const Partner = require('../models/Partner');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Withdrawal = require('../models/Withdrawal');
const Driver = require('../models/Driver');
const { uploadImage } = require('../services/firebase.service');
const { generatePartnerToken } = require('../services/auth.service');
const formatPrice = require('../utils/formatPrice');
const PDFDocument = require('pdfkit');
const path = require('path');

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
    const { title, description, price, wholesalePrice, stock, categoryId, unit, locationId } = req.body;
    
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

    if (locationId === 'all') {
      // Create primary location product
      const mainProduct = new Product({
        title,
        description,
        price: Number(price),
        wholesalePrice: wholesalePrice ? Number(wholesalePrice) : Number(price),
        stock: Number(stock),
        images: imageUrls,
        category: categoryId,
        unit: unit || 'unidades',
        partner: req.partner.id,
        location: null,
        active: true
      });
      await mainProduct.save();

      // Create branch location products
      const partner = await Partner.findById(req.partner.id);
      if (partner && partner.locations && partner.locations.length > 0) {
        for (const loc of partner.locations) {
          const duplicateProduct = new Product({
            title,
            description,
            price: Number(price),
            wholesalePrice: wholesalePrice ? Number(wholesalePrice) : Number(price),
            stock: Number(stock),
            images: imageUrls,
            category: categoryId,
            unit: unit || 'unidades',
            partner: req.partner.id,
            location: loc._id,
            active: true
          });
          await duplicateProduct.save();
        }
      }
      return res.redirect('/partner/panel?success=' + encodeURIComponent('Producto creado exitosamente en todas tus sucursales y catálogo principal.'));
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
      location: locationId && locationId !== '' ? locationId : null, // Associated with branch/location!
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
    const { title, description, categoryId, locationId } = req.body;
    
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
    product.location = locationId && locationId !== '' ? locationId : null;
    
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

const addLocation = async (req, res, next) => {
  try {
    const { name, address, province, latitude, longitude } = req.body;
    if (!name || !province) {
      return res.redirect('/partner/panel?error=' + encodeURIComponent('El nombre y la provincia son obligatorios para la sucursal.'));
    }

    const partner = await Partner.findById(req.partner.id);
    if (!partner) {
      return res.redirect('/partner/login');
    }

    partner.locations.push({
      name: name.trim(),
      address: (address || '').trim(),
      province: province.trim(),
      latitude: latitude && latitude.trim() !== '' ? Number(latitude) : null,
      longitude: longitude && longitude.trim() !== '' ? Number(longitude) : null
    });

    await partner.save();
    res.redirect('/partner/panel?success=' + encodeURIComponent('Nueva sucursal / locación agregada exitosamente.'));
  } catch (error) {
    console.error('Partner add location error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al agregar locación: ' + error.message));
  }
};

const deleteLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const partner = await Partner.findById(req.partner.id);
    if (!partner) {
      return res.redirect('/partner/login');
    }

    partner.locations.pull({ _id: id });
    await partner.save();

    // Set any products associated with this location back to null (default)
    await Product.updateMany({ partner: partner._id, location: id }, { location: null });

    res.redirect('/partner/panel?success=' + encodeURIComponent('Sucursal / locación eliminada exitosamente.'));
  } catch (error) {
    console.error('Partner delete location error:', error.message);
    res.redirect('/partner/panel?error=' + encodeURIComponent('Error al eliminar locación.'));
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

const generatePartnerPDFTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const partnerId = req.partner.id; // Logged-in partner ID
    
    const order = await Order.findById(id)
      .populate('user')
      .populate({
        path: 'products.product',
        populate: { path: 'partner' }
      });

    if (!order) {
      return res.status(404).send('Pedido no encontrado');
    }

    // Filter items belonging to this partner
    const partnerItems = order.products.filter(item => 
      item.product && item.product.partner && item.product.partner._id.toString() === partnerId
    );

    if (partnerItems.length === 0) {
      return res.status(403).send('No autorizado para ver este ticket (no contiene tus productos)');
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    
    // Set headers to open PDF in a new tab / window
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=ticket-socio-${order._id.toString().substring(12)}.pdf`);
    doc.pipe(res);

    // Color Palette
    const primaryColor = '#10b981'; // Emerald Green
    const darkSlate = '#0f172a'; // Deep slate
    const textGray = '#475569';  // Slate gray
    const bgGray = '#f8fafc';    // Soft slate background
    const borderGray = '#e2e8f0';  // Very light gray border
    const statusGreen = '#ecfdf5';
    const statusTextGreen = '#047857';
    const statusAmber = '#fffbeb';
    const statusTextAmber = '#b45309';

    // 1. Decorative Header Brand Bar
    doc.rect(40, 40, 515, 6).fill(primaryColor);
    
    // Logo & Header Brand
    const logoPath = path.join(__dirname, '../../public/img/logo.png');
    let headerTextX = 40;
    try {
      doc.image(logoPath, 40, 55, { height: 38 });
      headerTextX = 95;
    } catch (err) {
      headerTextX = 40;
    }
    
    doc.fillColor(darkSlate)
       .fontSize(18)
       .font('Helvetica-Bold')
       .text('AbastoHub', headerTextX, 55)
       .fontSize(8.5)
       .font('Helvetica-Bold')
       .fillColor(textGray)
       .text('REMITO DE PREPARACIÓN DE SOCIO / ASOCIADO', headerTextX, 76);

    // Order ID & Date (Right Aligned)
    const shortId = order._id.toString().substring(12).toUpperCase();
    doc.fillColor(darkSlate)
       .fontSize(11)
       .font('Helvetica-Bold')
       .text(`ORDEN: #${shortId}`, 350, 55, { align: 'right', width: 205 })
       .fontSize(8.5)
       .font('Helvetica')
       .fillColor(textGray)
       .text(`Fecha: ${order.createdAt.toLocaleString('es-AR')}`, 350, 72, { align: 'right', width: 205 });

    // Payment Status Badge
    const isPaid = order.paymentStatus === 'paid';
    const badgeBg = isPaid ? statusGreen : statusAmber;
    const badgeTextCol = isPaid ? statusTextGreen : statusTextAmber;
    const badgeLabel = isPaid ? 'PAGADO' : 'PENDIENTE';

    doc.rect(465, 87, 90, 16).fill(badgeBg);
    doc.fillColor(badgeTextCol)
       .fontSize(8)
       .font('Helvetica-Bold')
       .text(badgeLabel, 465, 91, { align: 'center', width: 90 });

    // 2. Client & Delivery Info Cards (Two-column layout)
    const clientBoxY = 120;
    
    // Left card: Client details
    doc.rect(40, clientBoxY, 250, 95).fill(bgGray);
    doc.rect(40, clientBoxY, 3, 95).fill(primaryColor);
    
    doc.fillColor(darkSlate)
       .fontSize(9)
       .font('Helvetica-Bold')
       .text('INFORMACIÓN DEL CLIENTE', 50, clientBoxY + 10);

    const customerName = order.shippingDetails.name || (order.user ? `${order.user.name} ${order.user.lastname}` : 'Cliente Registrado');
    const customerPhone = order.shippingDetails.phone || (order.user ? order.user.phone : 'N/A');
    const customerEmail = order.user ? order.user.email : 'N/A';

    doc.fontSize(8)
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Nombre:', 50, clientBoxY + 28)
       .font('Helvetica')
       .fillColor(textGray)
       .text(customerName, 95, clientBoxY + 28)
       
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Teléfono:', 50, clientBoxY + 44)
       .font('Helvetica')
       .fillColor(textGray)
       .text(customerPhone, 95, clientBoxY + 44)
       
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Email:', 50, clientBoxY + 60)
       .font('Helvetica')
       .fillColor(textGray)
       .text(customerEmail, 95, clientBoxY + 60)
       
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Método:', 50, clientBoxY + 76)
       .font('Helvetica')
       .fillColor(textGray)
       .text(order.deliveryType === 'delivery' ? 'Envío a Domicilio' : 'Retiro por Local', 95, clientBoxY + 76);

    // Right card: Delivery details
    doc.rect(305, clientBoxY, 250, 95).fill(bgGray);
    doc.rect(305, clientBoxY, 3, 95).fill('#3b82f6'); // Indigo blue indicator
    
    doc.fillColor(darkSlate)
       .fontSize(9)
       .font('Helvetica-Bold')
       .text('DETALLES DE SOCIO / LOGÍSTICA', 315, clientBoxY + 10);

    const addressStr = order.deliveryType === 'delivery' 
      ? (order.shippingDetails.address || 'No especificada') 
      : 'Retiro en depósito central / AbastoHub';
    
    const payMethodName = order.paymentMethod === 'transfer' ? 'Transferencia Bancaria' : 'MercadoPago';

    doc.fontSize(8)
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Dirección:', 315, clientBoxY + 28)
       .font('Helvetica')
       .fillColor(textGray)
       .text(addressStr, 365, clientBoxY + 28, { width: 180 })
       
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Pago:', 315, clientBoxY + 58)
       .font('Helvetica')
       .fillColor(textGray)
       .text(payMethodName, 365, clientBoxY + 58);

    if (order.driverName) {
      doc.font('Helvetica-Bold')
         .fillColor(darkSlate)
         .text('Chofer:', 315, clientBoxY + 74)
         .font('Helvetica-Bold')
         .fillColor('#1d4ed8')
         .text(`${order.driverName} (${order.driverVehicle || 'Vehículo'})`, 365, clientBoxY + 74);
    } else if (order.scheduledDate) {
      doc.font('Helvetica-Bold')
         .fillColor(darkSlate)
         .text('Reserva:', 315, clientBoxY + 74)
         .font('Helvetica-Bold')
         .fillColor(primaryColor)
         .text(order.scheduledDate.toLocaleDateString('es-AR'), 365, clientBoxY + 74);
    }

    // 3. Table Header Section
    const tableTitleY = 232;
    doc.fillColor(darkSlate)
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('TUS ARTÍCULOS A PREPARAR (SOCIO)', 40, tableTitleY);

    const tableTop = tableTitleY + 18;
    
    // Draw Header Background Row
    doc.rect(40, tableTop, 515, 20).fill('#e2e8f0');
    
    // Header labels
    doc.fillColor(darkSlate)
       .fontSize(8)
       .font('Helvetica-Bold')
       .text('OK', 45, tableTop + 6, { width: 20, align: 'center' })
       .text('PRODUCTO / DESCRIPCIÓN', 70, tableTop + 6)
       .text('CANT', 300, tableTop + 6, { width: 45, align: 'center' })
       .text('UNIDAD', 350, tableTop + 6, { width: 55, align: 'center' })
       .text('P. UNIT', 415, tableTop + 6, { width: 65, align: 'right' })
       .text('SUBTOTAL', 485, tableTop + 6, { width: 65, align: 'right' });

    // Table rows
    let currentY = tableTop + 20;
    
    // Auto page addition checker
    const checkPageBreak = (neededHeight) => {
      if (currentY + neededHeight > 670) {
        doc.addPage();
        
        // Redraw decorative top bar on new page
        doc.rect(40, 40, 515, 5).fill(primaryColor);
        
        // Redraw Table Header on new page
        doc.rect(40, 55, 515, 20).fill('#e2e8f0');
        doc.fillColor(darkSlate)
           .fontSize(8)
           .font('Helvetica-Bold')
           .text('OK', 45, 61, { width: 20, align: 'center' })
           .text('PRODUCTO / DESCRIPCIÓN', 70, 61)
           .text('CANT', 300, 61, { width: 45, align: 'center' })
           .text('UNIDAD', 350, 61, { width: 55, align: 'center' })
           .text('P. UNIT', 415, 61, { width: 65, align: 'right' })
           .text('SUBTOTAL', 485, 61, { width: 65, align: 'right' });
        
        currentY = 75;
      }
    };

    partnerItems.forEach((item, index) => {
      const rowHeight = 22;
      checkPageBreak(rowHeight);

      // Zebra row bg
      if (index % 2 === 0) {
        doc.rect(40, currentY, 515, rowHeight).fill('#f8fafc');
      } else {
        doc.rect(40, currentY, 515, rowHeight).fill('#ffffff');
      }

      // Checkbox square
      doc.rect(49, currentY + Math.floor((rowHeight - 11) / 2), 11, 11).lineWidth(1).strokeColor(textGray).stroke();

      doc.fillColor(darkSlate);
      const unitType = item.unit || 'unidades';

      // Title & quantity alignment
      doc.font('Helvetica-Bold')
         .fontSize(8.5)
         .text(item.title, 70, currentY + 6, { width: 220, truncate: true });

      doc.fillColor(darkSlate);
      doc.font('Helvetica-Bold')
         .fontSize(9)
         .text(item.quantity.toString(), 300, currentY + Math.floor((rowHeight - 9) / 2), { width: 45, align: 'center' })
         .font('Helvetica')
         .fontSize(8.5)
         .text(unitType, 350, currentY + Math.floor((rowHeight - 9) / 2), { width: 55, align: 'center' })
         .text(formatPrice(item.price), 415, currentY + Math.floor((rowHeight - 9) / 2), { width: 65, align: 'right' })
         .font('Helvetica-Bold')
         .text(formatPrice(item.price * item.quantity), 485, currentY + Math.floor((rowHeight - 9) / 2), { width: 65, align: 'right' });

      // Row separator line
      doc.rect(40, currentY + rowHeight, 515, 0.5).fill('#e2e8f0');
      currentY += rowHeight;
    });

    // 4. Totals Row Box
    checkPageBreak(55);
    
    const partnerTotal = partnerItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const partnerBultos = partnerItems.reduce((acc, item) => acc + item.quantity, 0);

    const totalsBoxY = currentY + 12;
    doc.rect(340, totalsBoxY, 215, 45).fill('#f8fafc');
    doc.rect(340, totalsBoxY, 215, 45).lineWidth(1).strokeColor('#e2e8f0').stroke();

    doc.fillColor(textGray)
       .fontSize(8.5)
       .font('Helvetica')
       .text('Cantidad de Bultos:', 355, totalsBoxY + 10)
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text(partnerBultos.toString(), 460, totalsBoxY + 10)
       
       .font('Helvetica-Bold')
       .fillColor(primaryColor)
       .fontSize(10)
       .text('TOTAL SOCIO:', 355, totalsBoxY + 26)
       .fontSize(11)
       .text(formatPrice(partnerTotal), 450, totalsBoxY + 25, { width: 95, align: 'right' });

    // 5. Tear-off remito / signatures section
    checkPageBreak(110);
    
    // Draw tear-off scissor line
    const scissorY = currentY + 70;
    doc.rect(40, scissorY, 515, 0.5).dash(4, { space: 4 }).strokeColor(textGray).stroke();
    
    // Scissor icon representation
    doc.fillColor(textGray)
       .fontSize(7.5)
       .font('Helvetica-Oblique')
       .text('--- TALÓN DE RETIRO / ENTREGA (PREPARACIÓN SOCIO) ---', 40, scissorY + 5, { align: 'center', width: 515 });

    // Signature Box
    const signY = scissorY + 18;
    doc.rect(40, signY, 515, 80).fill('#fdfdfd');
    doc.rect(40, signY, 515, 80).lineWidth(1).strokeColor(borderGray).stroke();

    doc.fillColor(darkSlate)
       .fontSize(8.5)
       .font('Helvetica-Bold')
       .text('CONFORMIDAD DE RETIRO (LOGÍSTICA / CADETE)', 50, signY + 10)
       .font('Helvetica')
       .text('Firma: ___________________________', 50, signY + 32)
       .text('Aclaración: ________________________', 50, signY + 50)
       .text('DNI/Patente: _______________________', 50, signY + 68)
       
       .text('Fecha: ____/____/2026', 330, signY + 32)
       .text('Hora: ____:____ hs', 330, signY + 50)
       .font('Helvetica-Bold')
       .text('Nº Pedido: #' + shortId, 330, signY + 68);

    doc.end();

  } catch (error) {
    next(error);
  }
};

