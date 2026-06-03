const Partner = require('../models/Partner');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Withdrawal = require('../models/Withdrawal');
const Driver = require('../models/Driver');
const { uploadImage } = require('../services/firebase.service');
const { generatePartnerToken } = require('../services/auth.service');
const formatPrice = require('../utils/formatPrice');

// GET Partner Login Page
const getLogin = async (req, res, next) => {
  try {
    if (req.partner) {
      return res.redirect('/partner/panel');
    }
    res.render('pages/partner-login', { title: 'Portal de Socios - Iniciar Sesión' });
  } catch (error) {
    next(error);
  }
};

// POST Partner Login Authentication
const postLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.render('pages/partner-login', { 
        title: 'Portal de Socios - Iniciar Sesión',
        error: 'Por favor complete todos los campos.' 
      });
    }

    const partner = await Partner.findOne({ email: email.toLowerCase().trim() });
    if (!partner || !partner.active) {
      return res.render('pages/partner-login', { 
        title: 'Portal de Socios - Iniciar Sesión',
        error: 'Credenciales inválidas o cuenta de socio inactiva.' 
      });
    }

    const isMatch = await partner.comparePassword(password);
    if (!isMatch) {
      return res.render('pages/partner-login', { 
        title: 'Portal de Socios - Iniciar Sesión',
        error: 'Credenciales inválidas.' 
      });
    }

    const token = generatePartnerToken(partner);
    res.cookie('partnerToken', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
    res.redirect('/partner/panel');
  } catch (error) {
    console.error('Partner login error:', error.message);
    res.render('pages/partner-login', { 
      title: 'Portal de Socios - Iniciar Sesión',
      error: 'Error interno en el servidor.' 
    });
  }
};

// GET Partner Logout
const getLogout = async (req, res, next) => {
  try {
    res.clearCookie('partnerToken');
    res.redirect('/partner/login');
  } catch (error) {
    next(error);
  }
};

// GET Partner Panel Dashboard
const getPanel = async (req, res, next) => {
  try {
    const partnerId = req.partner.id;
    const partnerDoc = await Partner.findById(partnerId);
    if (!partnerDoc) {
      res.clearCookie('partnerToken');
      return res.redirect('/partner/login');
    }

    // Load partner products
    const products = await Product.find({ partner: partnerId }).populate('category').sort({ title: 1 });
    
    // Load all categories for product creation
    const categories = await Category.find({}).sort({ name: 1 });

    // Calculate Summary Stats
    const totalProducts = products.length;
    const activeProducts = products.filter(p => p.active).length;
    const outOfStockProducts = products.filter(p => p.stock <= 0).length;

    // Load orders containing partner products
    const partnerProductIds = products.map(p => p._id);
    const rawOrders = await Order.find({ 'products.product': { $in: partnerProductIds } })
      .populate('user')
      .sort({ createdAt: -1 });

    // Format orders: keep only partner products, calculate partner subtotal
    const orders = rawOrders.map(order => {
      const partnerItems = order.products.filter(item =>
        partnerProductIds.some(pId => pId.toString() === item.product.toString())
      );
      const partnerSubtotal = partnerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      
      const orderObj = order.toObject();
      orderObj.partnerProducts = partnerItems;
      orderObj.partnerSubtotal = partnerSubtotal;
      return orderObj;
    });

    // Load all withdrawals for the partner
    const withdrawals = await Withdrawal.find({ partner: partnerId }).sort({ createdAt: -1 });

    // Load drivers registered by this partner
    const partnerDrivers = await Driver.find({ partner: partnerId }).sort({ name: 1 });
    
    // Load admin assigned driver if any
    let assignedDriver = null;
    if (partnerDoc.assignedDriver) {
      assignedDriver = await Driver.findById(partnerDoc.assignedDriver);
    }

    // Calculate earnings from paid orders
    const totalEarnings = orders.reduce((sum, o) => sum + (o.paymentStatus === 'paid' ? o.partnerSubtotal : 0), 0);

    // Calculate approved and pending withdrawals
    const totalApprovedWithdrawals = withdrawals.filter(w => w.status === 'approved').reduce((sum, w) => sum + w.amount, 0);
    const totalPendingWithdrawals = withdrawals.filter(w => w.status === 'pending').reduce((sum, w) => sum + w.amount, 0);

    // Available balance
    const availableBalance = totalEarnings - totalApprovedWithdrawals - totalPendingWithdrawals;

    res.render('pages/partner-panel', {
      title: 'Panel de Socio - AbastoHub',
      partner: partnerDoc,
      products,
      categories,
      orders,
      withdrawals,
      partnerDrivers,
      assignedDriver,
      totalProducts,
      activeProducts,
      outOfStockProducts,
      totalEarnings,
      totalApprovedWithdrawals,
      totalPendingWithdrawals,
      availableBalance,
      formatPrice,
      success: req.query.success,
      error: req.query.error
    });
  } catch (error) {
    next(error);
  }
};

