'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { haversineMetres, isLate, calcHoursWorked, calcOtHours } = require('./utils');
const { resolveSchedule } = require('./shift-resolver');
const { reconcileRecord } = require('./engines/time-reconciliation.engine');
const { summarizeAll } = require('./engines/attendance-summary.engine');
const {
  detectAnomaliesForRecord,
  detectMonthlyOtBreach,
  ANOMALY_TYPES,
  DEFAULT_THRESHOLDS,
} = require('./engines/anomaly.engine');

const EMPLOYEE_SERVICE_URL     = process.env.EMPLOYEE_SERVICE_URL     || 'http://employee-service:4002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';
const LEAVE_SERVICE_URL        = process.env.LEAVE_SERVICE_URL        || 'http://leave-service:4004';

// Read at request time, not module-load time — keeps tests able to set the
// key via process.env before each request without re-requiring the module.
const internalKey = () => process.env.INTERNAL_SERVICE_KEY || 'dev-internal-key';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4007;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'attendance-service', status: 'ok', ts: new Date() }));

// ── Audit helper ──────────────────────────────────────────────────────────────
async function writeAudit({ entityType, entityId, entityName, action, actor, changedFields, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        entityType,
        entityId: entityId || null,
        entityName: entityName || null,
        action,
        actorId:    actor?.sub   || actor?.id    || null,
        actorEmail: actor?.email                  || null,
        actorRole:  actor?.role                   || null,
        changedFields: changedFields               || null,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
      },
    });
  } catch (err) {
    console.error('[AUDIT] write failed:', err.message);
  }
}


// Returns { valid: bool, locationName: string|null } given employee + coordinates
async function checkGeofence(employeeId, lat, lng) {
  if (lat == null || lng == null) return { valid: null, locationName: null };
  const assignments = await prisma.employeeWorkLocation.findMany({
    where: { employeeId },
    include: { workLocation: true },
  });
  if (!assignments.length) return { valid: null, locationName: null }; // no restriction
  for (const a of assignments) {
    const loc = a.workLocation;
    if (!loc.isActive) continue;
    const dist = haversineMetres(lat, lng, loc.latitude, loc.longitude);
    if (dist <= loc.radiusMetres) return { valid: true, locationName: loc.name };
  }
  return { valid: false, locationName: null };
}

// ── Clock In ──────────────────────────────────────────────────────────────────
app.post('/attendance/clock-in', authenticate, async (req, res, next) => {
  try {
    const empId = req.body.employeeId || req.user.employeeId;
    const { latitude, longitude } = req.body;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const geo = await checkGeofence(empId, latitude, longitude);
    if (geo.valid === false) {
      return res.status(403).json({ error: 'Clock-in denied: you are outside your assigned work location(s). Contact HR if this is incorrect.' });
    }

    // TAT-005: look up roster + capture scheduledStart. resolveSchedule
    // returns null when there's no roster, in which case reconciliation
    // falls back to "no schedule" semantics (no deltas, billable = actual).
    const schedule = await resolveSchedule(prisma, empId, today);

    // Reconcile in-memory using the proposed clock event + schedule so we
    // can persist the deltas + status + scheduled bounds in ONE upsert.
    const scheduledStart = schedule?.scheduledStart ?? null;
    const scheduledEnd   = schedule?.scheduledEnd   ?? null;
    const recon = schedule
      ? reconcileRecord({ clockIn: now, clockOut: null, scheduledStart, scheduledEnd }, schedule)
      : {};

    const baseData = {
      clockIn: now,
      status: isLate(now) ? 'LATE' : 'PRESENT',
      clockInLat: latitude ?? null, clockInLng: longitude ?? null,
      withinGeofence: geo.valid, locationName: geo.locationName,
      scheduledStart, scheduledEnd,
      ...recon,
    };
    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: empId, date: today } },
      create: { id: uuidv4(), employeeId: empId, date: today, ...baseData },
      update: baseData,
    });
    res.json(record);
  } catch (err) { next(err); }
});

// ── Clock Out ─────────────────────────────────────────────────────────────────
app.post('/attendance/clock-out', authenticate, async (req, res, next) => {
  try {
    const empId = req.body.employeeId || req.user.employeeId;
    const { latitude, longitude } = req.body;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const record = await prisma.attendanceRecord.findFirst({ where: { employeeId: empId, date: today } });
    if (!record || !record.clockIn) return res.status(400).json({ error: 'No clock-in recorded today' });

    const geo = await checkGeofence(empId, latitude, longitude);
    if (geo.valid === false) {
      return res.status(403).json({ error: 'Clock-out denied: you are outside your assigned work location(s). Contact HR if this is incorrect.' });
    }

    const hoursWorked = calcHoursWorked(record.clockIn, now);
    const otHours = calcOtHours(hoursWorked);

    // Reconcile in-memory against the captured (or just-resolved) schedule,
    // then do ONE update with the merged patch — clock event + reconciliation.
    // When there's no roster, reconcileRecord still produces billable hours
    // (raw clock-time diff − break) with both delta statuses NOT_APPLICABLE.
    const schedule = (record.scheduledStart && record.scheduledEnd)
      ? {
          scheduledStart: record.scheduledStart,
          scheduledEnd: record.scheduledEnd,
          // Re-resolve to pick up any roster edits between clock-in and now.
          ...(await resolveSchedule(prisma, empId, today) || {}),
        }
      : (await resolveSchedule(prisma, empId, today));

    const inMemory = {
      ...record,
      clockOut: now,
      hoursWorked,
      otHours,
    };
    const recon = reconcileRecord(inMemory, schedule || {});
    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        clockOut: now,
        hoursWorked,
        otHours,
        clockOutLat: latitude ?? null, clockOutLng: longitude ?? null,
        ...recon,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Admin: all records for a date ─────────────────────────────────────────────
app.get('/attendance/admin/records', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const dateStr = req.query.date;
    const targetDate = dateStr ? new Date(dateStr + 'T00:00:00') : (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
    const nextDay = new Date(targetDate); nextDay.setDate(nextDay.getDate() + 1);
    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: targetDate, lt: nextDay } },
      orderBy: { clockIn: 'asc' },
    });
    res.json({ date: targetDate.toISOString().slice(0, 10), records });
  } catch (err) { next(err); }
});

// ── Employee records ──────────────────────────────────────────────────────────
const ATTENDANCE_RESERVED = new Set(['shifts', 'roster', 'locations', 'admin', 'records', 'periods', 'pending-approvals', 'internal', 'anomalies', 'thresholds', 'today']);
app.get('/attendance/:employeeId', authenticate, async (req, res, next) => {
  if (ATTENDANCE_RESERVED.has(req.params.employeeId)) return next();
  try {
    const { from, to } = req.query;
    const where = { employeeId: req.params.employeeId };
    if (from || to) where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
    const records = await prisma.attendanceRecord.findMany({ where, orderBy: { date: 'desc' } });
    res.json(records);
  } catch (err) { next(err); }
});

// ── OT summary ────────────────────────────────────────────────────────────────
app.get('/overtime/:employeeId/:period', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const [year, month] = req.params.period.split('-');
    const start = new Date(parseInt(year), parseInt(month) - 1, 1);
    const end = new Date(parseInt(year), parseInt(month), 0);
    const records = await prisma.attendanceRecord.findMany({ where: { employeeId: req.params.employeeId, date: { gte: start, lte: end } } });
    const totalOt = records.reduce((sum, r) => sum + (r.otHours || 0), 0);
    const cappedOt = Math.min(totalOt, 72);
    res.json({ employeeId: req.params.employeeId, period: req.params.period, totalOtHours: totalOt, cappedOtHours: cappedOt, exceedsMonthlyCap: totalOt > 72, records: records.length });
  } catch (err) { next(err); }
});

// ── Shifts ────────────────────────────────────────────────────────────────────
const ROSTER_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER, 'roster:manage'];

