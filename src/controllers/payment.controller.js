const Cart = require('../models/Cart');
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const { createOrderPreference } = require('../services/mercadopago.service');
const { mpClient, mpEnabled } = require('../config/mercadopago');
const { Payment } = require('mercadopago');
const formatPrice = require('../utils/formatPrice');
const { uploadImage } = require('../services/firebase.service');

// GET Checkout Page
const getCheckout = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id }).populate('products.product');
    
    if (!cart || cart.products.length === 0) {
      return res.redirect('/cart');
    }

    // Recalculate totals and check prices
    let total = 0;
    cart.products.forEach(item => {
      const isWholesale = item.quantity >= 6;
      const discountFactor = 1 - (item.product.discount || 0) / 100;
      const basePrice = item.product.price * discountFactor;
      const baseWholesalePrice = item.product.wholesalePrice * discountFactor;
      const priceToUse = isWholesale ? baseWholesalePrice : basePrice;
      item.activePrice = priceToUse;
      total += priceToUse * item.quantity;
    });

    const user = await User.findById(req.user.id);
    const defaultAddress = user.addresses.find(addr => addr.isDefault) || user.addresses[0] || null;

    res.render('pages/checkout', {
      title: 'Checkout',
      cart,
      user,
      defaultAddress,
      total,
      formatPrice
    });
  } catch (error) {
    next(error);
  }
};

// POST Process Checkout Action
const processCheckout = async (req, res, next) => {
  try {
    const { name, phone, deliveryType, street, city, province, zipCode, notes, scheduledDate, latitude, longitude } = req.body;

    const cart = await Cart.findOne({ user: req.user.id }).populate('products.product');
    if (!cart || cart.products.length === 0) {
      return res.redirect('/cart');
    }

    // 1. Calculate final products details and total
    let total = 0;
    const orderProducts = cart.products.map(item => {
      const isWholesale = item.quantity >= 6;
      const discountFactor = 1 - (item.product.discount || 0) / 100;
      const basePrice = item.product.price * discountFactor;
      const baseWholesalePrice = item.product.wholesalePrice * discountFactor;
      const priceToUse = isWholesale ? baseWholesalePrice : basePrice;
      const subtotal = priceToUse * item.quantity;
      total += subtotal;

      return {
        product: item.product._id,
        title: item.product.title,
        quantity: item.quantity,
        price: priceToUse,
        unit: item.product.unit
      };
    });

    // Generate a unique raffle code: e.g. AH-XXXXXX (6 alphanumeric chars)
    let raffleCode;
    let codeExists = true;
    while (codeExists) {
      raffleCode = 'AH-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const existing = await Order.findOne({ raffleCode });
      if (!existing) {
        codeExists = false;
      }
    }

    // 2. Create Order in Database (Pending status)
    const newOrder = new Order({
      user: req.user.id,
      products: orderProducts,
      total,
      paymentStatus: 'pending',
      deliveryType: 'delivery', // Force delivery mode
      scheduledDate: scheduledDate ? new Date(scheduledDate + 'T00:00:00') : null,
      raffleCode,
      shippingDetails: {
        name: name || `${req.user.name} ${req.user.lastname}`,
        phone: phone || '',
        address: street || '',
        city: city || '',
        province: province || '',
        zipCode: zipCode || '',
        notes: notes || '',
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null
      }
    });

    await newOrder.save();

    // 3. Update or save default address in User profile so next time it is prefilled
    const userObj = await User.findById(req.user.id);
    if (userObj) {
      const newAddressData = {
        street: street || '',
        city: city || '',
        province: province || '',
        state: province || '', // compatibility
        zipCode: zipCode || '',
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        isDefault: true
      };

      // Set all other user addresses to isDefault = false
      userObj.addresses.forEach(addr => {
        addr.isDefault = false;
      });

      // Update first address or push new one
      if (userObj.addresses.length > 0) {
        userObj.addresses[0] = { ...userObj.addresses[0].toObject(), ...newAddressData };
      } else {
        userObj.addresses.push(newAddressData);
      }

      // Also update user's phone if provided
      if (phone) {
        userObj.phone = phone;
      }
      
      await userObj.save();
    }

    // 4. Clear user's Shopping Cart
    cart.products = [];
    cart.total = 0;
    await cart.save();

    // 4. Create MercadoPago preference URL
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const { initPoint } = await createOrderPreference(newOrder, hostUrl);

    // 5. Redirect user to MercadoPago Checkout (or Simulated Page)
    res.redirect(initPoint);
  } catch (error) {
    next(error);
  }
};

