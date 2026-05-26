const fs = require('fs');
const path = require('path');
const { bucket, firebaseEnabled } = require('../config/firebase');

// Ensure local uploads directory exists
const localUploadsDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(localUploadsDir)) {
  fs.mkdirSync(localUploadsDir, { recursive: true });
}

/**
 * Uploads an image either to Firebase Storage or falls back to local disk storage.
 * @param {Express.Multer.File} file - Multer file object (configured with memoryStorage)
 * @param {string} folder - Destination folder name (e.g. 'products', 'categories', 'banners')
 * @returns {Promise<string>} The public URL of the uploaded image
 */
const uploadImage = async (file, folder = 'products') => {
  if (!file) return null;
  
  // Create clean unique filename
  const cleanName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.]/g, '_');
  const filename = `${folder}/${Date.now()}_${cleanName}`;
  
  if (firebaseEnabled && bucket) {
    try {
      const fileUpload = bucket.file(filename);
      
      const fileOptions = {
        metadata: {
          contentType: file.mimetype,
        },
      };

      // Upload buffer
      await fileUpload.save(file.buffer, fileOptions);
      
      // Make it public
      await fileUpload.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
      return publicUrl;
    } catch (error) {
      console.error('❌ Firebase upload error:', error.message);
      console.info('Falling back to local disk upload...');
    }
  }

  // Local upload fallback (Memory storage buffer)
  try {
    const localFilename = `${Date.now()}_${cleanName}`;
    const destinationPath = path.join(localUploadsDir, localFilename);
    
    // Write buffer to disk
    await fs.promises.writeFile(destinationPath, file.buffer);
    
    // Return relative public path
    return `/uploads/${localFilename}`;
  } catch (error) {
    console.error('❌ Local file write error:', error.message);
    throw new Error('Error al guardar la imagen en el servidor local.');
  }
};

module.exports = {
  uploadImage
};
