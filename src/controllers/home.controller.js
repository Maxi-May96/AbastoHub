const Product = require('../models/Product');
const Category = require('../models/Category');
const Partner = require('../models/Partner');
const Order = require('../models/Order');
const formatPrice = require('../utils/formatPrice');

const getHome = async (req, res, next) => {
  try {
    // Fetch all active categories
    const categories = await Category.find({});
    
    // Fetch 7 best-selling active products based on paid orders
    const topSold = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$products' },
      { $group: {
          _id: '$products.product',
          totalSold: { $sum: '$products.quantity' }
      }},
      { $sort: { totalSold: -1 } },
      { $limit: 7 }
    ]);

    const topProductIds = topSold.map(item => item._id);
    
    let bestSellers = [];
    if (topProductIds.length > 0) {
      bestSellers = await Product.find({ _id: { $in: topProductIds }, active: true })
        .populate('category')
        .populate('partner');
    }

    // Fallback if not enough best sellers are present
    if (bestSellers.length < 7) {
      const remainingCount = 7 - bestSellers.length;
      const remainingProducts = await Product.find({
        _id: { $nin: bestSellers.map(p => p._id) },
        active: true
      })
      .populate('category')
      .populate('partner')
      .limit(remainingCount);
      
      bestSellers = [...bestSellers, ...remainingProducts];
    }

    // Fetch latest active products (limit to 4)
    const latestProducts = await Product.find({ active: true })
      .sort({ createdAt: -1 })
      .populate('category')
      .limit(4);

    // Fetch active partners & affiliates
    const partners = await Partner.find({ active: true }).sort({ createdAt: -1 });

    // Fetch featured partner/producer (featured within 72 hours from now)
    const featuredPartner = await Partner.findOne({
      active: true,
      featuredUntil: { $gt: new Date() }
    });

    res.render('pages/home', {
      title: 'Inicio',
      categories,
      bestSellers,
      latestProducts,
      partners,
      featuredPartner,
      formatPrice
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHome
};
