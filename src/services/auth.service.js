const jwt = require('jsonwebtoken');
const env = require('../config/env');

const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user._id, 
      email: user.email, 
      role: user.role,
      name: user.name,
      lastname: user.lastname
    },
    env.jwtSecret,
    { expiresIn: '30d' } // Long-lived user session for MVP comfort
  );
};

const generateDriverToken = (driver) => {
  return jwt.sign(
    { 
      id: driver._id, 
      name: driver.name,
      vehicle: driver.vehicle,
      role: 'driver'
    },
    env.jwtSecret,
    { expiresIn: '30d' }
  );
};

const generatePartnerToken = (partner) => {
  return jwt.sign(
    { 
      id: partner._id, 
      name: partner.name,
      email: partner.email,
      role: 'partner'
    },
    env.jwtSecret,
    { expiresIn: '30d' }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateToken,
  generateDriverToken,
  generatePartnerToken,
  verifyToken
};
