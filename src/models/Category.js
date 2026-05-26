const mongoose = require('mongoose');
const slugifyHelper = require('../utils/slugify');

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre de la categoría es obligatorio'],
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    index: true
  },
  image: {
    type: String,
    default: '/img/placeholder-category.png'
  }
});

CategorySchema.pre('save', function () {
  if (this.isModified('name')) {
    this.slug = slugifyHelper(this.name);
  }
});

module.exports = mongoose.model('Category', CategorySchema);
