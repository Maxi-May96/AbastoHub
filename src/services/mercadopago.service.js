const { Preference } = require('mercadopago');
const { mpClient, mpEnabled } = require('../config/mercadopago');

/**
 * Creates a MercadoPago preference for the order.
 * @param {Object} order - Mongoose Order model instance
 * @param {string} hostUrl - Base URL of our application (e.g. http://localhost:3000)
 * @returns {Promise<{ initPoint: string, preferenceId: string }>}
 */
const createOrderPreference = async (order, hostUrl) => {
  const productsSubtotal = order.products.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  // Calculate proportional discount for each item if there is a discount
  let items = [];
  if (order.discountAmount > 0 && order.couponCode) {
    const Coupon = require('../models/Coupon');
    const Product = require('../models/Product');
    const coupon = await Coupon.findOne({ code: order.couponCode });
    
    let eligibleSubtotal = 0;
    const itemsWithEligibility = await Promise.all(order.products.map(async (item) => {
      const dbProduct = await Product.findById(item.product);
      const isEligible = dbProduct && (coupon && (coupon.partner === null || coupon.partner.toString() === dbProduct.partner.toString()));
      if (isEligible) {
        eligibleSubtotal += item.price * item.quantity;
      }
      return { item, isEligible };
    }));
    
    const partnerDiscountFactor = eligibleSubtotal > 0 ? (1 - order.discountAmount / eligibleSubtotal) : 1;
    
    items = itemsWithEligibility.map(({ item, isEligible }) => {
      const priceToUse = isEligible ? Number((item.price * partnerDiscountFactor).toFixed(2)) : Number(item.price);
      return {
        id: item.product.toString(),
        title: item.title,
        quantity: item.quantity,
        unit_price: priceToUse,
        currency_id: 'ARS'
      };
    });
  } else {
    items = order.products.map(item => ({
      id: item.product.toString(),
      title: item.title,
      quantity: item.quantity,
      unit_price: Number(item.price),
      currency_id: 'ARS'
    }));
  }

  // If the payment method is Mercado Pago, add the Platform fee and Gateway fee items
  if (order.paymentMethod === 'mercadopago') {
    const platformFee = Number(((productsSubtotal - order.discountAmount) * 0.05).toFixed(2));
    const gatewayFee = Number(((productsSubtotal - order.discountAmount) * 0.15).toFixed(2));
    
    items.push({
      id: 'fee_platform_5',
      title: 'Uso de Plataforma (5%)',
      quantity: 1,
      unit_price: platformFee,
      currency_id: 'ARS'
    }, {
      id: 'fee_tax_15',
      title: 'Impuestos + IVA (15%)',
      quantity: 1,
      unit_price: gatewayFee,
      currency_id: 'ARS'
    });
  }

  // Force HTTPS for production callback URLs
  let secureHostUrl = hostUrl;
  if (!hostUrl.includes('localhost') && hostUrl.startsWith('http://')) {
    secureHostUrl = hostUrl.replace('http://', 'https://');
  }

  if (mpEnabled && mpClient) {
    try {
      const preference = new Preference(mpClient);
      const body = {
        items,
        back_urls: {
          success: `${secureHostUrl}/payment/feedback?status=success&orderId=${order._id}`,
          failure: `${secureHostUrl}/payment/feedback?status=failure&orderId=${order._id}`,
          pending: `${secureHostUrl}/payment/feedback?status=pending&orderId=${order._id}`
        },
        // Make sure notification_url uses HTTPS if in production, otherwise MercadoPago webhook won't work.
        // For local development it defaults to feedback page redirects.
        notification_url: secureHostUrl.includes('localhost') ? null : `${secureHostUrl}/payment/webhook`,
        external_reference: order._id.toString()
      };

      // MercadoPago restricts auto_return to secure HTTPS URLs only
      if (secureHostUrl.startsWith('https://')) {
        body.auto_return = 'approved';
      }

      const response = await preference.create({ body });
      
      return {
        initPoint: response.init_point,
        preferenceId: response.id
      };
    } catch (error) {
      console.error('❌ MercadoPago preference creation failed:', error.message);
      console.info('Falling back to checkout simulation...');
    }
  }

  // Simulation mode fallback
  const mockPreferenceId = `pref_sim_${Date.now()}`;
  return {
    initPoint: `/payment/simulate-checkout?preferenceId=${mockPreferenceId}&orderId=${order._id}`,
    preferenceId: mockPreferenceId
  };
};

module.exports = {
  createOrderPreference
};
