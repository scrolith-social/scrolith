import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { createConcurrencyLimit } from '../middleware/concurrencyLimit';
import { KYC_MAX_CONCURRENT_UPLOADS } from '../services/kyc/kyc.constants';
import {
  getKycStatus,
  submitKyc,
  updateKyc,
  uploadKycDocument,
  uploadKycSecureDocument,
  getKycDocumentTypes,
  getKycFormConfig,
  kycUploadMulterMiddleware,
  kycUploadRateLimiter,
  kycSubmitRateLimiter
} from '../controllers/kyc.controller';

const router = express.Router();

// This gate must precede multer: KYC files are buffered in process memory.
const kycUploadConcurrencyLimiter = createConcurrencyLimit({
  max: KYC_MAX_CONCURRENT_UPLOADS,
  shouldLimit: () => true,
  message: 'KYC upload capacity is temporarily full; retry shortly',
  retryAfterSeconds: 5
});

router.use(authMiddleware);

router.get('/me', getKycStatus);
router.post('/submit', kycSubmitRateLimiter, submitKyc);
router.put('/:id', kycSubmitRateLimiter, updateKyc);

// Phase 20.2: private KYC upload — client cannot set visibility
// Phase 20.2T: multer LIMIT_* mapped to controlled 400 (not 500)
router.post(
  '/uploads',
  kycUploadRateLimiter,
  kycUploadConcurrencyLimiter,
  kycUploadMulterMiddleware,
  uploadKycSecureDocument
);

// Retired generic attachment path (no public media)
router.post('/documents', uploadKycDocument);

router.get('/document-types', getKycDocumentTypes);
router.get('/form-config', getKycFormConfig);

export default router;
