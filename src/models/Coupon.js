const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CouponSchema = new Schema({
  code: {
    type: String,
    required: [true, 'El código es obligatorio'],
    unique: true,
    uppercase: true,
    trim: true
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: [true, 'El tipo de descuento es obligatorio']
  },
  discountValue: {
    type: Number,
    required: [true, 'El valor del descuento es obligatorio'],
    min: [0.01, 'El valor mínimo es 0.01']
  },
  minPurchase: {
    type: Number,
    default: 0,
    min: [0, 'El monto mínimo no puede ser negativo']
  },
  partner: {
    type: Schema.Types.ObjectId,
    ref: 'Partner',
    default: null // null indicates it is an Admin coupon (global to all products)
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    default: null // null means no expiration
  },
  usageLimit: {
    type: Number,
    default: null // null means unlimited
  },
  usedCount: {
    type: Number,
    default: 0
  },
  usedBy: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Clean up code to be uppercase before validation
CouponSchema.pre('validate', function() {
  if (this.code) {
    this.code = this.code.toUpperCase().trim();
  }
});

module.exports = mongoose.model('Coupon', CouponSchema);
