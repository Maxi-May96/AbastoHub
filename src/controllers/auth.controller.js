const User = require('../models/User');
const Cart = require('../models/Cart');
const Driver = require('../models/Driver');
const Order = require('../models/Order');
const { generateToken, generateDriverToken } = require('../services/auth.service');
const { validateRegisterInput } = require('../utils/validators');
const formatPrice = require('../utils/formatPrice');

// GET Login Page
const getLogin = (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('pages/login', {
    title: 'Iniciar Sesión',
    error: null,
    success: null
  });
};

// POST Login Action
const postLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render('pages/login', {
        title: 'Iniciar Sesión',
        error: 'Por favor complete todos los campos.',
        success: null
      });
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.render('pages/login', {
        title: 'Iniciar Sesión',
        error: 'Correo electrónico o contraseña incorrectos.',
        success: null
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    // Save token in cookie (expires in 30 days)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    // Check redirection cookie
    const redirectTo = req.cookies.redirectTo || '/';
    res.clearCookie('redirectTo');
    
    return res.redirect(redirectTo);
  } catch (error) {
    next(error);
  }
};

// GET Register Page
const getRegister = (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('pages/register', {
    title: 'Registrarse',
    errors: [],
    inputData: {}
  });
};

// POST Register Action
const postRegister = async (req, res, next) => {
  try {
    const { name, lastname, email, phone, password, address_street, address_city } = req.body;
    
    const inputData = { name, lastname, email, phone, address_street, address_city };
    const { isValid, errors } = validateRegisterInput({ name, lastname, email, phone, password });

    if (!isValid) {
      return res.render('pages/register', {
        title: 'Registrarse',
        errors,
        inputData
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('pages/register', {
        title: 'Registrarse',
        errors: ['El correo electrónico ya está registrado.'],
        inputData
      });
    }

    // Construct address if provided
    const addresses = [];
    if (address_street && address_city) {
      addresses.push({
        street: address_street,
        city: address_city,
        isDefault: true
      });
    }

    // Create user
    const newUser = new User({
      name,
      lastname,
      email,
      phone,
      password,
      addresses
    });

    // Set first registered user as Admin for demonstration purposes in local MVP,
    // so developers can immediately use admin features! That's a super elegant developer feature.
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      newUser.role = 'admin';
    }

    await newUser.save();

    // Create cart for user
    const newCart = new Cart({
      user: newUser._id,
      products: [],
      total: 0
    });
    await newCart.save();

    // Log the user in
    const token = generateToken(newUser);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    return res.redirect('/');
  } catch (error) {
    next(error);
  }
};

// GET Logout
const getLogout = (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
};

// GET Driver Login Page
const getDriverLogin = (req, res) => {
  if (req.driver) return res.redirect('/driver/panel');
  res.render('pages/driver-login', {
    title: 'Iniciar Sesión - Conductor',
    error: req.query.error || null,
    success: req.query.success || null
  });
};

// POST Driver Login Action
const postDriverLogin = async (req, res, next) => {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.render('pages/driver-login', {
        title: 'Iniciar Sesión - Conductor',
        error: 'Por favor complete todos los campos.',
        success: null
      });
    }

    // Case-insensitive name lookup
    const driver = await Driver.findOne({ name: { $regex: new RegExp("^" + name.trim() + "$", "i") } });
    if (!driver || !(await driver.comparePassword(password))) {
      return res.render('pages/driver-login', {
        title: 'Iniciar Sesión - Conductor',
        error: 'Nombre de conductor o contraseña incorrectos.',
        success: null
      });
    }

    // Generate JWT token
    const token = generateDriverToken(driver);

    // Save token in cookie (expires in 30 days)
    res.cookie('driverToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    return res.redirect('/driver/panel');
  } catch (error) {
    next(error);
  }
};

// POST Driver Logout
const postDriverLogout = (req, res) => {
  res.clearCookie('driverToken');
  res.redirect('/driver/login?success=' + encodeURIComponent('Sesión de conductor cerrada.'));
};

// GET Driver Panel Dashboard
const getDriverPanel = async (req, res, next) => {
  try {
    // Pending orders (in transit / status: 'shipped')
    const pendingOrders = await Order.find({ 
      driverName: req.driver.name, 
      status: 'shipped' 
    }).sort({ dispatchedAt: -1 });

    // Recent delivered orders
    const deliveredOrders = await Order.find({ 
      driverName: req.driver.name, 
      status: 'delivered' 
    }).sort({ updatedAt: -1 }).limit(10);

    res.render('pages/driver-panel', {
      title: 'Panel de Reparto',
      driver: req.driver,
      pendingOrders,
      deliveredOrders,
      formatPrice,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
};

// POST Deliver Order
const deliverOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);

    if (!order) {
      return res.redirect('/driver/panel?error=' + encodeURIComponent('Pedido no encontrado.'));
    }

    // Verify order is assigned to this driver
    if (order.driverName !== req.driver.name) {
      return res.redirect('/driver/panel?error=' + encodeURIComponent('No tienes permiso para modificar este pedido.'));
    }

    // Update status
    order.status = 'delivered';
    await order.save();

    res.redirect('/driver/panel?success=' + encodeURIComponent(`Pedido #${order._id.toString().substring(12).toUpperCase()} entregado con éxito.`));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLogin,
  postLogin,
  getRegister,
  postRegister,
  getLogout,
  getDriverLogin,
  postDriverLogin,
  postDriverLogout,
  getDriverPanel,
  deliverOrder
};
