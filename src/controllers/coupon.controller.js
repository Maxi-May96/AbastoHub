const Coupon = require('../models/Coupon');
const Product = require('../models/Product');
const formatPrice = require('../utils/formatPrice');

// 1. API: Apply coupon
const applyCoupon = async (req, res, next) => {
  try {
    const { code, items } = req.body;
    if (!code) {
      return res.json({ success: false, message: 'Por favor, ingresa un código de cupón.' });
    }

    const uppercaseCode = code.toUpperCase().trim();
    const coupon = await Coupon.findOne({ code: uppercaseCode });

    if (!coupon || !coupon.active) {
      return res.json({ success: false, message: 'El cupón no es válido o ha sido desactivado.' });
    }

    // Check validity dates
    const now = new Date();
    if (coupon.startDate && coupon.startDate > now) {
      return res.json({ success: false, message: 'El cupón aún no está disponible para su uso.' });
    }
    if (coupon.endDate && coupon.endDate < now) {
      return res.json({ success: false, message: 'El cupón ha vencido.' });
    }

    // Check usage limit
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return res.json({ success: false, message: 'El cupón ha alcanzado el límite máximo de usos.' });
    }

    // Check if user has already used this coupon
    if (coupon.usedBy.some(id => id.toString() === req.user.id.toString())) {
      return res.json({ success: false, message: 'Ya has utilizado este cupón en una compra anterior.' });
    }

    // Recalculate totals and filter items by eligible products using the user's cart from database
    const Cart = require('../models/Cart');
    const cart = await Cart.findOne({ user: req.user.id }).populate('products.product');
    if (!cart || cart.products.length === 0) {
      return res.json({ success: false, message: 'El carrito está vacío.' });
    }

    let eligibleSubtotal = 0;
    let totalCartSubtotal = 0;

    for (const item of cart.products) {
      const dbProduct = item.product;
      if (!dbProduct) continue;

      // Calculate price just like checkout
      const isWholesale = item.quantity >= 6;
      const discountFactor = 1 - (dbProduct.discount || 0) / 100;
      const basePrice = dbProduct.price * discountFactor;
      const baseWholesalePrice = dbProduct.wholesalePrice * discountFactor;
      const priceToUse = isWholesale ? baseWholesalePrice : basePrice;

      const itemSubtotal = priceToUse * item.quantity;
      totalCartSubtotal += itemSubtotal;

      // If coupon is global (admin) OR belongs to this product's partner
      if (coupon.partner === null || coupon.partner.toString() === dbProduct.partner.toString()) {
        eligibleSubtotal += itemSubtotal;
      }
    }

    if (eligibleSubtotal === 0) {
      return res.json({
        success: false,
        message: coupon.partner 
          ? 'Este cupón solo es válido para productos del socio emisor y tu carrito no incluye productos de este.'
          : 'No hay productos elegibles para este cupón.'
      });
    }

    // Check minimum purchase limit
    if (eligibleSubtotal < coupon.minPurchase) {
      return res.json({
        success: false,
        message: `La compra mínima elegible para este cupón es ${formatPrice(coupon.minPurchase)} (Monto actual elegible: ${formatPrice(eligibleSubtotal)})`
      });
    }

    // Calculate discount value
    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
      discountAmount = eligibleSubtotal * (coupon.discountValue / 100);
    } else {
      discountAmount = coupon.discountValue;
    }

    // Limit discount to not exceed the eligible subtotal
    if (discountAmount > eligibleSubtotal) {
      discountAmount = eligibleSubtotal;
    }

    // Round discount to 2 decimals
    discountAmount = Math.round(discountAmount * 100) / 100;

    return res.json({
      success: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
      partner: coupon.partner,
      message: '¡Cupón aplicado con éxito!'
    });
  } catch (error) {
    console.error('Error applying coupon:', error);
    res.json({ success: false, message: 'Ocurrió un error al procesar el cupón.' });
  }
};

// 2. ADMIN Operations
const createAdminCoupon = async (req, res, next) => {
  try {
    const { code, discountType, discountValue, minPurchase, startDate, endDate, usageLimit } = req.body;

    const newCoupon = new Coupon({
      code: code.toUpperCase().trim(),
      discountType,
      discountValue: parseFloat(discountValue),
      minPurchase: parseFloat(minPurchase) || 0,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      partner: null // Admin coupon is global
    });

    await newCoupon.save();
    return res.redirect('/admin?tab=coupons');
  } catch (error) {
    next(error);
  }
};

const toggleAdminCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Cupón no encontrado' });
    }
    coupon.active = !coupon.active;
    await coupon.save();
    return res.json({ success: true, active: coupon.active });
  } catch (error) {
    next(error);
  }
};

const deleteAdminCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Coupon.findByIdAndDelete(id);
    return res.redirect('/admin?tab=coupons');
  } catch (error) {
    next(error);
  }
};

// 3. PARTNER Operations
const createPartnerCoupon = async (req, res, next) => {
  try {
    const { code, discountType, discountValue, minPurchase, startDate, endDate, usageLimit } = req.body;

    const newCoupon = new Coupon({
      code: code.toUpperCase().trim(),
      discountType,
      discountValue: parseFloat(discountValue),
      minPurchase: parseFloat(minPurchase) || 0,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      partner: req.partner.id // Scoped to current partner
    });

    await newCoupon.save();
    return res.redirect('/partner/panel?tab=coupons');
  } catch (error) {
    next(error);
  }
};

const togglePartnerCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findOne({ _id: id, partner: req.partner.id });
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Cupón no encontrado o no autorizado' });
    }
    coupon.active = !coupon.active;
    await coupon.save();
    return res.json({ success: true, active: coupon.active });
  } catch (error) {
    next(error);
  }
};

const deletePartnerCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Coupon.findOneAndDelete({ _id: id, partner: req.partner.id });
    return res.redirect('/partner/panel?tab=coupons');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  applyCoupon,
  createAdminCoupon,
  toggleAdminCoupon,
  deleteAdminCoupon,
  createPartnerCoupon,
  togglePartnerCoupon,
  deletePartnerCoupon
};
