'use strict';

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

// ── Employee IDs (from hrms_employee DB) ──────────────────────────────────────
const EMPS = {
  johnDoe:      'a221b4ed-9fab-43c0-9a63-b21e522e1baa',  // Engineering
  sarahTan:     'd026f3a1-aeea-4832-b540-3b1ddcdc87f7',  // HR
  rajeshKumar:  'e5813d39-a3f7-4c77-bf78-5230514c86df',  // Finance
  nurulAin:     'cb2fd9a5-b135-4943-a891-11ebb24f8896',  // Operations
  liWei:        'ca8eb220-581e-4029-a5c3-f872569b2a9b',  // Engineering
  priya:        '962a9cce-540b-4c33-97fe-1fa890bc2fc1',  // Marketing
  faizal:       'b462ddf1-5739-43a7-9c10-c5521ad414af',  // Sales
  chenMei:      '34f1815c-80c4-48c7-b017-d91afb5cc433',  // Engineering
  davidOng:     'ac1d396d-b647-403b-96ed-9bde40d6f9b0',  // Technology
  kavitha:      '80e6a8c2-a0b8-4988-bd22-2fd30f0e166c',  // HR
  michaelTan:   '843a0a61-33c9-4c18-9928-c838996e085b',  // Finance
  sitiRahimah:  '8234101b-84c7-4c8c-b969-42061ffaf6d6',  // Operations
  jamesLim:     '091bd0d7-435a-4cf1-9b06-e5e459ed2ce5',  // Sales
  ananya:       '98f8d416-d69e-4fdd-bbc1-d4d66bd110e9',  // Engineering
  wongJunHao:   '4dc176de-3fd6-41c5-9af3-65205f2df456',  // Marketing
};

// ── Date helpers ──────────────────────────────────────────────────────────────
// Current week: Mon 12 May 2026 … Fri 16 May 2026
function mondayOf(d) {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() - ((day + 6) % 7));
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toDate(d) {
  // Returns a Date with the date part only (time = 00:00:00 UTC)
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

const TODAY    = new Date('2026-05-14T00:00:00Z');
const MON      = mondayOf(TODAY);                   // 2026-05-11
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => addDays(MON, i));

