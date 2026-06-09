'use strict';

/**
 * Tool surface for the HR assistant.
 *
 * SECURITY MODEL — the whole point of this file:
 *   The LLM never touches a database or builds its own URLs. Each tool maps to
 *   ONE fixed, server-controlled endpoint on the existing API gateway. Every
 *   call is made with the *caller's own JWT* (passed straight through from the
 *   chat request), so the platform's existing RBAC decides what comes back:
 *     - a regular employee only ever sees their own records;
 *     - a manager/HR/admin sees more, exactly as they would in the UI;
 *     - if the model asks for something the caller isn't allowed to see, the
 *       downstream endpoint returns 403 and the model relays that it can't.
 *   There is no way for the model to exceed the caller's permissions, because
 *   it has no credential of its own — only the user's token.
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://api-gateway:4000';

// Low-level call to the gateway, carrying the caller's Authorization header so
// downstream services authenticate + authorize as that user.
async function apiCall(method, path, authHeader, body) {
  const url = `${GATEWAY_URL}/api${path}`;
  const headers = { Accept: 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, error: `Could not reach ${path}: ${e.message}` };
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    // Surface authz failures as a clear, model-friendly message.
    if (res.status === 403) return { ok: false, forbidden: true, error: 'You are not allowed to access this information.', detail: data };
    if (res.status === 401) return { ok: false, error: 'Authentication required / token expired.' };
    return { ok: false, status: res.status, error: (data && data.error) || `Request failed (${res.status})`, detail: data };
  }
  return { ok: true, data };
}

// Resolve a target employeeId: explicit input wins (admins querying others),
// else the caller's own employee record.
const self = (input, user) => (input && input.employeeId) || user.employeeId;

// --- Forgiving input helpers (so a small model + a human can be casual) ------
const pad = (n) => String(n).padStart(2, '0');

// Normalise almost any common date the user might type into YYYY-MM-DD.
// Handles "2026-06-10", "10 Jun 2026", "Jun 10 2026", "10/06/2026" (D/M/Y),
// "10-06-2026", "today"/"tomorrow".
function normDate(input) {
  if (!input) return null;
  let s = String(input).trim();
  const low = s.toLowerCase();
  const today = new Date();
  if (low === 'today') return today.toISOString().slice(0, 10);
  if (low === 'tomorrow') return new Date(today.getTime() + 864e5).toISOString().slice(0, 10);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);            // ISO-ish
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);    // D/M/Y (SG default)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  const d = new Date(s);                                       // "10 Jun 2026" etc.
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Resolve a leave-type name/code (e.g. "Annual Leave", "annual", "AL") to its id.
async function resolveLeaveTypeId(query, authHeader) {
  if (!query) return null;
  const q = String(query).toLowerCase().trim().replace(/\bleave\b/g, '').trim();
  const r = await apiCall('GET', '/leave/types', authHeader);
  const types = r.ok ? (Array.isArray(r.data) ? r.data : r.data?.types || []) : [];
  const norm = (s) => String(s || '').toLowerCase().replace(/\bleave\b/g, '').trim();
  return (
    types.find((t) => norm(t.code) === q || norm(t.name) === q) ||
    types.find((t) => norm(t.name).includes(q) || (q && norm(t.code) === q)) ||
    types.find((t) => norm(t.name).startsWith(q))
  )?.id || null;
}

// Resolve a claim-category name to its id.
async function resolveClaimCategoryId(query, authHeader) {
  if (!query) return null;
  const q = String(query).toLowerCase().trim();
  const r = await apiCall('GET', '/claims/categories', authHeader);
  const cats = r.ok ? (Array.isArray(r.data) ? r.data : r.data?.categories || []) : [];
  const norm = (s) => String(s || '').toLowerCase().trim();
  return (
    cats.find((c) => norm(c.name) === q || norm(c.code) === q) ||
    cats.find((c) => norm(c.name).includes(q))
  )?.id || null;
}

/**
 * The tool registry. Each entry has the Anthropic tool schema plus a handler.
 * Adding a new capability = add one row here.
 */
