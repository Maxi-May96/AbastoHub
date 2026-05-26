const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart.controller');
const { isAuthenticated } = require('../middlewares/auth.middleware');

router.get('/cart', isAuthenticated, cartController.getCart);
router.post('/cart/add', isAuthenticated, cartController.addToCart);
router.post('/cart/update', isAuthenticated, cartController.updateCartQuantity);
router.post('/cart/remove', isAuthenticated, cartController.removeFromCart);

module.exports = router;