// POST Partner Create Product
const createProduct = async (req, res, next) => {
  try {
    const { title, description, price, wholesalePrice, stock, categoryId, unit } = req.body;
    
    if (!title || !price || !stock || !categoryId) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Por favor complete todos los campos obligatorios.'));
    }

    // Handle image uploads
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadImage(file, 'products');
        if (url) imageUrls.push(url);
      }
    }

    // Default image if none uploaded
    if (imageUrls.length === 0) {
      imageUrls.push('/img/placeholder-product.png');
    }

    const newProduct = new Product({
      title,
      description,
      price: Number(price),
      wholesalePrice: wholesalePrice ? Number(wholesalePrice) : Number(price),
      stock: Number(stock),
      images: imageUrls,
      category: categoryId,
      unit: unit || 'unidades',
      partner: req.partner.id, // Associated with partner!
      active: true
    });

    await newProduct.save();
    res.redirect('/partner/panel?success=' + encodeURIComponent('Producto creado exitosamente y asignado a tu catálogo.'));
  } catch (error) {
    console.error('Partner create product error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al crear el producto: ' + error.message));
  }
};

// POST Partner Update Stock
const updateStock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;
    
    if (stock === undefined || stock === '') {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Valor de stock no válido.'));
    }

    const product = await Product.findOne({ _id: id, partner: req.partner.id });
    if (!product) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Producto no encontrado o no tienes permisos.'));
    }

    product.stock = Number(stock);
    await product.save();

    res.redirect('/partner/panel?success=' + encodeURIComponent('Stock actualizado exitosamente.'));
  } catch (error) {
    console.error('Partner update stock error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al actualizar el stock.'));
  }
};

// POST Partner Update Price
const updatePrice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { price, wholesalePrice } = req.body;
    
    if (price === undefined || price === '' || wholesalePrice === undefined || wholesalePrice === '') {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Precios no válidos.'));
    }

    const product = await Product.findOne({ _id: id, partner: req.partner.id });
    if (!product) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Producto no encontrado o no tienes permisos.'));
    }

    product.price = Number(price);
    product.wholesalePrice = Number(wholesalePrice);
    await product.save();

    res.redirect('/partner/panel?success=' + encodeURIComponent('Precios actualizados exitosamente.'));
  } catch (error) {
    console.error('Partner update price error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al actualizar precios.'));
  }
};

// POST Partner Update Product Details (Title, Description, Category)
const updateProductDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, categoryId } = req.body;
    
    if (!title || !title.trim() || !categoryId) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('El nombre y la categoría del producto son obligatorios.'));
    }

    const product = await Product.findOne({ _id: id, partner: req.partner.id });
    if (!product) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Producto no encontrado o no tienes permisos.'));
    }

    product.title = title.trim();
    product.description = (description || '').trim();
    product.category = categoryId;
    
    await product.save();

    res.redirect('/partner/panel?success=' + encodeURIComponent('Detalles de producto actualizados exitosamente.'));
  } catch (error) {
    console.error('Partner update product details error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al actualizar el producto: ' + error.message));
  }
};

// POST Partner Delete Product
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const product = await Product.findOneAndDelete({ _id: id, partner: req.partner.id });
    if (!product) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Producto no encontrado o no tienes permisos.'));
    }

    res.redirect('/partner/panel?success=' + encodeURIComponent('Producto eliminado permanentemente de tu catálogo.'));
  } catch (error) {
    console.error('Partner delete product error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al eliminar el producto.'));
  }
};

// POST Partner Update Bank Details
const updateBankDetails = async (req, res, next) => {
  try {
    const { alias, cbu, bankName } = req.body;
    
    if (!alias || !cbu) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('El Alias y el CBU/CVU son campos obligatorios.'));
    }

    const partner = await Partner.findById(req.partner.id);
    if (!partner) {
      return res.redirect('/partner/login');
    }

    partner.alias = alias.trim();
    partner.cbu = cbu.trim();
    partner.bankName = (bankName || '').trim();
    await partner.save();

    res.redirect('/partner/panel?success=' + encodeURIComponent('Datos de transferencia bancaria actualizados con éxito.'));
  } catch (error) {
    console.error('Update bank details error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al actualizar datos bancarios.'));
  }
};

