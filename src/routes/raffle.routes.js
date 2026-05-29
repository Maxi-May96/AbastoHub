const express = require('express');
const router = express.Router();
const raffleController = require('../controllers/raffle.controller');
const { isAuthenticated, isAdmin } = require('../middlewares/auth.middleware');

// Public Sorteo routes
router.get('/sorteo', raffleController.getRafflePage);
router.post('/sorteo', raffleController.postRegisterRaffle);

// Admin Sorteo routes
router.get('/admin/raffle/download-json', isAuthenticated, isAdmin, raffleController.downloadParticipantsJSON);
router.post('/admin/raffle/draw', isAuthenticated, isAdmin, raffleController.drawWinner);
router.post('/admin/raffle/clear', isAuthenticated, isAdmin, raffleController.clearRaffleData);

module.exports = router;
