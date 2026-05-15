#!/usr/bin/env node
'use strict';

/**
 * Attendance Seed Script — covers ALL scheduling types in the system:
 *   shift_templates, work_locations, employee_work_locations,
 *   shift_projects, working_shifts, shift_patterns,
 *   shift_assignments, project_members, schedules,
 *   roster_entries, attendance_records
 *
 * Run from repo root: node scripts/seed-attendance.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const HOST = process.env.POSTGRES_HOST === 'postgres' ? 'localhost' : (process.env.POSTGRES_HOST || 'localhost');
const PORT = parseInt(process.env.POSTGRES_PORT) || 5432;
const USER = process.env.POSTGRES_USER || 'hrms';
const PASS = process.env.POSTGRES_PASSWORD || 'hrms_secret_2025';

function db() { return new Client({ host: HOST, port: PORT, user: USER, password: PASS, database: 'hrms_attendance' }); }

// ── Date helpers ───────────────────────────────────────────────────────────────
function dateUTC(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
function addDays(d, n)     { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; }
function isoDate(d)        { return d.toISOString().slice(0, 10); }

// All dates relative to today (2026-05-15 in this env)
const TODAY    = new Date(); TODAY.setUTCHours(0, 0, 0, 0);
const MONDAY   = (() => { const d = new Date(TODAY); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; })();

// Singapore public holidays that fall in our attendance window
const SG_PUBLIC_HOLIDAYS = new Set(['2025-01-01','2025-01-29','2025-01-30','2025-03-31','2025-04-18','2025-05-01','2025-06-06','2025-08-09','2025-10-20','2025-12-25','2026-01-01','2026-01-29','2026-01-30']);

// ── Employee map (hardcoded from prior seed) ────────────────────────────────────
const EMP = {
  // Engineering
  WEI_JING:   'bbb912ee-9826-4751-b10e-c8694df914c1',
  PRIYA:      'fc456639-850a-4110-a08d-58805bffd4e9',
  AHMAD:      '1940c5e5-d363-481e-8098-03f60eb07058',
  MARCUS:     '41d03b61-2d98-411a-bce9-ba2f2e6d8057',
  RAVI:       '973fd3f9-e940-490d-be59-0da09eabd9ef',
  // HR
  RACHEL:     '5a866a6e-cd7e-4191-8173-8ef399c4f1cb',
  SITI:       '93aecbe9-be6a-45bd-a3b4-89d24e1466bb',
  // Finance
  DAVID:      'be987544-dd90-411a-b72c-8178cee8ad1d',
  KAVITHA:    '04944233-bbd2-4e46-aae3-4b2b29fc2546',
  // Operations
  JAMES:      'c3897387-e6a3-443a-a60f-3baa8a3557cb',
  NURUL:      '4b0923b0-9c58-4282-99d7-cce93aaa84e0',
  // Sales
  BRANDON:    '3f88bb2b-adce-4cb7-83ba-57b2a3744948',
  JASMINE:    'e3f82d55-2759-4570-9e89-7f467dbfac5f',
  // Marketing
  SOPHIA:     '9bb07fff-9d19-4894-877e-6e21e3d0c084',
  ETHAN:      '2f1e63d6-1bd6-4f7b-bf67-316b0e6422e9',
};

const ALL_EMPS = Object.values(EMP);

// ── 1. SHIFT TEMPLATES (simple standalone shifts — used by basic roster/schedules) ──
// These are single-occurrence or ad-hoc shifts not tied to a project.
const SHIFT_TEMPLATES = [
  { id: uuidv4(), name: 'Standard Office',  startTime: '09:00', endTime: '18:00', breakMinutes: 60, hoursPerDay: 8,   color: '#6366f1' },
  { id: uuidv4(), name: 'Early Shift',       startTime: '07:00', endTime: '15:00', breakMinutes: 60, hoursPerDay: 7,   color: '#10b981' },
  { id: uuidv4(), name: 'Late Shift',        startTime: '14:00', endTime: '22:00', breakMinutes: 60, hoursPerDay: 7.5, color: '#f59e0b' },
  { id: uuidv4(), name: 'Night Shift',       startTime: '22:00', endTime: '06:00', breakMinutes: 60, hoursPerDay: 7.5, color: '#8b5cf6' },
  { id: uuidv4(), name: 'Half Day AM',       startTime: '09:00', endTime: '13:00', breakMinutes: 0,  hoursPerDay: 4,   color: '#06b6d4' },
  { id: uuidv4(), name: 'Half Day PM',       startTime: '13:30', endTime: '18:00', breakMinutes: 0,  hoursPerDay: 4.5, color: '#84cc16' },
  { id: uuidv4(), name: 'Compressed (4-day)',startTime: '08:00', endTime: '19:00', breakMinutes: 60, hoursPerDay: 10,  color: '#ec4899' },
  { id: uuidv4(), name: 'Flexi-Hours',       startTime: '08:00', endTime: '20:00', breakMinutes: 60, hoursPerDay: 8,   color: '#14b8a6' },
];

// ── 2. WORK LOCATIONS (geofenced clock-in points) ────────────────────────────────
const WORK_LOCATIONS = [
  { id: uuidv4(), name: 'HQ – Raffles Place', postalCode: '048621', address: '1 Raffles Place, Tower 1, Singapore 048621', latitude: 1.2840, longitude: 103.8510, radiusMetres: 150 },
  { id: uuidv4(), name: 'One-North Office',   postalCode: '138589', address: '1 Fusionopolis Place, Galaxis, Singapore 138589', latitude: 1.2994, longitude: 103.7870, radiusMetres: 200 },
  { id: uuidv4(), name: 'Client Site – MBS',  postalCode: '018956', address: '10 Bayfront Ave, Marina Bay Sands, Singapore 018956', latitude: 1.2834, longitude: 103.8607, radiusMetres: 300 },
  { id: uuidv4(), name: 'Warehouse – Tuas',   postalCode: '637143', address: '51 Tuas South Ave 1, Singapore 637143', latitude: 1.2836, longitude: 103.6390, radiusMetres: 250 },
];

// ── 3. SHIFT PROJECTS ────────────────────────────────────────────────────────────
// Three distinct project types demonstrating all scheduling types:
//   Project A: Mon-Fri standard corporate (WorkingShift, recurring)
//   Project B: Operations 24/7 (WorkingShifts with rotating patterns — ShiftPattern)
//   Project C: Weekend & Ad-hoc coverage (WorkingShift + ShiftPattern)

const PROJECT_IDS = { corp: uuidv4(), ops247: uuidv4(), weekend: uuidv4() };

// Working shifts (recurring weekly, day-of-week controlled)
const WORKING_SHIFTS = [
  // Corporate project
  { id: uuidv4(), projectId: PROJECT_IDS.corp,    name: 'Mon–Fri Standard',     workMon:true, workTue:true, workWed:true, workThu:true, workFri:true,  workSat:false, workSun:false, startTime:'09:00', endTime:'18:00', breakMinutes:60, hoursPerDay:8,   color:'#6366f1', isRecurring:true },
  { id: uuidv4(), projectId: PROJECT_IDS.corp,    name: 'Mon–Fri Flexi',         workMon:true, workTue:true, workWed:true, workThu:true, workFri:true,  workSat:false, workSun:false, startTime:'08:00', endTime:'17:00', breakMinutes:60, hoursPerDay:8,   color:'#14b8a6', isRecurring:true },
  // Ops 24/7 project — three shift rotations
  { id: uuidv4(), projectId: PROJECT_IDS.ops247,  name: 'Ops Morning (06–14)',   workMon:true, workTue:true, workWed:true, workThu:true, workFri:true,  workSat:true,  workSun:true,  startTime:'06:00', endTime:'14:00', breakMinutes:30, hoursPerDay:7.5, color:'#10b981', isRecurring:true },
  { id: uuidv4(), projectId: PROJECT_IDS.ops247,  name: 'Ops Afternoon (14–22)', workMon:true, workTue:true, workWed:true, workThu:true, workFri:true,  workSat:true,  workSun:true,  startTime:'14:00', endTime:'22:00', breakMinutes:30, hoursPerDay:7.5, color:'#f59e0b', isRecurring:true },
  { id: uuidv4(), projectId: PROJECT_IDS.ops247,  name: 'Ops Night (22–06)',     workMon:true, workTue:true, workWed:true, workThu:true, workFri:true,  workSat:true,  workSun:true,  startTime:'22:00', endTime:'06:00', breakMinutes:30, hoursPerDay:7.5, color:'#8b5cf6', isRecurring:true },
  // Weekend project
  { id: uuidv4(), projectId: PROJECT_IDS.weekend, name: 'Weekend Day',           workMon:false,workTue:false,workWed:false,workThu:false,workFri:false, workSat:true,  workSun:true,  startTime:'09:00', endTime:'17:00', breakMinutes:60, hoursPerDay:7,   color:'#ec4899', isRecurring:true },
  { id: uuidv4(), projectId: PROJECT_IDS.weekend, name: 'Sat Only Coverage',     workMon:false,workTue:false,workWed:false,workThu:false,workFri:false, workSat:true,  workSun:false, startTime:'10:00', endTime:'18:00', breakMinutes:60, hoursPerDay:7,   color:'#f43f5e', isRecurring:true },
];

// Shift patterns (rotating cycle, e.g. 4-on-4-off)
const SHIFT_PATTERNS = [
  { id: uuidv4(), projectId: PROJECT_IDS.ops247,  name: '5-On 2-Off (Day)',     patternType:'STANDARD', workDays:5, offDays:2, startTime:'08:00', endTime:'16:00', breakMinutes:60, hoursPerShift:7, color:'#10b981' },
  { id: uuidv4(), projectId: PROJECT_IDS.ops247,  name: '4-On 4-Off (Night)',   patternType:'ROTATING', workDays:4, offDays:4, startTime:'22:00', endTime:'06:00', breakMinutes:30, hoursPerShift:7.5, color:'#8b5cf6' },
  { id: uuidv4(), projectId: PROJECT_IDS.ops247,  name: '4-On 2-Off (Ops)',     patternType:'ROTATING', workDays:4, offDays:2, startTime:'14:00', endTime:'22:00', breakMinutes:30, hoursPerShift:7.5, color:'#f59e0b' },
  { id: uuidv4(), projectId: PROJECT_IDS.weekend, name: '2-On 5-Off (Weekend)', patternType:'CUSTOM',   workDays:2, offDays:5, startTime:'09:00', endTime:'17:00', breakMinutes:60, hoursPerShift:7,  color:'#ec4899' },
];

// ── Helper: generate workdays in a range (skip weekends + SG PHs) ──────────────
function workdaysInRange(start, end) {
  const days = []; const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay(); // 0=Sun, 6=Sat
    const iso = isoDate(cur);
    if (dow !== 0 && dow !== 6 && !SG_PUBLIC_HOLIDAYS.has(iso)) days.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// All calendar days in range (for ops/weekend shifts)
function allDaysInRange(start, end) {
  const days = []; const cur = new Date(start);
  while (cur <= end) { days.push(isoDate(cur)); cur.setUTCDate(cur.getUTCDate() + 1); }
  return days;
}

// ── Generate attendance records ────────────────────────────────────────────────
// 8 weeks back → yesterday; mixes of PRESENT, LATE, ABSENT, HALF_DAY, ON_LEAVE, PUBLIC_HOLIDAY
function generateAttendanceRecords(empId, startDate, endDate) {
  const records = [];
  const cur = new Date(startDate);
  // seed a deterministic pseudo-random per employee
  const empHash = empId.charCodeAt(0) + empId.charCodeAt(4);

  while (cur < endDate) {
    const dow = cur.getUTCDay();
    const iso = isoDate(cur);

    // Skip weekends for standard office workers (handle ops workers separately via caller)
    if (dow === 0 || dow === 6) { cur.setUTCDate(cur.getUTCDate() + 1); continue; }

    // Public holiday
    if (SG_PUBLIC_HOLIDAYS.has(iso)) {
      records.push({ empId, date: iso, status: 'PUBLIC_HOLIDAY', clockIn: null, clockOut: null, hoursWorked: 0, otHours: 0 });
      cur.setUTCDate(cur.getUTCDate() + 1); continue;
    }

    // Deterministic variety based on day offset + empHash
    const offset = Math.abs(Math.round((cur - startDate) / 86400000));
    const roll = (offset * 17 + empHash * 13) % 100;

    let status, clockIn, clockOut, hoursWorked, otHours = 0, notes = null;

    if (roll < 3) {
      // ABSENT
      status = 'ABSENT'; clockIn = null; clockOut = null; hoursWorked = 0;
      notes = 'Unplanned absence';
    } else if (roll < 6) {
      // ON_LEAVE
      status = 'ON_LEAVE'; clockIn = null; clockOut = null; hoursWorked = 0;
      notes = 'Annual leave';
    } else if (roll < 9) {
      // HALF_DAY
      status = 'HALF_DAY';
      clockIn  = new Date(`${iso}T09:00:00+08:00`);
      clockOut = new Date(`${iso}T13:00:00+08:00`);
      hoursWorked = 4; otHours = 0;
    } else if (roll < 16) {
      // LATE (after 09:15)
      const lateMin = 15 + ((offset + empHash) % 45); // 15–59 min late
      const ciH = 9, ciM = lateMin;
      status = 'LATE';
      clockIn  = new Date(`${iso}T0${ciH}:${String(ciM).padStart(2,'0')}:00+08:00`);
      clockOut = new Date(`${iso}T${roll < 12 ? '18':'19'}:00:00+08:00`);
      hoursWorked = parseFloat(((clockOut - clockIn) / 3600000 - 1).toFixed(2)); // minus 1h break
      otHours = Math.max(0, hoursWorked - 8);
    } else if (roll < 25) {
      // OVERTIME day (leave late)
      status = 'PRESENT';
      const otExtra = 1 + ((offset + empHash) % 3); // 1–3 hours OT
      clockIn  = new Date(`${iso}T09:00:00+08:00`);
      clockOut = new Date(`${iso}T${(18 + otExtra).toString().padStart(2,'0')}:00:00+08:00`);
      hoursWorked = parseFloat(((clockOut - clockIn) / 3600000 - 1).toFixed(2));
      otHours = parseFloat((hoursWorked - 8).toFixed(2));
    } else {
      // PRESENT — normal day
      status = 'PRESENT';
      const minVar = ((offset + empHash) % 10) - 5; // ±5 min clock-in variation
      const ciMin = Math.max(0, Math.min(14, minVar < 0 ? 0 : minVar)); // 0–14 min (on time)
      clockIn  = new Date(`${iso}T09:${String(ciMin).padStart(2,'0')}:00+08:00`);
      const coVar = ((offset + empHash) % 6); // 0–5 min early/late clock-out
      clockOut = new Date(`${iso}T18:${String(coVar).padStart(2,'0')}:00+08:00`);
      hoursWorked = parseFloat(((clockOut - clockIn) / 3600000 - 1).toFixed(2));
      otHours = 0;
    }

    records.push({ empId, date: iso, status, clockIn, clockOut, hoursWorked, otHours, notes });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return records;
}

// Ops workers (James, Nurul) get shift-based records including weekends
function generateOpsAttendanceRecords(empId, startDate, endDate) {
  const records = [];
  const cur = new Date(startDate);
  const empHash = empId.charCodeAt(0) + empId.charCodeAt(4);

  while (cur < endDate) {
    const iso = isoDate(cur);
    if (SG_PUBLIC_HOLIDAYS.has(iso)) {
      records.push({ empId, date: iso, status: 'PUBLIC_HOLIDAY', clockIn: null, clockOut: null, hoursWorked: 0, otHours: 0, notes: null });
      cur.setUTCDate(cur.getUTCDate() + 1); continue;
    }
    const offset = Math.abs(Math.round((cur - startDate) / 86400000));
    // ops: 4-on 2-off cycle
    const cyclePos = offset % 6;
    if (cyclePos >= 4) { cur.setUTCDate(cur.getUTCDate() + 1); continue; } // off day

    const roll = (offset * 17 + empHash * 13) % 100;
    let status, clockIn, clockOut, hoursWorked, otHours = 0, notes = null;
    // Ops morning shift 06:00–14:00
    if (roll < 4) { status = 'ABSENT'; clockIn=null; clockOut=null; hoursWorked=0; notes='Absent'; }
    else if (roll < 8) { status = 'LATE'; clockIn=new Date(`${iso}T06:${20+(roll%20)}:00+08:00`); clockOut=new Date(`${iso}T14:00:00+08:00`); hoursWorked=7; otHours=0; }
    else { status='PRESENT'; clockIn=new Date(`${iso}T06:00:00+08:00`); clockOut=new Date(`${iso}T14:${(offset%5).toString().padStart(2,'0')}:00+08:00`); hoursWorked=7.5; otHours=0; }

    records.push({ empId, date: iso, status, clockIn, clockOut, hoursWorked, otHours, notes });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return records;
}

// ── Main seed ──────────────────────────────────────────────────────────────────
async function seedAttendance() {
  const client = db();
  await client.connect();

  try {
    // ── 1. Shift Templates ────────────────────────────────────────────────────
    let tmplIds = {};
    let tmplCount = 0;
    for (const t of SHIFT_TEMPLATES) {
      const ex = await client.query(`SELECT id FROM shift_templates WHERE name = $1`, [t.name]);
      if (ex.rows.length > 0) { tmplIds[t.name] = ex.rows[0].id; continue; }
      await client.query(
        `INSERT INTO shift_templates (id, name, "startTime", "endTime", "breakMinutes", "hoursPerDay", color, "isActive", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW())`,
        [t.id, t.name, t.startTime, t.endTime, t.breakMinutes, t.hoursPerDay, t.color]
      );
      tmplIds[t.name] = t.id;
      tmplCount++;
    }
    console.log(`  ✅ ${tmplCount} shift templates seeded`);

    // ── 2. Work Locations ─────────────────────────────────────────────────────
    let locIds = {};
    let locCount = 0;
    for (const l of WORK_LOCATIONS) {
      const ex = await client.query(`SELECT id FROM work_locations WHERE name = $1`, [l.name]);
      if (ex.rows.length > 0) { locIds[l.name] = ex.rows[0].id; continue; }
      await client.query(
        `INSERT INTO work_locations (id, name, "postalCode", address, latitude, longitude, "radiusMetres", "isActive", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW())`,
        [l.id, l.name, l.postalCode, l.address, l.latitude, l.longitude, l.radiusMetres]
      );
      locIds[l.name] = l.id;
      locCount++;
    }
    console.log(`  ✅ ${locCount} work locations seeded`);

    // ── 3. Employee ↔ Work Location assignments ───────────────────────────────
    const mainHQ  = locIds['HQ – Raffles Place'];
    const oneNorth = locIds['One-North Office'];
    const mbs     = locIds['Client Site – MBS'];
    const tuas    = locIds['Warehouse – Tuas'];

    const empLocMap = [
      // Engineering — HQ primary + One-North secondary
      { empId: EMP.WEI_JING, locId: mainHQ,    isPrimary: true  },
      { empId: EMP.WEI_JING, locId: oneNorth,  isPrimary: false },
      { empId: EMP.PRIYA,    locId: mainHQ,    isPrimary: true  },
      { empId: EMP.AHMAD,    locId: mainHQ,    isPrimary: true  },
      { empId: EMP.MARCUS,   locId: oneNorth,  isPrimary: true  },
      { empId: EMP.RAVI,     locId: oneNorth,  isPrimary: true  },
      // HR — HQ only
      { empId: EMP.RACHEL,   locId: mainHQ,    isPrimary: true  },
      { empId: EMP.SITI,     locId: mainHQ,    isPrimary: true  },
      // Finance — HQ
      { empId: EMP.DAVID,    locId: mainHQ,    isPrimary: true  },
      { empId: EMP.KAVITHA,  locId: mainHQ,    isPrimary: true  },
      // Operations — HQ + Warehouse
      { empId: EMP.JAMES,    locId: mainHQ,    isPrimary: true  },
      { empId: EMP.JAMES,    locId: tuas,      isPrimary: false },
      { empId: EMP.NURUL,    locId: tuas,      isPrimary: true  },
      { empId: EMP.NURUL,    locId: mainHQ,    isPrimary: false },
      // Sales — HQ + Client site
      { empId: EMP.BRANDON,  locId: mainHQ,    isPrimary: true  },
      { empId: EMP.BRANDON,  locId: mbs,       isPrimary: false },
      { empId: EMP.JASMINE,  locId: mainHQ,    isPrimary: true  },
      // Marketing — HQ + One-North
      { empId: EMP.SOPHIA,   locId: mainHQ,    isPrimary: true  },
      { empId: EMP.ETHAN,    locId: oneNorth,  isPrimary: true  },
    ];

    let ewlCount = 0;
    for (const a of empLocMap) {
      const ex = await client.query(`SELECT id FROM employee_work_locations WHERE "employeeId"=$1 AND "workLocationId"=$2`, [a.empId, a.locId]);
      if (ex.rows.length > 0) continue;
      await client.query(
        `INSERT INTO employee_work_locations (id, "employeeId", "workLocationId", "isPrimary", "createdAt")
         VALUES ($1,$2,$3,$4,NOW())`,
        [uuidv4(), a.empId, a.locId, a.isPrimary]
      );
      ewlCount++;
    }
    console.log(`  ✅ ${ewlCount} employee work locations assigned`);

    // ── 4. Shift Projects ─────────────────────────────────────────────────────
    const projectDefs = [
      { id: PROJECT_IDS.corp,    name: 'Corporate Schedule',   description: 'Standard Mon–Fri office schedule for all HQ staff' },
      { id: PROJECT_IDS.ops247,  name: 'Operations 24/7',      description: 'Round-the-clock operations shift rotations' },
      { id: PROJECT_IDS.weekend, name: 'Weekend Coverage',     description: 'Sales and marketing weekend cover schedule' },
    ];
    let projCount = 0;
    const resolvedProjectIds = {};
    for (const p of projectDefs) {
      const ex = await client.query(`SELECT id FROM shift_projects WHERE name = $1`, [p.name]);
      if (ex.rows.length > 0) { resolvedProjectIds[p.id] = ex.rows[0].id; continue; }
      await client.query(
        `INSERT INTO shift_projects (id, name, description, "isActive", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,true,NOW(),NOW())`,
        [p.id, p.name, p.description]
      );
      resolvedProjectIds[p.id] = p.id;
      projCount++;
    }
    console.log(`  ✅ ${projCount} shift projects seeded`);

    // ── 5. Working Shifts (recurring weekly, day-controlled) ─────────────────
    let wsCount = 0;
    const wsIds = {};
    for (const ws of WORKING_SHIFTS) {
      const ex = await client.query(`SELECT id FROM working_shifts WHERE name=$1 AND "projectId"=$2`, [ws.name, ws.projectId]);
      if (ex.rows.length > 0) { wsIds[ws.name] = ex.rows[0].id; continue; }
      await client.query(
        `INSERT INTO working_shifts
          (id, "projectId", name, "workMon","workTue","workWed","workThu","workFri","workSat","workSun",
           "startTime","endTime","breakMinutes","hoursPerDay",color,"isRecurring","isActive","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,NOW(),NOW())`,
        [ws.id, ws.projectId, ws.name, ws.workMon, ws.workTue, ws.workWed, ws.workThu, ws.workFri, ws.workSat, ws.workSun,
         ws.startTime, ws.endTime, ws.breakMinutes, ws.hoursPerDay, ws.color, ws.isRecurring]
      );
      wsIds[ws.name] = ws.id;
      wsCount++;
    }
    console.log(`  ✅ ${wsCount} working shifts seeded`);

    // ── 6. Shift Patterns (rotating cycles) ──────────────────────────────────
    let spCount = 0;
    const spIds = {};
    for (const sp of SHIFT_PATTERNS) {
      const ex = await client.query(`SELECT id FROM shift_patterns WHERE name=$1 AND "projectId"=$2`, [sp.name, sp.projectId]);
      if (ex.rows.length > 0) { spIds[sp.name] = ex.rows[0].id; continue; }
      await client.query(
        `INSERT INTO shift_patterns
          (id, "projectId", name, "patternType", "workDays", "offDays",
           "startTime","endTime","breakMinutes","hoursPerShift",color,"isActive","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,NOW(),NOW())`,
        [sp.id, sp.projectId, sp.name, sp.patternType, sp.workDays, sp.offDays,
         sp.startTime, sp.endTime, sp.breakMinutes, sp.hoursPerShift, sp.color]
      );
      spIds[sp.name] = sp.id;
      spCount++;
    }
    console.log(`  ✅ ${spCount} shift patterns seeded`);

    // ── 7. Shift Assignments (employee → working shift or pattern) ────────────
    // Corporate Mon-Fri shift: Engineering, HR, Finance, Marketing
    const corpShiftId   = wsIds['Mon–Fri Standard']   || WORKING_SHIFTS.find(w=>w.name==='Mon–Fri Standard')?.id;
    const corpFlexiId   = wsIds['Mon–Fri Flexi']       || WORKING_SHIFTS.find(w=>w.name==='Mon–Fri Flexi')?.id;
    const opsMorningId  = wsIds['Ops Morning (06–14)'] || WORKING_SHIFTS.find(w=>w.name==='Ops Morning (06–14)')?.id;
    const opsAfternoonId= wsIds['Ops Afternoon (14–22)']|| WORKING_SHIFTS.find(w=>w.name==='Ops Afternoon (14–22)')?.id;
    const weekendDayId  = wsIds['Weekend Day']         || WORKING_SHIFTS.find(w=>w.name==='Weekend Day')?.id;
    const ops4on2offId  = spIds['4-On 2-Off (Ops)']   || SHIFT_PATTERNS.find(p=>p.name==='4-On 2-Off (Ops)')?.id;
    const nightPatternId= spIds['4-On 4-Off (Night)'] || SHIFT_PATTERNS.find(p=>p.name==='4-On 4-Off (Night)')?.id;
    const weekendPatId  = spIds['2-On 5-Off (Weekend)']|| SHIFT_PATTERNS.find(p=>p.name==='2-On 5-Off (Weekend)')?.id;

    const ASSIGN_START = addDays(MONDAY, -56); // 8 weeks ago

    const shiftAssignments = [
      // Type 1: Working Shift (Mon–Fri recurring)
      { empId: EMP.WEI_JING,  workingShiftId: corpShiftId,    shiftPatternId: null },
      { empId: EMP.PRIYA,     workingShiftId: corpShiftId,    shiftPatternId: null },
      { empId: EMP.AHMAD,     workingShiftId: corpShiftId,    shiftPatternId: null },
      { empId: EMP.MARCUS,    workingShiftId: corpFlexiId,    shiftPatternId: null }, // flexi
      { empId: EMP.RACHEL,    workingShiftId: corpShiftId,    shiftPatternId: null },
      { empId: EMP.SITI,      workingShiftId: corpShiftId,    shiftPatternId: null },
      { empId: EMP.DAVID,     workingShiftId: corpShiftId,    shiftPatternId: null },
      { empId: EMP.KAVITHA,   workingShiftId: corpFlexiId,    shiftPatternId: null }, // flexi
      { empId: EMP.SOPHIA,    workingShiftId: corpShiftId,    shiftPatternId: null },
      { empId: EMP.ETHAN,     workingShiftId: corpFlexiId,    shiftPatternId: null },
      // Type 2: Ops working shifts (round-the-clock)
      { empId: EMP.JAMES,     workingShiftId: opsMorningId,   shiftPatternId: null },
      { empId: EMP.NURUL,     workingShiftId: opsAfternoonId, shiftPatternId: null },
      // Type 3: Shift Pattern (rotating 4-on-2-off)
      { empId: EMP.RAVI,      workingShiftId: null,           shiftPatternId: ops4on2offId },
      // Type 4: Sales — weekend pattern for coverage
      { empId: EMP.BRANDON,   workingShiftId: weekendDayId,   shiftPatternId: null },
      { empId: EMP.JASMINE,   workingShiftId: null,           shiftPatternId: weekendPatId },
    ];

    let saCount = 0;
    for (const a of shiftAssignments) {
      const ex = await client.query(
        `SELECT id FROM shift_assignments WHERE "employeeId"=$1 AND ("workingShiftId"=$2 OR "shiftPatternId"=$3)`,
        [a.empId, a.workingShiftId, a.shiftPatternId]
      );
      if (ex.rows.length > 0) continue;
      await client.query(
        `INSERT INTO shift_assignments (id, "employeeId", "workingShiftId", "shiftPatternId", "startDate", "createdAt")
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [uuidv4(), a.empId, a.workingShiftId, a.shiftPatternId, ASSIGN_START]
      );
      saCount++;
    }
    console.log(`  ✅ ${saCount} shift assignments seeded`);

    // ── 8. Project Members ────────────────────────────────────────────────────
    const projMemberMap = [
      // Corporate project members
      ...[EMP.WEI_JING, EMP.PRIYA, EMP.AHMAD, EMP.RACHEL, EMP.SITI, EMP.DAVID, EMP.KAVITHA, EMP.SOPHIA, EMP.ETHAN]
        .map(empId => ({ projectId: PROJECT_IDS.corp, empId, workingShiftId: corpShiftId, shiftPatternId: null })),
      { projectId: PROJECT_IDS.corp, empId: EMP.MARCUS,  workingShiftId: corpFlexiId,  shiftPatternId: null },
      // Ops project members
      { projectId: PROJECT_IDS.ops247, empId: EMP.JAMES,  workingShiftId: opsMorningId,   shiftPatternId: null },
      { projectId: PROJECT_IDS.ops247, empId: EMP.NURUL,  workingShiftId: opsAfternoonId,  shiftPatternId: null },
      { projectId: PROJECT_IDS.ops247, empId: EMP.RAVI,   workingShiftId: null,            shiftPatternId: ops4on2offId },
      // Weekend project members
      { projectId: PROJECT_IDS.weekend, empId: EMP.BRANDON, workingShiftId: weekendDayId, shiftPatternId: null },
      { projectId: PROJECT_IDS.weekend, empId: EMP.JASMINE, workingShiftId: null,          shiftPatternId: weekendPatId },
    ];

    let pmCount = 0;
    for (const m of projMemberMap) {
      const ex = await client.query(`SELECT id FROM project_members WHERE "projectId"=$1 AND "employeeId"=$2`, [m.projectId, m.empId]);
      if (ex.rows.length > 0) continue;
      await client.query(
        `INSERT INTO project_members (id, "projectId", "employeeId", "workingShiftId", "shiftPatternId", "startDate", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [uuidv4(), m.projectId, m.empId, m.workingShiftId, m.shiftPatternId, ASSIGN_START]
      );
      pmCount++;
    }
    console.log(`  ✅ ${pmCount} project members seeded`);

    // ── 9. Schedules (legacy employee-level schedule assignments) ─────────────
    // A Schedule links an employee to a ShiftTemplate for a date range (distinct from roster)
    const SCHED_START = addDays(MONDAY, -56);
    const schedules = [
      // Standard office workers → Standard Office template
      ...[EMP.WEI_JING, EMP.PRIYA, EMP.AHMAD, EMP.RACHEL, EMP.SITI, EMP.DAVID, EMP.KAVITHA, EMP.SOPHIA]
        .map(empId => ({ empId, templateName: 'Standard Office' })),
      // Flexi workers → Flexi-Hours template
      ...[EMP.MARCUS, EMP.ETHAN].map(empId => ({ empId, templateName: 'Flexi-Hours' })),
      // Ops workers → split across shift templates
      { empId: EMP.JAMES, templateName: 'Early Shift' },
      { empId: EMP.NURUL, templateName: 'Late Shift'  },
      // Sales → Standard + weekend
      { empId: EMP.BRANDON, templateName: 'Standard Office' },
      { empId: EMP.JASMINE, templateName: 'Standard Office' },
      // Contract → Compressed
      { empId: EMP.RAVI, templateName: 'Compressed (4-day)' },
    ];

    let schedCount = 0;
    for (const s of schedules) {
      const tid = tmplIds[s.templateName];
      if (!tid) continue;
      const ex = await client.query(`SELECT id FROM schedules WHERE "employeeId"=$1 AND "shiftTemplateId"=$2`, [s.empId, tid]);
      if (ex.rows.length > 0) continue;
      await client.query(
        `INSERT INTO schedules (id, "employeeId", "shiftTemplateId", "startDate", "createdAt")
         VALUES ($1,$2,$3,$4,NOW())`,
        [uuidv4(), s.empId, tid, SCHED_START]
      );
      schedCount++;
    }
    console.log(`  ✅ ${schedCount} schedules seeded`);

    // ── 10. Roster Entries ────────────────────────────────────────────────────
    // Past 8 weeks + current week + next 3 weeks (published future plan)
    const rosterStart = addDays(MONDAY, -56);
    const rosterEnd   = addDays(MONDAY, 20);   // 3 weeks ahead
    const publishedCutoff = addDays(MONDAY, 7); // publish up through next week

    // Map employees to their primary shift/template for roster
    const empRosterShift = {
      [EMP.WEI_JING]: { workingShiftId: corpShiftId,    shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5] },
      [EMP.PRIYA]:    { workingShiftId: corpShiftId,    shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5] },
      [EMP.AHMAD]:    { workingShiftId: corpShiftId,    shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5] },
      [EMP.MARCUS]:   { workingShiftId: corpFlexiId,    shiftTemplateId: tmplIds['Flexi-Hours'],      days: [1,2,3,4,5] },
      [EMP.RACHEL]:   { workingShiftId: corpShiftId,    shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5] },
      [EMP.SITI]:     { workingShiftId: corpShiftId,    shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5] },
      [EMP.DAVID]:    { workingShiftId: corpShiftId,    shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5] },
      [EMP.KAVITHA]:  { workingShiftId: corpFlexiId,    shiftTemplateId: tmplIds['Flexi-Hours'],      days: [1,2,3,4,5] },
      [EMP.SOPHIA]:   { workingShiftId: corpShiftId,    shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5] },
      [EMP.ETHAN]:    { workingShiftId: corpFlexiId,    shiftTemplateId: tmplIds['Flexi-Hours'],      days: [1,2,3,4,5] },
      // Ops morning shift Mon-Sun
      [EMP.JAMES]:    { workingShiftId: opsMorningId,   shiftTemplateId: tmplIds['Early Shift'],      days: [0,1,2,3,4,5,6] },
      [EMP.NURUL]:    { workingShiftId: opsAfternoonId, shiftTemplateId: tmplIds['Late Shift'],       days: [0,1,2,3,4,5,6] },
      // Sales — weekdays + weekend
      [EMP.BRANDON]:  { workingShiftId: weekendDayId,   shiftTemplateId: tmplIds['Standard Office'],  days: [1,2,3,4,5,6,0] },
      [EMP.JASMINE]:  { workingShiftId: weekendDayId,   shiftTemplateId: tmplIds['Half Day AM'],      days: [1,2,3,4,5] },
      // Contract — compressed 4-day
      [EMP.RAVI]:     { workingShiftId: null,            shiftTemplateId: tmplIds['Compressed (4-day)'], days: [1,2,3,4] },
    };

    let rosterCount = 0;
    const cur = new Date(rosterStart);
    while (cur <= rosterEnd) {
      const iso = isoDate(cur);
      const dow = cur.getUTCDay(); // 0=Sun, 6=Sat
      const isPublished = cur <= publishedCutoff;
      const isFuture = cur >= TODAY;

      if (!SG_PUBLIC_HOLIDAYS.has(iso)) {
        for (const [empId, shift] of Object.entries(empRosterShift)) {
          if (!shift.days.includes(dow)) { continue; } // not a working day for this employee

          const ex = await client.query(`SELECT id FROM roster_entries WHERE "employeeId"=$1 AND date=$2`, [empId, iso]);
          if (ex.rows.length > 0) continue;

          // Ops workers use workingShiftId; others use shiftTemplateId
          const isOps = empId === EMP.JAMES || empId === EMP.NURUL;
          const isSalesWeekend = (empId === EMP.BRANDON || empId === EMP.JASMINE) && (dow === 0 || dow === 6);

          await client.query(
            `INSERT INTO roster_entries
              (id, "employeeId", "shiftTemplateId", "workingShiftId", "shiftPatternId",
               date, "locationId", note, "publishedAt", "createdBy", "createdAt", "updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
            [
              uuidv4(), empId,
              isOps || isSalesWeekend ? null : shift.shiftTemplateId,
              isOps || isSalesWeekend ? shift.workingShiftId : null,
              null,
              iso,
              null,
              isFuture && !isPublished ? 'Draft roster' : null,
              isPublished ? new Date() : null,
              'seed',
            ]
          );
          rosterCount++;
        }
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    console.log(`  ✅ ${rosterCount} roster entries seeded (past 8 weeks + current + 3 weeks future)`);

    // ── 11. Attendance Records ────────────────────────────────────────────────
    const attStart = addDays(MONDAY, -56);
    const attEnd   = TODAY; // up to yesterday

    const attEmps = [
      EMP.WEI_JING, EMP.PRIYA, EMP.AHMAD, EMP.MARCUS, EMP.RAVI,
      EMP.RACHEL, EMP.SITI, EMP.DAVID, EMP.KAVITHA,
      EMP.BRANDON, EMP.JASMINE, EMP.SOPHIA, EMP.ETHAN,
    ];
    const opsEmps = [EMP.JAMES, EMP.NURUL];

    let attCount = 0;
    for (const empId of attEmps) {
      const recs = generateAttendanceRecords(empId, attStart, attEnd);
      for (const r of recs) {
        const ex = await client.query(`SELECT id FROM attendance_records WHERE "employeeId"=$1 AND date=$2`, [r.empId, r.date]);
        if (ex.rows.length > 0) continue;
        await client.query(
          `INSERT INTO attendance_records
            (id, "employeeId", date, "clockIn", "clockOut", "hoursWorked", "otHours", status, notes,
             "withinGeofence", "locationName", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [
            uuidv4(), r.empId, r.date, r.clockIn, r.clockOut,
            r.hoursWorked || null, r.otHours || 0, r.status, r.notes,
            r.clockIn ? true : null,
            r.clockIn ? 'HQ – Raffles Place' : null,
          ]
        );
        attCount++;
      }
    }

    for (const empId of opsEmps) {
      const recs = generateOpsAttendanceRecords(empId, attStart, attEnd);
      for (const r of recs) {
        const ex = await client.query(`SELECT id FROM attendance_records WHERE "employeeId"=$1 AND date=$2`, [r.empId, r.date]);
        if (ex.rows.length > 0) continue;
        await client.query(
          `INSERT INTO attendance_records
            (id, "employeeId", date, "clockIn", "clockOut", "hoursWorked", "otHours", status, notes,
             "withinGeofence", "locationName", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [
            uuidv4(), r.empId, r.date, r.clockIn, r.clockOut,
            r.hoursWorked || null, r.otHours || 0, r.status, r.notes,
            r.clockIn ? true : null,
            r.clockIn ? 'Warehouse – Tuas' : null,
          ]
        );
        attCount++;
      }
    }
    console.log(`  ✅ ${attCount} attendance records seeded (8 weeks, all employees)`);

  } finally {
    await client.end();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱 Attendance Seed Script');
  console.log(`   Connecting to postgres at ${HOST}:${PORT}\n`);

  const client = db();
  await client.connect();
  const { rows } = await client.query(`SELECT COUNT(*) FROM attendance_records`);
  await client.end();

  if (parseInt(rows[0].count) > 0) {
    console.log(`ℹ️  Attendance data already exists (${rows[0].count} records) — skipping\n`);
    return;
  }

  await seedAttendance();
  console.log('\n✅ Attendance seed complete!\n');
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
