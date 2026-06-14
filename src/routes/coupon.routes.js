const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { isAuthenticated, isAdmin, isPartnerAuthenticated } = require('../middlewares/auth.middleware');

// Public endpoints for customers
router.post('/api/coupons/apply', isAuthenticated, couponController.applyCoupon);

// Admin Coupon Management
router.post('/admin/coupons', isAuthenticated, isAdmin, couponController.createAdminCoupon);
router.post('/admin/coupons/:id/toggle', isAuthenticated, isAdmin, couponController.toggleAdminCoupon);
router.post('/admin/coupons/:id/delete', isAuthenticated, isAdmin, couponController.deleteAdminCoupon);

// Partner Coupon Management
router.post('/partner/coupons', isPartnerAuthenticated, couponController.createPartnerCoupon);
router.post('/partner/coupons/:id/toggle', isPartnerAuthenticated, couponController.togglePartnerCoupon);
router.post('/partner/coupons/:id/delete', isPartnerAuthenticated, couponController.deletePartnerCoupon);

module.exports = router;
