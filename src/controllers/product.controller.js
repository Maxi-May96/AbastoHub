const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Partner = require('../models/Partner');
const RaffleParticipant = require('../models/RaffleParticipant');
const Driver = require('../models/Driver');
const Withdrawal = require('../models/Withdrawal');
const CommissionPayment = require('../models/CommissionPayment');
const { uploadImage } = require('../services/firebase.service');
const formatPrice = require('../utils/formatPrice');
const PDFDocument = require('pdfkit');
const path = require('path');
const config = require('../config/env');

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

// GET Catalog Page
const getProducts = async (req, res, next) => {
  try {
    const { category: categorySlug, search, minPrice, maxPrice, sort, partner: partnerId, province, userLat, userLng, maxDistance } = req.query;
    
    // Build query filter
    const query = { active: true };
    
    // Filter by category
    if (categorySlug) {
      const categoryDoc = await Category.findOne({ slug: categorySlug });
      if (categoryDoc) {
        query.category = categoryDoc._id;
      }
    }
    
    // Search filter (title / description)
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Price range filters
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Filter by Partner
    if (partnerId) {
      query.partner = partnerId;
    } else if (province) {
      // Find all partners that have ANY location in this province (primary or in locations array)
      const partnersInProvince = await Partner.find({
        $or: [
          { province: province },
          { 'locations.province': province }
        ]
      }).select('_id');
      const partnerIds = partnersInProvince.map(p => p._id);
      query.partner = { $in: partnerIds };
    }
    
    // Sort query
    let sortQuery = { createdAt: -1 };
    if (sort) {
      if (sort === 'price_asc') sortQuery = { price: 1 };
      else if (sort === 'price_desc') sortQuery = { price: -1 };
      else if (sort === 'title_asc') sortQuery = { title: 1 };
    }
    
    // Fetch products and categories
    let products = await Product.find(query).populate('category').populate('partner').sort(sortQuery);

    // If province filter is active, filter in-memory to ensure only products in that location's province are returned
    if (province && !partnerId) {
      products = products.filter(prod => {
        if (!prod.partner) return false;
        // If product has custom location, check its province
        if (prod.location && prod.partner.locations && prod.partner.locations.length > 0) {
          const loc = prod.partner.locations.find(l => l._id && l._id.toString() === prod.location.toString());
          return loc && loc.province === province;
        }
        // Fallback to partner's primary province
        return prod.partner.province === province;
      });
    }
    
    // Calculate distance and filter if user sharing location
    if (userLat && userLng) {
      const uLat = parseFloat(userLat);
      const uLng = parseFloat(userLng);
      
      products = products.map(prod => {
        let distance = null;
        let lat = -34.603722; // default central warehouse (Obelisco, Buenos Aires)
        let lng = -58.381592;
        
        if (prod.partner) {
          if (prod.location && prod.partner.locations && prod.partner.locations.length > 0) {
            const loc = prod.partner.locations.id(prod.location);
            if (loc && loc.latitude !== null && loc.longitude !== null) {
              lat = loc.latitude;
              lng = loc.longitude;
            } else if (prod.partner.latitude !== null && prod.partner.longitude !== null) {
              lat = prod.partner.latitude;
              lng = prod.partner.longitude;
            }
          } else if (prod.partner.latitude !== null && prod.partner.longitude !== null) {
            lat = prod.partner.latitude;
            lng = prod.partner.longitude;
          }
          distance = calculateDistance(uLat, uLng, lat, lng);
        } else {
          // Assume central warehouse for global products
          distance = calculateDistance(uLat, uLng, lat, lng);
        }
        
        const pObj = prod.toObject ? prod.toObject() : { ...prod };
        pObj.distance = distance;
        return pObj;
      });

      // Filter by maxDistance if requested
      if (maxDistance) {
        const maxDistNum = parseFloat(maxDistance);
        products = products.filter(p => p.distance <= maxDistNum);
      }

      // If sort is distance_asc or not specified, sort by proximity
      if (!sort || sort === 'distance_asc') {
        products.sort((a, b) => a.distance - b.distance);
      }
    }

    const categories = await Category.find({});
    const activeCategory = categorySlug ? await Category.findOne({ slug: categorySlug }) : null;
    const partners = await Partner.find({ active: true }).sort({ name: 1 });
    const primaryProvinces = await Partner.distinct('province', { active: true, province: { $ne: '' } });
    const branchProvinces = await Partner.distinct('locations.province', { active: true, 'locations.province': { $ne: '' } });
    const provinces = Array.from(new Set([...primaryProvinces, ...branchProvinces])).sort();

    res.render('pages/products', {
      title: 'Catálogo de Productos',
      products,
      categories,
      activeCategory,
      search: search || '',
      minPrice: minPrice || '',
      maxPrice: maxPrice || '',
      sort: sort || '',
      partner: partnerId || '',
      province: province || '',
      userLat: userLat || '',
      userLng: userLng || '',
      maxDistance: maxDistance || '',
      partners,
      provinces,
      formatPrice
    });
  } catch (error) {
    next(error);
  }
};

// GET Product Detail Page
const getProductBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const product = await Product.findOne({ slug, active: true }).populate('category').populate('partner');
    
    if (!product) {
      return res.status(404).render('pages/error', {
        title: 'Producto no encontrado',
        status: 404,
        message: 'El producto que busca no existe o no se encuentra disponible.',
        stack: null
      });
    }

    // Load related products from the same category (limit to 4)
    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      active: true
    }).limit(4);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const ogImage = product.images && product.images.length > 0
      ? (product.images[0].startsWith('http') ? product.images[0] : `${baseUrl}${product.images[0]}`)
      : `${baseUrl}/img/logo.png`;

    res.render('pages/product-detail', {
      title: product.title,
      product,
      relatedProducts,
      formatPrice,
      ogTitle: `${product.title} | AbastoHub`,
      ogDescription: product.description || 'Comprá este excelente producto al mejor precio en AbastoHub.',
      ogImage,
      ogUrl: `${baseUrl}/products/${product.slug}`,
      ogType: 'product'
    });
  } catch (error) {
    next(error);
  }
};

