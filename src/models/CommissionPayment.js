const mongoose = require('mongoose');

const CommissionPaymentSchema = new mongoose.Schema({
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  paymentMethod: {
    type: String,
    enum: ['balance', 'transfer'],
    required: true
  },
  paymentReceipt: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  orders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  processedAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  }
});

module.exports = mongoose.model('CommissionPayment', CommissionPaymentSchema);
