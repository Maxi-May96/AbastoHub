const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PartnerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre del socio/afiliado es obligatorio'],
    trim: true
  },
  logo: {
    type: String,
    required: [true, 'El logo del socio/afiliado es obligatorio']
  },
  website: {
    type: String,
    trim: true,
    default: ''
  },
  type: {
    type: String,
    enum: ['socio', 'afiliado'],
    default: 'socio'
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  province: {
    type: String,
    trim: true,
    default: ''
  },
  latitude: {
    type: Number,
    default: null
  },
  longitude: {
    type: Number,
    default: null
  },
  alias: {
    type: String,
    trim: true,
    default: ''
  },
  cbu: {
    type: String,
    trim: true,
    default: ''
  },
  bankName: {
    type: String,
    trim: true,
    default: ''
  },
  assignedDriver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null
  },
  locations: [{
    name: { type: String, required: true },
    address: { type: String, default: '' },
    province: { type: String, default: '' },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null }
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

// Pre-save hook to hash password
PartnerSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Instance method to check password
PartnerSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Partner', PartnerSchema);