app.get('/attendance/shifts', authenticate, async (req, res, next) => {
  try {
    const [templates, workingShifts] = await Promise.all([
      prisma.shiftTemplate.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.workingShift.findMany({ where: { isActive: true }, include: { project: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } }),
    ]);
    const unified = [
      ...templates.map(t => ({ ...t, _type: 'template', projectName: null, projectId: null })),
      ...workingShifts.map(ws => ({
        id: ws.id, name: ws.name, startTime: ws.startTime, endTime: ws.endTime,
        breakMinutes: ws.breakMinutes, hoursPerDay: ws.hoursPerDay, color: ws.color, isActive: ws.isActive,
        workMon: ws.workMon, workTue: ws.workTue, workWed: ws.workWed, workThu: ws.workThu,
        workFri: ws.workFri, workSat: ws.workSat, workSun: ws.workSun,
        _type: 'working', projectName: ws.project.name, projectId: ws.project.id,
      })),
    ];
    res.json(unified);
  } catch (err) { next(err); }
});

app.post('/attendance/shifts', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, startTime, endTime, breakMinutes, hoursPerDay, color } = req.body;
    if (!name || !startTime || !endTime) return res.status(400).json({ error: 'name, startTime, endTime required' });
    res.status(201).json(await prisma.shiftTemplate.create({ data: { id: uuidv4(), name, startTime, endTime, breakMinutes: breakMinutes ?? 60, hoursPerDay: hoursPerDay ?? 8, color: color || '#6366f1' } }));
  } catch (err) { next(err); }
});

app.put('/attendance/shifts/:id', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, startTime, endTime, breakMinutes, hoursPerDay, color, isActive } = req.body;
    res.json(await prisma.shiftTemplate.update({ where: { id: req.params.id }, data: { name, startTime, endTime, breakMinutes, hoursPerDay, color, isActive } }));
  } catch (err) { next(err); }
});

app.delete('/attendance/shifts/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.shiftTemplate.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Roster ────────────────────────────────────────────────────────────────────
// GET /roster?weekStart=2026-05-05 | from=2026-05-04&to=2026-05-10
// Admin roles can pass any employeeId; employees can only see their own roster.
app.get('/attendance/roster', authenticate, async (req, res, next) => {
  try {
    const isAdmin = [...ROSTER_ROLES, ROLES.PAYROLL_OFFICER].includes(req.user?.role);
    let { weekStart, from, to, employeeId } = req.query;

    // Non-admin employees can only fetch their own roster
    if (!isAdmin) {
      employeeId = req.user.employeeId;
      if (!employeeId) return res.status(403).json({ error: 'Employee record not linked to this account' });
    }

    const where = {};
    if (from && to) {
      where.date = { gte: new Date(from + 'T00:00:00Z'), lte: new Date(to + 'T23:59:59Z') };
    } else if (weekStart) {
      const start = new Date(weekStart + 'T00:00:00Z');
      const end   = new Date(weekStart + 'T00:00:00Z'); end.setUTCDate(start.getUTCDate() + 6);
      where.date  = { gte: start, lte: end };
    }
    if (employeeId) where.employeeId = employeeId;

    const entries = await prisma.rosterEntry.findMany({
      where, orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
      include: { shiftTemplate: true, workingShift: true, shiftPattern: true },
    });
    res.json({ entries });
  } catch (err) { next(err); }
});

// PUT /roster/entry  (upsert single cell — employee + date)
app.put('/attendance/roster/entry', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { employeeId, date, shiftTemplateId, workingShiftId, locationId, note } = req.body;
    if (!employeeId || !date) return res.status(400).json({ error: 'employeeId and date required' });
    const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
    const existing = await prisma.rosterEntry.findUnique({ where: { employeeId_date: { employeeId, date: d } } });
    const entry = await prisma.rosterEntry.upsert({
      where: { employeeId_date: { employeeId, date: d } },
      create: { id: uuidv4(), employeeId, date: d, shiftTemplateId: shiftTemplateId || null, workingShiftId: workingShiftId || null, locationId: locationId || null, note: note || null, createdBy: req.user?.sub },
      update: { shiftTemplateId: shiftTemplateId || null, workingShiftId: workingShiftId || null, locationId: locationId || null, note: note || null, updatedBy: req.user?.sub },
      include: { shiftTemplate: true, workingShift: true, shiftPattern: true },
    });
    await writeAudit({
      entityType: 'RosterEntry', entityId: employeeId, entityName: `${employeeId} / ${date}`,
      action: existing ? 'ROSTER_UPDATE' : 'ROSTER_CREATE',
      actor: req.user, req,
      changedFields: {
        date, employeeId,
        shiftTemplateId: { from: existing?.shiftTemplateId ?? null, to: shiftTemplateId ?? null },
        workingShiftId:  { from: existing?.workingShiftId  ?? null, to: workingShiftId  ?? null },
        note:            { from: existing?.note             ?? null, to: note            ?? null },
      },
    });
    res.json(entry);
  } catch (err) { next(err); }
});

// POST /roster/bulk  (assign same shift to multiple employees over a date range)
app.post('/attendance/roster/bulk', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { employeeIds, shiftTemplateId, workingShiftId, dates } = req.body;
    if (!employeeIds?.length || !dates?.length) return res.status(400).json({ error: 'employeeIds and dates required' });
    let count = 0;
    for (const empId of employeeIds) {
      for (const rawDate of dates) {
        const d = new Date(rawDate); d.setUTCHours(0, 0, 0, 0);
        await prisma.rosterEntry.upsert({
          where: { employeeId_date: { employeeId: empId, date: d } },
          create: { id: uuidv4(), employeeId: empId, date: d, shiftTemplateId: shiftTemplateId || null, workingShiftId: workingShiftId || null, createdBy: req.user?.sub },
          update: { shiftTemplateId: shiftTemplateId || null, workingShiftId: workingShiftId || null, updatedBy: req.user?.sub },
        });
        count++;
      }
    }
    await writeAudit({
      entityType: 'RosterEntry', entityId: null,
      entityName: `Bulk assign – ${employeeIds.length} employees, ${dates.length} dates`,
      action: 'ROSTER_BULK_UPDATE', actor: req.user, req,
      changedFields: { employeeIds, dates, shiftTemplateId: shiftTemplateId || null, workingShiftId: workingShiftId || null, count },
    });
    res.json({ ok: true, count });
  } catch (err) { next(err); }
});

// POST /roster/copy-week  (copy one week's roster to another week)
app.post('/attendance/roster/copy-week', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { fromWeekStart, toWeekStart, employeeIds } = req.body;
    if (!fromWeekStart || !toWeekStart) return res.status(400).json({ error: 'fromWeekStart and toWeekStart required' });
    const from = new Date(fromWeekStart);
    const to = new Date(toWeekStart);
    const fromEnd = new Date(from); fromEnd.setDate(from.getDate() + 6);

    const where = { date: { gte: from, lte: fromEnd } };
    if (employeeIds?.length) where.employeeId = { in: employeeIds };
    const source = await prisma.rosterEntry.findMany({ where });

    let count = 0;
    for (const s of source) {
      const offset = Math.round((s.date - from) / 864e5);
      const newDate = new Date(to); newDate.setDate(to.getDate() + offset); newDate.setUTCHours(0, 0, 0, 0);
      await prisma.rosterEntry.upsert({
        where: { employeeId_date: { employeeId: s.employeeId, date: newDate } },
        create: { id: uuidv4(), employeeId: s.employeeId, date: newDate, shiftTemplateId: s.shiftTemplateId, locationId: s.locationId, createdBy: req.user?.sub },
        update: { shiftTemplateId: s.shiftTemplateId, locationId: s.locationId, updatedBy: req.user?.sub },
      });
      count++;
    }
    await writeAudit({
      entityType: 'RosterEntry', entityId: null,
      entityName: `Copy week ${fromWeekStart} → ${toWeekStart}`,
      action: 'ROSTER_COPY_WEEK', actor: req.user, req,
      changedFields: { fromWeekStart, toWeekStart, count },
    });
    res.json({ ok: true, count });
  } catch (err) { next(err); }
});

