const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  port: process.env.PORT || 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/abastohub',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'abastohub_super_secret_jwt_key_2026',
  cookieSecret: process.env.COOKIE_SECRET || 'abastohub_super_secret_cookie_key_2026',
  
  // MercadoPago
  mpAccessToken: process.env.MP_ACCESS_TOKEN || null,
  mpPublicKey: process.env.MP_PUBLIC_KEY || null,
  
  // Firebase
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || null,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || null,
    privateKey: (() => {
      let key = process.env.FIREBASE_PRIVATE_KEY;
      if (!key) return null;
      key = key.trim();
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
      }
      return key.replace(/\\n/g, '\n');
    })(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || null
  }
};

// Check for required configuration elements
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: JWT_SECRET not specified. Using default development secret key.');
}
if (!process.env.COOKIE_SECRET) {
  console.warn('⚠️  WARNING: COOKIE_SECRET not specified. Using default development cookie key.');
}

// Log status of external services
if (!config.mpAccessToken || !config.mpPublicKey) {
  console.info('ℹ️  INFO: MercadoPago credentials missing. Running in payment simulation mode.');
} else {
  console.info('✅ INFO: MercadoPago configuration loaded.');
}

if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
  console.info('ℹ️  INFO: Firebase credentials missing. Falling back to local disk storage uploads.');
} else {
  console.info('✅ INFO: Firebase Storage configuration loaded.');
}

module.exports = config;