const updateLocation = async (req, res, next) => {
  try {
    const { province, latitude, longitude, address } = req.body;
    
    if (!province || !latitude || !longitude) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('La provincia y la ubicación geográfica en el mapa son obligatorias.'));
    }

    const partner = await Partner.findById(req.partner.id);
    if (!partner) {
      return res.redirect('/partner/login');
    }

    partner.province = province.trim();
    partner.latitude = Number(latitude);
    partner.longitude = Number(longitude);
    if (address !== undefined) {
      partner.address = address.trim();
    }
    await partner.save();

    res.redirect('/partner/panel?success=' + encodeURIComponent('Ubicación del negocio configurada con éxito.'));
  } catch (error) {
    console.error('Update location error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al actualizar la ubicación.'));
  }
};

// POST Partner Request Payout/Withdrawal
const requestWithdrawal = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const partnerId = req.partner.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.redirect('/partner/login');
    }

    // Validate bank coordinates are present
    if (!partner.alias || !partner.cbu) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Debes configurar tus datos de transferencia bancaria (Alias y CBU) antes de solicitar un retiro.'));
    }

    const requestedAmount = Number(amount);
    if (isNaN(requestedAmount) || requestedAmount <= 0) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Monto de retiro no válido.'));
    }

    // Load products to compute available balance
    const products = await Product.find({ partner: partnerId });
    const partnerProductIds = products.map(p => p._id);
    
    const rawOrders = await Order.find({ 
      'products.product': { $in: partnerProductIds },
      paymentStatus: 'paid' 
    });

    const totalEarnings = rawOrders.reduce((sum, order) => {
      const partnerItems = order.products.filter(item =>
        partnerProductIds.some(pId => pId.toString() === item.product.toString())
      );
      return sum + partnerItems.reduce((s, item) => s + (item.price * item.quantity), 0);
    }, 0);

    const withdrawals = await Withdrawal.find({ partner: partnerId });
    const totalApproved = withdrawals.filter(w => w.status === 'approved').reduce((sum, w) => sum + w.amount, 0);
    const totalPending = withdrawals.filter(w => w.status === 'pending').reduce((sum, w) => sum + w.amount, 0);

    const availableBalance = totalEarnings - totalApproved - totalPending;

    if (requestedAmount > availableBalance) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent(`Fondos insuficientes. Tu saldo disponible para retirar es de ${formatPrice(availableBalance)}`));
    }

    // Save pending request
    const newWithdrawal = new Withdrawal({
      partner: partnerId,
      amount: requestedAmount,
      alias: partner.alias,
      cbu: partner.cbu,
      bankName: partner.bankName,
      status: 'pending'
    });

    await newWithdrawal.save();
    res.redirect('/partner/panel?success=' + encodeURIComponent('Tu solicitud de retiro ha sido registrada. El administrador procesará la transferencia a la brevedad.'));
  } catch (error) {
    console.error('Request withdrawal error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al registrar la solicitud de retiro: ' + error.message));
  }
};

// POST Partner Create Driver
const createPartnerDriver = async (req, res, next) => {
  try {
    const partnerId = req.partner.id;
    const { name, vehicle, password } = req.body;

    if (!name || !vehicle || !password) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('El nombre, vehículo y la contraseña son obligatorios.'));
    }

    // Check if driver name already exists globally
    const existing = await Driver.findOne({ name: { $regex: new RegExp("^" + name.trim() + "$", "i") } });
    if (existing) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Ya existe un conductor registrado con ese nombre. Por favor elija otro.'));
    }

    const driver = new Driver({
      name: name.trim(),
      vehicle: vehicle.trim(),
      password,
      partner: partnerId
    });

    await driver.save();
    res.redirect('/partner/panel?success=' + encodeURIComponent(`Conductor ${name} registrado exitosamente.`));
  } catch (error) {
    console.error('Create partner driver error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al registrar el conductor: ' + error.message));
  }
};