// DELETE /roster/entry — clear a single cell
app.delete('/attendance/roster/entry', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { employeeId, date } = req.body;
    const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
    await prisma.rosterEntry.deleteMany({ where: { employeeId, date: d } });
    await writeAudit({
      entityType: 'RosterEntry', entityId: employeeId, entityName: `${employeeId} / ${date}`,
      action: 'ROSTER_DELETE', actor: req.user, req,
      changedFields: { employeeId, date },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /roster/employee/:empId?from=YYYY-MM-DD&to=YYYY-MM-DD — clear all entries for one employee
app.delete('/attendance/roster/employee/:empId', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { empId } = req.params;
    const { from, to } = req.query;
    const where = { employeeId: empId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from + 'T00:00:00Z');
      if (to)   where.date.lte = new Date(to   + 'T23:59:59Z');
    }
    const result = await prisma.rosterEntry.deleteMany({ where });
    await writeAudit({
      entityType: 'RosterEntry', entityId: empId, entityName: empId,
      action: 'ROSTER_CLEAR_EMPLOYEE', actor: req.user, req,
      changedFields: { employeeId: empId, from: from || null, to: to || null, deleted: result.count },
    });
    res.json({ deleted: result.count });
  } catch (err) { next(err); }
});

// ── Work Locations (org-wide) ─────────────────────────────────────────────────
app.get('/attendance/locations', authenticate, async (req, res, next) => {
  try {
    const locs = await prisma.workLocation.findMany({
      where: req.query.activeOnly === 'true' ? { isActive: true } : {},
      include: { _count: { select: { employeeLocations: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(locs);
  } catch (err) { next(err); }
});

app.post('/attendance/locations', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { name, postalCode, address, latitude, longitude, radiusMetres } = req.body;
    if (!name || !postalCode || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'name, postalCode, latitude, longitude are required' });
    }
    const loc = await prisma.workLocation.create({
      data: { id: uuidv4(), name, postalCode, address: address || '', latitude, longitude, radiusMetres: radiusMetres || 200 },
    });
    res.status(201).json(loc);
  } catch (err) { next(err); }
});

app.put('/attendance/locations/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { name, postalCode, address, latitude, longitude, radiusMetres, isActive } = req.body;
    const loc = await prisma.workLocation.update({
      where: { id: req.params.id },
      data: { name, postalCode, address, latitude, longitude, radiusMetres, isActive },
    });
    res.json(loc);
  } catch (err) { next(err); }
});

app.delete('/attendance/locations/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.workLocation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Employee ↔ Location assignments ──────────────────────────────────────────
app.get('/attendance/locations/employee/:employeeId', authenticate, async (req, res, next) => {
  try {
    const assignments = await prisma.employeeWorkLocation.findMany({
      where: { employeeId: req.params.employeeId },
      include: { workLocation: true },
      orderBy: { isPrimary: 'desc' },
    });
    res.json(assignments);
  } catch (err) { next(err); }
});

app.post('/attendance/locations/employee', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { employeeId, workLocationId, isPrimary } = req.body;
    if (!employeeId || !workLocationId) return res.status(400).json({ error: 'employeeId and workLocationId required' });
    // If setting as primary, clear other primaries for this employee
    if (isPrimary) {
      await prisma.employeeWorkLocation.updateMany({ where: { employeeId, isPrimary: true }, data: { isPrimary: false } });
    }
    const assignment = await prisma.employeeWorkLocation.upsert({
      where: { employeeId_workLocationId: { employeeId, workLocationId } },
      create: { id: uuidv4(), employeeId, workLocationId, isPrimary: isPrimary ?? false },
      update: { isPrimary: isPrimary ?? false },
    });
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

app.delete('/attendance/locations/employee/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.employeeWorkLocation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Admin: override attendance record location ────────────────────────────────
app.patch('/attendance/records/:id/location', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { withinGeofence, locationName, notes } = req.body;
    const updated = await prisma.attendanceRecord.update({
      where: { id: req.params.id },
      data: { withinGeofence, locationName, notes },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Shift Projects ────────────────────────────────────────────────────────────
app.get('/attendance/shifts/projects', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const projects = await prisma.shiftProject.findMany({
      where: { isActive: true },
      include: { _count: { select: { workingShifts: true, shiftPatterns: true, members: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(projects);
  } catch (err) { next(err); }
});

app.post('/attendance/shifts/projects', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    res.status(201).json(await prisma.shiftProject.create({ data: { id: uuidv4(), name, description: description || null } }));
  } catch (err) { next(err); }
});

app.put('/attendance/shifts/projects/:id', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, description, isActive } = req.body;
    res.json(await prisma.shiftProject.update({ where: { id: req.params.id }, data: { name, description, isActive } }));
  } catch (err) { next(err); }
});

app.delete('/attendance/shifts/projects/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    await prisma.shiftProject.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Working Shifts ────────────────────────────────────────────────────────────
app.get('/attendance/shifts/projects/:projectId/working', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const shifts = await prisma.workingShift.findMany({
      where: { projectId: req.params.projectId, isActive: true },
      include: { assignments: true },
      orderBy: { name: 'asc' },
    });
    res.json(shifts);
  } catch (err) { next(err); }
});

app.post('/attendance/shifts/projects/:projectId/working', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, workMon, workTue, workWed, workThu, workFri, workSat, workSun, startTime, endTime, breakMinutes, hoursPerDay, color, isRecurring } = req.body;
    if (!name || !startTime || !endTime) return res.status(400).json({ error: 'name, startTime, endTime required' });
    res.status(201).json(await prisma.workingShift.create({
      data: {
        id: uuidv4(), projectId: req.params.projectId, name,
        workMon: workMon ?? false, workTue: workTue ?? false, workWed: workWed ?? false,
        workThu: workThu ?? false, workFri: workFri ?? false, workSat: workSat ?? false, workSun: workSun ?? false,
        startTime, endTime, breakMinutes: breakMinutes ?? 60, hoursPerDay: hoursPerDay ?? 8,
        color: color || '#6366f1', isRecurring: isRecurring !== false,
      },
    }));
  } catch (err) { next(err); }
});

app.put('/attendance/shifts/working/:id', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, workMon, workTue, workWed, workThu, workFri, workSat, workSun, startTime, endTime, breakMinutes, hoursPerDay, color, isRecurring, isActive } = req.body;
    res.json(await prisma.workingShift.update({
      where: { id: req.params.id },
      data: { name, workMon, workTue, workWed, workThu, workFri, workSat, workSun, startTime, endTime, breakMinutes, hoursPerDay, color, isRecurring, isActive },
    }));
  } catch (err) { next(err); }
});

app.delete('/attendance/shifts/working/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    await prisma.workingShift.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Shift Patterns ────────────────────────────────────────────────────────────
app.get('/attendance/shifts/projects/:projectId/patterns', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const patterns = await prisma.shiftPattern.findMany({
      where: { projectId: req.params.projectId, isActive: true },
      include: { assignments: true },
      orderBy: { name: 'asc' },
    });
    res.json(patterns);
  } catch (err) { next(err); }
});

app.post('/attendance/shifts/projects/:projectId/patterns', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, patternType, workDays, offDays, startTime, endTime, breakMinutes, hoursPerShift, color } = req.body;
    if (!name || !startTime || !endTime) return res.status(400).json({ error: 'name, startTime, endTime required' });
    res.status(201).json(await prisma.shiftPattern.create({
      data: {
        id: uuidv4(), projectId: req.params.projectId, name,
        patternType: patternType || 'CUSTOM', workDays: workDays ?? 5, offDays: offDays ?? 2,
        startTime, endTime, breakMinutes: breakMinutes ?? 60, hoursPerShift: hoursPerShift ?? 8,
        color: color || '#6366f1',
      },
    }));
  } catch (err) { next(err); }
});

app.put('/attendance/shifts/patterns/:id', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { name, patternType, workDays, offDays, startTime, endTime, breakMinutes, hoursPerShift, color, isActive } = req.body;
    res.json(await prisma.shiftPattern.update({
      where: { id: req.params.id },
      data: { name, patternType, workDays, offDays, startTime, endTime, breakMinutes, hoursPerShift, color, isActive },
    }));
  } catch (err) { next(err); }
});