// Helper function to subtract stock for an order, preventing double subtraction
const subtractOrderStock = async (order) => {
  try {
    if (order.stockSubtracted) {
      console.log(`ℹ️ Stock already subtracted for order ${order._id}`);
      return;
    }

    console.log(`📉 Reducing stock for order ${order._id}...`);
    for (const item of order.products) {
      const prod = await Product.findById(item.product);
      if (prod) {
        const newStock = Math.max(0, prod.stock - item.quantity);
        prod.stock = newStock;
        await prod.save();
        console.log(`   - Product: ${prod.title}. Previous stock: ${prod.stock + item.quantity}, new stock: ${prod.stock}`);
      } else {
        console.warn(`   ⚠️ Product not found when trying to subtract stock: ${item.product}`);
      }
    }

    order.stockSubtracted = true;
    await order.save();
    console.log(`✅ Stock reduction completed for order ${order._id}`);
  } catch (error) {
    console.error('Error subtracting order stock:', error.message);
  }
};

// GET Payment Feedback Page (landing redirect from MercadoPago or simulator)
const getFeedback = async (req, res, next) => {
  try {
    const { status, orderId, payment_id } = req.query;

    const order = await Order.findById(orderId).populate('user');
    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Pedido no encontrado',
        status: 404,
        message: 'No pudimos localizar la orden para procesar el pago.',
        stack: null
      });
    }

    // Normalize status parameter to handle cases where it is parsed as an array due to duplicated query parameters
    let normalizedStatus = order.paymentStatus === 'paid' ? 'success' : 
                          (order.paymentStatus === 'pending' ? 'pending' : 
                          (order.paymentStatus === 'cancelled' ? 'cancelled' : 'failure'));
    
    if (status && order.paymentStatus !== 'cancelled') {
      const statusArray = Array.isArray(status) ? status : [status];
      if (statusArray.includes('success') || statusArray.includes('approved')) {
        normalizedStatus = 'success';
      } else if (statusArray.includes('pending') || statusArray.includes('in_process')) {
        normalizedStatus = 'pending';
      } else {
        normalizedStatus = 'failure';
      }

      // Update payment status from callback parameters
      if (normalizedStatus === 'success') {
        order.paymentStatus = 'paid';
        const finalPaymentId = Array.isArray(payment_id) ? payment_id[0] : payment_id;
        order.paymentId = finalPaymentId || order.paymentId || 'MP-' + Date.now();
        await order.save();
        
        // Subtract stock upon successful payment
        await subtractOrderStock(order);
      } else if (normalizedStatus === 'pending') {
        order.paymentStatus = 'pending';
        await order.save();
      } else {
        order.paymentStatus = 'failed';
        await order.save();
      }
    }

    res.render('pages/checkout-feedback', {
      title: 'Resultado del Pago',
      order,
      status: normalizedStatus,
      formatPrice,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
};

// POST MercadoPago Webhook / IPN Receiver
const handleWebhook = async (req, res) => {
  try {
    const { query, body } = req;
    console.log('📬 Webhook received from MercadoPago:', { query, body });
    
    // Extract payment ID from webhook body or IPN query params
    let paymentId = null;
    if (body && body.data && body.data.id) {
      paymentId = body.data.id;
    } else if (query && query.id && (query.topic === 'payment' || query.type === 'payment')) {
      paymentId = query.id;
    } else if (body && body.type === 'payment' && body.id) {
      paymentId = body.id;
    }

    if (paymentId && mpEnabled && mpClient) {
      console.log(`🔍 Querying MercadoPago details for Payment ID: ${paymentId}`);
      const payment = new Payment(mpClient);
      const paymentDetails = await payment.get({ id: paymentId });
      
      console.log(`🔍 MercadoPago Payment status for ${paymentId}: ${paymentDetails.status}`);
      
      const orderId = paymentDetails.external_reference;
      if (orderId) {
        const order = await Order.findById(orderId);
        if (order) {
          if (paymentDetails.status === 'approved') {
            order.paymentStatus = 'paid';
            order.paymentId = paymentId.toString();
            await order.save();
            await subtractOrderStock(order);
            console.log(`✅ Order ${orderId} marked as PAID via MercadoPago webhook.`);
          } else if (paymentDetails.status === 'rejected' || paymentDetails.status === 'cancelled') {
            order.paymentStatus = 'failed';
            await order.save();
            console.log(`❌ Order ${orderId} marked as FAILED via MercadoPago webhook.`);
          }
        } else {
          console.warn(`⚠️ Webhook received for non-existent Order ID: ${orderId}`);
        }
      } else {
        console.warn(`⚠️ No external_reference found for payment ID: ${paymentId}`);
      }
    } else {
      console.log('ℹ️ Webhook received, but payment ID not found or MercadoPago SDK not enabled.');
    }
    
    // Always acknowledge the notification with 200 OK to MercadoPago
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error.message);
    res.status(500).send('Internal Server Error');
  }
};