const TOOLS = [
  // ---------- READ: identity & profile ----------
  {
    name: 'get_my_profile',
    description: "Get the current user's own account profile: name, email, role, permissions, and linked employee id. Call this first if you need the user's role or employee id.",
    input_schema: { type: 'object', properties: {} },
    handler: (input, auth) => apiCall('GET', '/auth/me', auth),
  },
  {
    name: 'get_employee',
    description: 'Look up an employee record by id (department, job title, manager, contact, etc.). Restricted by RBAC: regular employees can only look up themselves; HR/admin can look up anyone. Use the employee id, not a name.',
    input_schema: { type: 'object', properties: { employeeId: { type: 'string', description: 'Employee id to look up' } }, required: ['employeeId'] },
    handler: (input, auth) => apiCall('GET', `/employees/${encodeURIComponent(input.employeeId)}`, auth),
  },

  // ---------- READ: leave ----------
  {
    name: 'get_leave_types',
    description: 'List the available leave types (annual, medical, etc.) with their ids, paid/unpaid status and annual entitlement. Use this to map a leave-type name to its id before applying for leave.',
    input_schema: { type: 'object', properties: {} },
    handler: (input, auth) => apiCall('GET', '/leave/types', auth),
  },
  {
    name: 'get_leave_balance',
    description: "Get leave balances/entitlements for an employee (remaining days per leave type). Defaults to the current user; HR/managers may pass another employeeId (RBAC enforced).",
    input_schema: { type: 'object', properties: { employeeId: { type: 'string', description: 'Optional: another employee id (HR/manager only)' } } },
    handler: (input, auth, user) => apiCall('GET', `/leave/balances/${encodeURIComponent(self(input, user))}`, auth),
  },
  {
    name: 'get_leave_applications',
    description: "List leave applications and their approval status. Defaults to the current user's own applications; HR/managers may pass another employeeId to view that person's (RBAC enforced).",
    input_schema: { type: 'object', properties: { employeeId: { type: 'string', description: 'Optional: another employee id (HR/manager only)' } } },
    handler: (input, auth) => apiCall('GET', input && input.employeeId ? `/leave/applications?employeeId=${encodeURIComponent(input.employeeId)}` : '/leave/applications', auth),
  },

  // ---------- READ: claims ----------
  {
    name: 'get_claim_categories',
    description: 'List expense/medical claim categories with their ids and limits. Use this to map a category name to its id before submitting a claim.',
    input_schema: { type: 'object', properties: {} },
    handler: (input, auth) => apiCall('GET', '/claims/categories', auth),
  },
  {
    name: 'get_my_claims',
    description: "List the user's expense/medical claims and their approval status. HR/finance may pass another employeeId (RBAC enforced).",
    input_schema: { type: 'object', properties: { employeeId: { type: 'string', description: 'Optional: another employee id (HR/finance only)' } } },
    handler: (input, auth) => apiCall('GET', input && input.employeeId ? `/claims?employeeId=${encodeURIComponent(input.employeeId)}` : '/claims', auth),
  },

  // ---------- READ: payroll ----------
  {
    name: 'get_my_payslips',
    description: "Get the current user's own payslips / payroll records (net pay, components, CPF, period). Only ever returns the caller's own payslips.",
    input_schema: { type: 'object', properties: {} },
    handler: (input, auth) => apiCall('GET', '/payroll/payslips/me', auth),
  },

  // ---------- READ: performance ----------
  {
    name: 'get_my_appraisals',
    description: "Get the current user's own performance appraisals (ratings, status, cycle).",
    input_schema: { type: 'object', properties: {} },
    handler: (input, auth) => apiCall('GET', '/performance/appraisals/me', auth),
  },

  // ---------- READ: training ----------
  {
    name: 'get_my_training',
    description: "List the training programs the current user is enrolled in or has completed.",
    input_schema: { type: 'object', properties: {} },
    handler: (input, auth) => apiCall('GET', '/training/my-programs', auth),
  },

  // ---------- READ: team / approvals ----------
  {
    name: 'get_my_subordinates',
    description: 'List the employees who report to the current user (for managers). Returns an empty list if the user manages no one.',
    input_schema: { type: 'object', properties: {} },
    handler: (input, auth) => apiCall('GET', '/employees/me/subordinates', auth),
  },
  {
    name: 'get_supervisors',
    description: "List the supervisors/approvers for an employee. Defaults to the current user. Useful for 'who approves my leave?'.",
    input_schema: { type: 'object', properties: { employeeId: { type: 'string', description: 'Optional: another employee id (HR/manager only)' } } },
    handler: (input, auth, user) => apiCall('GET', `/employees/${encodeURIComponent(self(input, user))}/supervisors`, auth),
  },

  // ---------- ACTIONS (writes) — confirm with the user before calling ----------
  {
    name: 'apply_leave',
    description: "Submit a leave application FOR THE CURRENT USER, AFTER they've confirmed. Just pass the leave type by NAME (e.g. 'Annual Leave' or 'AL') and the dates in ANY common format (e.g. '10 Jun 2026', '2026-06-10', 'tomorrow') — the system resolves the type id and normalises the dates for you. Do NOT demand a specific date format from the user.",
    input_schema: {
      type: 'object',
      properties: {
        leaveType: { type: 'string', description: "Leave type by name or code, e.g. 'Annual Leave', 'annual', 'AL', 'Sick Leave'" },
        startDate: { type: 'string', description: "Start date, any common format e.g. '10 Jun 2026', '2026-06-10', '10/06/2026', 'today'" },
        endDate: { type: 'string', description: "End date (same as start for a single day), any common format" },
        reason: { type: 'string', description: 'Optional reason' },
        isHalfDay: { type: 'boolean', description: 'Optional: true for a half-day' },
        leaveTypeId: { type: 'string', description: 'Optional: exact id if already known (overrides leaveType)' },
      },
      required: ['leaveType', 'startDate', 'endDate'],
    },
    handler: async (input, auth) => {
      const leaveTypeId = input.leaveTypeId || await resolveLeaveTypeId(input.leaveType, auth);
      if (!leaveTypeId) return { ok: false, error: `I couldn't match "${input.leaveType || ''}" to a leave type. Use get_leave_types and ask the user to pick one.` };
      const startDate = normDate(input.startDate);
      const endDate = normDate(input.endDate);
      if (!startDate || !endDate) return { ok: false, error: `I couldn't read the dates (start="${input.startDate}", end="${input.endDate}"). Ask the user to restate them.` };
      return apiCall('POST', '/leave/applications', auth, { leaveTypeId, startDate, endDate, reason: input.reason, isHalfDay: !!input.isHalfDay });
    },
  },
  {
    name: 'submit_claim',
    description: "Submit an expense/medical claim FOR THE CURRENT USER, AFTER they've confirmed. Pass the category by NAME (e.g. 'Medical', 'Transport') and the date in any common format — the system resolves the category id and normalises the date. totalAmount is a number in SGD.",
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: "Claim category by name, e.g. 'Medical', 'Transport', 'Meals'" },
        title: { type: 'string', description: 'Short title for the claim' },
        claimDate: { type: 'string', description: "Date of expense, any common format e.g. '10 Jun 2026'" },
        totalAmount: { type: 'number', description: 'Total amount in SGD (positive number)' },
        description: { type: 'string', description: 'Optional description' },
        categoryId: { type: 'string', description: 'Optional: exact id if already known (overrides category)' },
      },
      required: ['category', 'title', 'claimDate', 'totalAmount'],
    },
    handler: async (input, auth) => {
      const categoryId = input.categoryId || await resolveClaimCategoryId(input.category, auth);
      if (!categoryId) return { ok: false, error: `I couldn't match "${input.category || ''}" to a claim category. Use get_claim_categories and ask the user to pick one.` };
      const claimDate = normDate(input.claimDate);
      if (!claimDate) return { ok: false, error: `I couldn't read the claim date ("${input.claimDate}"). Ask the user to restate it.` };
      return apiCall('POST', '/claims', auth, { categoryId, title: input.title, claimDate, totalAmount: input.totalAmount, description: input.description });
    },
  },
];

// Anthropic tool schema (without handlers).
const TOOL_SCHEMAS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

async function runTool(name, input, authHeader, user) {
  const tool = TOOL_BY_NAME[name];
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    return await tool.handler(input || {}, authHeader, user);
  } catch (e) {
    return { ok: false, error: `Tool ${name} failed: ${e.message}` };
  }
}

module.exports = { TOOL_SCHEMAS, runTool };
