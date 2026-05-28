'use strict';
/**
 * Security regression for H-22:
 *   POST /attendance/ot-auth/requests must NOT honour body.employeeId from a
 *   non-supervisor caller. Previously any user could submit OT under another
 *   employee's name, eating the victim's MOM 72h monthly cap.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

describe('H-22 OT-auth poisoning fix', () => {
  test('handler rejects non-supervisor body.employeeId with 403', () => {
    const start = src.indexOf("app.post('/attendance/ot-auth/requests'");
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start, start + 2000);
    expect(slice).toMatch(/Only supervisors \/ HR may submit OT on behalf/);
    expect(slice).toMatch(/requestType === 'SUPERVISOR'[\s\S]+?isManager/);
  });
  test('targetEmployee is forced to caller when caller is not a manager', () => {
    const start = src.indexOf("app.post('/attendance/ot-auth/requests'");
    const slice = src.slice(start, start + 2000);
    expect(slice).toMatch(/const targetEmployee = \(isManager && employeeId\) \? employeeId : callerEmpId/);
  });
});
