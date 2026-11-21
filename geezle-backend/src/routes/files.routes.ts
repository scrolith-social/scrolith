import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.middleware';
import { createConcurrencyLimit } from '../middleware/concurrencyLimit';
import { MAX_CONCURRENT_AZURE_UPLOADS, MAX_UPLOAD_BYTES } from '../config/uploadLimits';
import {
  deleteFile,
  getUploadDir,
  listFiles,
  serveFileContent,
  shouldUseMemoryUploadMulter,
  uploadFile
} from '../controllers/filesController';
import {
  getFileManifest,
  getFileProcessingStatus,
  serveFileVariantContent
} from '../controllers/files.mediaManifest.controller';

const router = express.Router();

const uploadDir = getUploadDir();
const azureTempUploadDir = path.join(uploadDir, '.tmp');
if (!fs.existsSync(azureTempUploadDir)) fs.mkdirSync(azureTempUploadDir, { recursive: true });

const isAzureUploadDriver = () =>
  ['azure_blob', 'azure', 'blob'].includes(
    String(process.env.UPLOAD_DRIVER || process.env.STORAGE_DRIVER || '').trim().toLowerCase()
  );

const limitAzureUploadConcurrency = createConcurrencyLimit({
  max: MAX_CONCURRENT_AZURE_UPLOADS,
  shouldLimit: isAzureUploadDriver,
  message: 'Upload capacity is temporarily full; retry shortly',
  retryAfterSeconds: 5
});

/** Memory multer for GCS/DB/Firebase/Azure — never write product media to Cloud Run uploads/. */
const isMemoryUploadDriver = () => shouldUseMemoryUploadMulter();

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, isAzureUploadDriver() ? azureTempUploadDir : uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
    cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  }
});

const upload = multer({
  storage: isMemoryUploadDriver() ? multer.memoryStorage() : diskStorage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  }
});

const handleSingleUpload: express.RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error: any) => {
    if (error instanceof multer.MulterError) {
      const isSize = error.code === 'LIMIT_FILE_SIZE';
      const message = isSize
        ? `File exceeds upload limit (${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)`
        : error.message || 'Upload failed';
      res.status(isSize ? 413 : 400).json({
        success: false,
        error: message,
        code: error.code
      });
      return;
    }

    if (error) {
      res.status(400).json({
        success: false,
        error: error.message || 'Upload failed'
      });
      return;
    }

    next();
  });
};

// Public file content endpoint: supports public assets and authenticated private files.
router.get('/content/:id', serveFileContent);

// Phase 3A additive APIs (authorization enforced inside handlers).
router.get('/:fileId/processing-status', getFileProcessingStatus);
router.get('/:fileId/manifest', getFileManifest);
router.get('/:fileId/variants/:variantId/content', serveFileVariantContent);

router.use(authMiddleware);

router.get('/', listFiles);
router.post('/upload', limitAzureUploadConcurrency, handleSingleUpload, uploadFile);
router.post('/', limitAzureUploadConcurrency, handleSingleUpload, uploadFile);
router.delete('/:id', deleteFile);

export { upload };
export default router;
