const mongoose = require('mongoose');
const env = require('./env');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000 // timeout fast if local Mongo is not running
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    
    // Migrate legacy boolean posFeePaid values
    try {
      const Order = require('../models/Order');
      const resUnpaid = await Order.updateMany({ posFeePaid: false }, { $set: { posFeePaid: 'unpaid' } });
      if (resUnpaid.modifiedCount > 0) {
        console.log(`🧹 Migrated ${resUnpaid.modifiedCount} legacy boolean 'false' posFeePaid orders to 'unpaid'.`);
      }
      const resPaid = await Order.updateMany({ posFeePaid: true }, { $set: { posFeePaid: 'paid' } });
      if (resPaid.modifiedCount > 0) {
        console.log(`🧹 Migrated ${resPaid.modifiedCount} legacy boolean 'true' posFeePaid orders to 'paid'.`);
      }
    } catch (migError) {
      console.error('⚠️ Error migrating legacy posFeePaid values:', migError.message);
    }
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    console.log('Ensure that MongoDB is running locally or check your MONGO_URI in .env');
    // We won't exit the process right away so the developer gets a readable app log
  }
};

module.exports = connectDB;
