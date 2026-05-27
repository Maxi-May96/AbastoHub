const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Partner = require('../models/Partner');
const { uploadImage } = require('../services/firebase.service');
const formatPrice = require('../utils/formatPrice');
const PDFDocument = require('pdfkit');
const path = require('path');

// GET Catalog Page
const getProducts = async (req, res, next) => {
  try {
    const { category: categorySlug, search, minPrice, maxPrice, sort } = req.query;
    
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
    
    // Sort query
    let sortQuery = { createdAt: -1 };
    if (sort) {
      if (sort === 'price_asc') sortQuery = { price: 1 };
      else if (sort === 'price_desc') sortQuery = { price: -1 };
      else if (sort === 'title_asc') sortQuery = { title: 1 };
    }
    
    // Fetch products and categories
    const products = await Product.find(query).populate('category').sort(sortQuery);
    const categories = await Category.find({});
    const activeCategory = categorySlug ? await Category.findOne({ slug: categorySlug }) : null;

    res.render('pages/products', {
      title: 'Catálogo de Productos',
      products,
      categories,
      activeCategory,
      search: search || '',
      minPrice: minPrice || '',
      maxPrice: maxPrice || '',
      sort: sort || '',
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
    const product = await Product.findOne({ slug, active: true }).populate('category');
    
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
    const products = await Product.find({}).populate('category').sort({ createdAt: -1 });
    const categories = await Category.find({});
    // Load orders with populated user info
    const orders = await Order.find({}).populate('user').sort({ createdAt: -1 });
    const partners = await Partner.find({}).sort({ createdAt: -1 });

    res.render('pages/admin', {
      title: 'Panel de Control',
      products,
      categories,
      orders,
      partners,
      formatPrice,
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
      return res.redirect('/admin?error=' + encodeURIComponent('Valor de stock no válido.'));
    }

    await Product.findByIdAndUpdate(id, { stock: Number(stock) });
    res.redirect('/admin?success=' + encodeURIComponent('Stock actualizado exitosamente.'));
  } catch (error) {
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar stock.'));
  }
};

// POST Toggle Active Status Action (Admin Only)
const toggleActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      return res.redirect('/admin?error=' + encodeURIComponent('Producto no encontrado.'));
    }
    
    product.active = !product.active;
    await product.save();
    
    res.redirect('/admin?success=' + encodeURIComponent(`Producto ${product.active ? 'activado' : 'desactivado'} exitosamente.`));
  } catch (error) {
    res.redirect('/admin?error=' + encodeURIComponent('Error al cambiar el estado del producto.'));
  }
};

// POST Toggle Featured Status Action (Admin Only)
const toggleFeatured = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      return res.redirect('/admin?error=' + encodeURIComponent('Producto no encontrado.'));
    }
    
    product.featured = !product.featured;
    await product.save();
    
    res.redirect('/admin?success=' + encodeURIComponent(`Producto ${product.featured ? 'destacado' : 'quitado de destacados'} exitosamente.`));
  } catch (error) {
    res.redirect('/admin?error=' + encodeURIComponent('Error al cambiar el estado destacado del producto.'));
  }
};

// POST Update Discount Action (Admin Only)
const updateDiscount = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { discount } = req.body;
    
    if (discount === undefined || discount === '') {
      return res.redirect('/admin?error=' + encodeURIComponent('Valor de descuento no válido.'));
    }

    const discountNum = Number(discount);
    if (isNaN(discountNum) || discountNum < 0 || discountNum >= 100) {
      return res.redirect('/admin?error=' + encodeURIComponent('El descuento debe ser un número entre 0 y 99.'));
    }

    await Product.findByIdAndUpdate(id, { discount: discountNum });
    res.redirect('/admin?success=' + encodeURIComponent('Descuento actualizado exitosamente.'));
  } catch (error) {
    res.redirect('/admin?error=' + encodeURIComponent('Error al actualizar el descuento.'));
  }
};

// POST Delete Product Action (Admin Only)
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return res.redirect('/admin?error=' + encodeURIComponent('Producto no encontrado.'));
    }
    res.redirect('/admin?success=' + encodeURIComponent('Producto eliminado exitosamente del catálogo.'));
  } catch (error) {
    res.redirect('/admin?error=' + encodeURIComponent('Error al eliminar el producto: ' + error.message));
  }
};