app.delete('/attendance/shifts/patterns/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    await prisma.shiftPattern.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Shift Assignments (employee ↔ shift) ──────────────────────────────────────
app.get('/attendance/shifts/working/:id/assignments', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    res.json(await prisma.shiftAssignment.findMany({ where: { workingShiftId: req.params.id }, orderBy: { startDate: 'desc' } }));
  } catch (err) { next(err); }
});

app.post('/attendance/shifts/working/:id/assign', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { employeeIds, startDate, endDate } = req.body;
    if (!employeeIds?.length || !startDate) return res.status(400).json({ error: 'employeeIds and startDate required' });
    const ws = await prisma.workingShift.findUnique({ where: { id: req.params.id } });
    if (!ws) return res.status(404).json({ error: 'Working shift not found' });
    const dayMap = [ws.workSun, ws.workMon, ws.workTue, ws.workWed, ws.workThu, ws.workFri, ws.workSat];
    const created = [];
    for (const employeeId of employeeIds) {
      const sd = new Date(startDate); sd.setUTCHours(0, 0, 0, 0);
      // End-date any open assignments for other shifts so history is preserved
      const dayBefore = new Date(sd); dayBefore.setUTCDate(sd.getUTCDate() - 1);
      await prisma.shiftAssignment.updateMany({
        where: { employeeId, endDate: null, NOT: { workingShiftId: req.params.id } },
        data: { endDate: dayBefore },
      });
      // Create or update this shift's assignment
      const existing = await prisma.shiftAssignment.findFirst({ where: { employeeId, workingShiftId: req.params.id } });
      if (!existing) {
        created.push(await prisma.shiftAssignment.create({
          data: { id: uuidv4(), employeeId, workingShiftId: req.params.id, startDate: sd, endDate: endDate ? new Date(endDate) : null },
        }));
      } else {
        await prisma.shiftAssignment.update({ where: { id: existing.id }, data: { startDate: sd, endDate: endDate ? new Date(endDate) : null } });
      }
      // Auto-populate roster entries from startDate onwards only — entries before startDate are untouched
      const end = new Date(sd); end.setDate(end.getDate() + 28);
      const cur = new Date(sd);
      while (cur <= end) {
        if (dayMap[cur.getDay()]) {
          const d = new Date(cur); d.setUTCHours(0, 0, 0, 0);
          await prisma.rosterEntry.upsert({
            where:  { employeeId_date: { employeeId, date: d } },
            create: { id: uuidv4(), employeeId, date: d, workingShiftId: ws.id, shiftTemplateId: null, createdBy: req.user?.sub },
            update: { workingShiftId: ws.id, shiftTemplateId: null, shiftPatternId: null, updatedBy: req.user?.sub },
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    res.status(201).json({ ok: true, count: created.length });
  } catch (err) { next(err); }
});

app.get('/attendance/shifts/patterns/:id/assignments', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    res.json(await prisma.shiftAssignment.findMany({ where: { shiftPatternId: req.params.id }, orderBy: { startDate: 'desc' } }));
  } catch (err) { next(err); }
});

app.post('/attendance/shifts/patterns/:id/assign', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { employeeIds, startDate, endDate } = req.body;
    if (!employeeIds?.length || !startDate) return res.status(400).json({ error: 'employeeIds and startDate required' });
    const pattern = await prisma.shiftPattern.findUnique({ where: { id: req.params.id } });
    if (!pattern) return res.status(404).json({ error: 'Shift pattern not found' });
    const created = [];
    const cycleLen = pattern.workDays + pattern.offDays;
    for (const employeeId of employeeIds) {
      const sd = new Date(startDate); sd.setUTCHours(0, 0, 0, 0);
      // End-date any open assignments for other patterns/shifts so history is preserved
      const dayBefore = new Date(sd); dayBefore.setUTCDate(sd.getUTCDate() - 1);
      await prisma.shiftAssignment.updateMany({
        where: { employeeId, endDate: null, NOT: { shiftPatternId: req.params.id } },
        data: { endDate: dayBefore },
      });
      // Create or update this pattern's assignment
      const existing = await prisma.shiftAssignment.findFirst({ where: { employeeId, shiftPatternId: req.params.id } });
      if (!existing) {
        created.push(await prisma.shiftAssignment.create({
          data: { id: uuidv4(), employeeId, shiftPatternId: req.params.id, startDate: sd, endDate: endDate ? new Date(endDate) : null },
        }));
      } else {
        await prisma.shiftAssignment.update({ where: { id: existing.id }, data: { startDate: sd, endDate: endDate ? new Date(endDate) : null } });
      }
      // Auto-populate roster entries from startDate onwards only — entries before startDate are untouched
      for (let i = 0; i < 28; i++) {
        const cur = new Date(sd); cur.setUTCDate(sd.getUTCDate() + i);
        if (i % cycleLen < pattern.workDays) {
          await prisma.rosterEntry.upsert({
            where: { employeeId_date: { employeeId, date: cur } },
            create: { id: uuidv4(), employeeId, date: cur, shiftPatternId: pattern.id, shiftTemplateId: null, workingShiftId: null, createdBy: req.user?.sub },
            update: { shiftPatternId: pattern.id, shiftTemplateId: null, workingShiftId: null, updatedBy: req.user?.sub },
          });
        }
      }
    }
    res.status(201).json({ ok: true, count: created.length });
  } catch (err) { next(err); }
});

app.delete('/attendance/shifts/assignments/:id', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const assignment = await prisma.shiftAssignment.findUnique({ where: { id: req.params.id } });
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    // Clear roster entries tied to this employee+shift within the assignment's date range
    const rosterWhere = { employeeId: assignment.employeeId, date: { gte: assignment.startDate } };
    if (assignment.endDate) rosterWhere.date.lte = assignment.endDate;
    if (assignment.workingShiftId) rosterWhere.workingShiftId = assignment.workingShiftId;
    if (assignment.shiftPatternId) rosterWhere.shiftPatternId = assignment.shiftPatternId;
    await prisma.rosterEntry.deleteMany({ where: rosterWhere });

    await prisma.shiftAssignment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/attendance/shifts/employee/:empId/assignments', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const assignments = await prisma.shiftAssignment.findMany({
      where: { employeeId: req.params.empId },
      include: { workingShift: { include: { project: true } }, shiftPattern: { include: { project: true } } },
      orderBy: { startDate: 'desc' },
    });
    res.json(assignments);
  } catch (err) { next(err); }
});

// ── Project Members ───────────────────────────────────────────────────────────
app.get('/attendance/shifts/projects/:id/members', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId: req.params.id },
      include: {
        workingShift: { select: { id: true, name: true, color: true, startTime: true, endTime: true, hoursPerDay: true } },
        shiftPattern:  { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(members);
  } catch (err) { next(err); }
});

app.post('/attendance/shifts/projects/:id/members', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { employeeId, workingShiftId, shiftPatternId, startDate, autoPopulate } = req.body;
    if (!employeeId || !startDate) return res.status(400).json({ error: 'employeeId and startDate required' });
    const sd = new Date(startDate); sd.setUTCHours(0, 0, 0, 0);
    const dayBefore = new Date(sd); dayBefore.setUTCDate(sd.getUTCDate() - 1);

    // If the employee's shift is changing, end-date their current open assignments before startDate
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_employeeId: { projectId: req.params.id, employeeId } },
    });
    const shiftChanging = existing && (existing.workingShiftId !== (workingShiftId || null) || existing.shiftPatternId !== (shiftPatternId || null));
    if (shiftChanging) {
      await prisma.shiftAssignment.updateMany({
        where: { employeeId, endDate: null },
        data: { endDate: dayBefore },
      });
    }

    const member = await prisma.projectMember.upsert({
      where: { projectId_employeeId: { projectId: req.params.id, employeeId } },
      create: { id: uuidv4(), projectId: req.params.id, employeeId, workingShiftId: workingShiftId || null, shiftPatternId: shiftPatternId || null, startDate: sd },
      update: { workingShiftId: workingShiftId || null, shiftPatternId: shiftPatternId || null, startDate: sd },
      include: { workingShift: true, shiftPattern: true },
    });

    if (autoPopulate && workingShiftId) {
      const ws = await prisma.workingShift.findUnique({ where: { id: workingShiftId } });
      if (ws) {
        const dayMap = [ws.workSun, ws.workMon, ws.workTue, ws.workWed, ws.workThu, ws.workFri, ws.workSat];
        const end = new Date(sd); end.setDate(end.getDate() + 28);
        const cur = new Date(sd);
        // Only populate from startDate onwards — roster before startDate is untouched
        while (cur <= end) {
          if (dayMap[cur.getDay()]) {
            const d = new Date(cur); d.setUTCHours(0, 0, 0, 0);
            await prisma.rosterEntry.upsert({
              where: { employeeId_date: { employeeId, date: d } },
              create: { id: uuidv4(), employeeId, date: d, workingShiftId, shiftTemplateId: null, createdBy: req.user?.sub },
              update: { workingShiftId, shiftTemplateId: null, updatedBy: req.user?.sub },
            });
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
    }
    res.status(201).json(member);
  } catch (err) { next(err); }
});

