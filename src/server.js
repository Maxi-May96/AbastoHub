const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');

// Connect to Database
connectDB();

// Start Server Listening
const PORT = env.port;
const server = app.listen(PORT, () => {
  console.log(`🚀 AbastoHub Server is running in [${env.nodeEnv}] mode on http://localhost:${PORT}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('💥 Process terminated.');
  });
});
