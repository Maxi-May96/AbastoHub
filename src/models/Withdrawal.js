const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true
  },
  amount: {
    type: Number,
    required: [true, 'El monto del retiro es obligatorio'],
    min: [1, 'El monto mínimo de retiro es $1']
  },
  alias: {
    type: String,
    required: [true, 'El alias para la transferencia es obligatorio'],
    trim: true
  },
  cbu: {
    type: String,
    required: [true, 'El CBU/CVU es obligatorio'],
    trim: true
  },
  bankName: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
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

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);
