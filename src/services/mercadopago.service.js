const { Preference } = require('mercadopago');
const { mpClient, mpEnabled } = require('../config/mercadopago');

/**
 * Creates a MercadoPago preference for the order.
 * @param {Object} order - Mongoose Order model instance
 * @param {string} hostUrl - Base URL of our application (e.g. http://localhost:3000)
 * @returns {Promise<{ initPoint: string, preferenceId: string }>}
 */
const createOrderPreference = async (order, hostUrl) => {
  const items = order.products.map(item => ({
    id: item.product.toString(),
    title: item.title,
    quantity: item.quantity,
    unit_price: Number(item.price),
    currency_id: 'ARS'
  }));

  if (mpEnabled && mpClient) {
    try {
      const preference = new Preference(mpClient);
      const body = {
        items,
        back_urls: {
          success: `${hostUrl}/payment/feedback?status=success&orderId=${order._id}`,
          failure: `${hostUrl}/payment/feedback?status=failure&orderId=${order._id}`,
          pending: `${hostUrl}/payment/feedback?status=pending&orderId=${order._id}`
        },
        // Make sure notification_url uses HTTPS if in production, otherwise MercadoPago webhook won't work.
        // For local development it defaults to feedback page redirects.
        notification_url: hostUrl.includes('localhost') ? null : `${hostUrl}/payment/webhook`,
        external_reference: order._id.toString()
      };

      // MercadoPago restricts auto_return to secure HTTPS URLs only
      if (hostUrl.startsWith('https://')) {
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
