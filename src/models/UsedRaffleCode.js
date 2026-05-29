const mongoose = require('mongoose');

const UsedRaffleCodeSchema = new mongoose.Schema({
  raffleCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  usedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('UsedRaffleCode', UsedRaffleCodeSchema);
