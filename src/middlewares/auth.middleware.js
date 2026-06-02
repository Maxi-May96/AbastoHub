const { verifyToken } = require('../services/auth.service');
const Cart = require('../models/Cart');

// Global middleware to populate res.locals.user and cart count for all routes
const loadUserSession = async (req, res, next) => {
  const token = req.cookies.token;
  const driverToken = req.cookies.driverToken;
  const partnerToken = req.cookies.partnerToken;
  res.locals.user = null;
  res.locals.driver = null;
  res.locals.partner = null;
  res.locals.cartCount = 0;
  req.user = null;
  req.driver = null;
  req.partner = null;

  // Set default absolute URL helpers and Open Graph metadata for social sharing
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  res.locals.baseUrl = baseUrl;
  res.locals.ogUrl = `${baseUrl}${req.originalUrl}`;
  res.locals.ogTitle = 'AbastoHub — Mercado Mayorista & Minorista';
  res.locals.ogDescription = 'Encuentra productos frescos, abarrotes y artículos al por mayor y menor con precios escalables en AbastoHub. Compra directa, rápida y segura.';
  res.locals.ogImage = `${baseUrl}/img/logo.png`;
  res.locals.ogType = 'website';

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

  if (driverToken) {
    const decoded = verifyToken(driverToken);
    if (decoded && decoded.role === 'driver') {
      req.driver = decoded;
      res.locals.driver = decoded;
    } else {
      // Clear invalid cookie
      res.clearCookie('driverToken');
    }
  }

  if (partnerToken) {
    const decoded = verifyToken(partnerToken);
    if (decoded && decoded.role === 'partner') {
      req.partner = decoded;
      res.locals.partner = decoded;
    } else {
      // Clear invalid cookie
      res.clearCookie('partnerToken');
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

// Check if driver is authenticated
const isDriverAuthenticated = (req, res, next) => {
  if (!req.driver) {
    return res.redirect('/driver/login');
  }
  next();
};

// Check if partner is authenticated
const isPartnerAuthenticated = (req, res, next) => {
  if (!req.partner) {
    return res.redirect('/partner/login');
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
  isDriverAuthenticated,
  isPartnerAuthenticated,
  isAdmin
};
