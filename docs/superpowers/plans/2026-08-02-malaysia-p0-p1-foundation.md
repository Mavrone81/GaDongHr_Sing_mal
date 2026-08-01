# Malaysia Localization — P0/P1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `LegalEntity` layer that makes a tenant multi-country, then extract Singapore's statutory computation into its own service behind a country-agnostic HTTP contract — shipping both to production with zero Malaysian code.

**Architecture:** A tenant owns 1..n legal entities, each with a country. A payroll run belongs to one entity, so it has exactly one country. `payroll-service` keeps its run lifecycle and delegates statutory computation over HTTP to a per-country service selected by the entity's country. This plan builds the entity layer (P0) and the Singapore statutory service (P1). The Malaysian service (P2+) is a later plan and is out of scope here.

**Tech Stack:** Node 20, Express 4, Prisma 5 (`db push`, not migrations, for most services), PostgreSQL 16, Jest 29 + Supertest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-02-malaysia-localization-design.md`
**Requirements:** `PRD_AMENDMENT_MY.md` — ENT-001, ENT-002, ENT-003, ENT-004, ENT-006

---

## Global Constraints

Every task's requirements implicitly include this section.

- **No Singapore statutory output may change by any amount.** PRD §A7.4. A difference is a defect, not an accepted consequence. The gate is Task 15.
- **Statutory computation fails closed.** If the statutory service is unreachable or has no effective rate row, payroll returns 503 and the run stays `DRAFT`. Never fall back to a default, a cached value, or the nearest rate row.
- **Statutory rate tables are global.** Rows in `hrms_statutory_sg` carry no `tenantId`. They are versioned by `effectiveFrom` and are read-only to tenants.
- **`rateVersion` is persisted per statutory line.** ENT-006 — a payslip must be reproducible years later.
- **Country is never client-supplied.** ENT-002 — resolve it server-side from the entity. Never from a header, query, body, or JWT claim.
- **Node 20 for test runs.** `TESTING.md` — jest 29 hangs on Node 22+. Use `npm ci`, not `npm install`.
- **A new service is not done until it is in all three places:** `docker-compose.yml`, `scripts/init-dbs.sql`, and the `projects` array in the root `jest.config.js`. Six existing services (`benefits`, `esign`, `hr-case`, `loans`, `support`, `survey`) are gateway-routed but missing from compose; do not add a seventh.
- **Shared-module imports use the container path** `/app/shared/<name>`, mapped for Jest via `moduleNameMapper` in each service's `package.json`. Copy the pattern from `services/payroll-service/package.json`.
- **Internal service-to-service auth** uses the `x-internal-service-key` header checked against `INTERNAL_SERVICE_KEY`. Fail closed if the env var is unset (VAPT C-07).
- **Commit after every task.** Do not batch commits across tasks.
- **Migration scripts read `POSTGRES_PASSWORD` from the environment.** Export it from your own shell before running any script in this plan — it is the value in the repo's git-ignored `.env`. Do not inline a read of `.env` into a command, and never paste the value into a file, a commit message, or a terminal transcript.

---

## File Structure

**P0 — entity layer**

| File | Responsibility |
|---|---|
| `services/auth-service/prisma/schema.prisma` | Add `LegalEntity` model |
| `services/auth-service/src/routes/entities.routes.js` | Entity CRUD + internal resolution endpoint |
| `services/auth-service/__tests__/entities.integration.test.js` | Route tests |
| `shared/entity-client/index.js` | Cached, fail-closed entity resolver used by every downstream service |
| `shared/entity-client/package.json` | Workspace manifest |
| `scripts/migrate-legal-entities.js` | One-off backfill, dry-runnable |
| `services/employee-service/prisma/schema.prisma` | Add `Employee.legalEntityId` |
| `services/payroll-service/prisma/schema.prisma` | Add `PayrollRun.legalEntityId`; fix two unique constraints |

**P1 — Singapore statutory service**

| File | Responsibility |
|---|---|
| `services/statutory-sg-service/src/index.js` | Express app, route mounting, health |
| `services/statutory-sg-service/src/engines/cpf.engine.js` | CPF/SDL/FWL computation (moved from `shared/payroll-utils`) |
| `services/statutory-sg-service/src/routes/statutory.routes.js` | The five contract endpoints |
| `services/statutory-sg-service/src/rules/employment-rules.js` | SG leave tiers, OT multipliers, normal hours |
| `services/statutory-sg-service/prisma/schema.prisma` | `CpfRate`, `SdlConfig`, `FwlRate`, `RateVersion` — global, no `tenantId` |
| `services/statutory-sg-service/__tests__/*.test.js` | Moved unit tests + new contract tests |
| `services/payroll-service/src/utils/statutory-client.js` | HTTP client, fail-closed |
| `scripts/migrate-statutory-tables-sg.js` | Hoist per-tenant rates to global + divergence report |

---

## Task 1: `LegalEntity` model and internal resolution endpoint

**Context:** `Tenant` and `CompanyProfile` already live in `services/auth-service/prisma/schema.prisma` (lines 22 and 76 carry an inert `country` field). `CompanyProfile` is 1:1 with `Tenant`. We add `LegalEntity` as the 1:n generalisation. Auth-service mounts routes in `src/index.js:56-61`.

**Files:**
- Modify: `services/auth-service/prisma/schema.prisma`
- Create: `services/auth-service/src/routes/entities.routes.js`
- Modify: `services/auth-service/src/index.js:13` (require) and `:59` (mount)
- Test: `services/auth-service/__tests__/entities.integration.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - Prisma model `LegalEntity` with fields `id, tenantId, name, code, country, currency, timezone, state, registrationNo, statutoryIds, isPrimary, isActive, createdAt, updatedAt`
  - `GET /tenants/internal/entities/:id` → `200 { id, tenantId, name, code, country, currency, timezone, state, registrationNo, statutoryIds }` | `404 { error }` | `401 { error }`

- [ ] **Step 1: Add the model to the Prisma schema**

Append to `services/auth-service/prisma/schema.prisma`:

```prisma
model LegalEntity {
  id             String   @id @default(uuid())
  tenantId       String
  name           String
  code           String
  country        String   @default("SG")  // SG | MY
  currency       String   @default("SGD") // SGD | MYR
  timezone       String   @default("Asia/Singapore")
  state          String?                  // MY only — drives state holiday set
  registrationNo String?                  // UEN (SG) / SSM (MY)
  statutoryIds   Json?                    // country-specific employer registrations
  isPrimary      Boolean  @default(false)
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([tenantId, code])
  @@index([tenantId])
  @@map("legal_entities")
}
```

`statutoryIds` is intentionally untyped — SG needs a CPF Submission Number, MY needs EPF/SOCSO/LHDN numbers. Typing it here would drag country knowledge into auth-service. Shape is validated by each statutory service's `/statutory/schema`.

- [ ] **Step 2: Write the failing test**

Create `services/auth-service/__tests__/entities.integration.test.js`:

```javascript
'use strict';
const request = require('supertest');

const mockPrisma = { legalEntity: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() } };
jest.mock('../src/utils/prisma', () => mockPrisma);

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';

const express = require('express');
const entitiesRoutes = require('../src/routes/entities.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/tenants', entitiesRoutes);
  return app;
}

const ENTITY = {
  id: 'ent-1', tenantId: 'ten-1', name: 'Acme Pte Ltd', code: 'ACME-SG',
  country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore', state: null,
  registrationNo: '201812345A', statutoryIds: { cpfSubmissionNumber: 'CSN-1' },
  isPrimary: true, isActive: true,
};

describe('GET /tenants/internal/entities/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the entity when the internal key is valid', async () => {
    mockPrisma.legalEntity.findUnique.mockResolvedValue(ENTITY);
    const res = await request(buildApp())
      .get('/tenants/internal/entities/ent-1')
      .set('x-internal-service-key', 'test-internal-key');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'ent-1', tenantId: 'ten-1', name: 'Acme Pte Ltd', code: 'ACME-SG',
      country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore', state: null,
      registrationNo: '201812345A', statutoryIds: { cpfSubmissionNumber: 'CSN-1' },
    });
  });

  test('rejects a missing internal key with 401', async () => {
    const res = await request(buildApp()).get('/tenants/internal/entities/ent-1');
    expect(res.status).toBe(401);
    expect(mockPrisma.legalEntity.findUnique).not.toHaveBeenCalled();
  });

  test('rejects a wrong internal key with 401', async () => {
    const res = await request(buildApp())
      .get('/tenants/internal/entities/ent-1')
      .set('x-internal-service-key', 'wrong');
    expect(res.status).toBe(401);
  });

  test('returns 404 for an unknown entity', async () => {
    mockPrisma.legalEntity.findUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/tenants/internal/entities/nope')
      .set('x-internal-service-key', 'test-internal-key');
    expect(res.status).toBe(404);
  });

  test('does not leak inactive entities', async () => {
    mockPrisma.legalEntity.findUnique.mockResolvedValue({ ...ENTITY, isActive: false });
    const res = await request(buildApp())
      .get('/tenants/internal/entities/ent-1')
      .set('x-internal-service-key', 'test-internal-key');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest --projects services/auth-service -t "internal/entities" --runInBand
```

Expected: FAIL — `Cannot find module '../src/routes/entities.routes'`.

- [ ] **Step 4: Implement the route**

Create `services/auth-service/src/routes/entities.routes.js`:

```javascript
'use strict';
const express = require('express');
const prisma = require('../utils/prisma');

const router = express.Router();

// Service-to-service only. Fails closed if INTERNAL_SERVICE_KEY is unset —
// never fall back to a hardcoded development default (VAPT C-07).
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) return res.status(401).json({ error: 'Internal key not configured' });
  if (req.headers['x-internal-service-key'] !== expected) {
    return res.status(401).json({ error: 'Invalid internal service key' });
  }
  next();
}

// Resolution endpoint consumed by shared/entity-client. Returns only the
// fields a downstream service needs to select a country pack — never the
// audit columns.
router.get('/internal/entities/:id', requireInternalKey, async (req, res, next) => {
  try {
    const e = await prisma.legalEntity.findUnique({ where: { id: req.params.id } });
    if (!e || !e.isActive) return res.status(404).json({ error: 'Legal entity not found' });
    res.json({
      id: e.id, tenantId: e.tenantId, name: e.name, code: e.code,
      country: e.country, currency: e.currency, timezone: e.timezone,
      state: e.state, registrationNo: e.registrationNo,
      statutoryIds: e.statutoryIds,
    });
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest --projects services/auth-service -t "internal/entities" --runInBand
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Mount the router**

In `services/auth-service/src/index.js`, add after line 13:

```javascript
const entitiesRoutes = require('./routes/entities.routes');
```

and after the `app.use('/tenants', tenantsRoutes);` line (currently line 59):

```javascript
app.use('/tenants', entitiesRoutes);
```

Mounting on the same `/tenants` prefix is deliberate — the gateway already proxies `/api/tenants` to auth-service (`api-gateway/src/index.js:286`), so no gateway change is needed.

- [ ] **Step 7: Verify the whole auth-service suite still passes**

```bash
npx jest --projects services/auth-service --runInBand
```

Expected: PASS, with no previously-passing test now failing.

- [ ] **Step 8: Commit**

```bash
git add services/auth-service/prisma/schema.prisma \
        services/auth-service/src/routes/entities.routes.js \
        services/auth-service/src/index.js \
        services/auth-service/__tests__/entities.integration.test.js
git commit -m "feat(entity): LegalEntity model + internal resolution endpoint (ENT-001)"
```

---

## Task 2: `shared/entity-client` — cached, fail-closed resolver

**Context:** Downstream services must resolve an entity's country without embedding auth-service knowledge. The caching shape is already proven by `getEntitlements` at `services/api-gateway/src/index.js:149`. **The failure semantics are deliberately opposite:** entitlements fail open so a control-plane hiccup can't down every tenant; entity resolution fails closed because guessing a country would compute the wrong payroll.

**Files:**
- Create: `shared/entity-client/index.js`, `shared/entity-client/package.json`
- Test: `shared/entity-client/__tests__/entity-client.unit.test.js`
- Modify: root `jest.config.js` (add the new project)

**Interfaces:**
- Consumes: `GET /tenants/internal/entities/:id` from Task 1
- Produces:
  - `resolveEntity(legalEntityId) → Promise<EntityContext>` — throws `EntityResolutionError` on any failure
  - `EntityContext = { id, tenantId, name, code, country, currency, timezone, state, registrationNo, statutoryIds }`
  - `EntityResolutionError` — `Error` subclass with `.status = 503`
  - `clearEntityCache()` — test helper

- [ ] **Step 1: Write the failing test**

Create `shared/entity-client/__tests__/entity-client.unit.test.js`:

```javascript
'use strict';
const { resolveEntity, clearEntityCache, EntityResolutionError } = require('../index');

const ENTITY = {
  id: 'ent-1', tenantId: 'ten-1', name: 'Acme Pte Ltd', code: 'ACME-SG',
  country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore', state: null,
  registrationNo: '201812345A', statutoryIds: {},
};

describe('resolveEntity', () => {
  beforeEach(() => {
    clearEntityCache();
    process.env.AUTH_SERVICE_URL = 'http://auth-service:4001';
    process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
    global.fetch = jest.fn();
  });

  test('returns the entity context on success', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await expect(resolveEntity('ent-1')).resolves.toEqual(ENTITY);
  });

  test('sends the internal service key', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await resolveEntity('ent-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://auth-service:4001/tenants/internal/entities/ent-1',
      { headers: { 'x-internal-service-key': 'test-internal-key' } },
    );
  });

  test('caches within the TTL — one fetch for two calls', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await resolveEntity('ent-1');
    await resolveEntity('ent-1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // Fail-closed: the whole point of this module.
  test('throws EntityResolutionError when the network fails', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(resolveEntity('ent-1')).rejects.toBeInstanceOf(EntityResolutionError);
  });

  test('throws when auth-service returns non-ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(resolveEntity('ent-1')).rejects.toBeInstanceOf(EntityResolutionError);
  });

  test('never caches a failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('boom'));
    await expect(resolveEntity('ent-1')).rejects.toThrow();
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await expect(resolveEntity('ent-1')).resolves.toEqual(ENTITY);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('throws when INTERNAL_SERVICE_KEY is unset', async () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    await expect(resolveEntity('ent-1')).rejects.toBeInstanceOf(EntityResolutionError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('error carries status 503 so callers surface a retryable failure', async () => {
    global.fetch.mockRejectedValue(new Error('boom'));
    await expect(resolveEntity('ent-1')).rejects.toMatchObject({ status: 503 });
  });
});
```

- [ ] **Step 2: Create the package manifest**

Create `shared/entity-client/package.json`:

```json
{
  "name": "@hrms/entity-client",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": { "test": "jest --runInBand" },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.js"]
  },
  "devDependencies": { "jest": "^29.7.0" }
}
```

- [ ] **Step 3: Register the project with the root Jest config**

In `jest.config.js`, add `'<rootDir>/shared/entity-client'` to the `projects` array. Without this the tests never run under `npm run test:backend`.

- [ ] **Step 4: Run the test to verify it fails**

```bash
npx jest --projects shared/entity-client --runInBand
```

Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 5: Implement the client**

Create `shared/entity-client/index.js`:

```javascript
'use strict';

/**
 * Resolves a LegalEntity to the context a downstream service needs in order to
 * select a country's statutory rules.
 *
 * FAIL-CLOSED BY DESIGN. The gateway's entitlement cache fails OPEN so a
 * control-plane outage can't take down every tenant's app. This module does the
 * opposite: if we cannot establish which country an entity is in, we must not
 * guess — computing Singapore CPF for a Malaysian employee is worse than an
 * outage. Every failure path throws.
 */

class EntityResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EntityResolutionError';
    this.status = 503;
  }
}

const _cache = new Map();
const TTL_MS = Number(process.env.ENTITY_CACHE_TTL_MS || 30000);

function clearEntityCache() { _cache.clear(); }

async function resolveEntity(legalEntityId) {
  if (!legalEntityId) throw new EntityResolutionError('legalEntityId is required');

  const cached = _cache.get(legalEntityId);
  if (cached && (Date.now() - cached.at) < TTL_MS) return cached.entity;

  const key = process.env.INTERNAL_SERVICE_KEY;
  if (!key) throw new EntityResolutionError('INTERNAL_SERVICE_KEY is not configured');

  const base = process.env.AUTH_SERVICE_URL || 'http://auth-service:4001';

  let res;
  try {
    res = await fetch(`${base}/tenants/internal/entities/${legalEntityId}`, {
      headers: { 'x-internal-service-key': key },
    });
  } catch (err) {
    throw new EntityResolutionError(`Entity resolution failed: ${err.message}`);
  }

  if (!res.ok) {
    throw new EntityResolutionError(`Entity resolution returned ${res.status} for ${legalEntityId}`);
  }

  const entity = await res.json();
  // Only successes are cached — a failure must be retried, never memoised.
  _cache.set(legalEntityId, { at: Date.now(), entity });
  return entity;
}

module.exports = { resolveEntity, clearEntityCache, EntityResolutionError };
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest --projects shared/entity-client --runInBand
```

Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
git add shared/entity-client jest.config.js
git commit -m "feat(entity): fail-closed cached entity resolver (ENT-002)"
```

---

## Task 3: Entity list and create routes

**Context:** Task 1 built only the internal endpoint. Operators and tenant admins need to list and create entities. Role gating follows the existing convention: `authenticate` then `authorize(...)` from `/app/shared/auth-middleware`.

**Tenant scoping is mandatory, not optional.** `:tenantId` is attacker-controlled, so role gating alone leaves an IDOR of the same class as VAPT C-01/C-02 — a caller in one tenant could enumerate or create entities in another. The authoritative tenant is the one in the verified JWT (`req.user.tenantId`, signed at `auth.routes.js:300`); the path segment may only *match* it, or be the literal `me`. Follow the convention at `tenants.routes.js:186`. `prisma.legalEntity.create` must stamp the token's tenantId, never `req.params.tenantId`.

This also means `services/auth-service/__mocks__/auth-middleware.js` must put `tenantId` on `req.user` — without it a missing scope check passes unnoticed in tests.

**Files:**
- Modify: `services/auth-service/src/routes/entities.routes.js`
- Test: `services/auth-service/__tests__/entities.integration.test.js`

**Interfaces:**
- Consumes: `LegalEntity` model (Task 1)
- Produces:
  - `GET /tenants/:tenantId/entities` → `200 [{ id, name, code, country, currency, state, isPrimary, isActive }]`
  - `POST /tenants/:tenantId/entities` → `201 { id, ... }` | `400 { error }` | `409 { error }`

- [ ] **Step 1: Write the failing tests**

Append to `services/auth-service/__tests__/entities.integration.test.js`:

```javascript
describe('entity CRUD', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists entities for a tenant', async () => {
    mockPrisma.legalEntity.findMany.mockResolvedValue([ENTITY]);
    const res = await request(buildApp()).get('/tenants/ten-1/entities');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].code).toBe('ACME-SG');
  });

  test('creates an entity with a supported country', async () => {
    mockPrisma.legalEntity.create.mockResolvedValue({ ...ENTITY, id: 'ent-2', code: 'ACME-MY' });
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme Sdn Bhd', code: 'ACME-MY', country: 'MY' });

    expect(res.status).toBe(201);
    // Currency and timezone are derived from country, never client-supplied.
    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'ten-1', country: 'MY', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur',
      }),
    }));
  });

  test('derives SGD / Asia/Singapore for an SG entity', async () => {
    mockPrisma.legalEntity.create.mockResolvedValue(ENTITY);
    await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme Pte Ltd', code: 'ACME-SG', country: 'SG' });

    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: 'SGD', timezone: 'Asia/Singapore' }),
    }));
  });

  test('rejects an unsupported country', async () => {
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme KK', code: 'ACME-HK', country: 'HK' });
    expect(res.status).toBe(400);
    expect(mockPrisma.legalEntity.create).not.toHaveBeenCalled();
  });

  test('ignores a client-supplied currency (ENT-002)', async () => {
    mockPrisma.legalEntity.create.mockResolvedValue(ENTITY);
    await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme', code: 'A1', country: 'SG', currency: 'USD' });

    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: 'SGD' }),
    }));
  });

  test('rejects a missing name or code', async () => {
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities').send({ country: 'SG' });
    expect(res.status).toBe(400);
  });

  test('maps a duplicate code to 409', async () => {
    mockPrisma.legalEntity.create.mockRejectedValue({ code: 'P2002' });
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme', code: 'ACME-SG', country: 'SG' });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest --projects services/auth-service -t "entity CRUD" --runInBand
```

Expected: FAIL — 404 responses, routes not defined.

- [ ] **Step 3: Implement the routes**

In `services/auth-service/src/routes/entities.routes.js`, add above `module.exports`:

```javascript
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

// v1 supports Singapore and Peninsular Malaysia only. Adding a country here
// without a corresponding statutory service would let a tenant create entities
// whose payroll cannot compute — see PRD §A1.2.
const COUNTRY_DEFAULTS = {
  SG: { currency: 'SGD', timezone: 'Asia/Singapore' },
  MY: { currency: 'MYR', timezone: 'Asia/Kuala_Lumpur' },
};

router.get('/:tenantId/entities', authenticate, async (req, res, next) => {
  try {
    const rows = await prisma.legalEntity.findMany({
      where: { tenantId: req.params.tenantId },
      orderBy: [{ isPrimary: 'desc' }, { code: 'asc' }],
    });
    res.json(rows.map(e => ({
      id: e.id, name: e.name, code: e.code, country: e.country,
      currency: e.currency, state: e.state, isPrimary: e.isPrimary, isActive: e.isActive,
    })));
  } catch (err) { next(err); }
});

router.post('/:tenantId/entities', authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { name, code, country, state, registrationNo, statutoryIds } = req.body || {};
    if (!name || !code) return res.status(400).json({ error: 'name and code are required' });

    const ctry = String(country || 'SG').toUpperCase();
    const defaults = COUNTRY_DEFAULTS[ctry];
    if (!defaults) {
      return res.status(400).json({
        error: `country must be one of ${Object.keys(COUNTRY_DEFAULTS).join(', ')}`,
      });
    }

    // currency and timezone are DERIVED, never accepted from the client (ENT-002).
    const entity = await prisma.legalEntity.create({
      data: {
        tenantId: req.params.tenantId,
        name, code, country: ctry,
        currency: defaults.currency,
        timezone: defaults.timezone,
        state: ctry === 'MY' ? (state || null) : null,
        registrationNo: registrationNo || null,
        statutoryIds: statutoryIds || null,
        isPrimary: false,
      },
    });
    res.status(201).json(entity);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'An entity with this code already exists for the tenant' });
    }
    next(err);
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest --projects services/auth-service --runInBand
```

Expected: PASS — all entity tests plus the pre-existing auth suite.

- [ ] **Step 5: Commit**

```bash
git add services/auth-service/src/routes/entities.routes.js \
        services/auth-service/__tests__/entities.integration.test.js
git commit -m "feat(entity): list + create legal entities, country-derived currency"
```

---

## Task 4: Backfill migration — one primary entity per tenant

**Context:** ENT-003 requires every existing tenant to receive exactly one primary `LegalEntity` derived from its `CompanyProfile`, country `SG`. Model the script on `scripts/migrate-cpf-jan2026.js` — same `DRY_RUN` convention and env var names (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`).

**Files:**
- Create: `scripts/migrate-legal-entities.js`
- Test: `scripts/__tests__/migrate-legal-entities.unit.test.js`
- Modify: root `jest.config.js` (add `'<rootDir>/scripts'` project)
- Create: `scripts/package.json` jest block if absent

**Interfaces:**
- Consumes: `LegalEntity` model (Task 1)
- Produces:
  - `buildEntityFromTenant(tenant, profile) → { tenantId, name, code, country, currency, timezone, registrationNo, isPrimary }` — pure, unit-testable
  - `deriveEntityCode(tenantSlug) → string`

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `scripts/__tests__/migrate-legal-entities.unit.test.js`:

```javascript
'use strict';
const { buildEntityFromTenant, deriveEntityCode } = require('../migrate-legal-entities');

describe('deriveEntityCode', () => {
  test('upper-cases the slug', () => {
    expect(deriveEntityCode('acme')).toBe('ACME');
  });
  test('strips characters outside A-Z0-9 and hyphen', () => {
    expect(deriveEntityCode('acme co. (sg)!')).toBe('ACME-CO-SG');
  });
  test('collapses repeated separators', () => {
    expect(deriveEntityCode('a   b')).toBe('A-B');
  });
  test('truncates to 32 characters', () => {
    expect(deriveEntityCode('x'.repeat(50))).toHaveLength(32);
  });
  test('falls back to ENTITY for an empty slug', () => {
    expect(deriveEntityCode('')).toBe('ENTITY');
  });
});

describe('buildEntityFromTenant', () => {
  const tenant = { id: 'ten-1', name: 'Acme Pte Ltd', slug: 'acme', country: 'SG' };

  test('derives an SG entity from tenant + profile', () => {
    const profile = { legalName: 'Acme Private Limited', registrationNo: '201812345A' };
    expect(buildEntityFromTenant(tenant, profile)).toEqual({
      tenantId: 'ten-1',
      name: 'Acme Private Limited',
      code: 'ACME',
      country: 'SG',
      currency: 'SGD',
      timezone: 'Asia/Singapore',
      registrationNo: '201812345A',
      isPrimary: true,
    });
  });

  test('falls back to the tenant name when there is no profile', () => {
    const e = buildEntityFromTenant(tenant, null);
    expect(e.name).toBe('Acme Pte Ltd');
    expect(e.registrationNo).toBeNull();
  });

  // ENT-003: every existing tenant migrates as Singapore regardless of the
  // inert `country` captured at signup — no live tenant has ever computed
  // anything but SG payroll, so honouring that field would silently change
  // behaviour for anyone who picked another country on the signup form.
  test('forces SG even when the tenant row says otherwise', () => {
    const e = buildEntityFromTenant({ ...tenant, country: 'MY' }, null);
    expect(e.country).toBe('SG');
    expect(e.currency).toBe('SGD');
  });
});
```

- [ ] **Step 2: Register `scripts` as a Jest project**

Add `'<rootDir>/scripts'` to `projects` in `jest.config.js`. Then confirm `scripts/package.json` contains:

```json
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.js"]
  },
```

Add that block if it is not already present.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest --projects scripts --runInBand
```

Expected: FAIL — `Cannot find module '../migrate-legal-entities'`.

- [ ] **Step 4: Implement the script**

Create `scripts/migrate-legal-entities.js`:

```javascript
'use strict';
/**
 * Migration (ENT-003): give every existing tenant exactly one primary
 * LegalEntity, derived from its CompanyProfile, with country SG.
 *
 * Every tenant alive today computes Singapore payroll — the `country` column on
 * `tenants` has never been read by any code path (it was captured at signup and
 * ignored). We therefore force SG rather than honouring that field: trusting it
 * would silently change behaviour for any tenant who picked another country on
 * the signup form and has been running SG payroll ever since.
 *
 * Idempotent: a tenant that already has a primary entity is skipped.
 *
 * Usage:
 *   node scripts/migrate-legal-entities.js
 *   DRY_RUN=true node scripts/migrate-legal-entities.js
 *
 * Environment:
 *   AUTH_DB            — defaults to hrms_auth
 *   POSTGRES_USER      — defaults to hrms
 *   POSTGRES_PASSWORD  — required
 *   POSTGRES_HOST      — defaults to localhost
 *   POSTGRES_PORT      — defaults to 5432
 *   DRY_RUN=true       — print intended changes without applying
 */

const { randomUUID } = require('crypto');

function deriveEntityCode(slug) {
  const code = String(slug || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return code || 'ENTITY';
}

function buildEntityFromTenant(tenant, profile) {
  return {
    tenantId: tenant.id,
    name: (profile && profile.legalName) || tenant.name,
    code: deriveEntityCode(tenant.slug),
    country: 'SG',
    currency: 'SGD',
    timezone: 'Asia/Singapore',
    registrationNo: (profile && profile.registrationNo) || null,
    isPrimary: true,
  };
}

async function run() {
  const { Client } = require('pg');
  const dryRun = process.env.DRY_RUN === 'true';

  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'hrms',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.AUTH_DB || 'hrms_auth',
  });
  await client.connect();

  const { rows: tenants } = await client.query(`
    SELECT t.id, t.name, t.slug, t.country,
           p."legalName" AS profile_legal_name,
           p."registrationNo" AS profile_registration_no
      FROM tenants t
      LEFT JOIN company_profiles p ON p."tenantId" = t.id
  `);

  let created = 0, skipped = 0;

  for (const row of tenants) {
    const { rows: existing } = await client.query(
      'SELECT id FROM legal_entities WHERE "tenantId" = $1 AND "isPrimary" = true LIMIT 1',
      [row.id],
    );
    if (existing.length) { skipped++; continue; }

    const entity = buildEntityFromTenant(
      { id: row.id, name: row.name, slug: row.slug, country: row.country },
      row.profile_legal_name
        ? { legalName: row.profile_legal_name, registrationNo: row.profile_registration_no }
        : null,
    );

    if (dryRun) {
      console.log(`[dry-run] would create entity ${entity.code} for tenant ${row.id}`);
    } else {
      await client.query(
        `INSERT INTO legal_entities
           (id, "tenantId", name, code, country, currency, timezone,
            "registrationNo", "isPrimary", "isActive", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,NOW(),NOW())`,
        [randomUUID(), entity.tenantId, entity.name, entity.code, entity.country,
         entity.currency, entity.timezone, entity.registrationNo],
      );
    }
    created++;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}tenants=${tenants.length} created=${created} skipped=${skipped}`);
  await client.end();
}