// GET Simulated Checkout Portal (Fallback View)
const getSimulateCheckout = async (req, res, next) => {
  try {
    const { preferenceId, orderId } = req.query;
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Error de Simulación',
        status: 404,
        message: 'No se puede simular pago para una orden inexistente.',
        stack: null
      });
    }

    res.render('pages/checkout-simulation', {
      title: 'MercadoPago — Simulación de Pago',
      order,
      preferenceId,
      formatPrice
    });
  } catch (error) {
    next(error);
  }
};

// POST Process Simulated Checkout
const postSimulateCheckout = async (req, res, next) => {
  try {
    const { orderId, preferenceId, action } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).send('Orden no encontrada');
    }

    if (action === 'approve') {
      order.paymentStatus = 'paid';
      order.paymentId = preferenceId;
      await order.save();
      await subtractOrderStock(order);
      
      return res.redirect(`/payment/feedback?status=success&orderId=${order._id}&payment_id=${preferenceId}`);
    } else {
      order.paymentStatus = 'failed';
      await order.save();
      
      return res.redirect(`/payment/feedback?status=failure&orderId=${order._id}`);
    }
  } catch (error) {
    next(error);
  }
};

// POST Upload Payment Receipt for an order (Customer)
const uploadReceipt = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    
    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Pedido no encontrado',
        status: 404,
        message: 'No pudimos localizar la orden para subir el comprobante.',
        stack: null
      });
    }

    // Verify order ownership
    if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).render('pages/error', {
        title: 'No autorizado',
        status: 403,
        message: 'No tienes permisos para modificar este pedido.',
        stack: null
      });
    }

    if (!req.file) {
      return res.redirect(`/payment/feedback?status=${order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'pending' ? 'pending' : 'failure'}&orderId=${order._id}&error=${encodeURIComponent('Por favor, selecciona un archivo de comprobante válido.')}`);
    }

    // Upload image proof to Firebase/local disk
    const receiptUrl = await uploadImage(req.file, 'receipts');
    if (!receiptUrl) {
      throw new Error('No se pudo procesar la imagen del comprobante.');
    }

    order.paymentReceipt = receiptUrl;
    await order.save();

    res.redirect(`/payment/feedback?status=${order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'pending' ? 'pending' : 'failure'}&orderId=${order._id}&success=${encodeURIComponent('Comprobante subido exitosamente. El administrador lo verificará a la brevedad.')}`);
  } catch (error) {
    next(error);
  }
};

// GET User's Order History Page
const getOrderHistory = async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    
    res.render('pages/orders-history', {
      title: 'Mis Compras',
      orders,
      formatPrice
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCheckout,
  processCheckout,
  getFeedback,
  handleWebhook,
  getSimulateCheckout,
  postSimulateCheckout,
  uploadReceipt,
  getOrderHistory
};
