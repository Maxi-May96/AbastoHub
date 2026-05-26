const mongoose = require('mongoose');
const env = require('./env');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000 // timeout fast if local Mongo is not running
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    console.log('Ensure that MongoDB is running locally or check your MONGO_URI in .env');
    // We won't exit the process right away so the developer gets a readable app log
  }
};

module.exports = connectDB;
