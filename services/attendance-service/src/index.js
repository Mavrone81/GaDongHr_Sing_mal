'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4007;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'attendance-service', status: 'ok', ts: new Date() }));

// ── Haversine distance (metres) ───────────────────────────────────────────────
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

    // Late detection: after 09:15 SGT
    const sgHour = parseInt(new Intl.DateTimeFormat('en-SG', { hour: 'numeric', hour12: false, timeZone: 'Asia/Singapore' }).format(now));
    const sgMin  = parseInt(new Intl.DateTimeFormat('en-SG', { minute: 'numeric', timeZone: 'Asia/Singapore' }).format(now));
    const isLate = sgHour > 9 || (sgHour === 9 && sgMin >= 15);

    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: empId, date: today } },
      create: {
        id: uuidv4(), employeeId: empId, date: today, clockIn: now,
        status: isLate ? 'LATE' : 'PRESENT',
        clockInLat: latitude ?? null, clockInLng: longitude ?? null,
        withinGeofence: geo.valid, locationName: geo.locationName,
      },
      update: {
        clockIn: now, status: isLate ? 'LATE' : 'PRESENT',
        clockInLat: latitude ?? null, clockInLng: longitude ?? null,
        withinGeofence: geo.valid, locationName: geo.locationName,
      },
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

    const hoursWorked = (now - record.clockIn) / (1000 * 60 * 60);
    const otHours = Math.max(0, hoursWorked - 8);

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        clockOut: now,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
        otHours: Math.round(otHours * 100) / 100,
        clockOutLat: latitude ?? null, clockOutLng: longitude ?? null,
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
const ATTENDANCE_RESERVED = new Set(['shifts', 'roster', 'locations', 'admin', 'records']);
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
    const entry = await prisma.rosterEntry.upsert({
      where: { employeeId_date: { employeeId, date: d } },
      create: { id: uuidv4(), employeeId, date: d, shiftTemplateId: shiftTemplateId || null, workingShiftId: workingShiftId || null, locationId: locationId || null, note: note || null, createdBy: req.user?.sub },
      update: { shiftTemplateId: shiftTemplateId || null, workingShiftId: workingShiftId || null, locationId: locationId || null, note: note || null, updatedBy: req.user?.sub },
      include: { shiftTemplate: true, workingShift: true, shiftPattern: true },
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
    res.json({ ok: true, count });
  } catch (err) { next(err); }
});

// DELETE /roster/entry — clear a single cell
app.delete('/attendance/roster/entry', authenticate, authorize(...ROSTER_ROLES), async (req, res, next) => {
  try {
    const { employeeId, date } = req.body;
    const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
    await prisma.rosterEntry.deleteMany({ where: { employeeId, date: d } });
    res.json({ ok: true });
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
    const created = [];
    for (const employeeId of employeeIds) {
      const existing = await prisma.shiftAssignment.findFirst({ where: { employeeId, workingShiftId: req.params.id } });
      if (!existing) {
        created.push(await prisma.shiftAssignment.create({
          data: { id: uuidv4(), employeeId, workingShiftId: req.params.id, startDate: new Date(startDate), endDate: endDate ? new Date(endDate) : null },
        }));
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
      const existing = await prisma.shiftAssignment.findFirst({ where: { employeeId, shiftPatternId: req.params.id } });
      if (!existing) {
        created.push(await prisma.shiftAssignment.create({
          data: { id: uuidv4(), employeeId, shiftPatternId: req.params.id, startDate: new Date(startDate), endDate: endDate ? new Date(endDate) : null },
        }));
      }
      // Auto-populate 28 days of roster entries using work/off cycle
      const sd = new Date(startDate); sd.setUTCHours(0, 0, 0, 0);
      const lookAheadDays = 28;
      for (let i = 0; i < lookAheadDays; i++) {
        const cur = new Date(sd); cur.setUTCDate(sd.getUTCDate() + i);
        const posInCycle = i % cycleLen;
        if (posInCycle < pattern.workDays) {
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

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[attendance-service] Running on port ${PORT}`));
