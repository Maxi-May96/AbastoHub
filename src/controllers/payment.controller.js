const Cart = require('../models/Cart');
const Order = require('../models/Order');
const User = require('../models/User');
const { createOrderPreference } = require('../services/mercadopago.service');
const { mpClient, mpEnabled } = require('../config/mercadopago');
const { Payment } = require('mercadopago');
const formatPrice = require('../utils/formatPrice');

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
    const { name, phone, deliveryType, street, city, zipCode, notes } = req.body;

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

    // 2. Create Order in Database (Pending status)
    const newOrder = new Order({
      user: req.user.id,
      products: orderProducts,
      total,
      paymentStatus: 'pending',
      deliveryType,
      shippingDetails: {
        name: name || `${req.user.name} ${req.user.lastname}`,
        phone: phone || '',
        address: deliveryType === 'delivery' ? street : 'Retiro por sucursal',
        city: deliveryType === 'delivery' ? city : '',
        zipCode: deliveryType === 'delivery' ? zipCode : '',
        notes: notes || ''
      }
    });

    await newOrder.save();

    // 3. Clear user's Shopping Cart
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
    let normalizedStatus = 'failure';
    if (status) {
      const statusArray = Array.isArray(status) ? status : [status];
      if (statusArray.includes('success') || statusArray.includes('approved')) {
        normalizedStatus = 'success';
      } else if (statusArray.includes('pending') || statusArray.includes('in_process')) {
        normalizedStatus = 'pending';
      }
    }

    // Update payment status from callback parameters
    if (normalizedStatus === 'success') {
      order.paymentStatus = 'paid';
      const finalPaymentId = Array.isArray(payment_id) ? payment_id[0] : payment_id;
      order.paymentId = finalPaymentId || order.paymentId || 'MP-' + Date.now();
      await order.save();
    } else if (normalizedStatus === 'pending') {
      order.paymentStatus = 'pending';
      await order.save();
    } else {
      order.paymentStatus = 'failed';
      await order.save();
    }

    res.render('pages/checkout-feedback', {
      title: 'Resultado del Pago',
      order,
      status: normalizedStatus,
      formatPrice
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

module.exports = {
  getCheckout,
  processCheckout,
  getFeedback,
  handleWebhook,
  getSimulateCheckout,
  postSimulateCheckout
};