app.delete('/attendance/shifts/projects/:id/members/:memberId', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    await prisma.projectMember.delete({ where: { id: req.params.memberId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── TAT-005 Period Lock / Approval / Manager Workflow ──────────────────────

const PERIOD_RX = /^\d{4}-(0[1-9]|1[0-2])$/;
const ADMIN_LOCK_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];
const APPROVAL_ROLES   = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER];

function periodBounds(period) {
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { start, end };
}

// List + fetch period state
app.get('/attendance/periods', authenticate, authorize(...ADMIN_LOCK_ROLES, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const rows = await prisma.attendancePeriod.findMany({ orderBy: { period: 'desc' } });
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/attendance/periods/:period', authenticate, authorize(...ADMIN_LOCK_ROLES, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    if (!PERIOD_RX.test(req.params.period)) return res.status(400).json({ error: 'Invalid period — use YYYY-MM' });
    const row = await prisma.attendancePeriod.findUnique({ where: { period: req.params.period } });
    res.json(row || { period: req.params.period, status: 'OPEN' });
  } catch (err) { next(err); }
});

// Lock — only valid OPEN → LOCKED
app.post('/attendance/periods/:period/lock', authenticate, authorize(...ADMIN_LOCK_ROLES), async (req, res, next) => {
  try {
    const period = req.params.period;
    if (!PERIOD_RX.test(period)) return res.status(400).json({ error: 'Invalid period — use YYYY-MM' });
    const existing = await prisma.attendancePeriod.findUnique({ where: { period } });
    if (existing && existing.status !== 'OPEN') {
      return res.status(409).json({ error: `Cannot lock from status ${existing.status}` });
    }
    const row = await prisma.attendancePeriod.upsert({
      where: { period },
      create: {
        id: uuidv4(), period, status: 'LOCKED',
        lockedBy: req.user?.sub, lockedAt: new Date(),
        notes: req.body?.notes || null,
      },
      update: {
        status: 'LOCKED',
        lockedBy: req.user?.sub, lockedAt: new Date(),
        notes: req.body?.notes ?? existing?.notes ?? null,
      },
    });
    await writeAudit({ entityType: 'AttendancePeriod', entityId: row.id, entityName: period, action: 'LOCK', actor: req.user, req });
    res.json(row);
  } catch (err) { next(err); }
});

// Unlock — back to OPEN; only HR_ADMIN+ (HR_MANAGER cannot unlock once approved)
app.post('/attendance/periods/:period/unlock', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const period = req.params.period;
    if (!PERIOD_RX.test(period)) return res.status(400).json({ error: 'Invalid period — use YYYY-MM' });
    const existing = await prisma.attendancePeriod.findUnique({ where: { period } });
    if (!existing) return res.status(404).json({ error: 'Period not found' });
    if (existing.status === 'OPEN') return res.status(409).json({ error: 'Period is already OPEN' });
    const row = await prisma.attendancePeriod.update({
      where: { period },
      data: { status: 'OPEN', lockedBy: null, lockedAt: null, approvedBy: null, approvedAt: null },
    });
    await writeAudit({ entityType: 'AttendancePeriod', entityId: row.id, entityName: period, action: 'UNLOCK', actor: req.user, req });
    res.json(row);
  } catch (err) { next(err); }
});

// Approve for payroll — only valid LOCKED → APPROVED_FOR_PAYROLL
app.post('/attendance/periods/:period/approve-for-payroll', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const period = req.params.period;
    if (!PERIOD_RX.test(period)) return res.status(400).json({ error: 'Invalid period — use YYYY-MM' });
    const existing = await prisma.attendancePeriod.findUnique({ where: { period } });
    if (!existing) return res.status(404).json({ error: 'Period must be LOCKED before approval' });
    if (existing.status !== 'LOCKED') {
      return res.status(409).json({ error: `Cannot approve from status ${existing.status} — period must be LOCKED first` });
    }
    const row = await prisma.attendancePeriod.update({
      where: { period },
      data: { status: 'APPROVED_FOR_PAYROLL', approvedBy: req.user?.sub, approvedAt: new Date() },
    });
    await writeAudit({ entityType: 'AttendancePeriod', entityId: row.id, entityName: period, action: 'APPROVE_FOR_PAYROLL', actor: req.user, req });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── Manager: pending early/late approvals ──────────────────────────────────

app.get('/attendance/pending-approvals', authenticate, authorize(...APPROVAL_ROLES), async (req, res, next) => {
  try {
    // Optional employeeIds filter (manager-of), period filter.
    const where = {
      OR: [
        { earlyStatus: 'PENDING' },
        { lateStatus:  'PENDING' },
      ],
    };
    if (req.query.employeeIds) {
      const ids = String(req.query.employeeIds).split(',').filter(Boolean);
      if (ids.length) where.employeeId = { in: ids };
    }
    if (req.query.period && PERIOD_RX.test(req.query.period)) {
      const { start, end } = periodBounds(req.query.period);
      where.date = { gte: start, lte: end };
    }
    const records = await prisma.attendanceRecord.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 500,
    });
    res.json({ count: records.length, records });
  } catch (err) { next(err); }
});

// Approve / Deny — per side. Reconciler re-runs to update billable hours.
async function decideDelta(req, res, side, decision) {
  if (side !== 'early' && side !== 'late') return res.status(400).json({ error: 'Invalid side' });
  const recordId = req.params.id;
  const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
  if (!record) return res.status(404).json({ error: 'Attendance record not found' });

  const currentStatus = side === 'early' ? record.earlyStatus : record.lateStatus;
  if (currentStatus !== 'PENDING' && currentStatus !== 'AUTO_APPROVED') {
    return res.status(409).json({ error: `Cannot ${decision.toLowerCase()} a delta in status ${currentStatus}` });
  }
  // Manager override on AUTO_APPROVED is allowed (HR may want to deny something the grace approved).

  // Apply the manager decision, then re-run reconciliation so billable values
  // reflect the new status.
  const decisionPatch = side === 'early'
    ? { earlyStatus: decision, earlyApprovedBy: req.user?.sub, earlyApprovedAt: new Date(), earlyDenyReason: decision === 'DENIED' ? (req.body?.reason || null) : null }
    : { lateStatus:  decision, lateApprovedBy:  req.user?.sub, lateApprovedAt:  new Date(), lateDenyReason:  decision === 'DENIED' ? (req.body?.reason || null) : null };

  const afterDecision = { ...record, ...decisionPatch };
  const shift = await resolveSchedule(prisma, record.employeeId, record.date);
  const recon = reconcileRecord(afterDecision, shift || {});
  const updated = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data: { ...decisionPatch, ...recon },
  });
  await writeAudit({
    entityType: 'AttendanceRecord', entityId: recordId, entityName: `${record.employeeId} ${record.date.toISOString().slice(0,10)}`,
    action: `${side.toUpperCase()}_${decision}`, actor: req.user, req,
  });
  return res.json(updated);
}

app.post('/attendance/records/:id/approve-early', authenticate, authorize(...APPROVAL_ROLES), async (req, res, next) => {
  try { await decideDelta(req, res, 'early', 'APPROVED'); } catch (err) { next(err); }
});

