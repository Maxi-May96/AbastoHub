const Cart = require('../models/Cart');
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const { createOrderPreference } = require('../services/mercadopago.service');
const { mpClient, mpEnabled } = require('../config/mercadopago');
const { Payment } = require('mercadopago');
const Coupon = require('../models/Coupon');
const formatPrice = require('../utils/formatPrice');
const { uploadImage } = require('../services/firebase.service');

// GET Checkout Page
const getCheckout = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id }).populate({
      path: 'products.product',
      populate: { path: 'partner' }
    });
    
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
      formatPrice,
      error: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
};

// POST Process Checkout Action
const processCheckout = async (req, res, next) => {
  try {
    const { name, phone, deliveryType, street, city, province, zipCode, notes, scheduledDate, latitude, longitude, paymentMethod, couponCode } = req.body;

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

    // 1b. Validate Coupon and Calculate Discount
    let discountAmount = 0;
    let appliedCode = null;

    if (couponCode && couponCode.trim() !== '') {
      const uppercaseCode = couponCode.toUpperCase().trim();
      const coupon = await Coupon.findOne({ code: uppercaseCode });

      if (!coupon || !coupon.active) {
        return res.redirect('/checkout?error=' + encodeURIComponent('El cupón no es válido o ha sido desactivado.'));
      }

      // Check dates
      const now = new Date();
      if (coupon.startDate && coupon.startDate > now) {
        return res.redirect('/checkout?error=' + encodeURIComponent('El cupón no está disponible actualmente.'));
      }
      if (coupon.endDate && coupon.endDate < now) {
        return res.redirect('/checkout?error=' + encodeURIComponent('El cupón ha vencido.'));
      }

      // Check usage limit
      if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
        return res.redirect('/checkout?error=' + encodeURIComponent('El cupón ha alcanzado su límite de usos.'));
      }

      // Check user usage
      if (coupon.usedBy.some(id => id.toString() === req.user.id.toString())) {
        return res.redirect('/checkout?error=' + encodeURIComponent('Ya has utilizado este cupón anteriormente.'));
      }

      // Calculate eligible subtotal
      let eligibleSubtotal = 0;
      cart.products.forEach(item => {
        const isWholesale = item.quantity >= 6;
        const discountFactor = 1 - (item.product.discount || 0) / 100;
        const basePrice = item.product.price * discountFactor;
        const baseWholesalePrice = item.product.wholesalePrice * discountFactor;
        const priceToUse = isWholesale ? baseWholesalePrice : basePrice;
        const subtotal = priceToUse * item.quantity;

        if (coupon.partner === null || coupon.partner.toString() === item.product.partner.toString()) {
          eligibleSubtotal += subtotal;
        }
      });

      if (eligibleSubtotal === 0) {
        return res.redirect('/checkout?error=' + encodeURIComponent('Tu carrito no incluye productos elegibles para este cupón.'));
      }

      if (eligibleSubtotal < coupon.minPurchase) {
        return res.redirect('/checkout?error=' + encodeURIComponent(`Compra mínima no alcanzada para este cupón (Mínimo: ${formatPrice(coupon.minPurchase)}).`));
      }

      // Calculate discount
      if (coupon.discountType === 'percentage') {
        discountAmount = eligibleSubtotal * (coupon.discountValue / 100);
      } else {
        discountAmount = coupon.discountValue;
      }

      if (discountAmount > eligibleSubtotal) {
        discountAmount = eligibleSubtotal;
      }

      discountAmount = Math.round(discountAmount * 100) / 100;
      appliedCode = coupon.code;

      // Update coupon usage
      coupon.usedCount += 1;
      coupon.usedBy.push(req.user.id);
      await coupon.save();
    }

    // Handle receipt upload for bank transfers
    let receiptUrl = null;
    if (paymentMethod === 'transfer') {
      if (!req.file) {
        return res.redirect('/checkout?error=' + encodeURIComponent('Por favor, sube una foto o PDF del comprobante de transferencia bancaria.'));
      }
      receiptUrl = await uploadImage(req.file, 'receipts');
      if (!receiptUrl) {
        return res.redirect('/checkout?error=' + encodeURIComponent('Error al subir el comprobante de transferencia.'));
      }
    }

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
    const discountedTotal = total - discountAmount;
    const isMp = (paymentMethod || 'mercadopago') === 'mercadopago';
    const taxFactor = isMp ? 1.20 : 1.05;
    const orderTotal = Number((discountedTotal * taxFactor).toFixed(2));

    const newOrder = new Order({
      user: req.user.id,
      products: orderProducts,
      subtotal: total,
      couponCode: appliedCode,
      discountAmount: discountAmount,
      total: orderTotal,
      paymentStatus: 'pending',
      paymentMethod: paymentMethod || 'mercadopago',
      paymentReceipt: receiptUrl || null,
      deliveryType: deliveryType === 'pickup' ? 'pickup' : 'delivery',
      scheduledDate: scheduledDate ? new Date(scheduledDate + 'T00:00:00') : null,
      raffleCode,
      shippingDetails: {
        name: name || `${req.user.name} ${req.user.lastname}`,
        phone: phone || '',
        address: deliveryType === 'pickup' ? 'Retiro por local del productor' : (street || ''),
        city: deliveryType === 'pickup' ? '' : (city || ''),
        province: deliveryType === 'pickup' ? '' : (province || ''),
        zipCode: deliveryType === 'pickup' ? '' : (zipCode || ''),
        notes: notes || '',
        latitude: deliveryType === 'pickup' ? null : (latitude ? parseFloat(latitude) : null),
        longitude: deliveryType === 'pickup' ? null : (longitude ? parseFloat(longitude) : null)
      }
    });

    await newOrder.save();

    // 3. Update or save default address in User profile so next time it is prefilled (only for delivery)
    const userObj = await User.findById(req.user.id);
    if (userObj) {
      if (deliveryType !== 'pickup') {
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

    // If Bank Transfer, redirect directly to feedback
    if (paymentMethod === 'transfer') {
      return res.redirect(`/payment/feedback?status=pending&orderId=${newOrder._id}`);
    }

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

        // Real-time notifications
        try {
          const io = req.app.get('io');
          if (io) {
            const formattedTotal = formatPrice(order.total);
            
            // 1. Notify Client (user_[userId])
            io.to(`user_${order.user._id}`).emit('notification', {
              title: '📦 Pedido confirmado',
              message: `Tu pedido por ${formattedTotal} ha sido confirmado. Código del Sorteo: ${order.raffleCode}`,
              type: 'order_confirmed',
              orderId: order._id,
              raffleCode: order.raffleCode
            });

            // 2. Notify Admins (admins)
            io.to('admins').emit('notification', {
              title: '📦 Nuevo pedido confirmado',
              message: `El pedido #${order._id.toString().substring(12).toUpperCase()} de ${order.shippingDetails.name} por ${formattedTotal} fue acreditado.`,
              type: 'admin_order_confirmed',
              orderId: order._id
            });

            // 3. Notify Partners of the products
            const productsWithPartners = await Order.findById(order._id).populate('products.product');
            if (productsWithPartners && productsWithPartners.products) {
              const partnerIds = [...new Set(productsWithPartners.products.map(p => p.product && p.product.partner && p.product.partner.toString()).filter(Boolean))];
              partnerIds.forEach(pId => {
                io.to(`partner_${pId}`).emit('notification', {
                  title: '📦 Nuevo pedido recibido',
                  message: `Has recibido un nuevo pedido (#${order._id.toString().substring(12).toUpperCase()}) de ${order.shippingDetails.name}.`,
                  type: 'partner_order_received',
                  orderId: order._id
                });
              });
            }
          }
        } catch (socketErr) {
          console.error('Error emitting checkout payment notifications:', socketErr.message);
        }
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

// Helper function to restore stock when an order is cancelled
const restoreOrderStock = async (order) => {
  try {
    if (!order.stockSubtracted) {
      console.log(`ℹ️ Stock was not subtracted for order ${order._id}, no need to restore.`);
      return;
    }

    console.log(`📈 Restoring stock for order ${order._id}...`);
    for (const item of order.products) {
      const prod = await Product.findById(item.product);
      if (prod) {
        const newStock = prod.stock + item.quantity;
        prod.stock = newStock;
        await prod.save();
        console.log(`   - Product: ${prod.title}. Restored stock: +${item.quantity}, new stock: ${prod.stock}`);
      } else {
        console.warn(`   ⚠️ Product not found when trying to restore stock: ${item.product}`);
      }
    }

    order.stockSubtracted = false;
    await order.save();
    console.log(`✅ Stock restoration completed for order ${order._id}`);
  } catch (error) {
    console.error('Error restoring order stock:', error.message);
  }
};

// POST Cancel Order and Request Refund (Customer side)
const cancelOrderAndRequestRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Pedido no encontrado',
        status: 404,
        message: 'No pudimos localizar la orden para realizar la cancelación.',
        stack: null
      });
    }

    // Verify order ownership
    if (order.user.toString() !== req.user.id) {
      return res.status(403).render('pages/error', {
        title: 'No autorizado',
        status: 403,
        message: 'No tienes permisos para cancelar este pedido.',
        stack: null
      });
    }

    // Verify status allows cancellation (must be before shipping)
    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
      return res.redirect('/orders/history?error=' + encodeURIComponent('No se puede cancelar la orden porque ya está en camino, entregada o ya fue cancelada.'));
    }

    // Cancel order
    order.status = 'cancelled';
    order.paymentStatus = 'cancelled';
    await order.save();

    // Restore stock if it was subtracted
    await restoreOrderStock(order);

    res.redirect('/orders/history?success=' + encodeURIComponent(`Pedido #${order._id.toString().substring(12).toUpperCase()} cancelado exitosamente y reembolso solicitado.`));
  } catch (error) {
    next(error);
  }
};

