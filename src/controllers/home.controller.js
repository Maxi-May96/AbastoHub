const Product = require('../models/Product');
const Category = require('../models/Category');
const Partner = require('../models/Partner');
const formatPrice = require('../utils/formatPrice');

const getHome = async (req, res, next) => {
  try {
    // Fetch all active categories
    const categories = await Category.find({});
    
    // Fetch featured active products (limit to 8)
    const featuredProducts = await Product.find({ featured: true, active: true })
      .populate('category')
      .limit(8);

    // Fetch latest active products (limit to 4)
    const latestProducts = await Product.find({ active: true })
      .sort({ createdAt: -1 })
      .populate('category')
      .limit(4);

    // Fetch active partners & affiliates
    const partners = await Partner.find({ active: true }).sort({ createdAt: -1 });

    res.render('pages/home', {
      title: 'Inicio',
      categories,
      featuredProducts,
      latestProducts,
      partners,
      formatPrice
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHome
};
