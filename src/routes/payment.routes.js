const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { isAuthenticated } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Checkout view and processing
router.get('/checkout', isAuthenticated, paymentController.getCheckout);
router.post('/checkout', isAuthenticated, paymentController.processCheckout);
router.get('/orders/history', isAuthenticated, paymentController.getOrderHistory);

// MercadoPago webhooks and feedback redirects
router.get('/payment/feedback', paymentController.getFeedback);
router.post('/payment/webhook', paymentController.handleWebhook);

// Upload payment receipt
router.post('/orders/:id/receipt', isAuthenticated, upload.single('receipt'), paymentController.uploadReceipt);

// Local checkout simulation (fallback when MP credentials are empty)
router.get('/payment/simulate-checkout', paymentController.getSimulateCheckout);
router.post('/payment/simulate-checkout', paymentController.postSimulateCheckout);

module.exports = router;
