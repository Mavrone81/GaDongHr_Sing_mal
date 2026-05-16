'use strict';

const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

const UPLOAD_DIR = '/app/uploads';
require('fs').mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

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
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const doc = await prisma.document.create({
      data: {
        id: uuidv4(),
        employeeId: req.params.employeeId,
        docType: req.body.docType || 'OTHER',
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
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
    // Support both old relative paths and new absolute /app/uploads paths
    const filePath = doc.filePath.startsWith('/') ? doc.filePath : path.join(UPLOAD_DIR, path.basename(doc.filePath));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
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