// GET Admin Dashboard Panel
const getAdminPanel = async (req, res, next) => {
  try {
    const products = await Product.find({}).populate('category').populate('partner').sort({ createdAt: -1 });
    const categories = await Category.find({});
    // Load orders with populated user info
    const orders = await Order.find({}).populate('user').sort({ createdAt: -1 });
    const partners = await Partner.find({}).populate('assignedDriver').sort({ createdAt: -1 });
    const raffleCount = await RaffleParticipant.countDocuments({});
    
    // Load all partner withdrawals
    const withdrawals = await Withdrawal.find({}).populate('partner').sort({ createdAt: -1 });

    // Load all POS commission payments
    const commissionPayments = await CommissionPayment.find({}).populate('partner').sort({ createdAt: -1 });

    // Load global drivers to assign to partners
    const drivers = await Driver.find({ partner: null }).sort({ name: 1 });

    // Calculate best selling statistics (Top Products & Top Partners)
    const bestSellingStats = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$products' },
      { $group: {
        _id: '$products.product',
        totalQty: { $sum: '$products.quantity' },
        totalRevenue: { $sum: { $multiply: ['$products.price', '$products.quantity'] } }
      }},
      { $sort: { totalQty: -1 } },
      { $limit: 20 }
    ]);

    const populatedStats = await Promise.all(bestSellingStats.map(async (stat) => {
      const product = await Product.findById(stat._id).populate('partner').populate('category');
      return {
        ...stat,
        product
      };
    }));

    const bestSellers = populatedStats.filter(item => item.product !== null);

    // Group sales by Partner in memory
    const partnerSalesMap = {};
    for (const stat of bestSellers) {
      if (stat.product && stat.product.partner) {
        const pId = stat.product.partner._id.toString();
        if (!partnerSalesMap[pId]) {
          partnerSalesMap[pId] = {
            partner: stat.product.partner,
            totalQty: 0,
            totalRevenue: 0
          };
        }
        partnerSalesMap[pId].totalQty += stat.totalQty;
        partnerSalesMap[pId].totalRevenue += stat.totalRevenue;
      }
    }
    const bestPartners = Object.values(partnerSalesMap).sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Global Sales performance metrics
    const totalPaidOrders = await Order.find({ paymentStatus: 'paid' });
    const globalStats = {
      totalRevenue: totalPaidOrders.reduce((sum, o) => sum + o.total, 0),
      totalOrdersCount: totalPaidOrders.length,
      averageTicket: totalPaidOrders.length > 0 ? (totalPaidOrders.reduce((sum, o) => sum + o.total, 0) / totalPaidOrders.length) : 0,
      totalQtySold: bestSellers.reduce((sum, item) => sum + item.totalQty, 0)
    };

    res.render('pages/admin', {
      title: 'Panel de Control',
      products,
      categories,
      orders,
      partners,
      withdrawals,
      commissionPayments,
      drivers,
      raffleCount,
      bestSellers,
      bestPartners,
      globalStats,
      formatPrice,
      partnerInviteToken: config.partnerInviteToken,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
};

// POST Create Product Action (Admin Only)
const createProduct = async (req, res, next) => {
  try {
    const { title, description, price, wholesalePrice, stock, categoryId, unit, featured, discount } = req.body;
    
    if (!title || !price || !stock || !categoryId) {
      return res.redirect('/admin?error=' + encodeURIComponent('Por favor complete todos los campos obligatorios.'));
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
      featured: featured === 'on' || featured === 'true',
      discount: discount ? Number(discount) : 0,
      active: true
    });

    await newProduct.save();
    res.redirect('/admin?success=' + encodeURIComponent('Producto creado exitosamente.'));
  } catch (error) {
    console.error('Create product error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al crear el producto: ' + error.message));
  }
};

// POST Update Stock Action (Admin Only)
const updateStock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;
    
    if (stock === undefined || stock === '') {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(400).json({ success: false, error: 'Valor de stock no válido.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Valor de stock no válido.'));
    }

    await Product.findByIdAndUpdate(id, { stock: Number(stock) });
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: 'Stock actualizado exitosamente.' });
    }
    res.redirect('/admin?success=' + encodeURIComponent('Stock actualizado exitosamente.'));
  } catch (error) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al actualizar stock.' });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar stock.'));
  }
};

// POST Update Product Prices Action (Admin Only)
const updatePrice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { price, wholesalePrice } = req.body;
    
    if (price === undefined || price === '' || wholesalePrice === undefined || wholesalePrice === '') {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(400).json({ success: false, error: 'Precios no válidos.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Precios no válidos.'));
    }

    await Product.findByIdAndUpdate(id, { 
      price: Number(price), 
      wholesalePrice: Number(wholesalePrice) 
    });
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: 'Precios actualizados exitosamente.' });
    }
    res.redirect('/admin?success=' + encodeURIComponent('Precios actualizados exitosamente.'));
  } catch (error) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al actualizar precios.' });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar precios.'));
  }
};

// POST Update Product Details (Title and Description) Action (Admin Only)
const updateProductDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;
    
    if (!title || !title.trim()) {
      return res.redirect('/admin?error=' + encodeURIComponent('El nombre del producto no puede estar vacío.'));
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.redirect('/admin?error=' + encodeURIComponent('Producto no encontrado.'));
    }

    product.title = title.trim();
    product.description = (description || '').trim();
    
    await product.save();

    res.redirect('/admin?success=' + encodeURIComponent('Producto actualizado exitosamente.'));
  } catch (error) {
    console.error('Update product details error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar el producto: ' + error.message));
  }
};

// POST Toggle Active Status Action (Admin Only)
const toggleActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Producto no encontrado.'));
    }
    
    product.active = !product.active;
    await product.save();
    
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: `Producto ${product.active ? 'activado' : 'desactivado'} exitosamente.`, active: product.active });
    }
    res.redirect('/admin?success=' + encodeURIComponent(`Producto ${product.active ? 'activado' : 'desactivado'} exitosamente.`));
  } catch (error) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al cambiar el estado del producto.' });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al cambiar el estado del producto.'));
  }
};

// POST Toggle Featured Status Action (Admin Only)
const toggleFeatured = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Producto no encontrado.'));
    }
    
    product.featured = !product.featured;
    await product.save();
    
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: `Producto ${product.featured ? 'destacado' : 'quitado de destacados'} exitosamente.`, featured: product.featured });
    }
    res.redirect('/admin?success=' + encodeURIComponent(`Producto ${product.featured ? 'destacado' : 'quitado de destacados'} exitosamente.`));
  } catch (error) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al cambiar el estado destacado del producto.' });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al cambiar el estado destacado del producto.'));
  }
};

// POST Update Discount Action (Admin Only)
const updateDiscount = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { discount } = req.body;
    
    if (discount === undefined || discount === '') {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(400).json({ success: false, error: 'Valor de descuento no válido.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Valor de descuento no válido.'));
    }

    const discountNum = Number(discount);
    if (isNaN(discountNum) || discountNum < 0 || discountNum >= 100) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(400).json({ success: false, error: 'El descuento debe ser un número entre 0 y 99.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('El descuento debe ser un número entre 0 y 99.'));
    }

    await Product.findByIdAndUpdate(id, { discount: discountNum });
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: 'Descuento actualizado exitosamente.', discount: discountNum });
    }
    res.redirect('/admin?success=' + encodeURIComponent('Descuento actualizado exitosamente.'));
  } catch (error) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al actualizar el descuento.' });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar el descuento.'));
  }
};

// POST Delete Product Action (Admin Only)
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Producto no encontrado.'));
    }
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: 'Producto eliminado exitosamente del catálogo.' });
    }
    res.redirect('/admin?success=' + encodeURIComponent('Producto eliminado exitosamente del catálogo.'));
  } catch (error) {
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al eliminar el producto: ' + error.message });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al eliminar el producto: ' + error.message));
  }
};

