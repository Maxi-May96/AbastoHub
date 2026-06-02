const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { isDriverAuthenticated } = require('../middlewares/auth.middleware');

router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);

router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);

router.get('/logout', authController.getLogout);

// Driver Panel and Authentication
router.get('/driver/login', authController.getDriverLogin);
router.post('/driver/login', authController.postDriverLogin);
router.post('/driver/logout', authController.postDriverLogout);
router.get('/driver/panel', isDriverAuthenticated, authController.getDriverPanel);
router.post('/driver/orders/:id/deliver', isDriverAuthenticated, authController.deliverOrder);

module.exports = router;