module.exports = { buildEntityFromTenant, deriveEntityCode, run };

if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest --projects scripts --runInBand
```

Expected: PASS — 9 tests.

- [ ] **Step 6: Dry-run against the local stack**

```bash
docker compose up -d postgres auth-service
docker compose exec auth-service npx prisma db push
DRY_RUN=true node scripts/migrate-legal-entities.js
```

Expected: one `[dry-run] would create entity ...` line per tenant, and a summary where `created` equals the tenant count and `skipped` is 0.

- [ ] **Step 7: Run for real, then confirm idempotence**

```bash
node scripts/migrate-legal-entities.js
node scripts/migrate-legal-entities.js
```

Expected: the first run reports `created=N skipped=0`; the second reports `created=0 skipped=N`.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate-legal-entities.js scripts/__tests__/migrate-legal-entities.unit.test.js \
        scripts/package.json jest.config.js
git commit -m "feat(entity): backfill one primary SG legal entity per tenant (ENT-003)"
```

---

## Task 5: `Employee.legalEntityId`

**Context:** `services/employee-service/prisma/schema.prisma:35` defines `Employee`. It has `department` and `costCentre` as free text but no entity concept. The column is nullable at first so `db push` succeeds against existing rows; the backfill then populates it.

**Files:**
- Modify: `services/employee-service/prisma/schema.prisma`
- Modify: `scripts/migrate-legal-entities.js` (add employee backfill)
- Test: `services/employee-service/__tests__/legal-entity.integration.test.js`

**Interfaces:**
- Consumes: `LegalEntity` (Task 1), `resolveEntity` (Task 2)
- Produces: `Employee.legalEntityId: String?` — populated for every employee after backfill

- [ ] **Step 1: Add the column**

In `services/employee-service/prisma/schema.prisma`, inside `model Employee`, add after the `tenantId` line:

```prisma
  legalEntityId       String?   // ENT-001 — the employing entity; drives country
```

and add to the model's index block:

```prisma
  @@index([legalEntityId])
```

- [ ] **Step 2: Write the failing test**

Create `services/employee-service/__tests__/legal-entity.integration.test.js`:

```javascript
'use strict';
const { assertEntityMatchesTenant } = require('../src/utils/entity-guard');

describe('assertEntityMatchesTenant', () => {
  const entity = { id: 'ent-1', tenantId: 'ten-1', country: 'SG' };

  test('passes when the entity belongs to the tenant', () => {
    expect(() => assertEntityMatchesTenant(entity, 'ten-1')).not.toThrow();
  });

  // Without this guard, a caller could attach an employee to another tenant's
  // entity and have their payroll computed under that tenant's country.
  test('throws when the entity belongs to a different tenant', () => {
    expect(() => assertEntityMatchesTenant(entity, 'ten-2'))
      .toThrow('Legal entity does not belong to this tenant');
  });

  test('throws when the entity is missing', () => {
    expect(() => assertEntityMatchesTenant(null, 'ten-1'))
      .toThrow('Legal entity not found');
  });

  test('the thrown error carries status 400', () => {
    try {
      assertEntityMatchesTenant(entity, 'ten-2');
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest --projects services/employee-service -t "assertEntityMatchesTenant" --runInBand
```

Expected: FAIL — `Cannot find module '../src/utils/entity-guard'`.

- [ ] **Step 4: Implement the guard**

Create `services/employee-service/src/utils/entity-guard.js`:

```javascript
'use strict';

/**
 * Rejects an employee↔entity assignment that crosses a tenant boundary.
 * Enforced at assignment time rather than at payroll time so a bad link can
 * never reach the compute path (spec §3.4).
 */
function assertEntityMatchesTenant(entity, tenantId) {
  if (!entity) {
    throw Object.assign(new Error('Legal entity not found'), { status: 400 });
  }
  if (entity.tenantId !== tenantId) {
    throw Object.assign(new Error('Legal entity does not belong to this tenant'), { status: 400 });
  }
}

module.exports = { assertEntityMatchesTenant };
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest --projects services/employee-service -t "assertEntityMatchesTenant" --runInBand
```

Expected: PASS — 4 tests.

- [ ] **Step 6: Add the employee backfill to the migration script**

In `scripts/migrate-legal-entities.js`, add this function and call it from `run()` after the tenant loop. Note it connects to a second database — `hrms_employee` — because employees live in a different service's DB.

```javascript
async function backfillEmployees(dryRun) {
  const { Client } = require('pg');
  const base = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'hrms',
    password: process.env.POSTGRES_PASSWORD,
  };

  const authDb = new Client({ ...base, database: process.env.AUTH_DB || 'hrms_auth' });
  const empDb  = new Client({ ...base, database: process.env.EMPLOYEE_DB || 'hrms_employee' });
  await authDb.connect();
  await empDb.connect();

  const { rows: entities } = await authDb.query(
    'SELECT id, "tenantId" FROM legal_entities WHERE "isPrimary" = true',
  );

  let updated = 0;
  for (const e of entities) {
    if (dryRun) {
      const { rows } = await empDb.query(
        'SELECT COUNT(*)::int AS n FROM employees WHERE "tenantId" = $1 AND "legalEntityId" IS NULL',
        [e.tenantId],
      );
      console.log(`[dry-run] would set legalEntityId=${e.id} on ${rows[0].n} employees`);
      updated += rows[0].n;
    } else {
      const r = await empDb.query(
        'UPDATE employees SET "legalEntityId" = $1 WHERE "tenantId" = $2 AND "legalEntityId" IS NULL',
        [e.id, e.tenantId],
      );
      updated += r.rowCount;
    }
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}employees backfilled=${updated}`);
  await authDb.end();
  await empDb.end();
}
```

Add `backfillEmployees` to the `module.exports` object, and call `await backfillEmployees(dryRun);` immediately before `await client.end();` in `run()`.

- [ ] **Step 7: Push the schema and run the backfill**

```bash
docker compose up -d postgres employee-service
docker compose exec employee-service npx prisma db push
DRY_RUN=true node scripts/migrate-legal-entities.js
node scripts/migrate-legal-entities.js
```

Expected: the dry run reports a non-zero employee count; the real run reports the same number backfilled.

- [ ] **Step 8: Verify no employee is left unassigned**

```bash
docker compose exec postgres psql -U hrms -d hrms_employee \
  -c 'SELECT COUNT(*) AS unassigned FROM employees WHERE "legalEntityId" IS NULL;'
```

Expected: `unassigned = 0`.

- [ ] **Step 9: Commit**

```bash
git add services/employee-service/prisma/schema.prisma \
        services/employee-service/src/utils/entity-guard.js \
        services/employee-service/__tests__/legal-entity.integration.test.js \
        scripts/migrate-legal-entities.js
git commit -m "feat(entity): Employee.legalEntityId + cross-tenant assignment guard"
```

---

## Task 6: `PayrollRun.legalEntityId` and the tenant-scoping constraint fix

**Context:** Two defects found during design, both in `services/payroll-service/prisma/schema.prisma`:

- Line 58: `@@unique([period, runType, periodHalf])` — **not tenant-scoped.** Two tenants cannot both run January 2026 monthly payroll; the second gets a Prisma `P2002`, which `payroll.routes.js:170` reports as "A payroll run for this period already exists".
- Line 290: `FwlRate.@@unique([sector, passType])` — same defect. (That table moves to the statutory service in Task 10; scope it correctly here so the interim state is sound.)

**Files:**
- Modify: `services/payroll-service/prisma/schema.prisma:58,290`
- Modify: `services/payroll-service/src/routes/payroll.routes.js:161-171`
- Test: `services/payroll-service/__tests__/payroll-run-scope.unit.test.js`

**Interfaces:**
- Consumes: `LegalEntity` (Task 1)
- Produces: `PayrollRun.legalEntityId: String?`; unique key `[tenantId, legalEntityId, period, runType, periodHalf]`

- [ ] **Step 1: Write the failing test**

Create `services/payroll-service/__tests__/payroll-run-scope.unit.test.js`:

```javascript
'use strict';
const { buildRunUniqueWhere } = require('../src/utils/run-scope');