// GET Generate PDF Ticket for Pickers (Admin Only)
const generatePDFTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id)
      .populate('user')
      .populate({
        path: 'products.product',
        populate: { path: 'partner' }
      });

    if (!order) {
      return res.status(404).send('Pedido no encontrado');
    }

    // Check authorization: must be admin or the owner of the order
    if (req.user.role !== 'admin' && (!order.user || order.user._id.toString() !== req.user._id.toString())) {
      return res.status(403).send('No autorizado para ver este ticket');
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    
    // Set headers to open PDF in a new tab / window
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=ticket-${order._id.toString().substring(12)}.pdf`);
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
       .text('DOCUMENTO DE PREPARACIÓN Y REMITO DE ENTREGA', headerTextX, 76);

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

    if (order.raffleCode) {
      doc.fillColor(darkSlate)
         .fontSize(8.5)
         .font('Helvetica-Bold')
         .text(`CÓDIGO SORTEO: ${order.raffleCode}`, 280, 91, { align: 'right', width: 175 });
    }

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
       .text('DETALLES DE DESPACHO / PAGO', 315, clientBoxY + 10);

    const addressStr = order.deliveryType === 'delivery' 
      ? (order.shippingDetails.address || 'No especificada') 
      : 'Retiro en depósito central / AbastoHub';
    
    const payMethodName = order.paymentMethod === 'transfer' ? 'Transferencia Bancaria' : (order.paymentMethod === 'cash' ? 'Efectivo (POS)' : 'MercadoPago');

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
       .text('ARTÍCULOS A RECOLECTAR (PICKING LIST)', 40, tableTitleY);

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

    order.products.forEach((item, index) => {
      // Determine if item has a partner
      const partnerName = item.product && item.product.partner ? item.product.partner.name : null;
      const rowHeight = partnerName ? 28 : 22;
      
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

      if (partnerName) {
        doc.font('Helvetica-Oblique')
           .fontSize(7.5)
           .fillColor(primaryColor)
           .text(`Producido por: ${partnerName}`, 70, currentY + 17, { width: 220, truncate: true });
      }

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
    
    const totalsBoxY = currentY + 12;
    doc.rect(340, totalsBoxY, 215, 45).fill('#f8fafc');
    doc.rect(340, totalsBoxY, 215, 45).lineWidth(1).strokeColor('#e2e8f0').stroke();

    doc.fillColor(textGray)
       .fontSize(8.5)
       .font('Helvetica')
       .text('Cantidad de Bultos:', 355, totalsBoxY + 10)
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text(order.products.reduce((acc, p) => acc + p.quantity, 0).toString(), 460, totalsBoxY + 10)
       
       .font('Helvetica-Bold')
       .fillColor(primaryColor)
       .fontSize(10)
       .text('TOTAL GENERAL:', 355, totalsBoxY + 26)
       .fontSize(11)
       .text(formatPrice(order.total), 450, totalsBoxY + 25, { width: 95, align: 'right' });

    // 5. Tear-off remito / signatures section
    checkPageBreak(110);
    
    // Draw tear-off scissor line
    const scissorY = currentY + 70;
    doc.rect(40, scissorY, 515, 0.5).dash(4, { space: 4 }).strokeColor(textGray).stroke();
    
    // Scissor icon representation
    doc.fillColor(textGray)
       .fontSize(7.5)
       .font('Helvetica-Oblique')
       .text('--- CORTAR AQUÍ (TALONARIO DE ENTREGA CONFORME) ---', 40, scissorY + 5, { align: 'center', width: 515 });

    // Client Signature Box
    const signY = scissorY + 18;
    doc.rect(40, signY, 515, 80).fill('#fdfdfd');
    doc.rect(40, signY, 515, 80).lineWidth(1).strokeColor(borderGray).stroke();

    doc.fillColor(darkSlate)
       .fontSize(8.5)
       .font('Helvetica-Bold')
       .text('CONFORMIDAD DE RECEPCIÓN (CLIENTE)', 50, signY + 10)
       .font('Helvetica')
       .text('Firma: ___________________________', 50, signY + 32)
       .text('Aclaración: ________________________', 50, signY + 50)
       .text('DNI: ____________________________', 50, signY + 68)
       
       .text('Fecha: ____/____/2026', 330, signY + 32)
       .text('Hora: ____:____ hs', 330, signY + 50)
       .font('Helvetica-Bold')
       .text('Nº Pedido: #' + shortId, 330, signY + 68);

    // Operator Signatures
    checkPageBreak(90);
    const opSignY = doc.y + 100 > 715 ? doc.y + 20 : 715;
    
    doc.rect(40, opSignY, 515, 0.5).fill(borderGray);
    doc.fillColor(darkSlate)
       .fontSize(8)
       .font('Helvetica-Bold')
       .text('Armado / Preparado por:', 45, opSignY + 12)
       .font('Helvetica')
       .text('Firma: ___________________________', 45, opSignY + 28)
       
       .font('Helvetica-Bold')
       .text('Controlado / Despachado por:', 320, opSignY + 12)
       .font('Helvetica')
       .text('Firma: ___________________________', 320, opSignY + 28);

    doc.font('Helvetica-Oblique')
       .fontSize(7)
       .fillColor(textGray)
       .text('Este ticket es un comprobante interno de preparación de mercadería y remito, no válido como factura fiscal.', 40, opSignY + 52, { align: 'center', width: 515 });

    doc.end();

  } catch (error) {
    next(error);
  }
};

// POST Create Partner/Affiliate Action (Admin Only)
const createPartner = async (req, res, next) => {
  try {
    const { name, type, website, password, phone, address } = req.body;
    
    if (!name || !password || !req.file) {
      return res.redirect('/admin?error=' + encodeURIComponent('El nombre, contraseña y logo son campos obligatorios.'));
    }

    // Generate internal email automatically: (nombredelsocio)@abastohub.com
    const generatedEmail = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '') + '@abastohub.com';

    // Check if email already exists
    const existing = await Partner.findOne({ email: generatedEmail });
    if (existing) {
      return res.redirect('/admin?error=' + encodeURIComponent(`Ya existe un socio con el correo generado: ${generatedEmail}`));
    }

    // Upload logo image to Firebase
    const logoUrl = await uploadImage(req.file, 'partners');
    if (!logoUrl) {
      return res.redirect('/admin?error=' + encodeURIComponent('Error al subir la imagen del logo.'));
    }

    const newPartner = new Partner({
      name,
      type,
      website: website || '',
      logo: logoUrl,
      email: generatedEmail,
      password, // Will be hashed via PartnerSchema pre('save') hook
      phone: phone || '',
      address: address || '',
      active: true
    });

    await newPartner.save();
    res.redirect('/admin?success=' + encodeURIComponent('Socio/Afiliado creado exitosamente.'));
  } catch (error) {
    console.error('Create partner error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al agregar el socio/afiliado: ' + error.message));
  }
};

// POST Delete Partner/Affiliate Action (Admin Only)
const deletePartner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const partner = await Partner.findByIdAndDelete(id);
    if (!partner) {
      return res.redirect('/admin?error=' + encodeURIComponent('Socio/Afiliado no encontrado.'));
    }
    res.redirect('/admin?success=' + encodeURIComponent('Socio/Afiliado eliminado exitosamente.'));
  } catch (error) {
    res.redirect('/admin?error=' + encodeURIComponent('Error al eliminar el socio/afiliado: ' + error.message));
  }
};

// POST Reset Partner Password Action (Admin Only)
const resetPartnerPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const partner = await Partner.findById(id);
    if (!partner) {
      return res.redirect('/admin?error=' + encodeURIComponent('Socio/Afiliado no encontrado.'));
    }

    // Generate random password: 6 letters, 4 numbers, 1 symbol
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    let passwordArr = [];
    // 6 letters
    for (let i = 0; i < 6; i++) {
      passwordArr.push(letters.charAt(Math.floor(Math.random() * letters.length)));
    }
    // 4 numbers
    for (let i = 0; i < 4; i++) {
      passwordArr.push(numbers.charAt(Math.floor(Math.random() * numbers.length)));
    }
    // 1 symbol
    passwordArr.push(symbols.charAt(Math.floor(Math.random() * symbols.length)));

    // Shuffle the array
    for (let i = passwordArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [passwordArr[i], passwordArr[j]] = [passwordArr[j], passwordArr[i]];
    }

    const generatedPassword = passwordArr.join('');
    partner.password = generatedPassword;
    await partner.save();

    res.redirect('/admin?success=' + encodeURIComponent(`Contraseña para "${partner.name}" restablecida con éxito. Nueva contraseña: ${generatedPassword}`));
  } catch (error) {
    console.error('Reset partner password error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al restablecer la contraseña: ' + error.message));
  }
};

// POST Toggle Partner Featured Status for 72 Hours (Admin Only)
const togglePartnerFeatured72h = async (req, res, next) => {
  try {
    const { id } = req.params;
    const partner = await Partner.findById(id);
    if (!partner) {
      return res.redirect('/admin?error=' + encodeURIComponent('Socio/Afiliado no encontrado.'));
    }

    const isFeatured = partner.featuredUntil && partner.featuredUntil > new Date();
    if (isFeatured) {
      partner.featuredUntil = null;
      await partner.save();
      res.redirect('/admin?success=' + encodeURIComponent(`Destacado removido para "${partner.name}".`));
    } else {
      partner.featuredUntil = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await partner.save();
      res.redirect('/admin?success=' + encodeURIComponent(`"${partner.name}" destacado por 72 horas con éxito.`));
    }
  } catch (error) {
    console.error('Toggle partner featured 72h error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al destacar el socio: ' + error.message));
  }
};

// POST Assign Driver to Partner (Admin Only)
const assignDriverToPartner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { driverId } = req.body;

    const partner = await Partner.findById(id);
    if (!partner) {
      return res.redirect('/admin?error=' + encodeURIComponent('Socio/Afiliado no encontrado.'));
    }

    if (!driverId || driverId.trim() === '') {
      partner.assignedDriver = null;
    } else {
      partner.assignedDriver = driverId;
    }

    await partner.save();
    res.redirect('/admin?success=' + encodeURIComponent(`Conductor asignado correctamente a ${partner.name}.`));
  } catch (error) {
    console.error('Assign driver to partner error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al asignar el conductor: ' + error.message));
  }
};

// GET Generate PDF Report / Summary of Orders (Admin Only)
const generateOrdersSummaryPDF = async (req, res, next) => {
  try {
    const { startDate, endDate, search } = req.query;
    
    // Build date query
    const dateQuery = {};
    if (startDate) {
      dateQuery.$gte = new Date(startDate + 'T00:00:00');
    }
    if (endDate) {
      dateQuery.$lte = new Date(endDate + 'T23:59:59');
    }
    
    const query = {};
    if (startDate || endDate) {
      query.createdAt = dateQuery;
    }
    
    // Find matching orders and populate user
    let orders = await Order.find(query).populate('user').sort({ createdAt: -1 });
    
    if (search) {
      const searchUpper = search.trim().toUpperCase();
      orders = orders.filter(order => {
        const orderId = order._id.toString().toUpperCase();
        const clientName = (order.shippingDetails.name || (order.user ? `${order.user.name} ${order.user.lastname}` : '')).toUpperCase();
        const clientEmail = (order.user ? order.user.email : '').toUpperCase();
        const clientPhone = (order.shippingDetails.phone || (order.user ? order.user.phone : '')).toUpperCase();
        
        return orderId.includes(searchUpper) || 
               clientName.includes(searchUpper) || 
               clientEmail.includes(searchUpper) || 
               clientPhone.includes(searchUpper);
      });
    }
    
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=resumen-pedidos.pdf');
    doc.pipe(res);
    
    // Color Palette
    const primaryColor = '#10b981'; // Emerald Green
    const darkSlate = '#0f172a'; // Deep slate
    const textGray = '#475569';  // Slate gray
    const bgGray = '#f8fafc';    // Soft slate background
    const borderGray = '#e2e8f0';  // Very light gray border
    
    // 1. Decorative Brand Bar
    doc.rect(40, 40, 515, 5).fill(primaryColor);
    
    // Logo & Header Brand
    const logoPath = path.join(__dirname, '../../public/img/logo.png');
    let headerTextX = 40;
    try {
      doc.image(logoPath, 40, 55, { height: 35 });
      headerTextX = 90;
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
       .text('REPORTE CONSOLIDADO DE PEDIDOS Y VENTAS', headerTextX, 76);
       
    // Date / Range info
    let rangeLabel = 'Todos los registros';
    if (startDate && endDate) {
      rangeLabel = `Del ${new Date(startDate + 'T00:00:00').toLocaleDateString('es-AR')} al ${new Date(endDate + 'T00:00:00').toLocaleDateString('es-AR')}`;
    } else if (startDate) {
      rangeLabel = `Desde el ${new Date(startDate + 'T00:00:00').toLocaleDateString('es-AR')}`;
    } else if (endDate) {
      rangeLabel = `Hasta el ${new Date(endDate + 'T00:00:00').toLocaleDateString('es-AR')}`;
    }
    
    doc.fillColor(darkSlate)
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Período:', 330, 55, { align: 'right', width: 225 })
       .font('Helvetica')
       .fontSize(8.5)
       .fillColor(textGray)
       .text(rangeLabel, 330, 68, { align: 'right', width: 225 })
       .text(`Generado: ${new Date().toLocaleString('es-AR')}`, 330, 80, { align: 'right', width: 225 });
       
    // 2. Summary Cards / Stats
    const statsBoxY = 110;
    doc.rect(40, statsBoxY, 515, 60).fill(bgGray);
    doc.rect(40, statsBoxY, 515, 60).lineWidth(1).strokeColor(borderGray).stroke();
    
    // Calculate stats
    const totalOrdersCount = orders.length;
    const totalAmount = orders.reduce((sum, o) => sum + o.total, 0);
    const paidOrders = orders.filter(o => o.paymentStatus === 'paid');
    const totalPaidAmount = paidOrders.reduce((sum, o) => sum + o.total, 0);
    
    // Column 1: Total Orders
    doc.fillColor(textGray)
       .fontSize(8)
       .font('Helvetica-Bold')
       .text('PEDIDOS TOTALES', 55, statsBoxY + 15)
       .fontSize(16)
       .fillColor(darkSlate)
       .text(totalOrdersCount.toString(), 55, statsBoxY + 27);
       
    // Column 2: Total Revenue (Facturado)
    doc.fillColor(textGray)
       .fontSize(8)
       .font('Helvetica-Bold')
       .text('MONTO TOTAL REGISTRADO', 200, statsBoxY + 15)
       .fontSize(16)
       .fillColor(darkSlate)
       .text(formatPrice(totalAmount), 200, statsBoxY + 27);
       
    // Column 3: Paid Revenue (Cobrado)
    doc.fillColor(textGray)
       .fontSize(8)
       .font('Helvetica-Bold')
       .text('EFECTIVO COBRADO (PAGADOS)', 380, statsBoxY + 15)
       .fontSize(16)
       .fillColor(primaryColor)
       .text(formatPrice(totalPaidAmount), 380, statsBoxY + 27);
       
    // 3. Orders Table Title
    const tableTitleY = 190;
    doc.fillColor(darkSlate)
       .fontSize(10.5)
       .font('Helvetica-Bold')
       .text('DETALLE DE TRANSACCIONES', 40, tableTitleY);
       
    const tableTop = tableTitleY + 18;
    
    // Draw Header Row background
    doc.rect(40, tableTop, 515, 20).fill('#e2e8f0');
    
    // Header labels
    doc.fillColor(darkSlate)
       .fontSize(8)
       .font('Helvetica-Bold')
       .text('ID PEDIDO', 45, tableTop + 6)
       .text('FECHA / HORA', 110, tableTop + 6)
       .text('CLIENTE / CONTACTO', 200, tableTop + 6)
       .text('METODO', 350, tableTop + 6)
       .text('ESTADO', 420, tableTop + 6)
       .text('TOTAL', 485, tableTop + 6, { width: 65, align: 'right' });
       
    let currentY = tableTop + 20;
    
    orders.forEach((order, index) => {
      // Manage page breaks
      if (currentY > 750) {
        doc.addPage();
        doc.rect(40, 40, 515, 5).fill(primaryColor);
        doc.rect(40, 55, 515, 20).fill('#e2e8f0');
        doc.fillColor(darkSlate)
           .fontSize(8)
           .font('Helvetica-Bold')
           .text('ID PEDIDO', 45, 61)
           .text('FECHA / HORA', 110, 61)
           .text('CLIENTE / CONTACTO', 200, 61)
           .text('METODO', 350, 61)
           .text('ESTADO', 420, 61)
           .text('TOTAL', 485, 61, { width: 65, align: 'right' });
        currentY = 75;
      }
      
      // Zebra backgrounds
      if (index % 2 === 0) {
        doc.rect(40, currentY, 515, 22).fill('#f8fafc');
      } else {
        doc.rect(40, currentY, 515, 22).fill('#ffffff');
      }
      
      const shortId = order._id.toString().substring(12).toUpperCase();
      const customerName = order.shippingDetails.name || (order.user ? `${order.user.name} ${order.user.lastname}` : 'Cliente Registrado');
      const dateStr = order.createdAt.toLocaleDateString('es-AR') + ' ' + order.createdAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const deliveryMethod = order.deliveryType === 'delivery' ? 'Envío' : 'Retiro';
      const statusLabel = order.paymentStatus.toUpperCase();
      
      doc.fillColor(darkSlate)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text(`#${shortId}`, 45, currentY + 7)
         .font('Helvetica')
         .fontSize(7.5)
         .text(dateStr, 110, currentY + 7)
         .font('Helvetica')
         .fontSize(8)
         .text(customerName, 200, currentY + 7, { width: 145, truncate: true })
         .text(deliveryMethod, 350, currentY + 7)
         .font('Helvetica-Bold')
         .text(statusLabel, 420, currentY + 7)
         .text(formatPrice(order.total), 485, currentY + 7, { width: 65, align: 'right' });
         
      // Divider
      doc.rect(40, currentY + 22, 515, 0.5).fill('#e2e8f0');
      currentY += 22;
    });
    
    // 4. Footer Note
    if (currentY > 740) {
      doc.addPage();
      currentY = 40;
    }
    
    const footerY = 780;
    doc.rect(40, footerY, 515, 0.5).fill(borderGray);
    doc.fillColor(textGray)
       .font('Helvetica-Oblique')
       .fontSize(7.5)
       .text('Este documento es un reporte consolidado emitido automáticamente por el panel de control de AbastoHub.', 40, footerY + 10, { align: 'center', width: 515 });
       
    doc.end();

    // Delete matching orders from database to clear history for the selected range
    if (orders && orders.length > 0) {
      const orderIds = orders.map(o => o._id);
      console.log(`🗑️ PDF Report Generated: Deleting ${orderIds.length} orders from range.`);
      await Order.deleteMany({ _id: { $in: orderIds } });
    }
  } catch (error) {
    next(error);
  }
};