app.post('/attendance/records/:id/approve-late', authenticate, authorize(...APPROVAL_ROLES), async (req, res, next) => {
  try { await decideDelta(req, res, 'late', 'APPROVED'); } catch (err) { next(err); }
});

app.post('/attendance/records/:id/deny-early', authenticate, authorize(...APPROVAL_ROLES), async (req, res, next) => {
  try { await decideDelta(req, res, 'early', 'DENIED'); } catch (err) { next(err); }
});

app.post('/attendance/records/:id/deny-late', authenticate, authorize(...APPROVAL_ROLES), async (req, res, next) => {
  try { await decideDelta(req, res, 'late', 'DENIED'); } catch (err) { next(err); }
});

// ─── Internal: per-employee period summary for payroll auto-feed ────────────
// Authenticated by INTERNAL_SERVICE_KEY header — caller is the payroll
// service running compute. Returns periodStatus so the caller can enforce
// the APPROVED_FOR_PAYROLL gate.
app.get('/attendance/internal/period-summary/:period', async (req, res, next) => {
  try {
    if (!PERIOD_RX.test(req.params.period)) return res.status(400).json({ error: 'Invalid period — use YYYY-MM' });
    const key = req.headers['x-internal-service-key'];
    if (!key || key !== internalKey()) return res.status(403).json({ error: 'Forbidden' });
    const period = req.params.period;
    const { start, end } = periodBounds(period);
    const periodRow = await prisma.attendancePeriod.findUnique({ where: { period } });
    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: start, lte: end } },
    });
    // Working-days computation lives in payroll-utils which is mounted here too.
    const { countWorkingDays } = require('/app/shared/payroll-utils');
    const holidays = []; // attendance-service doesn't own the PH calendar; caller can pass via summary endpoint v2 if needed
    const expectedWorkDays = countWorkingDays(start, end, new Set(holidays.map(h => h.toISOString().slice(0,10))), 'FIVE_DAY');
    const employeeIds = Array.isArray(req.query.employeeIds)
      ? req.query.employeeIds
      : (typeof req.query.employeeIds === 'string' ? req.query.employeeIds.split(',').filter(Boolean) : []);
    const summary = summarizeAll(records, { expectedWorkDays, employeeIds });
    res.json({
      period,
      periodStatus: periodRow?.status || 'OPEN',
      lockedBy:     periodRow?.lockedBy   || null,
      lockedAt:     periodRow?.lockedAt   || null,
      approvedBy:   periodRow?.approvedBy || null,
      approvedAt:   periodRow?.approvedAt || null,
      expectedWorkDays,
      employeeCount: Object.keys(summary).length,
      summary,
    });
  } catch (err) { next(err); }
});

// ─── TAT-004 Anomaly Detection ──────────────────────────────────────────────

const ANOMALY_ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];
const ANOMALY_VIEW_ROLES  = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER, ROLES.PAYROLL_OFFICER];

async function loadThresholds() {
  try {
    const row = await prisma.anomalyThreshold.findUnique({ where: { id: 1 } });
    if (!row) return { ...DEFAULT_THRESHOLDS };
    return {
      lateThresholdMin:          row.lateThresholdMin,
      earlyDepartThresholdMin:   row.earlyDepartThresholdMin,
      dailyOtThresholdHours:     row.dailyOtThresholdHours,
      monthlyOtAlertHours:       row.monthlyOtAlertHours,
      missingClockOutGraceHours: row.missingClockOutGraceHours,
    };
  } catch (err) {
    console.error('[anomaly] threshold load failed, using defaults:', err.message);
    return { ...DEFAULT_THRESHOLDS };
  }
}

// GET / PUT thresholds (singleton id=1)
app.get('/attendance/thresholds', authenticate, authorize(...ANOMALY_VIEW_ROLES), async (req, res, next) => {
  try {
    const row = await prisma.anomalyThreshold.findUnique({ where: { id: 1 } });
    res.json(row || { id: 1, ...DEFAULT_THRESHOLDS, updatedBy: null, updatedAt: null });
  } catch (err) { next(err); }
});

app.put('/attendance/thresholds', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const fields = ['lateThresholdMin', 'earlyDepartThresholdMin', 'dailyOtThresholdHours', 'monthlyOtAlertHours', 'missingClockOutGraceHours'];
    const data = {};
    for (const f of fields) {
      if (req.body[f] != null) {
        const n = Number(req.body[f]);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `Invalid value for ${f}` });
        data[f] = n;
      }
    }
    data.updatedBy = req.user?.sub || null;
    const row = await prisma.anomalyThreshold.upsert({
      where: { id: 1 },
      create: { id: 1, ...DEFAULT_THRESHOLDS, ...data },
      update: data,
    });
    await writeAudit({ entityType: 'AnomalyThreshold', entityId: '1', action: 'UPDATE', actor: req.user, req, changedFields: data });
    res.json(row);
  } catch (err) { next(err); }
});

/**
 * Run a sweep for a date range. For every attendance record in the window
 * (plus AWOL-detection over rostered employees who have NO record), upsert
 * the resulting anomaly rows. Also runs MONTHLY_OT_BREACH per (employee,
 * month) if the window covers any full or partial month.
 *
 * @param {object} args  { from, to, now } — Dates
 * @returns {object}     { swept, created, updated, byType: {...} }
 */
async function runAnomalySweep({ from, to, now = new Date() } = {}) {
  if (!(from instanceof Date) || !(to instanceof Date)) {
    throw new Error('runAnomalySweep requires from + to Date objects');
  }
  const thresholds = await loadThresholds();
  const byType = Object.fromEntries(Object.values(ANOMALY_TYPES).map(t => [t, 0]));
  let created = 0;
  let updated = 0;

  // 1. Per-record anomalies
  const records = await prisma.attendanceRecord.findMany({
    where: { date: { gte: from, lte: to } },
  });

  for (const record of records) {
    const detected = detectAnomaliesForRecord(record, { thresholds, now });
    for (const a of detected) {
      const recordDate = new Date(record.date);
      recordDate.setUTCHours(0, 0, 0, 0);
      const result = await prisma.attendanceAnomaly.upsert({
        where: { employeeId_date_type: { employeeId: record.employeeId, date: recordDate, type: a.type } },
        create: {
          id: uuidv4(),
          employeeId: record.employeeId,
          date: recordDate,
          type: a.type,
          severity: a.severity,
          message: a.message,
          detail: a.detail,
          recordId: record.id,
        },
        update: {
          // Refresh message + detail in case thresholds changed; keep status/ack/explain fields untouched.
          severity: a.severity,
          message: a.message,
          detail: a.detail,
          recordId: record.id,
        },
      });
      byType[a.type] += 1;
      if (result.detectedAt.getTime() === result.updatedAt.getTime()) created += 1; else updated += 1;
    }
  }

  // 2. AWOL — scheduled-to-work employees with no AttendanceRecord at all
  const rosterEntries = await prisma.rosterEntry.findMany({
    where: { date: { gte: from, lte: to } },
    include: { shiftTemplate: true, workingShift: true, shiftPattern: true },
  });
  const recordKeySet = new Set(records.map(r => `${r.employeeId}|${new Date(r.date).toISOString().slice(0, 10)}`));
  for (const entry of rosterEntries) {
    const dStr = new Date(entry.date).toISOString().slice(0, 10);
    if (recordKeySet.has(`${entry.employeeId}|${dStr}`)) continue;
    // Build a synthetic "no clock-in" record so the engine can decide AWOL.
    const schedule = await resolveSchedule(prisma, entry.employeeId, new Date(entry.date));
    if (!schedule) continue;
    if (now <= new Date(schedule.scheduledEnd)) continue; // day not over yet
    const synthetic = {
      employeeId: entry.employeeId,
      date: entry.date,
      clockIn: null,
      clockOut: null,
      status: 'ABSENT',
      scheduledStart: schedule.scheduledStart,
      scheduledEnd:   schedule.scheduledEnd,
    };
    const detected = detectAnomaliesForRecord(synthetic, { thresholds, now });
    for (const a of detected) {
      const recordDate = new Date(entry.date);
      recordDate.setUTCHours(0, 0, 0, 0);
      const result = await prisma.attendanceAnomaly.upsert({
        where: { employeeId_date_type: { employeeId: entry.employeeId, date: recordDate, type: a.type } },
        create: {
          id: uuidv4(),
          employeeId: entry.employeeId,
          date: recordDate,
          type: a.type,
          severity: a.severity,
          message: a.message,
          detail: a.detail,
        },
        update: { severity: a.severity, message: a.message, detail: a.detail },
      });
      byType[a.type] += 1;
      if (result.detectedAt.getTime() === result.updatedAt.getTime()) created += 1; else updated += 1;
    }
  }

  // 3. MONTHLY_OT_BREACH per (employee, month) covered by the window
  const monthKeys = new Set();
  for (const r of records) {
    const d = new Date(r.date);
    monthKeys.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  for (const monthKey of monthKeys) {
    const [y, m] = monthKey.split('-').map(Number);
    const mStart = new Date(Date.UTC(y, m - 1, 1));
    const mEnd   = new Date(Date.UTC(y, m,   0, 23, 59, 59, 999));
    const monthRecords = await prisma.attendanceRecord.findMany({ where: { date: { gte: mStart, lte: mEnd } } });
    const byEmp = new Map();
    for (const r of monthRecords) {
      if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, []);
      byEmp.get(r.employeeId).push(r);
    }
    for (const [empId, rows] of byEmp.entries()) {
      const breach = detectMonthlyOtBreach(rows, { thresholds, markerDate: mStart });
      if (!breach) continue;
      const result = await prisma.attendanceAnomaly.upsert({
        where: { employeeId_date_type: { employeeId: empId, date: mStart, type: breach.type } },
        create: {
          id: uuidv4(),
          employeeId: empId,
          date: mStart,
          type: breach.type,
          severity: breach.severity,
          message: breach.message,
          detail: breach.detail,
        },
        update: { severity: breach.severity, message: breach.message, detail: breach.detail },
      });
      byType[breach.type] += 1;
      if (result.detectedAt.getTime() === result.updatedAt.getTime()) created += 1; else updated += 1;
    }
  }

  return { swept: records.length, created, updated, byType };
}

