const express = require('express');
const router = express.Router();
const partnerController = require('../controllers/partner.controller');
const { isPartnerAuthenticated } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Public Partner Portal Login
router.get('/partner/login', partnerController.getLogin);
router.post('/partner/login', partnerController.postLogin);
router.get('/partner/logout', partnerController.getLogout);

// Partner Self-Registration Page (Public but Token-restricted)
router.get('/partner/register', partnerController.getRegister);
router.post('/partner/register', upload.single('logo'), partnerController.postRegister);

// Protected Partner Portal routes
router.get('/partner/panel', isPartnerAuthenticated, partnerController.getPanel);
router.post('/partner/profile', isPartnerAuthenticated, upload.single('logo'), partnerController.updateProfile);
router.post('/partner/products', isPartnerAuthenticated, upload.array('images', 3), partnerController.createProduct);
router.post('/partner/products/:id/stock', isPartnerAuthenticated, partnerController.updateStock);
router.post('/partner/products/:id/price', isPartnerAuthenticated, partnerController.updatePrice);
router.post('/partner/products/:id/edit', isPartnerAuthenticated, partnerController.updateProductDetails);
router.post('/partner/products/:id/delete', isPartnerAuthenticated, partnerController.deleteProduct);

// Accounting & Payouts
router.post('/partner/bank-details', isPartnerAuthenticated, partnerController.updateBankDetails);
router.post('/partner/withdraw', isPartnerAuthenticated, partnerController.requestWithdrawal);
router.post('/partner/location', isPartnerAuthenticated, partnerController.updateLocation);
router.post('/partner/locations', isPartnerAuthenticated, partnerController.addLocation);
router.post('/partner/locations/:id/delete', isPartnerAuthenticated, partnerController.deleteLocation);

// Partner Driver Management
router.post('/partner/drivers', isPartnerAuthenticated, partnerController.createPartnerDriver);
router.post('/partner/drivers/:id/delete', isPartnerAuthenticated, partnerController.deletePartnerDriver);
router.post('/partner/orders/:id/assign-driver', isPartnerAuthenticated, partnerController.assignDriverToOrder);
router.post('/partner/orders/dispatch-route', isPartnerAuthenticated, partnerController.dispatchPartnerRoute);
router.post('/partner/orders/:id/ship', isPartnerAuthenticated, partnerController.shipOrder);
router.get('/partner/orders/:id/ticket', isPartnerAuthenticated, partnerController.generatePartnerPDFTicket);
router.get('/partner/download-summary', isPartnerAuthenticated, partnerController.downloadMonthlySummary);
router.get('/partner/statistics/pdf', isPartnerAuthenticated, partnerController.generatePartnerStatisticsPDF);
router.get('/partner/pos', isPartnerAuthenticated, partnerController.getPOSView);
router.post('/partner/pos/sale', isPartnerAuthenticated, partnerController.postPOSSale);
router.post('/partner/pos/pay-commissions', isPartnerAuthenticated, partnerController.payPOSCommissions);

module.exports = router;
