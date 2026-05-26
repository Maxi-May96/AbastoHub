const { MercadoPagoConfig } = require('mercadopago');
const env = require('./env');

let mpClient = null;
let mpEnabled = false;

if (env.mpAccessToken) {
  try {
    mpClient = new MercadoPagoConfig({
      accessToken: env.mpAccessToken,
      options: { timeout: 5000 }
    });
    mpEnabled = true;
    console.log('✅ MercadoPago SDK initialized with provided token.');
  } catch (error) {
    console.error('❌ Failed to initialize MercadoPago SDK:', error.message);
    console.info('Falling back to MercadoPago simulation mode.');
  }
} else {
  console.log('ℹ️ MercadoPago Access Token not provided. Simulation Mode active.');
}

module.exports = {
  mpClient,
  mpEnabled
};