// POST /attendance/anomalies/sweep — admin trigger
app.post('/attendance/anomalies/sweep', authenticate, authorize(...ANOMALY_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from and to (YYYY-MM-DD) required' });
    const fromD = new Date(from + 'T00:00:00.000Z');
    const toD   = new Date(to   + 'T23:59:59.999Z');
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime()) || fromD > toD) {
      return res.status(400).json({ error: 'Invalid from/to range' });
    }
    const result = await runAnomalySweep({ from: fromD, to: toD });
    await writeAudit({ entityType: 'AttendanceAnomaly', action: 'SWEEP', actor: req.user, req, changedFields: { from, to, ...result } });
    res.json({ from, to, ...result });
  } catch (err) { next(err); }
});

// GET /attendance/anomalies — list with filters
app.get('/attendance/anomalies', authenticate, authorize(...ANOMALY_VIEW_ROLES), async (req, res, next) => {
  try {
    const { status, type, employeeId, from, to, severity } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (severity) where.severity = severity;
    if (employeeId) where.employeeId = employeeId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from + 'T00:00:00.000Z');
      if (to)   where.date.lte = new Date(to   + 'T23:59:59.999Z');
    }
    // Line managers only see their direct reports — caller must pass employeeIds
    // resolved upstream (or filter client-side from the unrestricted feed).
    const rows = await prisma.attendanceAnomaly.findMany({
      where,
      orderBy: [{ date: 'desc' }, { severity: 'desc' }],
      take: 1000,
    });
    const summary = rows.reduce((acc, r) => {
      acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
      acc.byType[r.type]     = (acc.byType[r.type]     || 0) + 1;
      acc.bySeverity[r.severity] = (acc.bySeverity[r.severity] || 0) + 1;
      return acc;
    }, { byStatus: {}, byType: {}, bySeverity: {} });
    res.json({ total: rows.length, summary, anomalies: rows });
  } catch (err) { next(err); }
});

// PUT /attendance/anomalies/:id/acknowledge
app.put('/attendance/anomalies/:id/acknowledge', authenticate, authorize(...ANOMALY_VIEW_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.attendanceAnomaly.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Anomaly not found' });
    if (existing.status === 'DISMISSED') {
      return res.status(409).json({ error: `Cannot acknowledge an anomaly in status ${existing.status}` });
    }
    const row = await prisma.attendanceAnomaly.update({
      where: { id: req.params.id },
      data: { status: 'ACKNOWLEDGED', acknowledgedBy: req.user?.sub || null, acknowledgedAt: new Date() },
    });
    await writeAudit({ entityType: 'AttendanceAnomaly', entityId: row.id, action: 'ACKNOWLEDGE', actor: req.user, req });
    res.json(row);
  } catch (err) { next(err); }
});

// PUT /attendance/anomalies/:id/explain  { explanation: "..." }
app.put('/attendance/anomalies/:id/explain', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.attendanceAnomaly.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Anomaly not found' });
    if (existing.status === 'DISMISSED') {
      return res.status(409).json({ error: `Cannot explain an anomaly in status ${existing.status}` });
    }
    // Employee may explain own anomaly; managers may explain any (they have the role).
    const role = req.user?.role;
    const ownerByRole = ANOMALY_VIEW_ROLES.includes(role);
    if (!ownerByRole && req.user?.employeeId !== existing.employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const explanation = (req.body?.explanation || '').trim();
    if (!explanation) return res.status(400).json({ error: 'explanation is required' });
    const row = await prisma.attendanceAnomaly.update({
      where: { id: req.params.id },
      data: { status: 'EXPLAINED', explanation, explanationBy: req.user?.sub || null, explanationAt: new Date() },
    });
    await writeAudit({ entityType: 'AttendanceAnomaly', entityId: row.id, action: 'EXPLAIN', actor: req.user, req });
    res.json(row);
  } catch (err) { next(err); }
});

// PUT /attendance/anomalies/:id/dismiss  { reason?: "..." }
app.put('/attendance/anomalies/:id/dismiss', authenticate, authorize(...ANOMALY_VIEW_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.attendanceAnomaly.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Anomaly not found' });
    if (existing.status === 'DISMISSED') {
      return res.status(409).json({ error: 'Already dismissed' });
    }
    const row = await prisma.attendanceAnomaly.update({
      where: { id: req.params.id },
      data: { status: 'DISMISSED', dismissedBy: req.user?.sub || null, dismissedAt: new Date(), dismissReason: req.body?.reason || null },
    });
    await writeAudit({ entityType: 'AttendanceAnomaly', entityId: row.id, action: 'DISMISS', actor: req.user, req });
    res.json(row);
  } catch (err) { next(err); }
});