// POST Partner Delete Driver
const deletePartnerDriver = async (req, res, next) => {
  try {
    const partnerId = req.partner.id;
    const { id } = req.params;

    // Verify driver belongs to this partner
    const driver = await Driver.findOne({ _id: id, partner: partnerId });
    if (!driver) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Conductor no encontrado o no pertenece a este socio.'));
    }

    await Driver.findByIdAndDelete(id);
    res.redirect('/partner/panel?success=' + encodeURIComponent('Conductor eliminado exitosamente.'));
  } catch (error) {
    console.error('Delete partner driver error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al eliminar el conductor: ' + error.message));
  }
};

// POST Partner Assign Driver to Order
const assignDriverToOrder = async (req, res, next) => {
  try {
    const partnerId = req.partner.id;
    const { id } = req.params; // Order ID
    const { driverId } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Pedido no encontrado.'));
    }

    // Load selected driver
    let driverName = 'Conductor';
    let driverVehicle = 'Vehículo';

    if (driverId && driverId.trim() !== '') {
      // Find driver either belonging to this partner or matching partner's assignedDriver
      const partnerDoc = await Partner.findById(partnerId);
      const driver = await Driver.findOne({
        _id: driverId,
        $or: [
          { partner: partnerId },
          { _id: partnerDoc.assignedDriver }
        ]
      });
      if (!driver) {
        return res.redirect('/partner/panel?error=' + encodeURIComponent('Conductor no autorizado o no encontrado.'));
      }
      driverName = driver.name;
      driverVehicle = driver.vehicle;
    } else {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Debe seleccionar un conductor válido.'));
    }

    // Update order status to shipped, and set driver details
    order.status = 'shipped';
    order.driverName = driverName;
    order.driverVehicle = driverVehicle;
    order.dispatchedAt = new Date();
    await order.save();

    res.redirect('/partner/panel?success=' + encodeURIComponent(`Pedido despachado correctamente con el conductor ${driverName}.`));
  } catch (error) {
    console.error('Assign driver to order error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al despachar el pedido: ' + error.message));
  }
};

// POST Partner Dispatch Route (Bulk Assign Driver)
const dispatchPartnerRoute = async (req, res, next) => {
  try {
    const partnerId = req.partner.id;
    const { orderIds, driverId } = req.body;

    if (!orderIds || (Array.isArray(orderIds) && orderIds.length === 0) || (!Array.isArray(orderIds) && !orderIds.trim())) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Debe seleccionar al menos un pedido para despachar la ruta.'));
    }

    const ids = Array.isArray(orderIds) ? orderIds : orderIds.split(',').map(id => id.trim()).filter(Boolean);

    if (!driverId || driverId.trim() === '') {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Debe seleccionar un conductor válido.'));
    }

    // Load selected driver
    const partnerDoc = await Partner.findById(partnerId);
    const driver = await Driver.findOne({
      _id: driverId,
      $or: [
        { partner: partnerId },
        { _id: partnerDoc.assignedDriver }
      ]
    });

    if (!driver) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Conductor no autorizado o no encontrado.'));
    }

    const driverName = driver.name;
    const driverVehicle = driver.vehicle;

    // Update orders
    let count = 0;
    for (const orderId of ids) {
      const order = await Order.findById(orderId);
      if (order) {
        order.status = 'shipped';
        order.driverName = driverName;
        order.driverVehicle = driverVehicle;
        order.dispatchedAt = new Date();
        await order.save();
        count++;
      }
    }

    res.redirect('/partner/panel?success=' + encodeURIComponent(`Ruta despachada exitosamente con ${count} pedidos asignados al conductor ${driverName}.`));
  } catch (error) {
    console.error('Dispatch partner route error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al despachar la ruta del socio: ' + error.message));
  }
};

const shipOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('Pedido no encontrado.'));
    }
    
    order.status = 'shipped';
    order.driverName = 'Logística del Socio';
    order.driverVehicle = 'Particular';
    order.dispatchedAt = new Date();
    await order.save();
    
    res.redirect('/partner/panel?success=' + encodeURIComponent('El pedido ha sido marcado en camino.'));
  } catch (error) {
    console.error('Ship order error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al marcar el pedido en camino: ' + error.message));
  }
};

module.exports = {
  getLogin,
  postLogin,
  getLogout,
  getPanel,
  createProduct,
  updateStock,
  updatePrice,
  updateProductDetails,
  deleteProduct,
  updateBankDetails,
  updateLocation,
  requestWithdrawal,
  createPartnerDriver,
  deletePartnerDriver,
  assignDriverToOrder,
  dispatchPartnerRoute,
  shipOrder
};
