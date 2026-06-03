'use strict';

const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

// Defaults to the container's /app/uploads but is overridable via UPLOADS_DIR.
// If the base isn't writable (e.g. CI runners can't mkdir under /app), fall back
// to the OS temp dir so importing this module never crashes the process.
const fs = require('fs');
const os = require('os');
function resolveUploadDir() {
  const dir = process.env.UPLOADS_DIR || '/app/uploads';
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    const fallback = path.join(os.tmpdir(), 'hrms-uploads');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}
const UPLOAD_DIR = resolveUploadDir();

// SECURITY (H-02 / H-03): file uploads are hardened against two attack classes.
//   H-03: filename is uuid + extension only. Embedding `originalname` (which
//         multer/busboy does not sanitise) created an exposure window if any
//         caller forgot to wrap the resulting on-disk path in path.basename.
//   H-02: MIME type is allowlisted at upload time AND derived from the
//         extension at download time. Storing the client-supplied mimeType
//         and reflecting it on download with Content-Disposition: inline
//         allowed an attacker (HR_ADMIN) to plant an HTML file that ran in
//         the HRMS origin.
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/webp',
]);
const ALLOWED_EXTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.heic', '.webp']);
const EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
  '.webp': 'image/webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_EXTS.has(ext) && ALLOWED_MIMES.has(file.mimetype)) return cb(null, true);
    cb(null, false);
  },
});

// GET /documents/employee/:employeeId
router.get('/employee/:employeeId', authenticate, authorizeSelfOrRole('employeeId', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const docs = await prisma.document.findMany({
      where: { employeeId: req.params.employeeId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(docs);
  } catch (err) { next(err); }
});

// POST /documents/employee/:employeeId  (upload)
router.post('/employee/:employeeId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or extension/MIME type not permitted' });
    // The stored mimeType is the extension-derived value, never the
    // client-supplied req.file.mimetype (which is attacker-controlled and
    // would otherwise be reflected on download).
    const ext = path.extname(req.file.filename || '').toLowerCase();
    const safeMime = EXT_TO_MIME[ext] || 'application/octet-stream';

    const doc = await prisma.document.create({
      data: {
        id: uuidv4(),
        employeeId: req.params.employeeId,
        docType: req.body.docType || 'OTHER',
        // Sanitise the original filename for display (strip path components).
        fileName: path.basename(req.file.originalname || `document${ext}`),
        filePath: req.file.path,
        fileSize: req.file.size,
        mimeType: safeMime,
        uploadedBy: req.user.sub,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
      },
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// GET /documents/:id/download — stream file to client
router.get('/:id/download', authenticate, async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Self-service: employee can only download their own docs
    const isSelf = req.user?.employeeId === doc.employeeId;
    const isPrivileged = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER].includes(req.user?.role);
    if (!isSelf && !isPrivileged) return res.status(403).json({ error: 'Forbidden' });

    const fs = require('fs');
    // Defense in depth: always resolve via basename(), reject anything that
    // doesn't end up inside UPLOAD_DIR.
    const filePath = doc.filePath.startsWith('/')
      ? path.join(UPLOAD_DIR, path.basename(doc.filePath))
      : path.join(UPLOAD_DIR, path.basename(doc.filePath));
    if (!filePath.startsWith(UPLOAD_DIR + path.sep) && filePath !== UPLOAD_DIR) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    // SECURITY (H-02): Content-Disposition: attachment forces a download
    // prompt instead of inline rendering. X-Content-Type-Options: nosniff
    // blocks MIME sniffing. The mimeType is the extension-derived safe
    // value stored at upload time — not a client-supplied string.
    const safeName = path.basename(doc.fileName || `document${path.extname(filePath)}`).replace(/"/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (doc.mimeType) res.setHeader('Content-Type', doc.mimeType);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

// DELETE /documents/:id
router.delete('/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const doc = await prisma.document.delete({ where: { id: req.params.id } });
    // Could also delete file from disk here
    res.json({ message: 'Document deleted', id: doc.id });
  } catch (err) { next(err); }
});

module.exports = router;