// POST /attendance/anomalies/manager-summary  — fire daily summary emails
// Body: { date?: 'YYYY-MM-DD' }  (defaults to yesterday)
// Honours x-internal-service-key OR an admin JWT — lets the scheduled task and
// HR Admin both kick it off.
app.post('/attendance/anomalies/manager-summary', async (req, res, next) => {
  try {
    const internal = req.headers['x-internal-service-key'] && req.headers['x-internal-service-key'] === internalKey();
    if (!internal) {
      // Fall through to auth + admin authorize
      return authenticate(req, res, () => {
        const role = req.user?.role;
        if (![ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER].includes(role)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        return dispatchManagerSummary(req, res, next);
      });
    }
    return dispatchManagerSummary(req, res, next);
  } catch (err) { next(err); }
});

async function dispatchManagerSummary(req, res, next) {
  try {
    const targetDate = req.body?.date ? new Date(req.body.date + 'T00:00:00.000Z') : (() => {
      const y = new Date(); y.setUTCDate(y.getUTCDate() - 1); y.setUTCHours(0, 0, 0, 0); return y;
    })();
    const endDate = new Date(targetDate); endDate.setUTCHours(23, 59, 59, 999);
    const pending = await prisma.attendanceAnomaly.findMany({
      where: { date: { gte: targetDate, lte: endDate }, status: 'PENDING' },
    });
    if (!pending.length) return res.json({ date: targetDate.toISOString().slice(0, 10), managersNotified: 0, anomalies: 0 });

    // Group by employeeId then resolve managers
    const byEmp = new Map();
    for (const a of pending) {
      if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, []);
      byEmp.get(a.employeeId).push(a);
    }
    const employeeIds = Array.from(byEmp.keys());
    let employeeMap = new Map();
    try {
      const empRes = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/by-ids?ids=${employeeIds.join(',')}`, {
        headers: { Authorization: req.headers.authorization || '' },
      });
      if (empRes.ok) {
        const list = await empRes.json();
        for (const e of list) employeeMap.set(e.id, e);
      }
    } catch (err) {
      console.error('[anomaly] employee lookup failed:', err.message);
    }

    // Build manager → anomalies map
    const byManager = new Map();
    for (const [empId, list] of byEmp.entries()) {
      const emp = employeeMap.get(empId);
      const managerId = emp?.reportingManagerId;
      if (!managerId) continue;
      if (!byManager.has(managerId)) byManager.set(managerId, []);
      byManager.get(managerId).push({ employee: emp, anomalies: list });
    }

    let notified = 0;
    for (const [managerId, items] of byManager.entries()) {
      const manager = employeeMap.get(managerId) || (await tryFetchEmployee(managerId, req.headers.authorization));
      if (!manager?.workEmail) continue;
      try {
        const totalAnomalies = items.reduce((sum, i) => sum + i.anomalies.length, 0);
        await fetch(`${NOTIFICATION_SERVICE_URL}/notifications/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
          body: JSON.stringify({
            type: 'ATTENDANCE_ANOMALY_DIGEST',
            recipients: [manager.workEmail],
            data: {
              managerName: manager.fullName,
              date: targetDate.toISOString().slice(0, 10),
              totalAnomalies,
              employeeCount: items.length,
              items: items.map(i => ({
                employeeName: i.employee?.fullName || i.employee?.id,
                anomalies: i.anomalies.map(a => ({ type: a.type, severity: a.severity, message: a.message })),
              })),
            },
          }),
        });
        notified += 1;
      } catch (err) {
        console.error('[anomaly] manager notify failed:', err.message);
      }
    }

    res.json({
      date: targetDate.toISOString().slice(0, 10),
      anomalies: pending.length,
      managersNotified: notified,
    });
  } catch (err) { next(err); }
}

async function tryFetchEmployee(id, authHeader) {
  try {
    const r = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/${id}`, { headers: { Authorization: authHeader || '' } });
    if (r.ok) return await r.json();
  } catch (_e) {}
  return null;
}

// ─── TAT-004 Real-Time Today Dashboard ──────────────────────────────────────

/**
 * GET /attendance/today/dashboard
 *
 * Real-time snapshot of today: who's in / on break / WFH / absent / on leave /
 * not yet clocked in. Reads:
 *   - all AttendanceRecord rows for today
 *   - rostered employees (RosterEntry) for today — anyone rostered without
 *     a record falls into NOT_CLOCKED_IN
 *   - leave-service approved leaves for today (best-effort; failure logs)
 */
app.get('/attendance/today/dashboard', authenticate, authorize(...ANOMALY_VIEW_ROLES), async (req, res, next) => {
  try {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(today); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const [records, rosterToday] = await Promise.all([
      prisma.attendanceRecord.findMany({ where: { date: { gte: today, lt: tomorrow } } }),
      prisma.rosterEntry.findMany({ where: { date: { gte: today, lt: tomorrow } } }),
    ]);

    // Optional leave fetch — fail-soft if leave service is unreachable.
    let leaveSet = new Map();
    try {
      const lr = await fetch(`${LEAVE_SERVICE_URL}/leave/internal/on-leave-today`, {
        headers: { 'x-internal-service-key': internalKey() },
      });
      if (lr.ok) {
        const list = await lr.json();
        for (const item of (Array.isArray(list) ? list : [])) {
          leaveSet.set(item.employeeId, item.leaveTypeCode || 'ON_LEAVE');
        }
      }
    } catch (err) {
      console.error('[dashboard] leave fetch failed:', err.message);
    }

    const buckets = { IN: [], OUT: [], WFH: [], LATE: [], ON_LEAVE: [], NOT_CLOCKED_IN: [], PUBLIC_HOLIDAY: [], ABSENT: [] };
    const seen = new Set();

    for (const r of records) {
      const empId = r.employeeId;
      seen.add(empId);
      const entry = rosterToday.find(e => e.employeeId === empId);
      const isWfh = entry?.note?.toLowerCase().includes('wfh') || false;
      if (leaveSet.has(empId)) {
        buckets.ON_LEAVE.push({ employeeId: empId, leaveType: leaveSet.get(empId), recordId: r.id });
      } else if (r.status === 'PUBLIC_HOLIDAY') {
        buckets.PUBLIC_HOLIDAY.push({ employeeId: empId, recordId: r.id });
      } else if (r.status === 'ABSENT') {
        buckets.ABSENT.push({ employeeId: empId, recordId: r.id });
      } else if (r.clockOut) {
        const target = isWfh ? buckets.WFH : buckets.OUT;
        target.push({ employeeId: empId, clockIn: r.clockIn, clockOut: r.clockOut, hoursWorked: r.hoursWorked });
      } else if (r.clockIn) {
        const target = isWfh ? buckets.WFH : buckets.IN;
        target.push({ employeeId: empId, clockIn: r.clockIn, status: r.status });
        if (r.status === 'LATE') buckets.LATE.push({ employeeId: empId, clockIn: r.clockIn });
      } else {
        buckets.NOT_CLOCKED_IN.push({ employeeId: empId, recordId: r.id });
      }
    }

    // Rostered employees with NO record yet
    for (const entry of rosterToday) {
      if (seen.has(entry.employeeId)) continue;
      if (leaveSet.has(entry.employeeId)) {
        buckets.ON_LEAVE.push({ employeeId: entry.employeeId, leaveType: leaveSet.get(entry.employeeId) });
      } else {
        buckets.NOT_CLOCKED_IN.push({ employeeId: entry.employeeId, scheduled: true });
      }
    }

    const summary = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
    res.json({
      date: today.toISOString().slice(0, 10),
      generatedAt: now.toISOString(),
      summary,
      buckets,
    });
  } catch (err) { next(err); }
});

// ─── Scheduled daily anomaly sweep ───────────────────────────────────────────
// Runs at 00:30 SGT every day — sweeps the prior day. Best-effort: errors are
// logged, the scheduler stays alive.
function scheduleDailyAnomalySweep() {
  if (process.env.NODE_ENV === 'test') return;
  const sgtOffsetMs = 8 * 60 * 60 * 1000;
  function msUntilNext0030Sgt() {
    const nowMs   = Date.now();
    const sgtNow  = new Date(nowMs + sgtOffsetMs);
    const target  = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), sgtNow.getUTCDate(), 0, 30, 0, 0));
    if (target <= sgtNow) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - sgtNow.getTime();
  }
  async function tick() {
    try {
      const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1); yesterday.setUTCHours(0, 0, 0, 0);
      const yEnd      = new Date(yesterday); yEnd.setUTCHours(23, 59, 59, 999);
      const result = await runAnomalySweep({ from: yesterday, to: yEnd });
      console.log(`[anomaly-sweep] ${yesterday.toISOString().slice(0,10)} created=${result.created} updated=${result.updated} byType=${JSON.stringify(result.byType)}`);
    } catch (err) {
      console.error('[anomaly-sweep] failed:', err.message);
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }
  setTimeout(tick, msUntilNext0030Sgt());
  console.log('[anomaly-sweep] daily scheduler armed for 00:30 SGT');
}

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });

if (require.main === module) {
  app.listen(PORT, () => console.log(`[attendance-service] Running on port ${PORT}`));
  scheduleDailyAnomalySweep();
}

module.exports = app;
module.exports.runAnomalySweep = runAnomalySweep;