const downloadMonthlySummary = async (req, res, next) => {
  try {
    const partnerId = req.partner.id;
    const partnerDoc = await Partner.findById(partnerId);
    if (!partnerDoc) {
      return res.status(404).send('Socio no encontrado');
    }

    const monthVal = req.query.month ? parseInt(req.query.month) : (new Date().getMonth() + 1);
    const yearVal = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

    const startDate = new Date(yearVal, monthVal - 1, 1);
    const endDate = new Date(yearVal, monthVal, 1);

    const products = await Product.find({ partner: partnerId });
    const partnerProductIds = products.map(p => p._id);

    // Fetch orders in date range containing partner products
    const rawOrders = await Order.find({
      'products.product': { $in: partnerProductIds },
      createdAt: { $gte: startDate, $lt: endDate }
    }).populate('user').sort({ createdAt: 1 });

    // Format orders
    const orders = rawOrders.map(order => {
      const partnerItems = order.products.filter(item =>
        partnerProductIds.some(pId => pId.toString() === item.product.toString())
      );
      const partnerSubtotal = partnerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const totalQuantity = partnerItems.reduce((sum, item) => sum + item.quantity, 0);

      return {
        _id: order._id,
        createdAt: order.createdAt,
        shippingDetails: order.shippingDetails,
        user: order.user,
        paymentStatus: order.paymentStatus,
        status: order.status,
        partnerSubtotal,
        totalQuantity,
        partnerItems
      };
    });

    // Fetch withdrawals in date range
    const withdrawals = await Withdrawal.find({
      partner: partnerId,
      createdAt: { $gte: startDate, $lt: endDate }
    }).sort({ createdAt: 1 });

    // Stats
    const totalEarnings = orders.reduce((sum, o) => sum + (o.paymentStatus === 'paid' ? o.partnerSubtotal : 0), 0);
    const pendingEarnings = orders.reduce((sum, o) => sum + (o.paymentStatus === 'pending' ? o.partnerSubtotal : 0), 0);
    const totalBultos = orders.reduce((sum, o) => sum + o.totalQuantity, 0);
    const approvedWithdrawals = withdrawals.filter(w => w.status === 'approved').reduce((sum, w) => sum + w.amount, 0);

    // Group sold products
    const productSalesMap = {};
    orders.forEach(o => {
      o.partnerItems.forEach(item => {
        const prodId = item.product.toString();
        if (!productSalesMap[prodId]) {
          productSalesMap[prodId] = {
            title: item.title,
            quantity: 0,
            revenue: 0,
            unit: item.unit || 'unidades'
          };
        }
        productSalesMap[prodId].quantity += item.quantity;
        productSalesMap[prodId].revenue += item.price * item.quantity;
      });
    });
    const productSales = Object.values(productSalesMap).sort((a, b) => b.quantity - a.quantity);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=resumen-${partnerDoc.name.replace(/\s+/g, '_')}-${monthVal}-${yearVal}.pdf`);
    doc.pipe(res);

    // Styling Colors
    const primaryColor = '#10b981'; // Emerald Green
    const darkSlate = '#0f172a'; // Deep slate
    const textGray = '#475569';  // Slate gray
    const bgGray = '#f8fafc';    // Soft slate background
    const borderGray = '#e2e8f0';  // Very light gray border

    // Top Brand Accent
    doc.rect(40, 40, 515, 6).fill(primaryColor);

    // Header info
    const logoPath = path.join(__dirname, '../../public/img/logo.png');
    let headerTextX = 40;
    try {
      doc.image(logoPath, 40, 55, { height: 38 });
      headerTextX = 95;
    } catch (err) {
      headerTextX = 40;
    }

    const getMonthName = (monthIndex) => {
      const months = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
      ];
      return months[monthIndex];
    };

    const monthName = getMonthName(monthVal - 1);

    doc.fillColor(darkSlate)
       .fontSize(18)
       .font('Helvetica-Bold')
       .text(partnerDoc.name, headerTextX, 55)
       .fontSize(9)
       .font('Helvetica-Bold')
       .fillColor(textGray)
       .text('REPORTE MENSUAL DE CUENTA, VENTAS Y COBRANZAS', headerTextX, 76);

    doc.fillColor(darkSlate)
       .fontSize(12)
       .font('Helvetica-Bold')
       .text(`${monthName.toUpperCase()} ${yearVal}`, 350, 55, { align: 'right', width: 205 })
       .fontSize(8)
       .font('Helvetica')
       .fillColor(textGray)
       .text(`Generado: ${new Date().toLocaleString('es-AR')}`, 350, 72, { align: 'right', width: 205 });

    // 1. Metric cards (Total Earnings, Pending, total orders, approved withdrawals)
    const cardsY = 110;
    
    // Card 1: Total Facturado (Acreditado)
    doc.rect(40, cardsY, 120, 50).fill('#ecfdf5');
    doc.rect(40, cardsY, 120, 50).lineWidth(0.5).strokeColor('#a7f3d0').stroke();
    doc.fillColor('#047857').fontSize(7).font('Helvetica-Bold').text('VENTAS COBRADAS', 45, cardsY + 8)
       .fontSize(11).font('Helvetica-Bold').text(formatPrice(totalEarnings), 45, cardsY + 22);

    // Card 2: Ventas Pendientes
    doc.rect(170, cardsY, 120, 50).fill('#fffbeb');
    doc.rect(170, cardsY, 120, 50).lineWidth(0.5).strokeColor('#fde68a').stroke();
    doc.fillColor('#b45309').fontSize(7).font('Helvetica-Bold').text('VENTAS PENDIENTES', 175, cardsY + 8)
       .fontSize(11).font('Helvetica-Bold').text(formatPrice(pendingEarnings), 175, cardsY + 22);

    // Card 3: Total Pedidos y Bultos
    doc.rect(300, cardsY, 120, 50).fill(bgGray);
    doc.rect(300, cardsY, 120, 50).lineWidth(0.5).strokeColor(borderGray).stroke();
    doc.fillColor(textGray).fontSize(7).font('Helvetica-Bold').text('PEDIDOS / BULTOS', 305, cardsY + 8)
       .fontSize(11).font('Helvetica-Bold').text(`${orders.length} ord. / ${totalBultos} bult.`, 305, cardsY + 22);

    // Card 4: Retiros Aprobados
    doc.rect(430, cardsY, 125, 50).fill('#f0f9ff');
    doc.rect(430, cardsY, 125, 50).lineWidth(0.5).strokeColor('#bae6fd').stroke();
    doc.fillColor('#0369a1').fontSize(7).font('Helvetica-Bold').text('RETIROS APROBADOS', 435, cardsY + 8)
       .fontSize(11).font('Helvetica-Bold').text(formatPrice(approvedWithdrawals), 435, cardsY + 22);

    let currentY = cardsY + 70;

    // 2. Table: Sales History (Ventas / Pedidos)
    doc.fillColor(darkSlate).fontSize(10).font('Helvetica-Bold').text('1. DETALLE DE VENTAS / PEDIDOS DEL MES', 40, currentY);
    currentY += 15;

    // Table Header
    doc.rect(40, currentY, 515, 16).fill('#e2e8f0');
    doc.fillColor(darkSlate).fontSize(7).font('Helvetica-Bold')
       .text('FECHA', 45, currentY + 4)
       .text('ID PEDIDO', 105, currentY + 4)
       .text('CLIENTE', 175, currentY + 4)
       .text('BULTOS', 315, currentY + 4, { width: 35, align: 'center' })
       .text('ESTADO PAGO', 360, currentY + 4)
       .text('TOTAL SOCIO', 475, currentY + 4, { width: 75, align: 'right' });

    currentY += 16;

    const checkPageBreak = (neededHeight) => {
      if (currentY + neededHeight > 730) {
        doc.addPage();
        doc.rect(40, 40, 515, 5).fill(primaryColor);
        currentY = 60;
      }
    };

    if (orders.length === 0) {
      checkPageBreak(25);
      doc.rect(40, currentY, 515, 20).fill('#ffffff');
      doc.fillColor(textGray).fontSize(8).font('Helvetica-Oblique').text('No se registraron ventas en este periodo.', 45, currentY + 6, { align: 'center', width: 505 });
      currentY += 20;
    } else {
      orders.forEach((o, index) => {
        checkPageBreak(18);
        
        if (index % 2 === 0) {
          doc.rect(40, currentY, 515, 18).fill('#f8fafc');
        } else {
          doc.rect(40, currentY, 515, 18).fill('#ffffff');
        }

        const clientName = o.shippingDetails?.name || (o.user ? `${o.user.name} ${o.user.lastname}` : 'Cliente General');
        const payStatus = o.paymentStatus === 'paid' ? 'ACREDITADO' : o.paymentStatus === 'pending' ? 'PENDIENTE' : 'CANCELADO';
        
        doc.fillColor(textGray).fontSize(7.5).font('Helvetica')
           .text(new Date(o.createdAt).toLocaleDateString('es-AR'), 45, currentY + 5)
           .font('Helvetica-Bold')
           .text(`#${o._id.toString().substring(12).toUpperCase()}`, 105, currentY + 5)
           .font('Helvetica')
           .text(clientName, 175, currentY + 5, { width: 130, truncate: true })
           .text(o.totalQuantity.toString(), 315, currentY + 5, { width: 35, align: 'center' })
           .font('Helvetica-Bold')
           .fillColor(o.paymentStatus === 'paid' ? '#047857' : o.paymentStatus === 'pending' ? '#b45309' : '#b91c1c')
           .text(payStatus, 360, currentY + 5)
           .fillColor(darkSlate)
           .text(formatPrice(o.partnerSubtotal), 475, currentY + 5, { width: 75, align: 'right' });

        doc.rect(40, currentY + 18, 515, 0.5).fill('#e2e8f0');
        currentY += 18;
      });
    }

    currentY += 20;

    // 3. Table: Withdrawals History (Historial de Cobranza / Retiros)
    checkPageBreak(45);
    doc.fillColor(darkSlate).fontSize(10).font('Helvetica-Bold').text('2. HISTORIAL DE RETIROS DE FONDOS', 40, currentY);
    currentY += 15;

    // Table Header
    doc.rect(40, currentY, 515, 16).fill('#e2e8f0');
    doc.fillColor(darkSlate).fontSize(7).font('Helvetica-Bold')
       .text('FECHA', 45, currentY + 4)
       .text('CBU / CVU DESTINO', 135, currentY + 4)
       .text('BANCO / ENTIDAD', 285, currentY + 4)
       .text('ESTADO RETIRO', 395, currentY + 4)
       .text('MONTO RETIRADO', 475, currentY + 4, { width: 75, align: 'right' });

    currentY += 16;

    if (withdrawals.length === 0) {
      checkPageBreak(25);
      doc.rect(40, currentY, 515, 20).fill('#ffffff');
      doc.fillColor(textGray).fontSize(8).font('Helvetica-Oblique').text('No se registraron solicitudes de retiro en este periodo.', 45, currentY + 6, { align: 'center', width: 505 });
      currentY += 20;
    } else {
      withdrawals.forEach((w, index) => {
        checkPageBreak(18);

        if (index % 2 === 0) {
          doc.rect(40, currentY, 515, 18).fill('#f8fafc');
        } else {
          doc.rect(40, currentY, 515, 18).fill('#ffffff');
        }

        const wStatus = w.status === 'approved' ? 'APROBADO' : w.status === 'pending' ? 'PENDIENTE' : 'RECHAZADO';

        doc.fillColor(textGray).fontSize(7.5).font('Helvetica')
           .text(new Date(w.createdAt).toLocaleDateString('es-AR'), 45, currentY + 5)
           .text(w.cbu || 'N/A', 135, currentY + 5)
           .text(w.bankName || 'N/A', 285, currentY + 5)
           .font('Helvetica-Bold')
           .fillColor(w.status === 'approved' ? '#047857' : w.status === 'pending' ? '#b45309' : '#b91c1c')
           .text(wStatus, 395, currentY + 5)
           .fillColor(darkSlate)
           .text(formatPrice(w.amount), 475, currentY + 5, { width: 75, align: 'right' });

        doc.rect(40, currentY + 18, 515, 0.5).fill('#e2e8f0');
        currentY += 18;
      });
    }

    currentY += 20;

    // 4. Table: Product Performance (Productos más vendidos)
    checkPageBreak(45);
    doc.fillColor(darkSlate).fontSize(10).font('Helvetica-Bold').text('3. RENDIMIENTO DE PRODUCTOS EN EL MES', 40, currentY);
    currentY += 15;

    // Table Header
    doc.rect(40, currentY, 515, 16).fill('#e2e8f0');
    doc.fillColor(darkSlate).fontSize(7).font('Helvetica-Bold')
       .text('PRODUCTO', 45, currentY + 4)
       .text('UNIDAD DE MEDIDA', 285, currentY + 4)
       .text('UNIDADES VENDIDAS', 385, currentY + 4, { width: 85, align: 'center' })
       .text('FACTURADO TOTAL', 475, currentY + 4, { width: 75, align: 'right' });

    currentY += 16;

    if (productSales.length === 0) {
      checkPageBreak(25);
      doc.rect(40, currentY, 515, 20).fill('#ffffff');
      doc.fillColor(textGray).fontSize(8).font('Helvetica-Oblique').text('No se registraron ventas de productos en este periodo.', 45, currentY + 6, { align: 'center', width: 505 });
      currentY += 20;
    } else {
      productSales.forEach((ps, index) => {
        checkPageBreak(18);

        if (index % 2 === 0) {
          doc.rect(40, currentY, 515, 18).fill('#f8fafc');
        } else {
          doc.rect(40, currentY, 515, 18).fill('#ffffff');
        }

        doc.fillColor(darkSlate).fontSize(7.5).font('Helvetica-Bold')
           .text(ps.title, 45, currentY + 5, { width: 230, truncate: true })
           .font('Helvetica')
           .fillColor(textGray)
           .text(ps.unit, 285, currentY + 5)
           .font('Helvetica-Bold')
           .text(ps.quantity.toString(), 385, currentY + 5, { width: 85, align: 'center' })
           .text(formatPrice(ps.revenue), 475, currentY + 5, { width: 75, align: 'right' });

        doc.rect(40, currentY + 18, 515, 0.5).fill('#e2e8f0');
        currentY += 18;
      });
    }

    // Footer signature & notice
    checkPageBreak(70);
    doc.rect(40, 755, 515, 0.5).fill(borderGray);
    doc.fillColor(textGray).fontSize(6.5).font('Helvetica-Oblique')
       .text('Este documento es un resumen administrativo oficial del panel de asociados de AbastoHub.', 40, 765, { align: 'center', width: 515 });

    doc.end();

  } catch (error) {
    next(error);
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
  addLocation,
  deleteLocation,
  requestWithdrawal,
  createPartnerDriver,
  deletePartnerDriver,
  assignDriverToOrder,
  dispatchPartnerRoute,
  shipOrder,
  generatePartnerPDFTicket,
  downloadMonthlySummary
};