describe('buildRunUniqueWhere', () => {
  // Regression guard for the cross-tenant collision: before this fix the
  // unique key omitted tenantId, so tenant B creating 2026-01 MONTHLY after
  // tenant A received a spurious 409.
  test('includes tenantId and legalEntityId in the key', () => {
    expect(buildRunUniqueWhere({
      tenantId: 'ten-1', legalEntityId: 'ent-1',
      period: '2026-01', runType: 'MONTHLY', periodHalf: null,
    })).toEqual({
      tenantId_legalEntityId_period_runType_periodHalf: {
        tenantId: 'ten-1', legalEntityId: 'ent-1',
        period: '2026-01', runType: 'MONTHLY', periodHalf: null,
      },
    });
  });

  test('two tenants with the same period produce different keys', () => {
    const a = buildRunUniqueWhere({ tenantId: 'ten-1', legalEntityId: 'ent-1', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    const b = buildRunUniqueWhere({ tenantId: 'ten-2', legalEntityId: 'ent-2', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    expect(a).not.toEqual(b);
  });

  // A group tenant's SG and MY entities both run January — must not collide.
  test('two entities of one tenant produce different keys', () => {
    const sg = buildRunUniqueWhere({ tenantId: 'ten-1', legalEntityId: 'ent-sg', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    const my = buildRunUniqueWhere({ tenantId: 'ten-1', legalEntityId: 'ent-my', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    expect(sg).not.toEqual(my);
  });

  test('throws when legalEntityId is absent', () => {
    expect(() => buildRunUniqueWhere({ tenantId: 'ten-1', period: '2026-01', runType: 'MONTHLY', periodHalf: null }))
      .toThrow('legalEntityId is required');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest --projects services/payroll-service -t "buildRunUniqueWhere" --runInBand
```

Expected: FAIL — `Cannot find module '../src/utils/run-scope'`.

- [ ] **Step 3: Implement the helper**

Create `services/payroll-service/src/utils/run-scope.js`:

```javascript
'use strict';

/**
 * Builds the Prisma compound-unique `where` for a payroll run.
 *
 * The previous key was [period, runType, periodHalf] with no tenant dimension,
 * so any two tenants collided on the same period. It also has to carry
 * legalEntityId now: a group tenant legitimately runs January payroll once per
 * entity.
 */
function buildRunUniqueWhere({ tenantId, legalEntityId, period, runType, periodHalf = null }) {
  if (!legalEntityId) throw new Error('legalEntityId is required');
  return {
    tenantId_legalEntityId_period_runType_periodHalf: {
      tenantId, legalEntityId, period, runType, periodHalf,
    },
  };
}

module.exports = { buildRunUniqueWhere };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest --projects services/payroll-service -t "buildRunUniqueWhere" --runInBand
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Fix the schema**

In `services/payroll-service/prisma/schema.prisma`, in `model PayrollRun` add after the `tenantId` line:

```prisma
  legalEntityId   String?       // ENT-001 — the entity this run belongs to
  country         String?       // denormalised from the entity for reporting
  currency        String?       // denormalised from the entity
  rateVersion     String?       // ENT-006 — statutory rate version used
```

Replace line 58:

```prisma
  @@unique([period, runType, periodHalf])
```

with:

```prisma
  @@unique([tenantId, legalEntityId, period, runType, periodHalf])
  @@index([legalEntityId])
```

And in `model FwlRate`, replace `@@unique([sector, passType])` with:

```prisma
  @@unique([tenantId, sector, passType])
```

- [ ] **Step 6: Wire the run-creation site**

In `services/payroll-service/src/routes/payroll.routes.js` at the `prisma.payrollRun.create` call (currently line 161), add `legalEntityId` to the `data` object, sourced from `req.body.legalEntityId`, and reject when absent:

```javascript
    const { legalEntityId } = req.body || {};
    if (!legalEntityId) {
      return res.status(400).json({ error: 'legalEntityId is required to create a payroll run' });
    }

    const run = await prisma.payrollRun.create({
      data: {
        id: uuidv4(), period, runType: RT, periodHalf, status: 'DRAFT',
        initiatedBy: req.user.sub, employeeGroup,
        paymentDate: resolvedPaymentDate,
        legalEntityId,
      },
    });
```

Update the `P2002` handler (line 170) so the message is accurate now that the key is scoped:

```javascript
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'A payroll run for this period already exists for this legal entity.',
      });
    }
```

- [ ] **Step 7: Add the payroll-run backfill to the migration script**

In `scripts/migrate-legal-entities.js`, add a `backfillPayrollRuns(dryRun)` function mirroring `backfillEmployees`, but against `process.env.PAYROLL_DB || 'hrms_payroll'` and the `payroll_runs` table:

```javascript
async function backfillPayrollRuns(dryRun) {
  const { Client } = require('pg');
  const base = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'hrms',
    password: process.env.POSTGRES_PASSWORD,
  };

  const authDb = new Client({ ...base, database: process.env.AUTH_DB || 'hrms_auth' });
  const payDb  = new Client({ ...base, database: process.env.PAYROLL_DB || 'hrms_payroll' });
  await authDb.connect();
  await payDb.connect();

  const { rows: entities } = await authDb.query(
    'SELECT id, "tenantId" FROM legal_entities WHERE "isPrimary" = true',
  );

  let updated = 0;
  for (const e of entities) {
    if (dryRun) {
      const { rows } = await payDb.query(
        'SELECT COUNT(*)::int AS n FROM payroll_runs WHERE "tenantId" = $1 AND "legalEntityId" IS NULL',
        [e.tenantId],
      );
      console.log(`[dry-run] would set legalEntityId=${e.id} on ${rows[0].n} payroll runs`);
      updated += rows[0].n;
    } else {
      const r = await payDb.query(
        `UPDATE payroll_runs
            SET "legalEntityId" = $1, country = 'SG', currency = 'SGD'
          WHERE "tenantId" = $2 AND "legalEntityId" IS NULL`,
        [e.id, e.tenantId],
      );
      updated += r.rowCount;
    }
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}payroll runs backfilled=${updated}`);
  await authDb.end();
  await payDb.end();
}
```

Export it and call it from `run()` after `backfillEmployees`.

**Order matters:** run the backfill *before* `prisma db push` applies the new unique constraint, or rows with `legalEntityId = NULL` may collide.

- [ ] **Step 8: Run the full payroll suite**

```bash
npx jest --projects services/payroll-service --runInBand
```

Expected: PASS. Any test that creates a run now needs `legalEntityId` in the request body — update those call sites in the test files rather than relaxing the route's validation.

- [ ] **Step 9: Commit**

```bash
git add services/payroll-service/prisma/schema.prisma \
        services/payroll-service/src/utils/run-scope.js \
        services/payroll-service/src/routes/payroll.routes.js \
        services/payroll-service/__tests__/ \
        scripts/migrate-legal-entities.js
git commit -m "fix(payroll): tenant-scope the run unique key; add legalEntityId

The unique key was [period, runType, periodHalf] with no tenant dimension, so
two tenants could not both run the same period — the second received a P2002
surfaced as a misleading 'run already exists' 409. Adds legalEntityId so a
group tenant can run one payroll per entity per period."
```

---

## Task 7: `PublicHoliday` per entity

**Context:** `services/payroll-service/prisma/schema.prisma:303` has `@@unique([tenantId, date])`, which prevents a tenant holding a Singapore and a Malaysian holiday on the same calendar date. `countWorkingDays` in `shared/payroll-utils` consumes the holiday set.

**Files:**
- Modify: `services/payroll-service/prisma/schema.prisma:296-307`
- Modify: `scripts/migrate-legal-entities.js`
- Test: `services/payroll-service/__tests__/public-holiday-scope.unit.test.js`

**Interfaces:**
- Consumes: `LegalEntity` (Task 1)
- Produces: `PublicHoliday.legalEntityId: String?`, `country: String?`, `state: String?`; unique `[tenantId, legalEntityId, date]`

- [ ] **Step 1: Write the failing test**

Create `services/payroll-service/__tests__/public-holiday-scope.unit.test.js`:

```javascript
'use strict';
const { buildHolidaySet } = require('../src/utils/holiday-scope');

const HOLIDAYS = [
  { date: new Date('2026-05-01T00:00:00Z'), name: 'Labour Day',      legalEntityId: 'ent-sg' },
  { date: new Date('2026-05-01T00:00:00Z'), name: 'Hari Pekerja',    legalEntityId: 'ent-my' },
  { date: new Date('2026-08-09T00:00:00Z'), name: 'National Day',    legalEntityId: 'ent-sg' },
  { date: new Date('2026-08-31T00:00:00Z'), name: 'Hari Merdeka',    legalEntityId: 'ent-my' },
];

describe('buildHolidaySet', () => {
  test('returns only the requested entity holidays', () => {
    const set = buildHolidaySet(HOLIDAYS, 'ent-sg');
    expect(set.has('2026-05-01')).toBe(true);
    expect(set.has('2026-08-09')).toBe(true);
    expect(set.has('2026-08-31')).toBe(false);
  });

  // The old [tenantId, date] unique key made this row pair impossible to store.
  test('two entities can hold different holidays on the same date', () => {
    expect(buildHolidaySet(HOLIDAYS, 'ent-sg').has('2026-05-01')).toBe(true);
    expect(buildHolidaySet(HOLIDAYS, 'ent-my').has('2026-05-01')).toBe(true);
  });

  test('returns an empty set for an unknown entity', () => {
    expect(buildHolidaySet(HOLIDAYS, 'ent-none').size).toBe(0);
  });

  // Dates are keyed as UTC-anchored YYYY-MM-DD, matching lib/timezone's
  // convention. Local getters would shift the day for any +08 machine.
  test('keys dates as UTC YYYY-MM-DD', () => {
    expect([...buildHolidaySet(HOLIDAYS, 'ent-my')].sort())
      .toEqual(['2026-05-01', '2026-08-31']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest --projects services/payroll-service -t "buildHolidaySet" --runInBand
```

Expected: FAIL — `Cannot find module '../src/utils/holiday-scope'`.

- [ ] **Step 3: Implement the helper**

Create `services/payroll-service/src/utils/holiday-scope.js`:

```javascript
'use strict';

/**
 * Narrows a tenant's holiday rows to one legal entity and keys them as
 * UTC-anchored YYYY-MM-DD, matching the convention in frontend/src/lib/timezone.ts
 * and shared/payroll-utils countWorkingDays.
 */
function buildHolidaySet(holidays, legalEntityId) {
  const set = new Set();
  for (const h of holidays) {
    if (h.legalEntityId !== legalEntityId) continue;
    set.add(new Date(h.date).toISOString().slice(0, 10));
  }
  return set;
}

module.exports = { buildHolidaySet };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest --projects services/payroll-service -t "buildHolidaySet" --runInBand
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Fix the schema**

In `model PublicHoliday`, add:

```prisma
  legalEntityId String?
  country       String?
  state         String?
```

and replace `@@unique([tenantId, date])` with:

```prisma
  @@unique([tenantId, legalEntityId, date])
  @@index([legalEntityId])
```

- [ ] **Step 6: Backfill holidays in the migration script**

Add to `scripts/migrate-legal-entities.js`:

```javascript
async function backfillPublicHolidays(dryRun) {
  const { Client } = require('pg');
  const base = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'hrms',
    password: process.env.POSTGRES_PASSWORD,
  };

  const authDb = new Client({ ...base, database: process.env.AUTH_DB || 'hrms_auth' });
  const payDb  = new Client({ ...base, database: process.env.PAYROLL_DB || 'hrms_payroll' });
  await authDb.connect();
  await payDb.connect();

  const { rows: entities } = await authDb.query(
    'SELECT id, "tenantId" FROM legal_entities WHERE "isPrimary" = true',
  );

  let updated = 0;
  for (const e of entities) {
    if (dryRun) {
      const { rows } = await payDb.query(
        'SELECT COUNT(*)::int AS n FROM public_holidays WHERE "tenantId" = $1 AND "legalEntityId" IS NULL',
        [e.tenantId],
      );
      console.log(`[dry-run] would set legalEntityId=${e.id} on ${rows[0].n} public holidays`);
      updated += rows[0].n;
    } else {
      const r = await payDb.query(
        `UPDATE public_holidays
            SET "legalEntityId" = $1, country = 'SG'
          WHERE "tenantId" = $2 AND "legalEntityId" IS NULL`,
        [e.id, e.tenantId],
      );
      updated += r.rowCount;
    }
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}public holidays backfilled=${updated}`);
  await authDb.end();
  await payDb.end();
}
```

Add `backfillPublicHolidays` to `module.exports` and call `await backfillPublicHolidays(dryRun);` from `run()` after `backfillPayrollRuns`.

**Run the backfill before `db push` applies the new unique key**, for the same reason as Task 6: rows sharing a null `legalEntityId` would collide.

- [ ] **Step 7: Run the full payroll suite**

```bash
npx jest --projects services/payroll-service --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/payroll-service/prisma/schema.prisma \
        services/payroll-service/src/utils/holiday-scope.js \
        services/payroll-service/__tests__/public-holiday-scope.unit.test.js \
        scripts/migrate-legal-entities.js
git commit -m "fix(payroll): scope public holidays per legal entity

[tenantId, date] prevented a group tenant holding an SG and an MY holiday on
the same calendar date, which blocks multi-entity outright."
```

**P0 complete.** Everything to this point is additive and Singapore-only.

---

## Task 8: Scaffold `statutory-sg-service`

**Context:** Copy the service shape from `services/loans-service` — same Dockerfile layout, same `package.json` structure. Port 4021 (4001-4020 are taken; `admin-service` already occupies 4016 and the gateway's `benefits` default collides with it, so do not reuse anything below 4021).

**Files:**
- Create: `services/statutory-sg-service/{package.json,Dockerfile,src/index.js,prisma/schema.prisma}`
- Create: `services/statutory-sg-service/__mocks__/auth-middleware.js`
- Modify: `docker-compose.yml`, `scripts/init-dbs.sql`, `jest.config.js`
- Test: `services/statutory-sg-service/__tests__/health.integration.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `GET /health` → `200 { service: 'statutory-sg-service', status: 'ok', country: 'SG' }`

- [ ] **Step 1: Write the failing test**

Create `services/statutory-sg-service/__tests__/health.integration.test.js`:

```javascript
'use strict';
const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  test('reports service identity and country', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('statutory-sg-service');
    expect(res.body.status).toBe('ok');
    expect(res.body.country).toBe('SG');
  });
});
```

- [ ] **Step 2: Create `package.json`**

Create `services/statutory-sg-service/package.json`:

```json
{
  "name": "@hrms/statutory-sg-service",
  "version": "1.0.0",
  "description": "Singapore statutory computation (CPF, SDL, FWL)",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "jest --runInBand",
    "prisma:generate": "prisma generate"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.js"],
    "moduleNameMapper": {
      "/app/shared/auth-middleware": "<rootDir>/__mocks__/auth-middleware.js"
    }
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.1",
    "helmet": "^8.0.0",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "nodemon": "^3.1.7",
    "prisma": "^5.22.0",
    "supertest": "^7.2.2"
  }
}
```

- [ ] **Step 3: Create the auth-middleware mock**

Create `services/statutory-sg-service/__mocks__/auth-middleware.js`:

```javascript
'use strict';
module.exports = {
  authenticate: (req, _res, next) => { req.user = { sub: 'svc', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER', EMPLOYEE: 'EMPLOYEE' },
};
```

- [ ] **Step 4: Create the app and entrypoint**

The app is split from the listener so Supertest can import it without binding a port.

Create `services/statutory-sg-service/src/app.js`:

```javascript
'use strict';
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' })); // batch payloads carry many employees
app.use(morgan('combined'));

app.get('/health', (_req, res) =>
  res.json({ service: 'statutory-sg-service', status: 'ok', country: 'SG', ts: new Date() }));

app.use((err, _req, res, _next) => {
  console.error('[statutory-sg]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

module.exports = app;
```

Create `services/statutory-sg-service/src/index.js`:

```javascript
'use strict';
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 4021;
app.listen(PORT, () => console.log(`[statutory-sg-service] listening on ${PORT}`));
```

- [ ] **Step 5: Create the Prisma schema**

Create `services/statutory-sg-service/prisma/schema.prisma`. Note the **absence of `tenantId`** — these tables are global (ENT-004).

```prisma
// Singapore statutory rate tables.
// GLOBAL — no tenantId. Platform-managed, versioned, tenant read-only (ENT-004).

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model RateVersion {
  id            String   @id @default(uuid())
  country       String   @default("SG")
  version       String   @unique  // e.g. "SG-2026.1"
  effectiveFrom DateTime
  source        String             // provenance, e.g. "CPF Board rate table 1 Jan 2026"
  retrievedAt   DateTime           // when the figures were taken from the source
  isActive      Boolean  @default(false)
  createdAt     DateTime @default(now())

  @@index([country, effectiveFrom])
  @@map("rate_versions")
}

model CpfRate {
  id            String   @id @default(uuid())
  rateVersion   String
  citizenStatus String   // SC_PR | PR_YEAR1 | PR_YEAR2 | FOREIGNER
  ageMin        Int
  ageMax        Int?     // null = no upper bound
  employeeRate  Float
  employerRate  Float
  owCeiling     Float
  awCeiling     Float
  createdAt     DateTime @default(now())

  @@unique([rateVersion, citizenStatus, ageMin])
  @@index([rateVersion])
  @@map("cpf_rates")
}

model SdlConfig {
  id          String   @id @default(uuid())
  rateVersion String   @unique
  rate        Float    @default(0.0025)
  minAmount   Float    @default(2.00)
  maxAmount   Float    @default(11.25)
  salaryCap   Float    @default(4500)
  createdAt   DateTime @default(now())

  @@map("sdl_config")
}

model FwlRate {
  id          String   @id @default(uuid())
  rateVersion String
  passType    String   // WP | S_PASS
  sector      String   // SERVICES | CONSTRUCTION | MARINE | PROCESS | MANUFACTURING
  tier        String   // BASIC_SKILLED | HIGHER_SKILLED | TIER1 | TIER2
  dailyRate   Float
  createdAt   DateTime @default(now())

  @@unique([rateVersion, passType, sector, tier])
  @@index([rateVersion])
  @@map("fwl_rates")
}
```

- [ ] **Step 6: Create the Dockerfile**

Create `services/statutory-sg-service/Dockerfile`:

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY shared /app/shared
RUN cd /app/shared/auth-middleware && npm install

WORKDIR /app/services/statutory-sg-service
COPY services/statutory-sg-service/package*.json ./
RUN npm install --omit=dev
COPY services/statutory-sg-service/ ./
RUN npx prisma generate
EXPOSE 4021
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/index.js"]
```

- [ ] **Step 7: Register the service in all three required places**

**7a.** Add to `docker-compose.yml`, after the `payroll-service` block:

```yaml
  # Singapore statutory computation (CPF, SDL, FWL). Owns the global,
  # platform-managed rate tables — no tenantId on any row (ENT-004).
  statutory-sg-service:
    build:
      context: .
      dockerfile: services/statutory-sg-service/Dockerfile
    container_name: hrms-statutory-sg
    init: true
    restart: unless-stopped
    ports:
      - "127.0.0.1:${STATUTORY_SG_SERVICE_PORT:-4021}:4021"
    environment:
      - NODE_ENV=${NODE_ENV:-development}
      - PORT=4021
      - DATABASE_URL=postgresql://${POSTGRES_USER:-hrms}:${POSTGRES_PASSWORD}@postgres:5432/hrms_statutory_sg
      - INTERNAL_SERVICE_KEY=${INTERNAL_SERVICE_KEY}
      - JWT_PUBLIC_KEY_PATH=/app/certs/public.pem
    volumes:
      - shared_certs:/app/certs:ro
    depends_on:
      postgres:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 128m
        reservations:
          memory: 64m
```

**7b.** Add to `scripts/init-dbs.sql`:

```sql
CREATE DATABASE hrms_statutory_sg;
GRANT ALL PRIVILEGES ON DATABASE hrms_statutory_sg TO hrms;
```

`init-dbs.sql` only runs when the Postgres data directory is empty, so **existing deployments need the database created manually**:

```bash
docker compose exec postgres psql -U hrms -d postgres \
  -c 'CREATE DATABASE hrms_statutory_sg;' \
  -c 'GRANT ALL PRIVILEGES ON DATABASE hrms_statutory_sg TO hrms;'
```

**7c.** Add `'<rootDir>/services/statutory-sg-service'` to `projects` in `jest.config.js`.

- [ ] **Step 8: Run the test to verify it passes**

```bash
npm --prefix services/statutory-sg-service install
npx jest --projects services/statutory-sg-service --runInBand
```

Expected: PASS — 1 test.

- [ ] **Step 9: Verify the container builds and answers**

```bash
docker compose build statutory-sg-service
docker compose up -d statutory-sg-service
curl -fsS http://127.0.0.1:4021/health
```

Expected: `{"service":"statutory-sg-service","status":"ok","country":"SG",...}`.

- [ ] **Step 10: Commit**

```bash
git add services/statutory-sg-service docker-compose.yml scripts/init-dbs.sql jest.config.js
git commit -m "feat(statutory): scaffold statutory-sg-service on 4021

Registered in docker-compose.yml, init-dbs.sql and the root jest projects
array — six existing services are gateway-routed but missing from compose;
this one must not join them."
```

---

## Task 9: Move the CPF/SDL engine and its tests

**Context:** `shared/payroll-utils/index.js` (141 lines) holds `computeCpf`, `computeSdl`, `computeOtPay`, `computeNplDeduction`, `computeAws`, `computeFwl`, `computeNetPay`, `cpfRound`, `countWorkingDays`, `countPeriodLeaveWorkingDays`. Its tests are `services/payroll-service/__tests__/payroll-utils.unit.test.js`.

**The split matters.** Only the *statutory* functions move: `computeCpf`, `computeSdl`, `computeFwl`, `cpfRound`. The rest — `computeOtPay`, `computeNplDeduction`, `computeAws`, `computeNetPay`, `countWorkingDays`, `countPeriodLeaveWorkingDays` — are generic payroll arithmetic that the run lifecycle needs regardless of country, so they stay in `shared/payroll-utils`. (`computeOtPay`'s multiplier becomes country-supplied in P4; the function itself is generic.)

**Files:**
- Create: `services/statutory-sg-service/src/engines/cpf.engine.js`
- Create: `services/statutory-sg-service/__tests__/cpf.engine.unit.test.js`
- Modify: `shared/payroll-utils/index.js` (remove the four moved functions)
- Modify: `services/payroll-service/__tests__/payroll-utils.unit.test.js` (drop the moved describes)

**Interfaces:**
- Consumes: nothing
- Produces, from `services/statutory-sg-service/src/engines/cpf.engine.js`:
  - `computeCpf({ ow, aw, ytdOw, ytdAw, citizenStatus, age, rates }) → { employeeOw, employerOw, employeeAw, employerAw, totalEmployee, totalEmployer, owSubjectToCpf, awSubjectToCpf }`
  - `computeSdl(grossMonthlyRemuneration, config) → number`
  - `computeFwl(dailyRate, daysInMonth) → number`
  - `cpfRound(amount) → number`

- [ ] **Step 1: Copy the engine into the new service**

Create `services/statutory-sg-service/src/engines/cpf.engine.js` containing `computeCpf`, `computeSdl`, `computeFwl` and `cpfRound` copied **verbatim** from `shared/payroll-utils/index.js` — including the CPF Board 3-step rounding comment block at the top, which documents the compliance basis.

Do not "improve" anything while moving. Behaviour must be identical; this task's whole purpose is a provably behaviour-preserving move.

Export exactly:

```javascript
module.exports = { computeCpf, computeSdl, computeFwl, cpfRound };
```

- [ ] **Step 2: Move the tests**

Create `services/statutory-sg-service/__tests__/cpf.engine.unit.test.js` by copying `services/payroll-service/__tests__/payroll-utils.unit.test.js` and:

- changing the import to `const { computeCpf, computeSdl, computeFwl, cpfRound } = require('../src/engines/cpf.engine');`
- keeping only the `describe` blocks covering `computeCpf`, `computeSdl`, `computeFwl` and `cpfRound`
- keeping every assertion byte-identical

- [ ] **Step 3: Run the moved tests**

```bash
npx jest --projects services/statutory-sg-service --runInBand
```

Expected: PASS, with the same number of CPF/SDL/FWL assertions that passed before the move.

- [ ] **Step 4: Remove the moved functions from the shared module**

Delete `computeCpf`, `computeSdl`, `computeFwl` and `cpfRound` from `shared/payroll-utils/index.js` and from its `module.exports`. Leave `computeOtPay`, `computeNplDeduction`, `computeAws`, `computeNetPay`, `countWorkingDays` and `countPeriodLeaveWorkingDays` in place.

- [ ] **Step 5: Trim the old test file**

In `services/payroll-service/__tests__/payroll-utils.unit.test.js`, remove the `describe` blocks for the four moved functions and drop them from the destructured import. Everything else stays.

- [ ] **Step 6: Run both suites**

```bash
npx jest --projects services/statutory-sg-service --runInBand
npx jest --projects services/payroll-service --runInBand
```

Expected: the statutory suite passes. The payroll suite will **fail** at `payroll.routes.js:11`, which still imports `computeCpf`/`computeSdl` from the removed shared module. That failure is expected and is fixed in Task 13 — do not paper over it by re-adding the functions.

- [ ] **Step 7: Commit**

```bash
git add services/statutory-sg-service/src/engines/cpf.engine.js \
        services/statutory-sg-service/__tests__/cpf.engine.unit.test.js \
        shared/payroll-utils/index.js \
        services/payroll-service/__tests__/payroll-utils.unit.test.js
git commit -m "refactor(statutory): move CPF/SDL/FWL computation into statutory-sg-service

Statutory functions only. Generic payroll arithmetic (OT, NPL, AWS, net pay,
working-day counting) stays in shared/payroll-utils — it is country-agnostic.
payroll-service is intentionally left broken until Task 13 wires the client."
```

---

## Task 10: Rate tables, versioning, and the divergence report

**Context:** ENT-004 makes rate tables global. Existing per-tenant rows live in each deployment's `hrms_payroll.cpf_rates`. Because `scripts/migrate-cpf-jan2026.js` had to be run per deployment, some tenants may hold stale rates — the migration must surface those rather than silently overwrite.

**Files:**
- Create: `services/statutory-sg-service/src/seed/sg-2026-1.js`
- Create: `scripts/migrate-statutory-tables-sg.js`
- Test: `scripts/__tests__/migrate-statutory-tables-sg.unit.test.js`

**Interfaces:**
- Consumes: `CpfRate`, `SdlConfig`, `RateVersion` (Task 8)
- Produces:
  - `SG_2026_1 = { version, effectiveFrom, source, retrievedAt, cpfRates: [...], sdlConfig: {...} }`
  - `diffRateRows(canonical, actual) → [{ citizenStatus, ageMin, field, expected, found }]`

- [ ] **Step 1: Write the failing test for the diff helper**

Create `scripts/__tests__/migrate-statutory-tables-sg.unit.test.js`:

```javascript
'use strict';
const { diffRateRows } = require('../migrate-statutory-tables-sg');

const CANONICAL = [
  { citizenStatus: 'SC_PR', ageMin: 0,  ageMax: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 8000 },
  { citizenStatus: 'SC_PR', ageMin: 55, ageMax: 60, employeeRate: 0.18, employerRate: 0.16, owCeiling: 8000 },
];

describe('diffRateRows', () => {
  test('reports nothing when the tenant matches canonical', () => {
    expect(diffRateRows(CANONICAL, CANONICAL)).toEqual([]);
  });

  // The exact drift the Jan 2026 migration was meant to fix. A tenant that
  // never received it is still on the old 16%/15% band and has been
  // under-contributing CPF for senior workers.
  test('reports a stale rate', () => {
    const stale = [CANONICAL[0], { ...CANONICAL[1], employeeRate: 0.16 }];
    expect(diffRateRows(CANONICAL, stale)).toEqual([
      { citizenStatus: 'SC_PR', ageMin: 55, field: 'employeeRate', expected: 0.18, found: 0.16 },
    ]);
  });

  test('reports a stale OW ceiling', () => {
    const stale = [{ ...CANONICAL[0], owCeiling: 6800 }, CANONICAL[1]];
    expect(diffRateRows(CANONICAL, stale)).toEqual([
      { citizenStatus: 'SC_PR', ageMin: 0, field: 'owCeiling', expected: 8000, found: 6800 },
    ]);
  });

  test('reports a missing row', () => {
    expect(diffRateRows(CANONICAL, [CANONICAL[0]])).toEqual([
      { citizenStatus: 'SC_PR', ageMin: 55, field: 'row', expected: 'present', found: 'missing' },
    ]);
  });

  test('reports every differing field on one row', () => {
    const stale = [CANONICAL[0], { ...CANONICAL[1], employeeRate: 0.16, employerRate: 0.15 }];
    expect(diffRateRows(CANONICAL, stale)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest --projects scripts -t "diffRateRows" --runInBand
```

Expected: FAIL — `Cannot find module '../migrate-statutory-tables-sg'`.

- [ ] **Step 3: Create the canonical seed with provenance**

Create `services/statutory-sg-service/src/seed/sg-2026-1.js`. Transcribe the rate rows from `scripts/seed.js` (which already carries the verified Jan 2026 values) — do not retype them from memory.

```javascript
'use strict';
/**
 * Canonical Singapore statutory rates, version SG-2026.1.
 *
 * PROVENANCE IS PART OF THE DATA (PRD §A7.1). Every value here is traceable to
 * the source named below. Transcribe from scripts/seed.js, which already holds
 * the verified Jan 2026 figures — do not retype from memory.
 */
const SG_2026_1 = {
  version: 'SG-2026.1',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  source: 'CPF Board — CPF Contribution Rate Table from 1 January 2026 (Tables 1, 2, 3)',
  retrievedAt: new Date('2026-05-22T00:00:00Z'),
  cpfRates: [
    // TRANSCRIBE — do not retype from memory. Read the canonical rows with:
    //   grep -n "cpf_rates\|citizenStatus" -A 12 scripts/seed.js
    // and copy each row across as:
    //   { citizenStatus, ageMin, ageMax, employeeRate, employerRate,
    //     owCeiling: 8000, awCeiling: 102000 }
    // scripts/seed.js already holds the verified Jan 2026 values (TESTING.md §11
    // records the verification against the CPF Board PDF). Task 10 Step 6's
    // divergence report will fail loudly if a row is transcribed wrongly, since
    // every tenant would then be reported as diverging from canonical.
  ],
  sdlConfig: { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500 },
};

module.exports = { SG_2026_1 };
```

- [ ] **Step 4: Implement the migration and diff**

Create `scripts/migrate-statutory-tables-sg.js`:

```javascript
'use strict';
/**
 * Migration (ENT-004): hoist per-tenant Singapore rate tables into the global,
 * platform-managed tables in hrms_statutory_sg.
 *
 * COPIES rather than moves — the per-tenant rows in hrms_payroll are left intact
 * so this is reversible. A later release drops them.
 *
 * Emits a DIVERGENCE REPORT naming any tenant whose rates differ from canonical.
 * Because scripts/migrate-cpf-jan2026.js had to be run against every deployment
 * individually, a tenant that never received it is still computing CPF on the
 * pre-2026 bands. That report identifies exactly which customers are affected —
 * worth producing regardless of Malaysia.
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-statutory-tables-sg.js
 *   node scripts/migrate-statutory-tables-sg.js
 */

const COMPARED_FIELDS = ['employeeRate', 'employerRate', 'owCeiling'];

function diffRateRows(canonical, actual) {
  const diffs = [];
  for (const c of canonical) {
    const found = actual.find(a => a.citizenStatus === c.citizenStatus && a.ageMin === c.ageMin);
    if (!found) {
      diffs.push({ citizenStatus: c.citizenStatus, ageMin: c.ageMin, field: 'row', expected: 'present', found: 'missing' });
      continue;
    }
    for (const field of COMPARED_FIELDS) {
      if (c[field] !== undefined && found[field] !== c[field]) {
        diffs.push({ citizenStatus: c.citizenStatus, ageMin: c.ageMin, field, expected: c[field], found: found[field] });
      }
    }
  }
  return diffs;
}

module.exports = { diffRateRows };
```

Then append the `run()` implementation to the same file:

```javascript
const { randomUUID } = require('crypto');
const { SG_2026_1 } = require('../services/statutory-sg-service/src/seed/sg-2026-1');

async function run() {
  const { Client } = require('pg');
  const dryRun = process.env.DRY_RUN === 'true';
  const base = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'hrms',
    password: process.env.POSTGRES_PASSWORD,
  };

  const payDb  = new Client({ ...base, database: process.env.PAYROLL_DB || 'hrms_payroll' });
  const statDb = new Client({ ...base, database: process.env.STATUTORY_SG_DB || 'hrms_statutory_sg' });
  await payDb.connect();
  await statDb.connect();

  // ── 1. Insert the canonical global rate set (idempotent) ──
  const { rows: existing } = await statDb.query(
    'SELECT version FROM rate_versions WHERE version = $1', [SG_2026_1.version],
  );

  if (existing.length) {
    console.log(`rate version ${SG_2026_1.version} already present — skipping insert`);
  } else if (dryRun) {
    console.log(`[dry-run] would insert ${SG_2026_1.version} with ${SG_2026_1.cpfRates.length} CPF rows`);
  } else {
    await statDb.query('BEGIN');
    await statDb.query(
      `INSERT INTO rate_versions (id, country, version, "effectiveFrom", source, "retrievedAt", "isActive", "createdAt")
       VALUES ($1,'SG',$2,$3,$4,$5,true,NOW())`,
      [randomUUID(), SG_2026_1.version, SG_2026_1.effectiveFrom, SG_2026_1.source, SG_2026_1.retrievedAt],
    );
    for (const r of SG_2026_1.cpfRates) {
      await statDb.query(
        `INSERT INTO cpf_rates (id, "rateVersion", "citizenStatus", "ageMin", "ageMax",
                                "employeeRate", "employerRate", "owCeiling", "awCeiling", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [randomUUID(), SG_2026_1.version, r.citizenStatus, r.ageMin, r.ageMax,
         r.employeeRate, r.employerRate, r.owCeiling, r.awCeiling],
      );
    }
    const s = SG_2026_1.sdlConfig;
    await statDb.query(
      `INSERT INTO sdl_config (id, "rateVersion", rate, "minAmount", "maxAmount", "salaryCap", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [randomUUID(), SG_2026_1.version, s.rate, s.minAmount, s.maxAmount, s.salaryCap],
    );
    await statDb.query('COMMIT');
    console.log(`inserted ${SG_2026_1.version} with ${SG_2026_1.cpfRates.length} CPF rows`);
  }

  // ── 2. Divergence report — which tenants were computing on different rates ──
  const { rows: tenants } = await payDb.query(
    'SELECT DISTINCT "tenantId" FROM cpf_rates WHERE "isActive" = true',
  );

  let diverged = 0;
  for (const { tenantId } of tenants) {
    const { rows: tenantRates } = await payDb.query(
      `SELECT "citizenStatus", "ageMin", "ageMax", "employeeRate", "employerRate", "owCeiling"
         FROM cpf_rates WHERE "tenantId" = $1 AND "isActive" = true`,
      [tenantId],
    );
    const diffs = diffRateRows(SG_2026_1.cpfRates, tenantRates);
    if (diffs.length === 0) {
      console.log(`  tenant ${tenantId}: matches ${SG_2026_1.version}`);
    } else {
      diverged++;
      console.log(`  tenant ${tenantId}: ${diffs.length} DIVERGENCE(S)`);
      for (const d of diffs) {
        console.log(`    ${d.citizenStatus} age>=${d.ageMin} ${d.field}: expected ${d.expected}, found ${d.found}`);
      }
    }
  }

  console.log(`\ntenants=${tenants.length} matching=${tenants.length - diverged} diverged=${diverged}`);
  if (diverged > 0) {
    console.log('DIVERGENCE FOUND — these tenants computed CPF on different rates. Review before proceeding.');
  }

  await payDb.end();
  await statDb.end();
}

module.exports = { diffRateRows, run };

if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}
```

Replace the earlier bare `module.exports = { diffRateRows };` line with the version above — there must be exactly one `module.exports` in the file.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest --projects scripts -t "diffRateRows" --runInBand
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Dry-run and read the divergence report**

```bash
docker compose up -d statutory-sg-service
DRY_RUN=true node scripts/migrate-statutory-tables-sg.js
```

Expected: the canonical version is reported as pending insert, and each tenant is listed as either matching canonical or with a specific field-level divergence.

**If any tenant diverges, stop and report it before continuing.** A divergence means that customer's historical CPF was computed on different rates, which is a compliance finding, not a migration detail.

- [ ] **Step 7: Apply**

```bash
node scripts/migrate-statutory-tables-sg.js
docker compose exec postgres psql -U hrms -d hrms_statutory_sg \
  -c 'SELECT version, "isActive" FROM rate_versions;' \
  -c 'SELECT COUNT(*) FROM cpf_rates;'
```

Expected: one active `SG-2026.1` row, and a `cpf_rates` count equal to the canonical row count.

- [ ] **Step 8: Commit**

```bash
git add services/statutory-sg-service/src/seed/sg-2026-1.js \
        scripts/migrate-statutory-tables-sg.js \
        scripts/__tests__/migrate-statutory-tables-sg.unit.test.js
git commit -m "feat(statutory): global versioned SG rate tables + divergence report (ENT-004)"
```

---

## Task 11: `POST /statutory/compute-batch`

**Context:** The contract endpoint `payroll-service` will call. Batched so a 500-employee run makes one HTTP call, not 500.

**Files:**
- Create: `services/statutory-sg-service/src/routes/statutory.routes.js`
- Create: `services/statutory-sg-service/src/utils/prisma.js`
- Modify: `services/statutory-sg-service/src/app.js`
- Test: `services/statutory-sg-service/__tests__/compute-batch.integration.test.js`

**Interfaces:**
- Consumes: `computeCpf`, `computeSdl` (Task 9); `CpfRate`, `SdlConfig`, `RateVersion` (Task 8)
- Produces:
  - `POST /statutory/compute-batch` with body `{ period: { year, month }, entity: { country, state, statutoryIds }, employees: [{ employeeId, profile: { citizenStatus, age }, remuneration: { ordinary, additional, gross, ytdOrdinary, ytdAdditional } }] }`
  - → `200 { rateVersion, results: [{ employeeId, employeeDeductions, employerContributions, employerLevies }] }`
  - Each entry: `{ code, label, amount, basis }`
  - → `503 { error }` when no active rate version exists

- [ ] **Step 1: Write the failing tests**

Create `services/statutory-sg-service/__tests__/compute-batch.integration.test.js`:

```javascript
'use strict';
const request = require('supertest');

const mockPrisma = {
  rateVersion: { findFirst: jest.fn() },
  cpfRate:     { findMany: jest.fn() },
  sdlConfig:   { findUnique: jest.fn() },
};
jest.mock('../src/utils/prisma', () => mockPrisma);

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
const app = require('../src/app');

const KEY = { 'x-internal-service-key': 'test-internal-key' };

const RATES = [
  { citizenStatus: 'SC_PR', ageMin: 0, ageMax: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 8000, awCeiling: 102000 },
];

function body(overrides = {}) {
  return {
    period: { year: 2026, month: 1 },
    entity: { country: 'SG', state: null, statutoryIds: {} },
    employees: [{
      employeeId: 'emp-1',
      profile: { citizenStatus: 'SC', age: 35 },
      remuneration: { ordinary: 5000, additional: 0, gross: 5000, ytdOrdinary: 0, ytdAdditional: 0 },
    }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.rateVersion.findFirst.mockResolvedValue({ version: 'SG-2026.1' });
  mockPrisma.cpfRate.findMany.mockResolvedValue(RATES);
  mockPrisma.sdlConfig.findUnique.mockResolvedValue({ rate: 0.0025, minAmount: 2, maxAmount: 11.25, salaryCap: 4500 });
});

describe('POST /statutory/compute-batch', () => {
  test('returns CPF employee and employer lines', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.status).toBe(200);

    const r = res.body.results[0];
    expect(r.employeeId).toBe('emp-1');
    // 5000 * 0.20 = 1000 employee; total 5000*0.37=1850 → employer 850
    expect(r.employeeDeductions).toEqual([
      expect.objectContaining({ code: 'CPF_EE', amount: 1000 }),
    ]);
    expect(r.employerContributions).toEqual([
      expect.objectContaining({ code: 'CPF_ER', amount: 850 }),
    ]);
  });

  test('returns SDL as an employer levy', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    // min(5000,4500)*0.0025 = 11.25 → at the max cap
    expect(res.body.results[0].employerLevies).toEqual([
      expect.objectContaining({ code: 'SDL', amount: 11.25 }),
    ]);
  });

  test('echoes the active rate version (ENT-006)', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.body.rateVersion).toBe('SG-2026.1');
  });

  test('carries the applied band in `basis` for audit', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.body.results[0].employeeDeductions[0].basis).toMatchObject({
      citizenStatus: 'SC_PR', employeeRate: 0.20, owCeiling: 8000,
    });
  });

  test('computes every employee in the batch', async () => {
    const two = body({ employees: [
      { employeeId: 'emp-1', profile: { citizenStatus: 'SC', age: 35 }, remuneration: { ordinary: 5000, additional: 0, gross: 5000, ytdOrdinary: 0, ytdAdditional: 0 } },
      { employeeId: 'emp-2', profile: { citizenStatus: 'SC', age: 40 }, remuneration: { ordinary: 3000, additional: 0, gross: 3000, ytdOrdinary: 0, ytdAdditional: 0 } },
    ] });
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(two);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[1].employeeDeductions[0].amount).toBe(600);
  });

  test('returns zero CPF for a foreigner but still levies SDL', async () => {
    const foreign = body({ employees: [{
      employeeId: 'emp-3', profile: { citizenStatus: 'FOREIGNER', age: 30 },
      remuneration: { ordinary: 5000, additional: 0, gross: 5000, ytdOrdinary: 0, ytdAdditional: 0 },
    }] });
    mockPrisma.cpfRate.findMany.mockResolvedValue([
      ...RATES, { citizenStatus: 'FOREIGNER', ageMin: 0, ageMax: null, employeeRate: 0, employerRate: 0, owCeiling: 8000, awCeiling: 102000 },
    ]);
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(foreign);
    expect(res.body.results[0].employeeDeductions[0].amount).toBe(0);
    expect(res.body.results[0].employerLevies[0].amount).toBe(11.25);
  });

  // FAIL CLOSED — never guess a rate.
  test('returns 503 when no active rate version exists', async () => {
    mockPrisma.rateVersion.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.status).toBe(503);
  });

  test('returns 503 when no CPF band matches the employee', async () => {
    mockPrisma.cpfRate.findMany.mockResolvedValue([]);
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.status).toBe(503);
  });

  test('rejects a missing internal key', async () => {
    const res = await request(app).post('/statutory/compute-batch').send(body());
    expect(res.status).toBe(401);
  });

  test('rejects a non-SG entity — wrong service', async () => {
    const my = body({ entity: { country: 'MY', state: 'SGR', statutoryIds: {} } });
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(my);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest --projects services/statutory-sg-service -t "compute-batch" --runInBand
```

Expected: FAIL — `Cannot find module '../src/utils/prisma'`.

- [ ] **Step 3: Create the Prisma singleton**

Create `services/statutory-sg-service/src/utils/prisma.js`:

```javascript
'use strict';
const { PrismaClient } = require('@prisma/client');
module.exports = new PrismaClient();
```

- [ ] **Step 4: Implement the route**

Create `services/statutory-sg-service/src/routes/statutory.routes.js`:

```javascript
'use strict';
const express = require('express');
const prisma  = require('../utils/prisma');
const { computeCpf, computeSdl } = require('../engines/cpf.engine');

const router = express.Router();

function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) return res.status(401).json({ error: 'Internal key not configured' });
  if (req.headers['x-internal-service-key'] !== expected) {
    return res.status(401).json({ error: 'Invalid internal service key' });
  }
  next();
}

// The employee-facing citizenStatus vocabulary is broader than the rate table's.
// Mirrors findCpfRate in payroll.routes.js:1693 so behaviour is preserved.
const STATUS_MAP = {
  SC: 'SC_PR', PR: 'SC_PR', SC_PR: 'SC_PR',
  PR_YEAR1: 'PR_YEAR1', PR_YEAR2: 'PR_YEAR2', FOREIGNER: 'FOREIGNER',
};

function findBand(rates, citizenStatus, age) {
  const mapped = STATUS_MAP[citizenStatus] || 'SC_PR';
  return rates.find(r =>
    r.citizenStatus === mapped && r.ageMin <= age && (r.ageMax === null || r.ageMax >= age)) || null;
}

router.post('/compute-batch', requireInternalKey, async (req, res, next) => {
  try {
    const { entity, employees } = req.body || {};

    if (!entity || entity.country !== 'SG') {
      return res.status(400).json({ error: 'statutory-sg-service only computes SG entities' });
    }
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: 'employees[] is required' });
    }

    const active = await prisma.rateVersion.findFirst({
      where: { country: 'SG', isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    // FAIL CLOSED. Never fall back to a default or the nearest version.
    if (!active) {
      return res.status(503).json({ error: 'No active SG rate version — payroll cannot compute' });
    }

    const rates = await prisma.cpfRate.findMany({ where: { rateVersion: active.version } });
    const sdlConfig = await prisma.sdlConfig.findUnique({ where: { rateVersion: active.version } });

    const results = [];
    for (const emp of employees) {
      const { employeeId, profile = {}, remuneration = {} } = emp;
      const band = findBand(rates, profile.citizenStatus, profile.age);
      if (!band) {
        return res.status(503).json({
          error: `No CPF band for employee ${employeeId} (${profile.citizenStatus}, age ${profile.age})`,
        });
      }

      const cpf = computeCpf({
        ow: remuneration.ordinary || 0,
        aw: remuneration.additional || 0,
        ytdOw: remuneration.ytdOrdinary || 0,
        ytdAw: remuneration.ytdAdditional || 0,
        citizenStatus: profile.citizenStatus,
        age: profile.age,
        rates: band,
      });
      const sdl = computeSdl(remuneration.gross || 0, sdlConfig);

      const basis = {
        citizenStatus: band.citizenStatus, ageMin: band.ageMin, ageMax: band.ageMax,
        employeeRate: band.employeeRate, employerRate: band.employerRate,
        owCeiling: band.owCeiling, awCeiling: band.awCeiling,
      };

      results.push({
        employeeId,
        employeeDeductions: [
          { code: 'CPF_EE', label: 'CPF (Employee)', amount: cpf.totalEmployee, basis },
        ],
        employerContributions: [
          { code: 'CPF_ER', label: 'CPF (Employer)', amount: cpf.totalEmployer, basis },
        ],
        employerLevies: [
          { code: 'SDL', label: 'Skills Development Levy', amount: sdl, basis: sdlConfig },
        ],
      });
    }

    res.json({ rateVersion: active.version, results });
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 5: Mount the router**

In `services/statutory-sg-service/src/app.js`, add before the error handler:

```javascript
app.use('/statutory', require('./routes/statutory.routes'));
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx jest --projects services/statutory-sg-service --runInBand
```

Expected: PASS — 10 compute-batch tests plus the earlier suites.

- [ ] **Step 7: Commit**

```bash
git add services/statutory-sg-service/src/routes/statutory.routes.js \
        services/statutory-sg-service/src/utils/prisma.js \
        services/statutory-sg-service/src/app.js \
        services/statutory-sg-service/__tests__/compute-batch.integration.test.js
git commit -m "feat(statutory): POST /statutory/compute-batch for SG, fail-closed on missing rates"
```

---

## Task 12: `/statutory/schema`, `/statutory/employment-rules`, `/statutory/validate`

**Context:** The remaining read-side contract endpoints. `employment-rules` is what lets leave-service and attendance-service stay country-agnostic in P4 — they read rules rather than holding constants.

**Files:**
- Create: `services/statutory-sg-service/src/rules/employment-rules.js`
- Modify: `services/statutory-sg-service/src/routes/statutory.routes.js`
- Test: `services/statutory-sg-service/__tests__/contract-endpoints.integration.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `GET /statutory/schema` → `200 { country, identityTypes, employeeFields, entityFields }`
  - `GET /statutory/employment-rules` → `200 { country, normalWeeklyHours, overtimeMultipliers, leaveEntitlements, noticePeriods }`
  - `POST /statutory/validate` body `{ entity, employees }` → `200 { valid: true }` | `200 { valid: false, problems: [{ employeeId, missing: [...] }] }`

- [ ] **Step 1: Write the failing tests**

Create `services/statutory-sg-service/__tests__/contract-endpoints.integration.test.js`:

```javascript
'use strict';
const request = require('supertest');

jest.mock('../src/utils/prisma', () => ({
  rateVersion: { findFirst: jest.fn() }, cpfRate: { findMany: jest.fn() }, sdlConfig: { findUnique: jest.fn() },
}));

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
const app = require('../src/app');
const KEY = { 'x-internal-service-key': 'test-internal-key' };

describe('GET /statutory/schema', () => {
  test('declares SG identity types', async () => {
    const res = await request(app).get('/statutory/schema').set(KEY);
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('SG');
    expect(res.body.identityTypes).toEqual(expect.arrayContaining(['NRIC', 'FIN']));
  });

  test('declares the employee fields CPF needs', async () => {
    const res = await request(app).get('/statutory/schema').set(KEY);
    const required = res.body.employeeFields.filter(f => f.required).map(f => f.name);
    expect(required).toEqual(expect.arrayContaining(['citizenStatus', 'dateOfBirth']));
  });
});

describe('GET /statutory/employment-rules', () => {
  test('reports the SG 44-hour week', async () => {
    const res = await request(app).get('/statutory/employment-rules').set(KEY);
    expect(res.body.normalWeeklyHours).toBe(44);
  });

  // SG EA s.38 has a single OT rate. MY s.60A differentiates 1.5/2/3 — that
  // difference is exactly why this lives behind the contract.
  test('reports a single 1.5x overtime multiplier', async () => {
    const res = await request(app).get('/statutory/employment-rules').set(KEY);
    expect(res.body.overtimeMultipliers).toEqual({ NORMAL: 1.5, REST_DAY: 1.5, PUBLIC_HOLIDAY: 1.5 });
  });

  test('reports flat statutory leave entitlements', async () => {
    const res = await request(app).get('/statutory/employment-rules').set(KEY);
    expect(res.body.leaveEntitlements.ANNUAL).toEqual([{ minServiceMonths: 0, days: 7 }]);
  });
});

describe('POST /statutory/validate', () => {
  const entity = { country: 'SG', state: null, statutoryIds: {} };

  test('passes a complete employee', async () => {
    const res = await request(app).post('/statutory/validate').set(KEY).send({
      entity, employees: [{ employeeId: 'e1', profile: { citizenStatus: 'SC', dateOfBirth: '1990-01-01' } }],
    });
    expect(res.body).toEqual({ valid: true, problems: [] });
  });

  // Caught BEFORE compute starts, listing employees — never mid-run.
  test('reports missing fields per employee', async () => {
    const res = await request(app).post('/statutory/validate').set(KEY).send({
      entity, employees: [{ employeeId: 'e1', profile: {} }],
    });
    expect(res.body.valid).toBe(false);
    expect(res.body.problems).toEqual([
      { employeeId: 'e1', missing: ['citizenStatus', 'dateOfBirth'] },
    ]);
  });

  test('reports every failing employee, not just the first', async () => {
    const res = await request(app).post('/statutory/validate').set(KEY).send({
      entity, employees: [
        { employeeId: 'e1', profile: {} },
        { employeeId: 'e2', profile: { citizenStatus: 'SC', dateOfBirth: '1990-01-01' } },
        { employeeId: 'e3', profile: { citizenStatus: 'SC' } },
      ],
    });
    expect(res.body.problems.map(p => p.employeeId)).toEqual(['e1', 'e3']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest --projects services/statutory-sg-service -t "statutory/" --runInBand
```

Expected: FAIL — 404 for all three endpoints.

- [ ] **Step 3: Create the employment rules module**

Create `services/statutory-sg-service/src/rules/employment-rules.js`:

```javascript
'use strict';

/**
 * Singapore employment terms — Employment Act (Cap. 91).
 *
 * Exposed over the contract so leave-service and attendance-service never hold
 * country constants. `leaveEntitlements` is a tiered list keyed by minimum
 * completed service months; SG is flat (one tier), MY is genuinely tiered.
 * Same shape either way so consumers need no country branch.
 *
 * These are STATUTORY MINIMA. A tenant's configured LeaveType may exceed them
 * but must never fall below.
 */
const SG_EMPLOYMENT_RULES = {
  country: 'SG',
  normalWeeklyHours: 44,
  overtimeMultipliers: { NORMAL: 1.5, REST_DAY: 1.5, PUBLIC_HOLIDAY: 1.5 },
  leaveEntitlements: {
    ANNUAL:            [{ minServiceMonths: 0, days: 7 }],   // EA statutory minimum
    SICK_OUTPATIENT:   [{ minServiceMonths: 0, days: 14 }],
    HOSPITALISATION:   [{ minServiceMonths: 0, days: 60 }],
    MATERNITY:         [{ minServiceMonths: 0, days: 112 }], // 16 weeks
    PATERNITY:         [{ minServiceMonths: 0, days: 14 }],  // 2 weeks
  },
  noticePeriods: [
    { minServiceMonths: 0,  days: 1 },
    { minServiceMonths: 6,  days: 7 },
    { minServiceMonths: 24, days: 14 },
    { minServiceMonths: 60, days: 28 },
  ],
};

const SG_SCHEMA = {
  country: 'SG',
  identityTypes: ['NRIC', 'FIN'],
  employeeFields: [
    { name: 'citizenStatus', type: 'enum', required: true,
      values: ['SC', 'PR', 'PR_YEAR1', 'PR_YEAR2', 'FOREIGNER'] },
    { name: 'dateOfBirth', type: 'date', required: true },
    { name: 'cpfPrYear', type: 'int', required: false },
    { name: 'cpfVoluntaryRate', type: 'boolean', required: false },
    { name: 'passType', type: 'enum', required: false, values: ['WP', 'S_PASS', 'EP'] },
    { name: 'workPassSector', type: 'string', required: false },
  ],
  entityFields: [
    { name: 'cpfSubmissionNumber', type: 'string', required: true },
  ],
};

module.exports = { SG_EMPLOYMENT_RULES, SG_SCHEMA };
```

- [ ] **Step 4: Implement the three endpoints**

In `services/statutory-sg-service/src/routes/statutory.routes.js`, add above `module.exports`:

```javascript
const { SG_EMPLOYMENT_RULES, SG_SCHEMA } = require('../rules/employment-rules');

router.get('/schema', requireInternalKey, (_req, res) => res.json(SG_SCHEMA));

router.get('/employment-rules', requireInternalKey, (_req, res) => res.json(SG_EMPLOYMENT_RULES));

// Completeness check run BEFORE compute so missing data surfaces as a list of
// employees to fix, never as a half-written payroll run (spec §3.4).
router.post('/validate', requireInternalKey, (req, res) => {
  const { employees } = req.body || {};
  if (!Array.isArray(employees)) {
    return res.status(400).json({ error: 'employees[] is required' });
  }

  const required = SG_SCHEMA.employeeFields.filter(f => f.required).map(f => f.name);
  const problems = [];

  for (const emp of employees) {
    const profile = emp.profile || {};
    const missing = required.filter(name =>
      profile[name] === undefined || profile[name] === null || profile[name] === '');
    if (missing.length) problems.push({ employeeId: emp.employeeId, missing });
  }

  res.json({ valid: problems.length === 0, problems });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest --projects services/statutory-sg-service --runInBand
```

Expected: PASS — 8 new tests plus all earlier suites.

- [ ] **Step 6: Commit**

```bash
git add services/statutory-sg-service/src/rules/employment-rules.js \
        services/statutory-sg-service/src/routes/statutory.routes.js \
        services/statutory-sg-service/__tests__/contract-endpoints.integration.test.js
git commit -m "feat(statutory): schema, employment-rules and validate endpoints"
```

---

## Task 13: Wire `payroll-service` to the statutory service

**Context:** This is the task that reconnects the payroll suite broken in Task 9. The compute site is `services/payroll-service/src/routes/payroll.routes.js:525-527`; rate loading is at `:319-320`. Both go away — rates now live in the statutory service.

**Files:**
- Create: `services/payroll-service/src/utils/statutory-client.js`
- Modify: `services/payroll-service/src/routes/payroll.routes.js:11,319-320,525-527`
- Modify: `services/payroll-service/package.json` (jest `moduleNameMapper` for `entity-client`)
- Modify: `docker-compose.yml` (payroll-service env)
- Test: `services/payroll-service/__tests__/statutory-client.unit.test.js`

**Interfaces:**
- Consumes: `POST /statutory/compute-batch` (Task 11); `resolveEntity` (Task 2)
- Produces:
  - `computeStatutoryBatch({ country, period, entity, employees }) → Promise<{ rateVersion, results }>` — throws `StatutoryUnavailableError` (`.status = 503`)
  - `findResult(results, employeeId) → result` — throws if absent
  - `sumByKind(result, 'employeeDeductions') → number`

- [ ] **Step 1: Write the failing tests**

Create `services/payroll-service/__tests__/statutory-client.unit.test.js`:

```javascript
'use strict';
const {
  computeStatutoryBatch, findResult, sumByKind, StatutoryUnavailableError,
} = require('../src/utils/statutory-client');

const RESULT = {
  employeeId: 'emp-1',
  employeeDeductions:    [{ code: 'CPF_EE', label: 'CPF (Employee)', amount: 1000, basis: {} }],
  employerContributions: [{ code: 'CPF_ER', label: 'CPF (Employer)', amount: 850,  basis: {} }],
  employerLevies:        [{ code: 'SDL',    label: 'SDL',            amount: 11.25, basis: {} }],
};

describe('computeStatutoryBatch', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
    process.env.STATUTORY_SG_SERVICE_URL = 'http://statutory-sg-service:4021';
    global.fetch = jest.fn();
  });

  test('routes an SG entity to the SG service', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rateVersion: 'SG-2026.1', results: [RESULT] }) });
    await computeStatutoryBatch({ country: 'SG', period: { year: 2026, month: 1 }, entity: {}, employees: [] });
    expect(global.fetch.mock.calls[0][0]).toBe('http://statutory-sg-service:4021/statutory/compute-batch');
  });

  test('returns the parsed payload', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rateVersion: 'SG-2026.1', results: [RESULT] }) });
    const out = await computeStatutoryBatch({ country: 'SG', period: {}, entity: {}, employees: [] });
    expect(out.rateVersion).toBe('SG-2026.1');
    expect(out.results).toHaveLength(1);
  });

  // FAIL CLOSED — the caller must leave the run in DRAFT.
  test('throws when the service is unreachable', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(computeStatutoryBatch({ country: 'SG', period: {}, entity: {}, employees: [] }))
      .rejects.toBeInstanceOf(StatutoryUnavailableError);
  });

  test('throws on a non-ok response and preserves 503', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'no active rate version' });
    await expect(computeStatutoryBatch({ country: 'SG', period: {}, entity: {}, employees: [] }))
      .rejects.toMatchObject({ status: 503 });
  });

  test('throws for a country with no configured service', async () => {
    await expect(computeStatutoryBatch({ country: 'MY', period: {}, entity: {}, employees: [] }))
      .rejects.toBeInstanceOf(StatutoryUnavailableError);
  });

  test('throws when INTERNAL_SERVICE_KEY is unset', async () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    await expect(computeStatutoryBatch({ country: 'SG', period: {}, entity: {}, employees: [] }))
      .rejects.toBeInstanceOf(StatutoryUnavailableError);
  });
});

describe('findResult', () => {
  test('finds a result by employeeId', () => {
    expect(findResult([RESULT], 'emp-1')).toBe(RESULT);
  });

  // Silently treating a missing employee as zero CPF would under-contribute.
  test('throws when the employee is absent', () => {
    expect(() => findResult([RESULT], 'emp-2'))
      .toThrow('No statutory result for employee emp-2');
  });
});

describe('sumByKind', () => {
  test('sums employee deductions', () => {
    expect(sumByKind(RESULT, 'employeeDeductions')).toBe(1000);
  });
  test('sums employer contributions', () => {
    expect(sumByKind(RESULT, 'employerContributions')).toBe(850);
  });
  test('returns 0 for an empty list', () => {
    expect(sumByKind({ employerLevies: [] }, 'employerLevies')).toBe(0);
  });
  test('sums multiple lines', () => {
    expect(sumByKind({ employeeDeductions: [{ amount: 100 }, { amount: 50 }] }, 'employeeDeductions')).toBe(150);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest --projects services/payroll-service -t "statutory-client" --runInBand
```

Expected: FAIL — `Cannot find module '../src/utils/statutory-client'`.

- [ ] **Step 3: Implement the client**

Create `services/payroll-service/src/utils/statutory-client.js`:

```javascript
'use strict';

/**
 * HTTP client for the per-country statutory services.
 *
 * FAIL CLOSED. Every failure throws so the caller leaves the run in DRAFT.
 * There is no cached result, no default rate and no partial compute: a wrong
 * CPF figure is worse than an unavailable payroll run.
 */

class StatutoryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StatutoryUnavailableError';
    this.status = 503;
  }
}

function serviceUrlFor(country) {
  const urls = {
    SG: process.env.STATUTORY_SG_SERVICE_URL || 'http://statutory-sg-service:4021',
    MY: process.env.STATUTORY_MY_SERVICE_URL || null, // added in P2
  };
  return urls[country] || null;
}

async function computeStatutoryBatch({ country, period, entity, employees }) {
  const base = serviceUrlFor(country);
  if (!base) throw new StatutoryUnavailableError(`No statutory service configured for country ${country}`);

  const key = process.env.INTERNAL_SERVICE_KEY;
  if (!key) throw new StatutoryUnavailableError('INTERNAL_SERVICE_KEY is not configured');

  let res;
  try {
    res = await fetch(`${base}/statutory/compute-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-service-key': key },
      body: JSON.stringify({ period, entity, employees }),
    });
  } catch (err) {
    throw new StatutoryUnavailableError(`Statutory service unreachable: ${err.message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new StatutoryUnavailableError(`Statutory service returned ${res.status}: ${detail}`);
  }
  return res.json();
}

function findResult(results, employeeId) {
  const r = (results || []).find(x => x.employeeId === employeeId);
  // Never default to zero — that would silently under-contribute.
  if (!r) throw new StatutoryUnavailableError(`No statutory result for employee ${employeeId}`);
  return r;
}

function sumByKind(result, kind) {
  return ((result && result[kind]) || []).reduce((acc, line) => acc + (line.amount || 0), 0);
}

module.exports = { computeStatutoryBatch, findResult, sumByKind, StatutoryUnavailableError };
```

- [ ] **Step 4: Run the client tests to verify they pass**

```bash
npx jest --projects services/payroll-service -t "statutory-client" --runInBand
```

Expected: PASS — 12 tests.

- [ ] **Step 5: Rewire the compute route**

In `services/payroll-service/src/routes/payroll.routes.js`:

**5a.** Replace the import on line 11:

```javascript
const { computeNetPay, countWorkingDays, countPeriodLeaveWorkingDays } = require('/app/shared/payroll-utils');
const { computeStatutoryBatch, findResult, sumByKind } = require('../utils/statutory-client');
const { resolveEntity } = require('/app/shared/entity-client');
```

**5b.** Replace the rate loading at lines 319-320. Delete both `prisma.cpfRate.findMany` and `prisma.sdlConfig.findFirst` calls, and resolve the entity plus compute the whole batch up front:

```javascript
    const entity = await resolveEntity(run.legalEntityId);

    const [periodYear, periodMonth] = run.period.split('-').map(Number);
    const statutoryBatch = await computeStatutoryBatch({
      country: entity.country,
      period: { year: periodYear, month: periodMonth },
      entity: { country: entity.country, state: entity.state, statutoryIds: entity.statutoryIds },
      employees: employees.map(e => ({
        employeeId: e.employeeId,
        profile: { citizenStatus: e.citizenStatus, age: e.age },
        remuneration: {
          ordinary: e.ow || 0, additional: e.aw || 0, gross: e.grossPay || e.ow || 0,
          ytdOrdinary: e.ytdOw || 0, ytdAdditional: e.ytdAw || 0,
        },
      })),
    });
```

**Note the ordering constraint:** the batch needs each employee's *effective* OW/AW, which today are computed inside the per-employee loop (lines 505-517). Hoist that adjustment loop above this call so `employees` already carries effective figures, then call the batch once. Do not call the statutory service inside the loop — that reintroduces the N-calls problem the batch endpoint exists to avoid.

**5c.** Replace lines 525-527:

```javascript
      const statutory = findResult(statutoryBatch.results, emp.employeeId);
      const employeeStatutory = sumByKind(statutory, 'employeeDeductions');
      const employerStatutory = sumByKind(statutory, 'employerContributions');
      const levies            = sumByKind(statutory, 'employerLevies');

      const net = computeNetPay({
        grossPay: effectiveGross,
        employeeCpf: employeeStatutory,
        nplDeduction: (emp.nplDeduction || 0) + deductions + autoNpl,
        reimbursements: (emp.reimbursements || 0) + reimbursements,
      });
```

Then update the accumulators and the `payslipData` object to use `employeeStatutory`, `employerStatutory` and `levies` in place of `cpf.totalEmployee`, `cpf.totalEmployer` and `sdl`. The encrypted SG column names stay exactly as they are — dual-write is Task 14.

**5d.** Let `StatutoryUnavailableError` propagate. The service's error handler already maps `err.status`, so the run stays `DRAFT` and the caller receives 503. Do not catch and continue.

- [ ] **Step 6: Add the Jest module mapping and service env**

In `services/payroll-service/package.json`, add to `moduleNameMapper`, **above** the catch-all `"/app/shared/(.*)"` entry (order matters — the catch-all wins otherwise):

```json
      "/app/shared/entity-client": "<rootDir>/../../shared/entity-client/index.js",
```

In `docker-compose.yml`, add to the `payroll-service` `environment` block:

```yaml
      - STATUTORY_SG_SERVICE_URL=http://statutory-sg-service:4021
      - AUTH_SERVICE_URL=http://auth-service:4001
      - INTERNAL_SERVICE_KEY=${INTERNAL_SERVICE_KEY}
```

and add `statutory-sg-service` to its `depends_on`.

Also add the `entity-client` install line to `services/payroll-service/Dockerfile`, next to the existing shared-module installs:

```dockerfile
RUN cd /app/shared/entity-client && npm install
```

- [ ] **Step 7: Run the full payroll suite**

```bash
npx jest --projects services/payroll-service --runInBand
```

Expected: PASS. Integration tests that previously mocked `prisma.cpfRate`/`prisma.sdlConfig` must now mock `global.fetch` for the statutory call instead. Update those mocks; **do not change any expected CPF or SDL figure** — if a number has to move, the refactor changed behaviour and is wrong.

- [ ] **Step 8: Commit**

```bash
git add services/payroll-service/src/utils/statutory-client.js \
        services/payroll-service/src/routes/payroll.routes.js \
        services/payroll-service/package.json \
        services/payroll-service/Dockerfile \
        services/payroll-service/__tests__/ \
        docker-compose.yml
git commit -m "refactor(payroll): compute statutory via statutory-sg-service, fail-closed

payroll.routes.js no longer knows what CPF is. Entity resolution selects the
country service; an unreachable service leaves the run in DRAFT with a 503."
```

---

## Task 14: `PayslipStatutoryLine` dual-write

**Context:** ENT-006 requires per-line `rateVersion`. Existing SG columns (`employeeCpfEnc`, `employerCpfEnc`, `sdlAmountEnc`, `fwlAmountEnc`) stay and keep being written, so the PDF engine, IRAS engine and reporting keep working untouched. This is a strangler step — no historical payslip is rewritten.

**Files:**
- Modify: `services/payroll-service/prisma/schema.prisma`
- Modify: `services/payroll-service/src/routes/payroll.routes.js` (payslip upsert, ~line 554)
- Test: `services/payroll-service/__tests__/payslip-statutory-line.unit.test.js`

**Interfaces:**
- Consumes: statutory result shape (Task 11), `encrypt` (existing in payroll-service)
- Produces:
  - Model `PayslipStatutoryLine`
  - `buildStatutoryLines({ payslipId, tenantId, statutory, rateVersion, encrypt }) → [row]`

- [ ] **Step 1: Write the failing test**

Create `services/payroll-service/__tests__/payslip-statutory-line.unit.test.js`:

```javascript
'use strict';
const { buildStatutoryLines } = require('../src/utils/statutory-lines');

const STATUTORY = {
  employeeId: 'emp-1',
  employeeDeductions:    [{ code: 'CPF_EE', label: 'CPF (Employee)', amount: 1000,  basis: { employeeRate: 0.2 } }],
  employerContributions: [{ code: 'CPF_ER', label: 'CPF (Employer)', amount: 850,   basis: { employerRate: 0.17 } }],
  employerLevies:        [{ code: 'SDL',    label: 'SDL',            amount: 11.25, basis: { rate: 0.0025 } }],
};

const enc = (v) => `enc(${v})`;

describe('buildStatutoryLines', () => {
  const rows = buildStatutoryLines({
    payslipId: 'ps-1', tenantId: 'ten-1', statutory: STATUTORY,
    rateVersion: 'SG-2026.1', encrypt: enc,
  });

  test('emits one row per statutory line', () => {
    expect(rows).toHaveLength(3);
  });

  test('classifies party and kind correctly', () => {
    expect(rows.find(r => r.code === 'CPF_EE')).toMatchObject({ party: 'EMPLOYEE', kind: 'DEDUCTION' });
    expect(rows.find(r => r.code === 'CPF_ER')).toMatchObject({ party: 'EMPLOYER', kind: 'CONTRIBUTION' });
    expect(rows.find(r => r.code === 'SDL')).toMatchObject({ party: 'EMPLOYER', kind: 'LEVY' });
  });

  test('encrypts every amount', () => {
    expect(rows.find(r => r.code === 'CPF_EE').amountEnc).toBe('enc(1000)');
  });

  // ENT-006 — reproducibility years later.
  test('stamps rateVersion on every row', () => {
    expect(rows.every(r => r.rateVersion === 'SG-2026.1')).toBe(true);
  });

  test('preserves the basis for audit', () => {
    expect(rows.find(r => r.code === 'SDL').basis).toEqual({ rate: 0.0025 });
  });

  test('returns an empty array when there are no lines', () => {
    expect(buildStatutoryLines({
      payslipId: 'ps-1', tenantId: 'ten-1',
      statutory: { employeeDeductions: [], employerContributions: [], employerLevies: [] },
      rateVersion: 'SG-2026.1', encrypt: enc,
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest --projects services/payroll-service -t "buildStatutoryLines" --runInBand
```

Expected: FAIL — `Cannot find module '../src/utils/statutory-lines'`.

- [ ] **Step 3: Add the model**

Append to `services/payroll-service/prisma/schema.prisma`:

```prisma
model PayslipStatutoryLine {
  id          String   @id @default(uuid())
  tenantId    String
  payslipId   String
  code        String   // CPF_EE | CPF_ER | SDL | FWL | (MY: EPF_EE, SOCSO_ER, PCB, …)
  label       String
  party       String   // EMPLOYEE | EMPLOYER
  kind        String   // DEDUCTION | CONTRIBUTION | LEVY
  amountEnc   String   // AES-256-GCM
  basis       Json?    // which band/rate row applied — audit trail
  rateVersion String   // ENT-006 — reproducibility
  createdAt   DateTime @default(now())

  @@unique([payslipId, code])
  @@index([tenantId])
  @@index([payslipId])
  @@map("payslip_statutory_lines")
}
```

- [ ] **Step 4: Implement the builder**

Create `services/payroll-service/src/utils/statutory-lines.js`:

```javascript
'use strict';

/**
 * Flattens a statutory result into per-line payslip rows.
 *
 * Written ALONGSIDE the legacy SG columns (employeeCpfEnc, employerCpfEnc,
 * sdlAmountEnc, fwlAmountEnc), not instead of them. Every existing reader —
 * PDF engine, IRAS engine, reporting — keeps working while this becomes the
 * new source of truth. A later release migrates those readers and drops the
 * columns.
 */
const KINDS = [
  ['employeeDeductions',    'EMPLOYEE', 'DEDUCTION'],
  ['employerContributions', 'EMPLOYER', 'CONTRIBUTION'],
  ['employerLevies',        'EMPLOYER', 'LEVY'],
];

function buildStatutoryLines({ payslipId, tenantId, statutory, rateVersion, encrypt }) {
  const rows = [];
  for (const [key, party, kind] of KINDS) {
    for (const line of (statutory && statutory[key]) || []) {
      rows.push({
        payslipId, tenantId,
        code: line.code, label: line.label, party, kind,
        amountEnc: encrypt(String(line.amount)),
        basis: line.basis || null,
        rateVersion,
      });
    }
  }
  return rows;
}

module.exports = { buildStatutoryLines };
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest --projects services/payroll-service -t "buildStatutoryLines" --runInBand
```

Expected: PASS — 6 tests.

- [ ] **Step 6: Dual-write at the payslip upsert**

In `services/payroll-service/src/routes/payroll.routes.js`, immediately after the `prisma.payslip.upsert` call (~line 554), add:

```javascript
      const payslipRow = await prisma.payslip.findUnique({
        where: { runId_employeeId: { runId: run.id, employeeId: emp.employeeId } },
        select: { id: true },
      });

      const statutoryLines = buildStatutoryLines({
        payslipId: payslipRow.id,
        tenantId: run.tenantId,
        statutory,
        rateVersion: statutoryBatch.rateVersion,
        encrypt,
      });

      // Recompute cleanly: a re-run must not leave stale lines behind.
      await prisma.payslipStatutoryLine.deleteMany({ where: { payslipId: payslipRow.id } });
      if (statutoryLines.length) {
        await prisma.payslipStatutoryLine.createMany({ data: statutoryLines });
      }
```

Add the import at the top of the file:

```javascript
const { buildStatutoryLines } = require('../utils/statutory-lines');
```

Also set `rateVersion` on the run when it is finalised, from `statutoryBatch.rateVersion`.

- [ ] **Step 7: Run the full payroll suite**

```bash
npx jest --projects services/payroll-service --runInBand
```

Expected: PASS, with every legacy CPF/SDL assertion unchanged.

- [ ] **Step 8: Commit**

```bash
git add services/payroll-service/prisma/schema.prisma \
        services/payroll-service/src/utils/statutory-lines.js \
        services/payroll-service/src/routes/payroll.routes.js \
        services/payroll-service/__tests__/payslip-statutory-line.unit.test.js
git commit -m "feat(payroll): dual-write PayslipStatutoryLine with rateVersion (ENT-006)

Legacy SG columns keep being written so no existing reader changes. MY runs
will write only the child table."
```

---

## Task 15: Singapore regression gate and deployment verification

**Context:** This is the gate from PRD §A7.4 and spec §6.1. It is the entire safety argument for P1 — nothing from P2 onward may start until it is green.

**Files:**
- Modify: `TESTING.md`
- Create: `docs/superpowers/plans/p1-verification-record.md`

**Interfaces:**
- Consumes: everything above
- Produces: a recorded verification result

- [ ] **Step 1: Run the complete backend suite on Node 20**

```bash
node --version   # must report v20.x — jest 29 hangs on 22+
npm ci
npm run test:backend 2>&1 | tail -40
```

Expected: pass counts at or above the pre-change baseline. `tenant-isolation.test.js` has **16 known pre-existing failures** (Phase-2, `raw.tenant` undefined — needs a generated Prisma client). Those are not regressions. Any *other* failure is.

- [ ] **Step 2: Run the frontend suite**

```bash
npm run test:frontend
```

Expected: PASS. No frontend change was made in P0/P1, so any failure here indicates accidental coupling.

- [ ] **Step 3: Bring up the full stack and run payroll E2E**

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:4021/health
curl -fsS http://127.0.0.1:4000/health
E2E_BASE_URL=http://localhost:8081 npm run test:e2e -- tests/payroll.spec.ts
```

Expected: PASS. This is the suite that matters most — the CPF rate matrix, five AW-ceiling scenarios, SDL bounds, EA s.20 pro-ration and the OT/OIL/deduction paycode branches. **Every assertion must pass with its original expected value.**

If any expected figure needs adjusting, the refactor changed Singapore behaviour. Stop, revert to the last green commit, and find the difference — do not update the expectation.

- [ ] **Step 4: Verify fail-closed behaviour end to end**

```bash
docker compose stop statutory-sg-service
# Trigger a payroll compute via the API, then inspect:
docker compose logs payroll-service --tail 20
docker compose start statutory-sg-service
```

Expected: the compute request returns **503**, the run remains `DRAFT`, and no payslip rows were written for that run. Confirm with:

```bash
docker compose exec postgres psql -U hrms -d hrms_payroll \
  -c "SELECT status FROM payroll_runs ORDER BY \"createdAt\" DESC LIMIT 1;" \
  -c "SELECT COUNT(*) FROM payslips WHERE \"runId\" = (SELECT id FROM payroll_runs ORDER BY \"createdAt\" DESC LIMIT 1);"
```

Expected: `status = DRAFT` and payslip count `0`.

- [ ] **Step 5: Verify the deployment registration**

```bash
grep -c "statutory-sg-service:" docker-compose.yml          # expect 1
grep -c "hrms_statutory_sg" scripts/init-dbs.sql            # expect 2 (create + grant)
grep -c "statutory-sg-service" jest.config.js               # expect 1
docker compose ps statutory-sg-service                      # expect running
```

All four must pass. A statutory service missing from compose is a payroll outage — six services in this repo are already gateway-routed but absent from compose; this one must not join them.

- [ ] **Step 6: Record the verification**

Create `docs/superpowers/plans/p1-verification-record.md` capturing: date, commit SHA, Node version, backend/frontend/E2E pass counts, the known-16 isolation failures confirmed as pre-existing, the fail-closed result, and the divergence report output from Task 10.

- [ ] **Step 7: Update TESTING.md**

Add `statutory-sg-service` to the backend suite description in §3, and note in §11 that Singapore statutory computation now runs over HTTP with the SG engine tests living in `services/statutory-sg-service/__tests__/`.

- [ ] **Step 8: Commit**

```bash
git add TESTING.md docs/superpowers/plans/p1-verification-record.md
git commit -m "test(statutory): record P1 SG regression gate result

Full SG payroll suite passes unchanged across the new HTTP boundary. P2
(statutory-my-service) is unblocked."
```

---

## Definition of Done

- [ ] Every tenant has exactly one primary `LegalEntity`; no employee or payroll run has a null `legalEntityId`
- [ ] Two tenants can create a payroll run for the same period without a 409
- [ ] A tenant can hold two entities with different holidays on the same date
- [ ] `hrms_statutory_sg` holds one active versioned rate set; the divergence report has been reviewed
- [ ] `payroll-service` contains no reference to CPF or SDL computation
- [ ] Stopping `statutory-sg-service` makes payroll return 503 with the run left in `DRAFT` and no payslips written
- [ ] The full Singapore payroll E2E suite passes with **no expected value changed**
- [ ] `statutory-sg-service` is present in `docker-compose.yml`, `scripts/init-dbs.sql` and `jest.config.js`

---

## Out of Scope (P2 and later)

Not in this plan; each needs its own:

- `statutory-my-service` — EPF, SOCSO, EIS, HRD Corp levy, zakat (P2)
- The PCB/MTD engine and its zero-tolerance LHDN differential gate (P3)
- Malaysian leave tiers, s.60A overtime multipliers, state holiday sets (P4)
- `Employee.statutoryProfile`, the `NricType` extension for `MYKAD`/`PASSPORT`, and MyKad patterns in `services/assistant-service/src/mask.js` — all MY-specific, so they land with P2 rather than here (spec §4.2)
- `LeaveType.entitlementRule` and the statutory-minimum floor validation (P4, spec §4.5)
- The `/statutory/year-end` and `/statutory/submission-file` contract endpoints — declared in spec §3.2 but only needed once there are Malaysian forms to emit (P5)
- Entity-contextual module visibility and the frontend active-entity selector (P4, ENT-005)
- Malaysian filing: CP39, Borang A, Borang 8A, Lampiran 1, EA Form, Form E, CP21/22/22A (P5)
- Migrating SG readers off the legacy payslip columns and dropping them (post-P5)