// GET User's Order History Page
const getOrderHistory = async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate({
        path: 'products.product',
        populate: {
          path: 'partner'
        }
      })
      .sort({ createdAt: -1 });
    
    res.render('pages/orders-history', {
      title: 'Mis Compras',
      orders,
      formatPrice,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
};

// POST Confirm Order Received (Customer side)
const receiveOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Pedido no encontrado',
        status: 404,
        message: 'No pudimos localizar el pedido.',
        stack: null
      });
    }

    // Verify order ownership
    if (order.user.toString() !== req.user.id) {
      return res.status(403).render('pages/error', {
        title: 'No autorizado',
        status: 403,
        message: 'No tienes permisos para modificar este pedido.',
        stack: null
      });
    }

    // Check status
    if (order.status !== 'shipped') {
      return res.redirect('/orders/history?error=' + encodeURIComponent('Solo se puede marcar como recibido un pedido que se encuentra En Camino.'));
    }

    order.status = 'delivered';
    order.deliveredAt = new Date();
    await order.save();

    res.redirect('/orders/history?success=' + encodeURIComponent(`Pedido #${order._id.toString().substring(12).toUpperCase()} confirmado como recibido. ¡Ya puedes usar tu código de sorteo!`));
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
  cancelOrderAndRequestRefund,
  getOrderHistory,
  receiveOrder
};
