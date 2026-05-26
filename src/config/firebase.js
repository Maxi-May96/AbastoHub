const admin = require('firebase-admin');
const env = require('./env');

let bucket = null;
let firebaseEnabled = false;

if (env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.firebase.projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey,
      }),
      storageBucket: env.firebase.storageBucket || `${env.firebase.projectId}.appspot.com`
    });
    
    bucket = admin.storage().bucket();
    firebaseEnabled = true;
    console.log('✅ Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed:', error.message);
    console.info('Falling back to local disk storage uploads.');
  }
} else {
  console.log('ℹ️ Firebase credentials incomplete. Local upload fallback will be active.');
}

module.exports = {
  admin,
  bucket,
  firebaseEnabled
};
