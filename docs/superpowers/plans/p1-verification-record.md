# P1 Verification Record — Singapore statutory extraction

**Date:** 2026-08-03
**Branch:** `feat/malaysia-p0-entity-layer`
**Node:** v22 (TESTING.md documents Node 20 for CI parity; the suite runs clean on 22 here)
**Scope:** Tasks 1–15 of `docs/superpowers/plans/2026-08-02-malaysia-p0-p1-foundation.md`

This is the gate the plan requires before P2 (`statutory-my-service`) begins.

---

## Gate 1 — Singapore behaviour preserved across the new HTTP boundary

**PASS.** This is the whole safety argument for the extraction: Singapore's suite
passes *unaltered* after CPF/SDL/FWL moved out of process.

- `statutory-sg-service`: **55/55** (29 CPF/SDL/FWL tests moved verbatim, plus
  compute-batch, contract endpoints and health)
- `payroll-service`: **460/460**
- **No expected CPF or SDL figure was changed.** The test fetch mocks call the
  *real* engine with the same fixture rates, so every value asserted before the
  move is asserted after it.
- Two expectations were genuinely obsolete and were replaced, not fudged:
  - one asserted payroll queries `cpf_rates`/`sdl_config` — it deliberately no
    longer does (ENT-004)
  - `H8` rejected *all* fetches while its own comment said "only the leave call
    fails"; it was catching the fail-closed statutory call and asserting the
    wrong thing

## Gate 2 — Timezone independence

**PASS.** `1909/1909` under both `UTC` and `Asia/Singapore` on a clean run.
Also verified during the fix itself against `Asia/Kuala_Lumpur`,
`America/New_York`, `America/Los_Angeles` and `Pacific/Auckland`.

CI now runs the backend under a TZ matrix (UTC + Asia/Singapore), because the
class of bug this caught is invisible under UTC — which is exactly how it
survived.

## Gate 3 — Cross-tenant isolation

**PASS. 16/16** — auth 4, employee 3, payroll 3, leave 3, attendance 3, via
`npm run test:isolation`.

Worth stating plainly: these had **never run**. They were recorded in TESTING.md
as "known failing today" when in fact they had only ever been executed in a
harness that could not run them. They prove tenant A cannot read tenant B's
data, and they now run in CI with `deploy` gated on them.

## Gate 4 — Frontend

**PASS. 89/89**, 7 suites.

## Gate 5 — Fail-closed behaviour

**PASS**, verified against running containers rather than mocks:

- `payroll-service` reaches `statutory-sg-service` over the docker network
- with `statutory-sg-service` stopped, the dependency is genuinely unreachable —
  the 503 path, not a silently wrong figure
- unit-level: no active rate version → 503; no CPF band for an employee → 503
  *naming the employee*; statutory service unreachable → `StatutoryUnavailableError`

## Gate 6 — Deployment registration

**PASS.** `statutory-sg-service` is in all three required places —
`docker-compose.yml`, `scripts/init-dbs.sql`, root `jest.config.js`. Image
builds, container runs, `/health` 200, and `prisma db push` creates all four
tables on boot. Verified zero `tenantId` columns in `hrms_statutory_sg` (ENT-004).

## Gate 7 — Rate provenance

**PASS.** `SG-2026.1` transcribed from `scripts/seed.js` (the verified Jan 2026
figures), never typed from memory. `RateVersion` records `source` and
`retrievedAt`.

The divergence report independently validated the transcription: it compares
every tenant's existing rates against canonical, so a mistyped value would have
flagged every tenant as diverging. Local run: **1 tenant, 0 diverged.**

---

## OPEN FINDING — the suite flakes under parallel execution

**This is the one thing preventing me from calling the gate unconditionally
clean, and it should be fixed before P2 leans on it.**

`npm run test:backend` (`--maxWorkers=2`, 16 projects) is green on roughly
**5 runs in 8**. The other runs fail 1–5 tests.

It is **not** caused by the statutory work:

- the failing tests are scattered across *untouched* services — `drc-quotas`,
  `iras-submissions`, MSF daily cap, a leave-service helper, performance summary
- no test fails twice across six runs; there is no consistently bad test
- `performance-service` alone: **6/6 runs stable**
- `performance-service` + `payroll-service` in parallel: **6/6 runs stable**
- only the full 16-project run flakes

**Probable root cause:** seven services call `setInterval` at module load,
unguarded by environment —

```
asset-service, auth-service, leave-service, hr-case-service,
reporting-service, training-service, employee-service (movement.routes.js)
```

Requiring the app in a test starts those timers, and under parallel workers they
fire during unrelated suites. This also explains the "Cannot log after tests are
done" warnings and the stray `[leave-service] Auto-provision run`,
`[hr-case sweep] start`, `[movement-sweep] start` output that appears throughout
test runs.

**Suggested fix:** guard the schedulers with `if (process.env.NODE_ENV !==
'test')`, or export a `startSchedulers()` the entrypoint calls rather than
running them on require. Not attempted here — it touches seven services and
belongs in its own change with its own verification.

**Impact on the gate:** every gate above was confirmed on clean runs, and the
flaky failures are unrelated to statutory computation. But a gate that fails
~35% of the time is not yet a dependable gate, and P2 will lean on it harder.

---

## Suite growth this session

| Point | Backend tests passing |
|---|---|
| Session start | 758 |
| After `uuid` alignment | 1,490 |
| After six services registered | +343 |
| After P0 + P1 | **1,909** |

The increase is almost entirely tests that already existed and had never run —
suites that could not load (`uuid` hoisted as ESM), projects missing from the
Jest `projects` array, and a `moduleNameMapper` gap. No permanently-red suites
remain, which matters because red noise is exactly what let the `uuid` breakage
conceal a genuine Task 6 regression earlier.
