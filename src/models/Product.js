const mongoose = require('mongoose');
const slugifyHelper = require('../utils/slugify');

const ProductSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'El título del producto es obligatorio'],
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    index: true
  },
  description: {
    type: String,
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'El precio minorista es obligatorio'],
    min: [0, 'El precio no puede ser negativo']
  },
  wholesalePrice: {
    type: Number,
    min: [0, 'El precio mayorista no puede ser negativo'],
    default: function() {
      return this.price;
    }
  },
  stock: {
    type: Number,
    required: [true, 'El stock es obligatorio'],
    min: [0, 'El stock no puede ser negativo'],
    default: 0
  },
  images: [{
    type: String
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'La categoría es obligatoria']
  },
  unit: {
    type: String,
    default: 'unidades', // e.g. "kg", "unidades", "cajón"
    trim: true
  },
  featured: {
    type: Boolean,
    default: false
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

ProductSchema.pre('save', function () {
  if (this.isModified('title')) {
    this.slug = slugifyHelper(this.title);
  }
});

module.exports = mongoose.model('Product', ProductSchema);