async function main() {
  console.log('Seeding Attendance schedules...\n');

  // ── 1. Shift Templates (simple named slots) ──────────────────────────────
  console.log('Creating shift templates...');
  const templates = await Promise.all([
    prisma.shiftTemplate.upsert({
      where:  { id: 'tpl-standard-0001' },
      update: {},
      create: { id: 'tpl-standard-0001', name: 'Standard Office', startTime: '09:00', endTime: '18:00', breakMinutes: 60, hoursPerDay: 8, color: '#6366f1' },
    }),
    prisma.shiftTemplate.upsert({
      where:  { id: 'tpl-early-000002' },
      update: {},
      create: { id: 'tpl-early-000002', name: 'Early Bird',       startTime: '07:00', endTime: '16:00', breakMinutes: 60, hoursPerDay: 8, color: '#10b981' },
    }),
    prisma.shiftTemplate.upsert({
      where:  { id: 'tpl-late-0000003' },
      update: {},
      create: { id: 'tpl-late-0000003', name: 'Late Shift',       startTime: '13:00', endTime: '22:00', breakMinutes: 60, hoursPerDay: 8, color: '#f59e0b' },
    }),
    prisma.shiftTemplate.upsert({
      where:  { id: 'tpl-half-0000004' },
      update: {},
      create: { id: 'tpl-half-0000004', name: 'Half Day AM',      startTime: '09:00', endTime: '13:00', breakMinutes: 0,  hoursPerDay: 4, color: '#8b5cf6' },
    }),
    prisma.shiftTemplate.upsert({
      where:  { id: 'tpl-ops-00000005' },
      update: {},
      create: { id: 'tpl-ops-00000005', name: 'Ops Morning',      startTime: '06:00', endTime: '14:00', breakMinutes: 30, hoursPerDay: 7.5, color: '#3b82f6' },
    }),
    prisma.shiftTemplate.upsert({
      where:  { id: 'tpl-ops-00000006' },
      update: {},
      create: { id: 'tpl-ops-00000006', name: 'Ops Afternoon',    startTime: '14:00', endTime: '22:00', breakMinutes: 30, hoursPerDay: 7.5, color: '#ec4899' },
    }),
  ]);
  const [stdTpl, earlyTpl, lateTpl, halfTpl, opsMornTpl, opsAftnTpl] = templates;
  templates.forEach(t => console.log(`  ✓ [Template] ${t.name}  ${t.startTime}–${t.endTime}`));

  // ── 2. Shift Projects ─────────────────────────────────────────────────────
  console.log('\nCreating shift projects...');

  const projOffice = await prisma.shiftProject.upsert({
    where:  { id: 'proj-office-00001' },
    update: {},
    create: { id: 'proj-office-00001', name: 'Office Staff', description: 'Standard weekday Mon–Fri office employees across Engineering, Finance, HR, Marketing, Sales, and Technology.' },
  });

  const projOps = await prisma.shiftProject.upsert({
    where:  { id: 'proj-ops-000002' },
    update: {},
    create: { id: 'proj-ops-000002', name: 'Operations Team', description: 'Rotating morning/afternoon shifts covering 06:00–22:00, 7 days a week.' },
  });

  const projSupport = await prisma.shiftProject.upsert({
    where:  { id: 'proj-support-003' },
    update: {},
    create: { id: 'proj-support-003', name: 'Customer Support', description: 'Flexible shifts for the sales & support team including weekend coverage.' },
  });

  console.log(`  ✓ ${projOffice.name}`);
  console.log(`  ✓ ${projOps.name}`);
  console.log(`  ✓ ${projSupport.name}`);

  // ── 3. Working Shifts within each project ─────────────────────────────────
  console.log('\nCreating working shifts...');

  const wsOfficeStd = await prisma.workingShift.upsert({
    where:  { id: 'ws-office-std-01' },
    update: {},
    create: {
      id: 'ws-office-std-01', projectId: projOffice.id,
      name: 'Standard (Mon–Fri)', startTime: '09:00', endTime: '18:00',
      breakMinutes: 60, hoursPerDay: 8, color: '#6366f1',
      workMon: true, workTue: true, workWed: true, workThu: true, workFri: true,
      workSat: false, workSun: false, isRecurring: true,
    },
  });

  const wsOfficeEarly = await prisma.workingShift.upsert({
    where:  { id: 'ws-office-ear-02' },
    update: {},
    create: {
      id: 'ws-office-ear-02', projectId: projOffice.id,
      name: 'Early (Mon–Fri)',     startTime: '07:30', endTime: '16:30',
      breakMinutes: 60, hoursPerDay: 8, color: '#10b981',
      workMon: true, workTue: true, workWed: true, workThu: true, workFri: true,
      workSat: false, workSun: false, isRecurring: true,
    },
  });

  const wsOpsMorn = await prisma.workingShift.upsert({
    where:  { id: 'ws-ops-morn-003' },
    update: {},
    create: {
      id: 'ws-ops-morn-003', projectId: projOps.id,
      name: 'Ops Morning (06–14)', startTime: '06:00', endTime: '14:00',
      breakMinutes: 30, hoursPerDay: 7.5, color: '#3b82f6',
      workMon: true, workTue: true, workWed: true, workThu: true, workFri: true,
      workSat: true, workSun: true, isRecurring: true,
    },
  });

  const wsOpsAftn = await prisma.workingShift.upsert({
    where:  { id: 'ws-ops-aftn-004' },
    update: {},
    create: {
      id: 'ws-ops-aftn-004', projectId: projOps.id,
      name: 'Ops Afternoon (14–22)', startTime: '14:00', endTime: '22:00',
      breakMinutes: 30, hoursPerDay: 7.5, color: '#ec4899',
      workMon: true, workTue: true, workWed: true, workThu: true, workFri: true,
      workSat: true, workSun: true, isRecurring: true,
    },
  });

  const wsSupportFlex = await prisma.workingShift.upsert({
    where:  { id: 'ws-supp-flex-05' },
    update: {},
    create: {
      id: 'ws-supp-flex-05', projectId: projSupport.id,
      name: 'Support Flex (10–19)', startTime: '10:00', endTime: '19:00',
      breakMinutes: 60, hoursPerDay: 8, color: '#f59e0b',
      workMon: true, workTue: true, workWed: true, workThu: true, workFri: true,
      workSat: true, workSun: false, isRecurring: true,
    },
  });

  console.log(`  ✓ [${projOffice.name}] ${wsOfficeStd.name}`);
  console.log(`  ✓ [${projOffice.name}] ${wsOfficeEarly.name}`);
  console.log(`  ✓ [${projOps.name}]   ${wsOpsMorn.name}`);
  console.log(`  ✓ [${projOps.name}]   ${wsOpsAftn.name}`);
  console.log(`  ✓ [${projSupport.name}] ${wsSupportFlex.name}`);

  // ── 4. Shift Patterns ─────────────────────────────────────────────────────
  console.log('\nCreating shift patterns...');

  const patOps4on3off = await prisma.shiftPattern.upsert({
    where:  { id: 'pat-ops-4on3off' },
    update: {},
    create: {
      id: 'pat-ops-4on3off', projectId: projOps.id,
      name: '4-on 3-off (Morning)', patternType: 'ROTATING',
      workDays: 4, offDays: 3,
      startTime: '06:00', endTime: '14:00', breakMinutes: 30, hoursPerShift: 7.5, color: '#14b8a6',
    },
  });

  const patSupport5on2off = await prisma.shiftPattern.upsert({
    where:  { id: 'pat-sup-5on2off' },
    update: {},
    create: {
      id: 'pat-sup-5on2off', projectId: projSupport.id,
      name: '5-on 2-off (Flex)',    patternType: 'CUSTOM',
      workDays: 5, offDays: 2,
      startTime: '10:00', endTime: '19:00', breakMinutes: 60, hoursPerShift: 8,  color: '#f97316',
    },
  });

  console.log(`  ✓ [${projOps.name}]   ${patOps4on3off.name}`);
  console.log(`  ✓ [${projSupport.name}] ${patSupport5on2off.name}`);

  // ── 5. Project Members ────────────────────────────────────────────────────
  console.log('\nAssigning employees to projects...');

  const memberDefs = [
    // Office Staff — Standard shift
    { projectId: projOffice.id, employeeId: EMPS.johnDoe,     workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.sarahTan,    workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.rajeshKumar, workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.liWei,       workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.priya,       workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.chenMei,     workingShiftId: wsOfficeEarly.id },
    { projectId: projOffice.id, employeeId: EMPS.davidOng,    workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.kavitha,     workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.michaelTan,  workingShiftId: wsOfficeStd.id  },
    { projectId: projOffice.id, employeeId: EMPS.ananya,      workingShiftId: wsOfficeEarly.id },
    { projectId: projOffice.id, employeeId: EMPS.wongJunHao,  workingShiftId: wsOfficeStd.id  },
    // Operations — rotating pattern
    { projectId: projOps.id, employeeId: EMPS.nurulAin,    workingShiftId: wsOpsMorn.id, shiftPatternId: patOps4on3off.id },
    { projectId: projOps.id, employeeId: EMPS.sitiRahimah, workingShiftId: wsOpsAftn.id, shiftPatternId: patOps4on3off.id },
    // Customer Support — flex
    { projectId: projSupport.id, employeeId: EMPS.faizal,   workingShiftId: wsSupportFlex.id, shiftPatternId: patSupport5on2off.id },
    { projectId: projSupport.id, employeeId: EMPS.jamesLim, workingShiftId: wsSupportFlex.id, shiftPatternId: patSupport5on2off.id },
  ];

  const startDate = toDate(MON);
  for (const m of memberDefs) {
    await prisma.projectMember.upsert({
      where:  { projectId_employeeId: { projectId: m.projectId, employeeId: m.employeeId } },
      update: { workingShiftId: m.workingShiftId ?? null, shiftPatternId: m.shiftPatternId ?? null },
      create: { id: uuidv4(), ...m, workingShiftId: m.workingShiftId ?? null, shiftPatternId: m.shiftPatternId ?? null, startDate },
    });
  }
  console.log(`  ✓ ${memberDefs.length} members assigned across 3 projects`);

  // ── 6. Roster Entries — this week + next week ─────────────────────────────
  console.log('\nCreating roster entries for current & next week...');

  // Map employee → their working shift for roster cell
  const rosterAssignments = [
    // Office Standard (Mon–Fri both weeks)
    { empId: EMPS.johnDoe,     shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.sarahTan,    shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.rajeshKumar, shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.liWei,       shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.priya,       shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.davidOng,    shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.kavitha,     shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.michaelTan,  shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.wongJunHao,  shiftId: wsOfficeStd.id,   days: [0,1,2,3,4,7,8,9,10,11] },
    // Office Early (Mon–Fri)
    { empId: EMPS.chenMei,     shiftId: wsOfficeEarly.id, days: [0,1,2,3,4,7,8,9,10,11] },
    { empId: EMPS.ananya,      shiftId: wsOfficeEarly.id, days: [0,1,2,3,4,7,8,9,10,11] },
    // Ops Morning (Mon, Wed, Fri, Sat this week; Mon, Tue, Thu, Fri next)
    { empId: EMPS.nurulAin,    shiftId: wsOpsMorn.id,     days: [0,2,4,5,7,8,10,11]      },
    // Ops Afternoon (Tue, Thu, Sat this week; Mon, Wed, Fri, Sat next)
    { empId: EMPS.sitiRahimah, shiftId: wsOpsAftn.id,     days: [1,3,5,7,9,11,12]        },
    // Support Flex (Mon–Sat)
    { empId: EMPS.faizal,      shiftId: wsSupportFlex.id, days: [0,1,2,3,4,5,7,8,9,10,11,12] },
    { empId: EMPS.jamesLim,    shiftId: wsSupportFlex.id, days: [0,1,2,3,4,5,7,8,9,10,11,12] },
  ];

  let rosterCount = 0;
  for (const ra of rosterAssignments) {
    for (const dayOffset of ra.days) {
      const date = toDate(addDays(MON, dayOffset));
      await prisma.rosterEntry.upsert({
        where:  { employeeId_date: { employeeId: ra.empId, date } },
        update: { workingShiftId: ra.shiftId, shiftTemplateId: null, publishedAt: new Date() },
        create: {
          id: uuidv4(), employeeId: ra.empId, date,
          workingShiftId: ra.shiftId, shiftTemplateId: null,
          publishedAt: new Date(), createdBy: 'd39e53b8-d00d-441b-b20c-3d2ea36940dc',
        },
      });
      rosterCount++;
    }
  }
  console.log(`  ✓ ${rosterCount} roster cells published (this week + next week)`);

  // ── 7. Work Locations ─────────────────────────────────────────────────────
  console.log('\nCreating work locations...');

  const locations = await Promise.all([
    prisma.workLocation.upsert({
      where:  { id: 'loc-hq-00000001' },
      update: {},
      create: {
        id: 'loc-hq-00000001', name: 'HQ — One Raffles Quay',
        postalCode: '048583', address: '1 Raffles Quay, North Tower, Singapore 048583',
        latitude: 1.2808, longitude: 103.8520, radiusMetres: 150,
      },
    }),
    prisma.workLocation.upsert({
      where:  { id: 'loc-west-00002' },
      update: {},
      create: {
        id: 'loc-west-00002', name: 'West Hub — JEM',
        postalCode: '608549', address: '50 Jurong Gateway Rd, #12-01, Singapore 608549',
        latitude: 1.3331, longitude: 103.7436, radiusMetres: 200,
      },
    }),
    prisma.workLocation.upsert({
      where:  { id: 'loc-north-0003' },
      update: {},
      create: {
        id: 'loc-north-0003', name: 'North Office — Woodlands',
        postalCode: '738406', address: '1 Woodlands Square, #08-01, Singapore 738406',
        latitude: 1.4367, longitude: 103.7863, radiusMetres: 200,
      },
    }),
  ]);
  locations.forEach(l => console.log(`  ✓ ${l.name} (${l.postalCode}, r=${l.radiusMetres}m)`));

  // ── 8. Assign employees to primary work location ──────────────────────────
  console.log('\nAssigning employees to work locations...');
  const locHQ   = locations[0];
  const locWest = locations[1];
  const locNorth= locations[2];

  const locAssignments = [
    // HQ: Engineering, Technology, Finance, HR leadership
    { empId: EMPS.johnDoe,     locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.liWei,       locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.chenMei,     locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.ananya,      locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.davidOng,    locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.rajeshKumar, locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.michaelTan,  locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.sarahTan,    locId: locHQ.id,    isPrimary: true  },
    { empId: EMPS.kavitha,     locId: locHQ.id,    isPrimary: true  },
    // West: Sales, Marketing
    { empId: EMPS.faizal,      locId: locWest.id,  isPrimary: true  },
    { empId: EMPS.jamesLim,    locId: locWest.id,  isPrimary: true  },
    { empId: EMPS.priya,       locId: locWest.id,  isPrimary: true  },
    { empId: EMPS.wongJunHao,  locId: locWest.id,  isPrimary: true  },
    // North: Operations
    { empId: EMPS.nurulAin,    locId: locNorth.id, isPrimary: true  },
    { empId: EMPS.sitiRahimah, locId: locNorth.id, isPrimary: true  },
  ];

  for (const la of locAssignments) {
    await prisma.employeeWorkLocation.upsert({
      where:  { employeeId_workLocationId: { employeeId: la.empId, workLocationId: la.locId } },
      update: { isPrimary: la.isPrimary },
      create: { id: uuidv4(), employeeId: la.empId, workLocationId: la.locId, isPrimary: la.isPrimary },
    });
  }
  console.log(`  ✓ ${locAssignments.length} employees assigned to primary locations`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log('Attendance seeding complete.');
  console.log(`  ${templates.length} shift templates`);
  console.log(`  3 shift projects  (Office Staff / Operations Team / Customer Support)`);
  console.log(`  5 working shifts  across 3 projects`);
  console.log(`  2 shift patterns  (4-on-3-off, 5-on-2-off)`);
  console.log(`  ${memberDefs.length} project members`);
  console.log(`  ${rosterCount} roster entries  (this week + next week)`);
  console.log(`  3 work locations  (HQ / West / North)`);
  console.log(`  ${locAssignments.length} location assignments`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
