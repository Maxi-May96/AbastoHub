const mongoose = require('mongoose');

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
  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Partner', PartnerSchema);