// POST Mark Order as Paid (Admin Only)
const markOrderAsPaid = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    
    if (!order) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Pedido no encontrado.'));
    }

    if (order.paymentStatus === 'paid') {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(400).json({ success: false, error: 'El pedido ya está marcado como pagado.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('El pedido ya está marcado como pagado.'));
    }

    order.paymentStatus = 'paid';
    
    // Subtract stock if not already subtracted
    if (!order.stockSubtracted) {
      console.log(`📉 Reducing stock for manually approved order ${order._id}...`);
      for (const item of order.products) {
        const prod = await Product.findById(item.product);
        if (prod) {
          const newStock = Math.max(0, prod.stock - item.quantity);
          prod.stock = newStock;
          await prod.save();
          console.log(`   - Product: ${prod.title}. Previous stock: ${prod.stock + item.quantity}, new stock: ${prod.stock}`);
        } else {
          console.warn(`   ⚠️ Product not found when trying to subtract stock: ${item.product}`);
        }
      }
      order.stockSubtracted = true;
    }

    await order.save();
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: `El pedido #${order._id.toString().substring(12).toUpperCase()} ha sido acreditado exitosamente.` });
    }
    res.redirect('/admin?success=' + encodeURIComponent(`El pedido #${order._id.toString().substring(12).toUpperCase()} ha sido acreditado exitosamente.`));
  } catch (error) {
    console.error('Mark order as paid error:', error.message);
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al acreditar el pago: ' + error.message });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al acreditar el pago: ' + error.message));
  }
};

