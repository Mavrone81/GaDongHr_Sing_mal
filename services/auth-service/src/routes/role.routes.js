'use strict';

const router = require('express').Router();
const prisma = require('../utils/prisma');
const { authenticate, authorize } = require('/app/shared/auth-middleware');

// GET /roles - List all roles with their permissions
router.get('/', authenticate, authorize('role:manage'), async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      include: {
        permissions: {
          include: { permission: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    const formatted = roles.map(r => ({
      ...r,
      permissions: r.permissions.map(p => p.permission.code)
    }));

    res.json(formatted);
  } catch (err) { next(err); }
});

// GET /permissions - List all available system permissions
router.get('/permissions', authenticate, authorize('role:manage'), async (req, res, next) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { module: 'asc' }
    });
    res.json(permissions);
  } catch (err) { next(err); }
});

// POST /roles - Create a new role
router.post('/', authenticate, authorize('role:manage'), async (req, res, next) => {
  try {
    const { name, description, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const role = await prisma.role.create({
      data: {
        name,
        description,
        isSystem: false,
      }
    });

    if (permissions && Array.isArray(permissions)) {
      const perms = await prisma.permission.findMany({
        where: { code: { in: permissions } }
      });
      
      await prisma.rolePermission.createMany({
        data: perms.map(p => ({
          roleId: role.id,
          permissionId: p.id
        }))
      });
    }

    res.status(201).json(role);
  } catch (err) { next(err); }
});

// PUT /roles/:id - Update role name/description/permissions
router.put('/:id', authenticate, authorize('role:manage'), async (req, res, next) => {
  try {
    const { name, description, permissions } = req.body;
    const roleId = req.params.id;

    const existing = await prisma.role.findUnique({ where: { id: roleId } });
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.isSystem && name !== existing.name) {
      return res.status(403).json({ error: 'Cannot rename system roles' });
    }

    await prisma.role.update({
      where: { id: roleId },
      data: { name, description }
    });

    if (permissions && Array.isArray(permissions)) {
      // Clear old permissions
      await prisma.rolePermission.deleteMany({ where: { roleId } });
      
      // Add new ones
      const perms = await prisma.permission.findMany({
        where: { code: { in: permissions } }
      });
      
      await prisma.rolePermission.createMany({
        data: perms.map(p => ({
          roleId,
          permissionId: p.id
        }))
      });
    }

    res.json({ message: 'Role updated' });
  } catch (err) { next(err); }
});

// DELETE /roles/:id
router.delete('/:id', authenticate, authorize('role:manage'), async (req, res, next) => {
  try {
    const roleId = req.params.id;
    const existing = await prisma.role.findUnique({ where: { id: roleId }, include: { _count: { select: { users: true } } } });
    
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.isSystem) return res.status(403).json({ error: 'Cannot delete system roles' });
    if (existing._count.users > 0) return res.status(400).json({ error: 'Cannot delete role assigned to users' });

    await prisma.role.delete({ where: { id: roleId } });
    res.json({ message: 'Role deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
