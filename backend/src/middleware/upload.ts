import multer from 'multer';

// Use memoryStorage so files are held in buffer.
// StorageService (storage.ts) handles all writes — to local disk or R2.
const memStorage = multer.memoryStorage();

// File filter — images only
const imageFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowed = /^image\/(jpeg|jpg|png|gif|webp|heic|heif)$/i;
  if (allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP, HEIC)'));
  }
};

export const uploadPhoto = multer({
  storage: memStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
    files: 1,
  },
});