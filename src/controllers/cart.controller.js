const Cart = require('../models/Cart');
const Product = require('../models/Product');
const formatPrice = require('../utils/formatPrice');

// Helper to calculate cart totals and apply wholesale prices dynamically
const calculateCartTotal = (cart) => {
  let total = 0;
  
  if (cart.products && cart.products.length > 0) {
    cart.products.forEach(item => {
      if (item.product) {
        // Wholesale trigger: 6 or more units
        const isWholesale = item.quantity >= 6;
        const discountFactor = 1 - (item.product.discount || 0) / 100;
        const basePrice = item.product.price * discountFactor;
        const baseWholesalePrice = item.product.wholesalePrice * discountFactor;
        const priceToUse = isWholesale ? baseWholesalePrice : basePrice;
        
        // Temporarily store dynamic prices for view rendering without mutating mongoose schema values
        item.activePrice = priceToUse;
        item.wholesaleActive = isWholesale;
        
        total += priceToUse * item.quantity;
      }
    });
  }
  
  cart.total = total;
  return total;
};

// GET Cart Page
const getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user: req.user.id }).populate('products.product');
    
    if (!cart) {
      cart = new Cart({ user: req.user.id, products: [], total: 0 });
      await cart.save();
    }

    // Filter out items whose products might have been deleted from DB
    const originalLength = cart.products.length;
    cart.products = cart.products.filter(item => item.product !== null);
    
    calculateCartTotal(cart);
    
    if (cart.products.length !== originalLength || cart.isModified()) {
      await cart.save();
    }

    res.render('pages/cart', {
      title: 'Carrito de Compras',
      cart,
      formatPrice
    });
  } catch (error) {
    next(error);
  }
};

// POST Add to Cart
const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const qty = Number(quantity) || 1;

    const product = await Product.findById(productId);
    if (!product || !product.active) {
      return res.status(404).render('pages/error', {
        title: 'Error',
        status: 404,
        message: 'El producto no está disponible para agregar al carrito.',
        stack: null
      });
    }

    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      cart = new Cart({ user: req.user.id, products: [], total: 0 });
    }

    const existingProductIndex = cart.products.findIndex(
      item => item.product.toString() === productId
    );

    if (existingProductIndex > -1) {
      // Increment quantity
      cart.products[existingProductIndex].quantity += qty;
    } else {
      // Add new product item
      cart.products.push({
        product: productId,
        quantity: qty
      });
    }

    // Recalculate total (needs populate first)
    await cart.populate('products.product');
    calculateCartTotal(cart);
    await cart.save();

    res.redirect('/cart');
  } catch (error) {
    next(error);
  }
};

// POST Update Cart Item Quantity
const updateCartQuantity = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const qty = Number(quantity);

    if (isNaN(qty) || qty < 1) {
      // If quantity is invalid or less than 1, treat as removal
      return removeFromCartHandler(req, res, next, productId);
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) return res.redirect('/cart');

    const itemIndex = cart.products.findIndex(
      item => item.product.toString() === productId
    );

    if (itemIndex > -1) {
      cart.products[itemIndex].quantity = qty;
      
      // Load products to compute total
      await cart.populate('products.product');
      calculateCartTotal(cart);
      await cart.save();
    }

    res.redirect('/cart');
  } catch (error) {
    next(error);
  }
};

// POST Remove from Cart
const removeFromCart = async (req, res, next) => {
  try {
    const { productId } = req.body;
    await removeFromCartHandler(req, res, next, productId);
  } catch (error) {
    next(error);
  }
};

// Shared handler to remove an item from the cart
const removeFromCartHandler = async (req, res, next, productId) => {
  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) return res.redirect('/cart');

  cart.products = cart.products.filter(
    item => item.product.toString() !== productId
  );

  await cart.populate('products.product');
  calculateCartTotal(cart);
  await cart.save();

  res.redirect('/cart');
};

module.exports = {
  getCart,
  addToCart,
  updateCartQuantity,
  removeFromCart
};
