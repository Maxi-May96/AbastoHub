const { verifyToken } = require('../services/auth.service');
const Cart = require('../models/Cart');

// Global middleware to populate res.locals.user and cart count for all routes
const loadUserSession = async (req, res, next) => {
  const token = req.cookies.token;
  res.locals.user = null;
  res.locals.cartCount = 0;
  req.user = null;

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      res.locals.user = decoded;
      
      // Load cart count dynamically
      try {
        const cart = await Cart.findOne({ user: decoded.id });
        if (cart && cart.products) {
          res.locals.cartCount = cart.products.reduce((sum, item) => sum + item.quantity, 0);
        }
      } catch (err) {
        console.error('Error fetching cart count in session middleware:', err.message);
      }
    } else {
      // Clear invalid cookie
      res.clearCookie('token');
    }
  }
  
  next();
};

// Check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (!req.user) {
    // Save original destination to redirect back after login
    res.cookie('redirectTo', req.originalUrl, { maxAge: 900000, httpOnly: true });
    return res.redirect('/login');
  }
  next();
};

// Check if user has admin role
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('pages/error', {
      message: 'No autorizado. Se requiere nivel de administrador.',
      status: 403,
      title: 'Acceso Denegado'
    });
  }
  next();
};

module.exports = {
  loadUserSession,
  isAuthenticated,
  isAdmin
};
