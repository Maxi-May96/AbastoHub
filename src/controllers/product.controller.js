const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
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

    res.render('pages/admin', {
      title: 'Panel de Control',
      products,
      categories,
      orders,
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
    const primaryColor = '#059669'; // Emerald Green
    const darkSlate = '#1e293b';
    const lightGray = '#f8fafc';
    const borderGray = '#cbd5e1';

    // 1. Header banner
    doc.rect(40, 40, 515, 60).fill(primaryColor);
    
    // Logo & Header Title
    const logoPath = path.join(__dirname, '../../public/img/logo.png');
    try {
      doc.image(logoPath, 55, 48, { height: 44 });
      
      doc.fillColor('#ffffff')
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('ABASTOHUB', 115, 52)
         .fontSize(10)
         .font('Helvetica')
         .text('TICKET DE PREPARACIÓN DE PEDIDO', 115, 73);
    } catch (err) {
      doc.fillColor('#ffffff')
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('ABASTOHUB', 55, 52)
         .fontSize(10)
         .font('Helvetica')
         .text('TICKET DE PREPARACIÓN DE PEDIDO', 55, 73);
    }

    // Order Code & Date Top Right
    const shortId = order._id.toString().substring(12).toUpperCase();
    doc.fillColor('#ffffff')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text(`PEDIDO: #${shortId}`, 400, 52, { align: 'right', width: 140 })
       .fontSize(8.5)
       .font('Helvetica')
       .text(order.createdAt.toLocaleString('es-AR'), 400, 73, { align: 'right', width: 140 });

    // 2. Customer Card Info Box
    doc.y = 120;
    doc.fillColor(darkSlate)
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('DATOS DE ENTREGA Y CLIENTE', 40, doc.y)
       .moveDown(0.3);

    const clientBoxY = doc.y;
    doc.rect(40, clientBoxY, 515, 75).stroke(borderGray);

    // Customer details
    const customerName = order.shippingDetails.name || (order.user ? `${order.user.name} ${order.user.lastname}` : 'Cliente Registrado');
    const customerPhone = order.shippingDetails.phone || (order.user ? order.user.phone : 'N/A');
    const customerEmail = order.user ? order.user.email : 'N/A';
    const deliveryMethod = order.deliveryType === 'delivery' ? 'Envío a Domicilio' : 'Retiro por Local';

    doc.fillColor(darkSlate)
       .fontSize(9)
       .font('Helvetica-Bold')
       .text('Cliente: ', 55, clientBoxY + 12)
       .font('Helvetica')
       .text(customerName, 105, clientBoxY + 12)
       .font('Helvetica-Bold')
       .text('Teléfono: ', 55, clientBoxY + 27)
       .font('Helvetica')
       .text(customerPhone, 105, clientBoxY + 27)
       .font('Helvetica-Bold')
       .text('Email: ', 55, clientBoxY + 42)
       .font('Helvetica')
       .text(customerEmail, 105, clientBoxY + 42);

    doc.font('Helvetica-Bold')
       .text('Método: ', 310, clientBoxY + 12)
       .font('Helvetica')
       .text(deliveryMethod, 360, clientBoxY + 12);

    if (order.deliveryType === 'delivery') {
      doc.font('Helvetica-Bold')
         .text('Dirección: ', 310, clientBoxY + 27)
         .font('Helvetica')
         .text(order.shippingDetails.address || 'No especificada', 360, clientBoxY + 27, { width: 180 });
    } else {
      doc.font('Helvetica-Bold')
         .text('Dirección: ', 310, clientBoxY + 27)
         .font('Helvetica')
         .text('Retira en tienda central', 360, clientBoxY + 27, { width: 180 });
    }

    // 3. Table Title
    doc.y = clientBoxY + 105;
    doc.fillColor(darkSlate)
       .fontSize(11)
       .font('Helvetica-Bold')
       .text('PRODUCTOS A RECOLECTAR (PICKING LIST)', 40, doc.y)
       .moveDown(0.3);

    // 4. Products Table Drawing
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 20).fill(darkSlate);
    doc.fillColor('#ffffff')
       .fontSize(8.5)
       .font('Helvetica-Bold')
       .text('DESCRIPCIÓN DEL PRODUCTO', 55, tableTop + 6)
       .text('CANTIDAD', 300, tableTop + 6, { width: 60, align: 'center' })
       .text('UNIDAD', 370, tableTop + 6, { width: 60, align: 'center' })
       .text('P. UNIT', 440, tableTop + 6, { width: 50, align: 'right' })
       .text('SUBTOTAL', 500, tableTop + 6, { width: 45, align: 'right' });

    let currentY = tableTop + 20;
    
    order.products.forEach((item, index) => {
      // Row Background
      if (index % 2 === 0) {
        doc.rect(40, currentY, 515, 20).fill(lightGray);
      }
      doc.fillColor(darkSlate);

      const unitType = item.unit || 'unidades';
      
      // Text Alignment
      doc.font('Helvetica-Bold')
         .text(item.title, 55, currentY + 6, { width: 235, truncate: true })
         .font('Helvetica')
         .text(item.quantity.toString(), 300, currentY + 6, { width: 60, align: 'center' })
         .text(unitType, 370, currentY + 6, { width: 60, align: 'center' })
         .text(formatPrice(item.price), 440, currentY + 6, { width: 50, align: 'right' })
         .font('Helvetica-Bold')
         .text(formatPrice(item.price * item.quantity), 500, currentY + 6, { width: 45, align: 'right' });

      // Draw bottom border
      doc.rect(40, currentY + 20, 515, 0.5).fill('#e2e8f0');

      currentY += 21;
    });

    // 5. Total Row
    doc.y = currentY + 12;
    doc.fillColor(darkSlate)
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('TOTAL DE LA ORDEN:', 330, doc.y)
       .fontSize(12)
       .text(formatPrice(order.total), 440, doc.y - 1, { width: 105, align: 'right' });

    // 6. Signatures and control footer at the bottom
    const footerY = 700;
    doc.rect(40, footerY, 515, 0.5).fill(borderGray);

    doc.fillColor(darkSlate)
       .fontSize(8.5)
       .font('Helvetica')
       .text('Armado por: ___________________________', 55, footerY + 20)
       .text('Controlado por: ___________________________', 320, footerY + 20)
       .font('Helvetica-Oblique')
       .text('Este ticket sirve como constancia interna para el despacho físico de mercadería.', 40, footerY + 50, { align: 'center', width: 515 });

    doc.end();

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
  toggleActive,
  toggleFeatured,
  updateDiscount,
  deleteProduct,
  generatePDFTicket
};
