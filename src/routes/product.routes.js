const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const { isAuthenticated, isAdmin } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Public catalog routes
router.get('/products', productController.getProducts);
router.get('/products/:slug', productController.getProductBySlug);

// Admin product management routes
router.get('/admin', isAuthenticated, isAdmin, productController.getAdminPanel);
router.post('/admin/products', isAuthenticated, isAdmin, upload.array('images', 3), productController.createProduct);
router.post('/admin/products/:id/stock', isAuthenticated, isAdmin, productController.updateStock);
router.post('/admin/products/:id/toggle', isAuthenticated, isAdmin, productController.toggleActive);
router.post('/admin/products/:id/toggle-featured', isAuthenticated, isAdmin, productController.toggleFeatured);
router.post('/admin/products/:id/discount', isAuthenticated, isAdmin, productController.updateDiscount);
router.post('/admin/products/:id/delete', isAuthenticated, isAdmin, productController.deleteProduct);
router.get('/admin/orders/report/pdf', isAuthenticated, isAdmin, productController.generateOrdersSummaryPDF);
router.get('/admin/orders/:id/pdf', isAuthenticated, isAdmin, productController.generatePDFTicket);
router.post('/admin/orders/:id/mark-paid', isAuthenticated, isAdmin, productController.markOrderAsPaid);

// Admin partner management routes
router.post('/admin/partners', isAuthenticated, isAdmin, upload.single('logo'), productController.createPartner);
router.post('/admin/partners/:id/delete', isAuthenticated, isAdmin, productController.deletePartner);

module.exports = router;