// POST Update Order Status (Admin Only)
const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const order = await Order.findById(id);
    if (!order) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Pedido no encontrado.'));
    }

    order.status = status;

    // If status is updated to cancelled, cancel payment status and restore stock if subtracted
    if (status === 'cancelled') {
      order.paymentStatus = 'cancelled';
      
      if (order.stockSubtracted) {
        console.log(`📈 Restoring stock for cancelled order ${order._id}...`);
        for (const item of order.products) {
          const prod = await Product.findById(item.product);
          if (prod) {
            prod.stock += item.quantity;
            await prod.save();
            console.log(`   - Product: ${prod.title}. Restored stock: +${item.quantity}. New stock: ${prod.stock}`);
          }
        }
        order.stockSubtracted = false;
      }
    }

    await order.save();
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: `Estado del pedido #${order._id.toString().substring(12).toUpperCase()} actualizado exitosamente.` });
    }
    res.redirect('/admin?success=' + encodeURIComponent(`Estado del pedido #${order._id.toString().substring(12).toUpperCase()} actualizado exitosamente.`));
  } catch (error) {
    console.error('Update order status error:', error.message);
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al actualizar el estado del pedido: ' + error.message });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar el estado del pedido: ' + error.message));
  }
};

// GET Admin Routes Map Page
const getAdminRoutes = async (req, res, next) => {
  try {
    // Get pending delivery orders (excluding cancelled, already delivered, or already shipped)
    const orders = await Order.find({
      deliveryType: 'delivery',
      status: { $nin: ['shipped', 'delivered', 'cancelled'] }
    }).populate('user').sort({ createdAt: -1 });

    // Get drivers list
    const drivers = await Driver.find({}).sort({ name: 1 });

    // Get dispatch history (shipped or delivered orders)
    const dispatchedOrders = await Order.find({
      deliveryType: 'delivery',
      status: { $in: ['shipped', 'delivered'] }
    }).populate('user').sort({ dispatchedAt: -1 });

    res.render('pages/admin-routes', {
      title: 'Trazado de Rutas de Entrega',
      orders,
      drivers,
      dispatchedOrders,
      formatPrice,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
};

// GET Admin Drivers Management Page
const getAdminDrivers = async (req, res, next) => {
  try {
    const drivers = await Driver.find({}).populate('partner').sort({ name: 1 });
    res.render('pages/admin-drivers', {
      title: 'Gestión de Conductores',
      drivers,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
};

// POST Create Driver (Admin Only)
const createDriver = async (req, res, next) => {
  try {
    const { name, vehicle, password } = req.body;
    if (!name || !vehicle || !password) {
      return res.redirect('/admin/drivers?error=' + encodeURIComponent('El nombre, vehículo y la contraseña son obligatorios.'));
    }

    const driver = new Driver({ name, vehicle, password });
    await driver.save();

    res.redirect('/admin/drivers?success=' + encodeURIComponent(`Conductor ${name} registrado exitosamente.`));
  } catch (error) {
    console.error('Create driver error:', error.message);
    res.redirect('/admin/drivers?error=' + encodeURIComponent('Error al registrar el conductor: ' + error.message));
  }
};

// POST Delete Driver (Admin Only)
const deleteDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Driver.findByIdAndDelete(id);
    res.redirect('/admin/drivers?success=' + encodeURIComponent('Conductor eliminado exitosamente.'));
  } catch (error) {
    console.error('Delete driver error:', error.message);
    res.redirect('/admin/drivers?error=' + encodeURIComponent('Error al eliminar el conductor: ' + error.message));
  }
};

// POST Dispatch Routes (Admin Only)
const dispatchRoute = async (req, res, next) => {
  try {
    const { orderIds, driverName, driverVehicle } = req.body;

    if (!orderIds || (Array.isArray(orderIds) && orderIds.length === 0) || (!Array.isArray(orderIds) && !orderIds)) {
      return res.redirect('/admin/routes?error=' + encodeURIComponent('Debe seleccionar al menos un pedido para despachar la ruta.'));
    }

    const ids = Array.isArray(orderIds) ? orderIds : [orderIds];

    // Update orders status to 'shipped' and assign driver details
    for (const orderId of ids) {
      const order = await Order.findById(orderId);
      if (order) {
        order.status = 'shipped';
        order.driverName = driverName || 'Conductor';
        order.driverVehicle = driverVehicle || 'Vehículo';
        order.dispatchedAt = new Date();
        await order.save();
      }
    }

    res.redirect('/admin/routes?success=' + encodeURIComponent(`Se han despachado ${ids.length} pedido(s) con el conductor ${driverName || 'asignado'}. El estado ha cambiado a "En camino".`));
  } catch (error) {
    console.error('Dispatch route error:', error.message);
    res.redirect('/admin/routes?error=' + encodeURIComponent('Error al despachar la ruta: ' + error.message));
  }
};

// POST Delete Single Order (Admin Only)
const deleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findByIdAndDelete(id);
    if (!order) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });
      }
      return res.redirect('/admin?error=' + encodeURIComponent('Pedido no encontrado.'));
    }
    if (req.accepts('html', 'json') === 'json') {
      return res.json({ success: true, message: `Pedido #${id.toString().substring(12).toUpperCase()} eliminado correctamente.` });
    }
    res.redirect('/admin?success=' + encodeURIComponent(`Pedido #${id.toString().substring(12).toUpperCase()} eliminado correctamente.`));
  } catch (error) {
    console.error('Delete order error:', error.message);
    if (req.accepts('html', 'json') === 'json') {
      return res.status(500).json({ success: false, error: 'Error al eliminar el pedido: ' + error.message });
    }
    res.redirect('/admin?error=' + encodeURIComponent('Error al eliminar el pedido: ' + error.message));
  }
};