// GET Generate PDF Ticket for Pickers (Admin Only)
const generatePDFTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate('user');
    if (!order) {
      return res.status(404).send('Pedido no encontrado');
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    
    // Set headers to open PDF in a new tab / window
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=ticket-${order._id.toString().substring(12)}.pdf`);
    doc.pipe(res);

    // Color Palette
    const primaryColor = '#10b981'; // Emerald Green
    const darkSlate = '#0f172a'; // Deep slate (almost black)
    const textGray = '#475569';  // Slate gray
    const bgGray = '#f8fafc';    // Soft slate background
    const borderGray = '#e2e8f0';  // Very light gray border
    const statusGreen = '#ecfdf5';
    const statusTextGreen = '#047857';
    const statusAmber = '#fffbeb';
    const statusTextAmber = '#b45309';

    // 1. Top Decorative Brand Bar
    doc.rect(40, 40, 515, 5).fill(primaryColor);
    
    // Logo & Header Brand
    const logoPath = path.join(__dirname, '../../public/img/logo.png');
    let headerTextX = 40;
    try {
      doc.image(logoPath, 40, 55, { height: 35 });
      headerTextX = 90; // Adjust spacing if logo is present
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
       .text('TICKET DE PREPARACIÓN / HOJA DE RUTA', headerTextX, 76);

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
    const badgeLabel = isPaid ? 'PAGADO' : 'PENDIENTE DE PAGO';

    doc.rect(465, 87, 90, 16).fill(badgeBg);
    doc.fillColor(badgeTextCol)
       .fontSize(7.5)
       .font('Helvetica-Bold')
       .text(badgeLabel, 465, 91, { align: 'center', width: 90 });

    // 2. Client & Delivery Info Card
    const clientBoxY = 120;
    
    // Draw background block
    doc.rect(40, clientBoxY, 515, 85).fill(bgGray);
    // Draw left colored indicator border
    doc.rect(40, clientBoxY, 4, 85).fill(primaryColor);
    
    // Title inside card
    doc.fillColor(darkSlate)
       .fontSize(9.5)
       .font('Helvetica-Bold')
       .text('DATOS DE ENTREGA Y CLIENTE', 55, clientBoxY + 12);

    const customerName = order.shippingDetails.name || (order.user ? `${order.user.name} ${order.user.lastname}` : 'Cliente Registrado');
    const customerPhone = order.shippingDetails.phone || (order.user ? order.user.phone : 'N/A');
    const customerEmail = order.user ? order.user.email : 'N/A';
    const deliveryMethod = order.deliveryType === 'delivery' ? 'Envío a Domicilio' : 'Retiro por Local';

    // Left Column Info
    doc.fontSize(8.5)
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Cliente:', 55, clientBoxY + 32)
       .font('Helvetica')
       .fillColor(textGray)
       .text(customerName, 105, clientBoxY + 32)
       
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Teléfono:', 55, clientBoxY + 47)
       .font('Helvetica')
       .fillColor(textGray)
       .text(customerPhone, 105, clientBoxY + 47)
       
       .font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Email:', 55, clientBoxY + 62)
       .font('Helvetica')
       .fillColor(textGray)
       .text(customerEmail, 105, clientBoxY + 62);

    // Right Column Info
    doc.font('Helvetica-Bold')
       .fillColor(darkSlate)
       .text('Método:', 300, clientBoxY + 32)
       .font('Helvetica')
       .fillColor(textGray)
       .text(deliveryMethod, 355, clientBoxY + 32);

    if (order.deliveryType === 'delivery') {
      doc.font('Helvetica-Bold')
         .fillColor(darkSlate)
         .text('Dirección:', 300, clientBoxY + 47)
         .font('Helvetica')
         .fillColor(textGray)
         .text(order.shippingDetails.address || 'No especificada', 355, clientBoxY + 47, { width: 185 });
    } else {
      doc.font('Helvetica-Bold')
         .fillColor(darkSlate)
         .text('Dirección:', 300, clientBoxY + 47)
         .font('Helvetica')
         .fillColor(textGray)
         .text('Retira en depósito central', 355, clientBoxY + 47, { width: 185 });
    }

    // Notes if present
    if (order.shippingDetails.notes) {
      doc.font('Helvetica-Bold')
         .fillColor(darkSlate)
         .text('Notas:', 300, clientBoxY + 67)
         .font('Helvetica-Oblique')
         .fillColor(textGray)
         .text(order.shippingDetails.notes, 355, clientBoxY + 67, { width: 185, height: 18, truncate: true });
    }

    // 3. Table Header Section
    const tableTitleY = 220;
    doc.fillColor(darkSlate)
       .fontSize(10.5)
       .font('Helvetica-Bold')
       .text('ARTÍCULOS A RECOLECTAR (PICKING LIST)', 40, tableTitleY);

    const tableTop = tableTitleY + 18;
    
    // Draw Header Background Row
    doc.rect(40, tableTop, 515, 20).fill('#e2e8f0');
    
    // Header text labels
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
    
    order.products.forEach((item, index) => {
      // Row zebra background
      if (index % 2 === 0) {
        doc.rect(40, currentY, 515, 22).fill('#f8fafc');
      } else {
        doc.rect(40, currentY, 515, 22).fill('#ffffff');
      }

      // Draw Checkbox Square for Pickers
      doc.rect(49, currentY + 5, 11, 11).lineWidth(1).strokeColor(textGray).stroke();

      doc.fillColor(darkSlate);
      const unitType = item.unit || 'unidades';

      // Text Alignment and fonts
      doc.font('Helvetica-Bold')
         .fontSize(8.5)
         .text(item.title, 70, currentY + 7, { width: 220, truncate: true })
         .font('Helvetica-Bold')
         .fontSize(9)
         .text(item.quantity.toString(), 300, currentY + 7, { width: 45, align: 'center' })
         .font('Helvetica')
         .fontSize(8.5)
         .text(unitType, 350, currentY + 7, { width: 55, align: 'center' })
         .text(formatPrice(item.price), 415, currentY + 7, { width: 65, align: 'right' })
         .font('Helvetica-Bold')
         .text(formatPrice(item.price * item.quantity), 485, currentY + 7, { width: 65, align: 'right' });

      // Row thin bottom border divider
      doc.rect(40, currentY + 22, 515, 0.5).fill('#e2e8f0');
      currentY += 22;
    });

    // 4. Totals Row Box
    doc.y = currentY + 12;
    const totalsBoxY = doc.y;
    
    // Draw totals summary box
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

    // 5. Signatures and control footer at the bottom of the page
    const footerY = 715;
    
    // Draw thin line divider above footer
    doc.rect(40, footerY, 515, 0.5).fill(borderGray);

    // Operator Signatures
    doc.fillColor(darkSlate)
       .fontSize(8.5)
       .font('Helvetica-Bold')
       .text('Armado / Preparado por:', 55, footerY + 20)
       .font('Helvetica')
       .text('Firma: ___________________________', 55, footerY + 37)
       .text('Nombre: __________________________', 55, footerY + 52)
       
       .font('Helvetica-Bold')
       .text('Controlado / Despachado por:', 320, footerY + 20)
       .font('Helvetica')
       .text('Firma: ___________________________', 320, footerY + 37)
       .text('Nombre: __________________________', 320, footerY + 52);

    // Legal / Internal note
    doc.font('Helvetica-Oblique')
       .fontSize(7.5)
       .fillColor(textGray)
       .text('Este ticket es un comprobante interno de preparación de mercadería y picking, no es válido como factura.', 40, footerY + 74, { align: 'center', width: 515 });

    doc.end();

  } catch (error) {
    next(error);
  }
};

// POST Create Partner/Affiliate Action (Admin Only)
const createPartner = async (req, res, next) => {
  try {
    const { name, type, website } = req.body;
    
    if (!name || !req.file) {
      return res.redirect('/admin?error=' + encodeURIComponent('El nombre y el logo son campos obligatorios.'));
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

module.exports = {
  getProducts,
  getProductBySlug,
  getAdminPanel,
  createProduct,
  updateStock,
  toggleActive,
  toggleFeatured,
  updateDiscount,
  deleteProduct,
  generatePDFTicket,
  createPartner,
  deletePartner
};
