const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const connectDB = require('./config/db');

// Connect to Database (critical for serverless execution like Vercel)
connectDB();

// Middleware imports
const { loadUserSession } = require('./middlewares/auth.middleware');
const { errorHandler, notFoundHandler } = require('./middlewares/error.middleware');

// Route imports
const homeRoutes = require('./routes/home.routes');
const authRoutes = require('./routes/auth.routes');
const productRoutes = require('./routes/product.routes');
const cartRoutes = require('./routes/cart.routes');
const paymentRoutes = require('./routes/payment.routes');
const raffleRoutes = require('./routes/raffle.routes');

const app = express();
app.set('trust proxy', true);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(env.cookieSecret));

// Static files directories setup
app.use(express.static(path.join(__dirname, '../public')));

// Global session loader middleware (attaches user and cart count to res.locals)
app.use(loadUserSession);

// Bind application routers
app.use('/', homeRoutes);
app.use('/', authRoutes);
app.use('/', productRoutes);
app.use('/', cartRoutes);
app.use('/', paymentRoutes);
app.use('/', raffleRoutes);

// 404 Handler
app.use(notFoundHandler);

// Global Error Handler Page
app.use(errorHandler);

module.exports = app;
