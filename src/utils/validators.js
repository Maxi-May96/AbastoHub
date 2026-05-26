function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidPhone(phone) {
  // basic validation checking for digits and optional symbols
  const phoneRegex = /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/;
  return phone && phone.trim().length >= 6 && phoneRegex.test(phone);
}

function validateRegisterInput({ name, lastname, email, phone, password }) {
  const errors = [];
  
  if (!name || name.trim().length < 2) {
    errors.push('El nombre debe tener al menos 2 caracteres.');
  }
  if (!lastname || lastname.trim().length < 2) {
    errors.push('El apellido debe tener al menos 2 caracteres.');
  }
  if (!email || !isValidEmail(email)) {
    errors.push('Ingrese un correo electrónico válido.');
  }
  if (!phone || !isValidPhone(phone)) {
    errors.push('Ingrese un número de teléfono válido.');
  }
  if (!password || password.length < 6) {
    errors.push('La contraseña debe tener al menos 6 caracteres.');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  isValidEmail,
  isValidPhone,
  validateRegisterInput
};
