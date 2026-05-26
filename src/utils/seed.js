const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const env = require('../config/env');

const seedDB = async () => {
  try {
    console.log('🔄 Seeding database starting...');
    
    // Connect to database
    await mongoose.connect(env.mongoUri);
    console.log('📡 Connected to MongoDB for seeding.');

    // Clear existing data
    console.log('🗑️  Cleaning collections...');
    await Category.deleteMany({});
    await Product.deleteMany({});
    await Cart.deleteMany({});
    await Order.deleteMany({});
    
    // Note: We do NOT delete users to avoid locking out existing tests, but we can seed one admin user if none exists.
    console.log('✅ Collections cleaned.');

    // 1. Create Categories
    console.log('📂 Seeding categories...');
    const categoriesData = [
      {
        name: 'Frutas y Verduras',
        image: 'https://images.unsplash.com/photo-1610832958506-ee56336191d8?w=300&auto=format&fit=crop&q=60'
      },
      {
        name: 'Lácteos y Quesos',
        image: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=300&auto=format&fit=crop&q=60'
      },
      {
        name: 'Almacén y Secos',
        image: 'https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=300&auto=format&fit=crop&q=60'
      },
      {
        name: 'Carnes y Pescados',
        image: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=300&auto=format&fit=crop&q=60'
      },
      {
        name: 'Mascotas',
        image: 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?w=300&auto=format&fit=crop&q=60'
      },
      {
        name: 'Productos de Limpieza',
        image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=300&auto=format&fit=crop&q=60'
      }
    ];

    const seededCategories = [];
    for (const catData of categoriesData) {
      const c = new Category(catData);
      await c.save();
      seededCategories.push(c);
    }
    console.log(`✅ Seeded ${seededCategories.length} categories.`);

    const catFruits = seededCategories.find(c => c.name === 'Frutas y Verduras');
    const catDairy = seededCategories.find(c => c.name === 'Lácteos y Quesos');
    const catGrocery = seededCategories.find(c => c.name === 'Almacén y Secos');

    // 2. Create Products
    console.log('🍎 Seeding products...');
    const productsData = [
      {
        title: 'Banana Cavadish Premium',
        description: 'Bananas ecuatorianas de selección. Dulces, firmes y en su punto justo de madurez.',
        price: 1950,
        wholesalePrice: 1500,
        stock: 120,
        images: ['https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=500&auto=format&fit=crop&q=80'],
        category: catFruits._id,
        unit: 'kg',
        featured: true,
        active: true
      },
      {
        title: 'Tomate Redondo Seleccionado',
        description: 'Tomates jugosos y firmes de huerta local. Ideales para ensaladas y salsas.',
        price: 2400,
        wholesalePrice: 1800,
        stock: 80,
        images: ['https://images.unsplash.com/photo-1595855759920-86582396756a?w=500&auto=format&fit=crop&q=80'],
        category: catFruits._id,
        unit: 'kg',
        featured: true,
        active: true
      },
      {
        title: 'Papa Cepillada Premium bolsa 20kg',
        description: 'Papas lavadas de tamaño uniforme directas de Balcarce. Excelente cocción y calidad.',
        price: 14500,
        wholesalePrice: 11000,
        stock: 25,
        images: ['https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=500&auto=format&fit=crop&q=80'],
        category: catFruits._id,
        unit: 'bolsa',
        featured: false,
        active: true
      },
      {
        title: 'Leche Entera Clásica 1L',
        description: 'Leche entera ultrapasteurizada, fortificada con Vitaminas A y D. Envase tetrapack.',
        price: 1300,
        wholesalePrice: 1100,
        stock: 150,
        images: ['https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=80'],
        category: catDairy._id,
        unit: 'unidades',
        featured: true,
        active: true
      },
      {
        title: 'Queso Cremoso de Campo',
        description: 'Queso cremoso doble crema de pasta blanda. Delicioso sabor y consistencia para fundir.',
        price: 5900,
        wholesalePrice: 4800,
        stock: 40,
        images: ['https://images.unsplash.com/photo-1486299267070-83823f5448dd?w=500&auto=format&fit=crop&q=80'],
        category: catDairy._id,
        unit: 'kg',
        featured: true,
        active: true
      },
      {
        title: 'Manteca Calidad Extra 200g',
        description: 'Manteca elaborada con crema de leche seleccionada pasteurizada. Suave y cremosa.',
        price: 1650,
        wholesalePrice: 1380,
        stock: 95,
        images: ['https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=500&auto=format&fit=crop&q=80'],
        category: catDairy._id,
        unit: 'unidades',
        featured: false,
        active: true
      },
      {
        title: 'Arroz Integral Extralargo 1kg',
        description: 'Arroz integral seleccionado grano extralargo. Alto contenido en fibras y nutrientes.',
        price: 1800,
        wholesalePrice: 1450,
        stock: 110,
        images: ['https://images.unsplash.com/photo-1586201375761-83865001e31c?w=500&auto=format&fit=crop&q=80'],
        category: catGrocery._id,
        unit: 'unidades',
        featured: true,
        active: true
      },
      {
        title: 'Aceite de Girasol Superior 1.5L',
        description: 'Aceite de girasol refinado de primera prensada, libre de gluten. Ideal para cocinar y freír.',
        price: 2600,
        wholesalePrice: 2150,
        stock: 65,
        images: ['https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500&auto=format&fit=crop&q=80'],
        category: catGrocery._id,
        unit: 'unidades',
        featured: true,
        active: true
      },
      {
        title: 'Fideos Spaghetti Secos 500g',
        description: 'Fideos elaborados con sémola de trigo candeal de alta calidad. Quedan perfectos al dente.',
        price: 980,
        wholesalePrice: 790,
        stock: 130,
        images: ['https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&auto=format&fit=crop&q=80'],
        category: catGrocery._id,
        unit: 'unidades',
        featured: false,
        active: true
      }
    ];

    const seededProducts = [];
    
    // We save each product individually so the pre-save slug hooks fire correctly!
    for (const prodData of productsData) {
      const p = new Product(prodData);
      await p.save();
      seededProducts.push(p);
    }
    
    console.log(`✅ Seeded ${seededProducts.length} products.`);
    
    console.log('🎉 Database seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  }
};

seedDB();