// POST Delete All Orders (Admin Only)
const deleteAllOrders = async (req, res, next) => {
  try {
    const result = await Order.deleteMany({});
    res.redirect('/admin?success=' + encodeURIComponent(`Se han eliminado todos los pedidos correctamente (${result.deletedCount} registros).`));
  } catch (error) {
    console.error('Delete all orders error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al eliminar todos los pedidos: ' + error.message));
  }
};

// GET Generate Catalog Price List PDF (Admin / Public)
const generatePriceListPDF = async (req, res, next) => {
  try {
    const products = await Product.find({ active: true }).populate('category').sort({ title: 1 });
    
    // Group products by category
    const grouped = {};
    products.forEach(p => {
      const catName = p.category ? p.category.name : 'Otros';
      if (!grouped[catName]) {
        grouped[catName] = [];
      }
      grouped[catName].push(p);
    });

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=lista-de-precios.pdf');
    doc.pipe(res);
    
    // Color Palette
    const primaryColor = '#10b981'; // Emerald Green
    const darkSlate = '#0f172a'; // Deep slate
    const textGray = '#475569';  // Slate gray
    const bgGray = '#f8fafc';    // Soft slate background
    const borderGray = '#e2e8f0';  // Very light gray border
    
    // 1. Decorative Brand Bar
    doc.rect(40, 40, 515, 5).fill(primaryColor);
    
    // Logo & Header Brand
    const logoPath = path.join(__dirname, '../../public/img/logo.png');
    let headerTextX = 40;
    try {
      doc.image(logoPath, 40, 55, { height: 35 });
      headerTextX = 90;
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
       .text('LISTA DE PRECIOS VIGENTE', headerTextX, 76);
       
    doc.fillColor(darkSlate)
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Catálogo Oficial', 330, 55, { align: 'right', width: 225 })
       .font('Helvetica')
       .fontSize(8.5)
       .fillColor(textGray)
       .text(`Generada: ${new Date().toLocaleDateString('es-AR')}`, 330, 68, { align: 'right', width: 225 })
       .text('Precios sujetos a cambio sin previo aviso', 330, 80, { align: 'right', width: 225 });

    let currentY = 110;

    // Draw lines for each category
    const categoriesList = Object.keys(grouped).sort();
    
    if (categoriesList.length === 0) {
      doc.fontSize(12)
         .font('Helvetica')
         .fillColor(textGray)
         .text('No hay productos activos en el catálogo actualmente.', 40, currentY);
    } else {
      categoriesList.forEach((catName) => {
        const catProducts = grouped[catName];
        
        // Manage page break if category header is too low
        if (currentY > 700) {
          doc.addPage();
          doc.rect(40, 40, 515, 5).fill(primaryColor);
          currentY = 60;
        }

        // Category Title Bar
        doc.rect(40, currentY, 515, 20).fill(bgGray);
        doc.rect(40, currentY, 515, 20).lineWidth(0.5).strokeColor(borderGray).stroke();
        
        doc.fillColor(primaryColor)
           .font('Helvetica-Bold')
           .fontSize(10)
           .text(catName.toUpperCase(), 50, currentY + 5);

        currentY += 25;

        // Table Header
        doc.rect(40, currentY, 515, 18).fill('#e2e8f0');
        doc.fillColor(darkSlate)
           .font('Helvetica-Bold')
           .fontSize(8.5)
           .text('PRODUCTO', 45, currentY + 5)
           .text('UNIDAD', 260, currentY + 5)
           .text('PRECIO MINORISTA', 340, currentY + 5, { width: 100, align: 'right' })
           .text('PRECIO MAYORISTA (6+ u.)', 450, currentY + 5, { width: 100, align: 'right' });

        currentY += 18;

        catProducts.forEach((p, idx) => {
          // Page break
          if (currentY > 740) {
            doc.addPage();
            doc.rect(40, 40, 515, 5).fill(primaryColor);
            
            // Re-draw Table Header on new page
            currentY = 60;
            doc.rect(40, currentY, 515, 18).fill('#e2e8f0');
            doc.fillColor(darkSlate)
               .font('Helvetica-Bold')
               .fontSize(8.5)
               .text('PRODUCTO', 45, currentY + 5)
               .text('UNIDAD', 260, currentY + 5)
               .text('PRECIO MINORISTA', 340, currentY + 5, { width: 100, align: 'right' })
               .text('PRECIO MAYORISTA (6+ u.)', 450, currentY + 5, { width: 100, align: 'right' });
            currentY += 18;
          }

          // Zebra backgrounds
          if (idx % 2 === 0) {
            doc.rect(40, currentY, 515, 20).fill('#f8fafc');
          } else {
            doc.rect(40, currentY, 515, 20).fill('#ffffff');
          }

          const wholesale = p.wholesalePrice || p.price;

          doc.fillColor(darkSlate)
             .font('Helvetica-Bold')
             .fontSize(8.5)
             .text(p.title, 45, currentY + 6, { width: 210, truncate: true })
             .font('Helvetica')
             .fontSize(8)
             .text(p.unit || 'unidades', 260, currentY + 6)
             .font('Helvetica-Bold')
             .fillColor(darkSlate)
             .text(formatPrice(p.price), 340, currentY + 6, { width: 100, align: 'right' })
             .fillColor(primaryColor)
             .text(formatPrice(wholesale), 450, currentY + 6, { width: 100, align: 'right' });

          doc.rect(40, currentY + 20, 515, 0.5).fill(borderGray);
          currentY += 20;
        });

        currentY += 15; // Gap between categories
      });
    }

    // Footer
    if (currentY > 740) {
      doc.addPage();
      currentY = 40;
    }
    
    const footerY = 780;
    doc.rect(40, footerY, 515, 0.5).fill(borderGray);
    doc.fillColor(textGray)
       .font('Helvetica-Oblique')
       .fontSize(7.5)
       .text('AbastoHub - Tu distribuidora de confianza. Precios expresados en Pesos Argentinos ($).', 40, footerY + 10, { align: 'center', width: 515 });

    doc.end();
  } catch (error) {
    next(error);
  }
};

// POST Admin Update Partner Withdrawal Status (Approve/Reject)
const updateWithdrawalStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.redirect('/admin?error=' + encodeURIComponent('Estado de retiro no válido.'));
    }

    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal) {
      return res.redirect('/admin?error=' + encodeURIComponent('Solicitud de retiro no encontrada.'));
    }

    withdrawal.status = status;
    withdrawal.notes = (notes || '').trim();
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    res.redirect('/admin?success=' + encodeURIComponent(`Solicitud de retiro actualizada a [${status === 'approved' ? 'Aprobada/Pagada' : 'Rechazada'}] con éxito.`));
  } catch (error) {
    console.error('Update withdrawal status error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar el estado del retiro: ' + error.message));
  }
};

