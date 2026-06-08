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
    description: "Submit a leave application FOR THE CURRENT USER. Only call this AFTER the user has confirmed the exact leave type, dates and (optionally) reason. Get leaveTypeId from get_leave_types first. Dates are YYYY-MM-DD.",
    input_schema: {
      type: 'object',
      properties: {
        leaveTypeId: { type: 'string', description: 'Leave type id (from get_leave_types)' },
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD (same as start for one day)' },
        reason: { type: 'string', description: 'Optional reason' },
        isHalfDay: { type: 'boolean', description: 'Optional: true for a half-day' },
      },
      required: ['leaveTypeId', 'startDate', 'endDate'],
    },
    handler: (input, auth) => apiCall('POST', '/leave/applications', auth, {
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
      isHalfDay: !!input.isHalfDay,
    }),
  },
  {
    name: 'submit_claim',
    description: "Submit an expense/medical claim FOR THE CURRENT USER. Only call this AFTER the user has confirmed the category, title, date and amount. Get categoryId from get_claim_categories first. claimDate is YYYY-MM-DD; totalAmount is a number in SGD.",
    input_schema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'Claim category id (from get_claim_categories)' },
        title: { type: 'string', description: 'Short title for the claim' },
        claimDate: { type: 'string', description: 'Date of expense YYYY-MM-DD' },
        totalAmount: { type: 'number', description: 'Total amount in SGD (positive number)' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['categoryId', 'title', 'claimDate', 'totalAmount'],
    },
    handler: (input, auth) => apiCall('POST', '/claims', auth, {
      categoryId: input.categoryId,
      title: input.title,
      claimDate: input.claimDate,
      totalAmount: input.totalAmount,
      description: input.description,
    }),
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
