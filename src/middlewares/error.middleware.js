const env = require('../config/env');

const errorHandler = (err, req, res, next) => {
  console.error('❌ Error caught by global handler:', err);

  const status = err.status || 500;
  const message = err.message || 'Ocurrió un error inesperado en el servidor.';
  
  res.status(status).render('pages/error', {
    title: 'Error',
    status,
    message,
    // only expose stack traces in development
    stack: env.nodeEnv === 'development' ? err.stack : null
  });
};

const notFoundHandler = (req, res, next) => {
  res.status(404).render('pages/error', {
    title: 'Página no encontrada',
    status: 404,
    message: `La ruta ${req.originalUrl} no existe en este servidor.`,
    stack: null
  });
};

module.exports = {
  errorHandler,
  notFoundHandler
};