const generateStatisticsPDF = async (req, res, next) => {
  try {
    // Calculate best selling statistics (Top Products & Top Partners)
    const bestSellingStats = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$products' },
      { $group: {
        _id: '$products.product',
        totalQty: { $sum: '$products.quantity' },
        totalRevenue: { $sum: { $multiply: ['$products.price', '$products.quantity'] } }
      }},
      { $sort: { totalQty: -1 } },
      { $limit: 20 }
    ]);

    const populatedStats = await Promise.all(bestSellingStats.map(async (stat) => {
      const product = await Product.findById(stat._id).populate('partner').populate('category');
      return {
        ...stat,
        product
      };
    }));

    const bestSellers = populatedStats.filter(item => item.product !== null);

    // Group sales by Partner in memory
    const partnerSalesMap = {};
    for (const stat of bestSellers) {
      if (stat.product && stat.product.partner) {
        const pId = stat.product.partner._id.toString();
        if (!partnerSalesMap[pId]) {
          partnerSalesMap[pId] = {
            partner: stat.product.partner,
            totalQty: 0,
            totalRevenue: 0
          };
        }
        partnerSalesMap[pId].totalQty += stat.totalQty;
        partnerSalesMap[pId].totalRevenue += stat.totalRevenue;
      }
    }
    const bestPartners = Object.values(partnerSalesMap).sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Global Sales performance metrics
    const totalPaidOrders = await Order.find({ paymentStatus: 'paid' });
    const globalStats = {
      totalRevenue: totalPaidOrders.reduce((sum, o) => sum + o.total, 0),
      totalOrdersCount: totalPaidOrders.length,
      averageTicket: totalPaidOrders.length > 0 ? (totalPaidOrders.reduce((sum, o) => sum + o.total, 0) / totalPaidOrders.length) : 0,
      totalQtySold: bestSellers.reduce((sum, item) => sum + item.totalQty, 0)
    };

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte-estadisticas.pdf');
    doc.pipe(res);
    
    // Color Palette
    const primaryColor = '#10b981'; // Emerald Green
    const darkSlate = '#0f172a'; // Deep slate
    const textGray = '#475569';  // Slate gray
    const bgGray = '#f8fafc';    // Soft slate background
    const borderGray = '#e2e8f0';  // Very light gray border
    
    // 1. Decorative Brand Bar
    doc.rect(40, 40, 515, 5).fill(primaryColor);
    
    // Logo & Header Brand
    const logoPath = path.join(__dirname, '../../public/img/logo.png');
    let headerTextX = 40;
    try {
      doc.image(logoPath, 40, 55, { height: 35 });
      headerTextX = 90;
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
       .text('REPORTE EJECUTIVO DE ESTADÍSTICAS Y RENDIMIENTO', headerTextX, 76);
       
    doc.fillColor(darkSlate)
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Métricas de Negocio', 330, 55, { align: 'right', width: 225 })
       .font('Helvetica')
       .fontSize(8.5)
       .fillColor(textGray)
       .text(`Generado: ${new Date().toLocaleString('es-AR')}`, 330, 68, { align: 'right', width: 225 })
       .text('Datos de órdenes finalizadas', 330, 80, { align: 'right', width: 225 });

    let currentY = 110;

    // Draw 4 Metrics Cards side by side
    const cardW = 120;
    const cardH = 50;
    const cardGap = 11;
    const startX = 40;

    const metrics = [
      { label: 'TOTAL FACTURADO', val: formatPrice(globalStats.totalRevenue), color: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
      { label: 'TICKET PROMEDIO', val: formatPrice(globalStats.averageTicket), color: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
      { label: 'PEDIDOS PAGADOS', val: String(globalStats.totalOrdersCount), color: '#f5f3ff', text: '#5b21b6', border: '#ddd6fe' },
      { label: 'UNIDADES VENDIDAS', val: `${globalStats.totalQtySold} u.`, color: '#fffbeb', text: '#92400e', border: '#fde68a' }
    ];

    metrics.forEach((m, idx) => {
      const x = startX + idx * (cardW + cardGap);
      doc.rect(x, currentY, cardW, cardH).fill(m.color);
      doc.rect(x, currentY, cardW, cardH).lineWidth(1).strokeColor(m.border).stroke();
      
      doc.fillColor(textGray)
         .font('Helvetica-Bold')
         .fontSize(6.5)
         .text(m.label, x + 8, currentY + 10, { width: cardW - 16 });
         
      doc.fillColor(m.text)
         .font('Helvetica-Bold')
         .fontSize(12)
         .text(m.val, x + 8, currentY + 22, { width: cardW - 16 });
    });

    currentY += 70;

    // Section Title: Best Sellers
    doc.fillColor(darkSlate)
       .font('Helvetica-Bold')
       .fontSize(12)
       .text('TOP 20 PRODUCTOS MÁS VENDIDOS', 40, currentY);
       
    currentY += 18;

    // Table Header for Best Sellers
    doc.rect(40, currentY, 515, 18).fill('#e2e8f0');
    doc.fillColor(darkSlate)
       .font('Helvetica-Bold')
       .fontSize(8)
       .text('POS', 45, currentY + 5)
       .text('PRODUCTO', 75, currentY + 5)
       .text('SOCIO COMERCIAL', 260, currentY + 5)
       .text('CANT. VENDIDA', 390, currentY + 5, { width: 70, align: 'right' })
       .text('RECAUDACIÓN', 470, currentY + 5, { width: 80, align: 'right' });

    currentY += 18;

    bestSellers.forEach((item, index) => {
      if (index % 2 === 1) {
        doc.rect(40, currentY, 515, 18).fill('#f8fafc');
      }
      
      doc.rect(40, currentY, 515, 18).lineWidth(0.5).strokeColor('#f1f5f9').stroke();

      const pos = String(index + 1);
      const title = item.product.title;
      const partnerName = item.product.partner ? item.product.partner.name : 'Directo (AbastoHub)';
      const qty = `${item.totalQty} ${item.product.unit}`;
      const rev = formatPrice(item.totalRevenue);

      doc.fillColor(textGray)
         .font('Helvetica')
         .fontSize(7.5)
         .text(pos, 45, currentY + 5)
         .font('Helvetica-Bold')
         .fillColor(darkSlate)
         .text(title, 75, currentY + 5, { width: 175, ellipsis: true })
         .font('Helvetica')
         .fillColor(textGray)
         .text(partnerName, 260, currentY + 5, { width: 120, ellipsis: true })
         .text(qty, 390, currentY + 5, { width: 70, align: 'right' })
         .font('Helvetica-Bold')
         .text(rev, 470, currentY + 5, { width: 80, align: 'right' });

      currentY += 18;

      if (currentY > 730) {
        doc.addPage();
        doc.rect(40, 40, 515, 5).fill(primaryColor);
        currentY = 60;
      }
    });

    currentY += 25;

    if (currentY > 600) {
      doc.addPage();
      doc.rect(40, 40, 515, 5).fill(primaryColor);
      currentY = 60;
    }

    // Section Title: Best Partners
    doc.fillColor(darkSlate)
       .font('Helvetica-Bold')
       .fontSize(12)
       .text('DESEMPEÑO DE SOCIOS COMERCIALES', 40, currentY);
       
    currentY += 18;

    // Table Header for Best Partners
    doc.rect(40, currentY, 515, 18).fill('#e2e8f0');
    doc.fillColor(darkSlate)
       .font('Helvetica-Bold')
       .fontSize(8)
       .text('POS', 45, currentY + 5)
       .text('SOCIO COMERCIAL', 75, currentY + 5)
       .text('CORREO ELECTRÓNICO', 250, currentY + 5)
       .text('UNIDADES VENDIDAS', 380, currentY + 5, { width: 90, align: 'right' })
       .text('INGRESOS TOTALES', 480, currentY + 5, { width: 70, align: 'right' });

    currentY += 18;

    if (bestPartners.length === 0) {
      doc.fontSize(8)
         .font('Helvetica')
         .fillColor(textGray)
         .text('No hay registros de ventas para socios comerciales en este período.', 45, currentY + 5);
    } else {
      bestPartners.forEach((item, index) => {
        if (index % 2 === 1) {
          doc.rect(40, currentY, 515, 18).fill('#f8fafc');
        }
        
        doc.rect(40, currentY, 515, 18).lineWidth(0.5).strokeColor('#f1f5f9').stroke();

        const pos = String(index + 1);
        const name = item.partner.name;
        const email = item.partner.email;
        const qty = `${item.totalQty} u.`;
        const rev = formatPrice(item.totalRevenue);

        doc.fillColor(textGray)
           .font('Helvetica')
           .fontSize(7.5)
           .text(pos, 45, currentY + 5)
           .font('Helvetica-Bold')
           .fillColor(darkSlate)
           .text(name, 75, currentY + 5, { width: 165, ellipsis: true })
           .font('Helvetica')
           .fillColor(textGray)
           .text(email, 250, currentY + 5, { width: 125, ellipsis: true })
           .text(qty, 380, currentY + 5, { width: 90, align: 'right' })
           .font('Helvetica-Bold')
           .text(rev, 480, currentY + 5, { width: 70, align: 'right' });

        currentY += 18;

        if (currentY > 730) {
          doc.addPage();
          doc.rect(40, 40, 515, 5).fill(primaryColor);
          currentY = 60;
        }
      });
    }

    doc.end();
  } catch (error) {
    next(error);
  }
};

const updateCommissionPaymentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.redirect('/admin?error=' + encodeURIComponent('Estado inválido.'));
    }

    const payment = await CommissionPayment.findById(id).populate('orders');
    if (!payment) {
      return res.redirect('/admin?error=' + encodeURIComponent('Pago de comisión no encontrado.'));
    }

    // If it's already processed, avoid reprocessing
    if (payment.status !== 'pending') {
      return res.redirect('/admin?error=' + encodeURIComponent('Este pago ya fue procesado.'));
    }

    payment.status = status;
    payment.notes = notes || '';
    payment.processedAt = new Date();
    await payment.save();

    // Update the associated orders
    const targetOrderFeePaidStatus = status === 'approved' ? 'paid' : 'unpaid';
    for (const order of payment.orders) {
      order.posFeePaid = targetOrderFeePaidStatus;
      await order.save();
    }

    const msg = status === 'approved'
      ? 'Pago de comisión aprobado con éxito.'
      : 'Pago de comisión rechazado. Las ventas POS correspondientes han vuelto a quedar pendientes de pago.';

    return res.redirect('/admin?success=' + encodeURIComponent(msg));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  getProductBySlug,
  getAdminPanel,
  createProduct,
  updateStock,
  updatePrice,
  updateProductDetails,
  toggleActive,
  toggleFeatured,
  updateDiscount,
  deleteProduct,
  generatePDFTicket,
  createPartner,
  deletePartner,
  resetPartnerPassword,
  togglePartnerFeatured72h,
  assignDriverToPartner,
  generateOrdersSummaryPDF,
  markOrderAsPaid,
  updateOrderStatus,
  getAdminRoutes,
  dispatchRoute,
  getAdminDrivers,
  createDriver,
  deleteDriver,
  deleteOrder,
  deleteAllOrders,
  generatePriceListPDF,
  updateWithdrawalStatus,
  generateStatisticsPDF,
  updateCommissionPaymentStatus
};
