# GaDongHR Rebrand — Stage 2: Screen Conversion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the UI from card-and-shadow dashboard vocabulary to the Official Record document vocabulary, using the primitives Stage 1 built.

**Architecture:** Shared chrome first (one file, changes every screen's frame), then a fully-worked reference screen that establishes the recipe, then screens in waves by area. Each wave is independently reviewable and shippable.

**Tech Stack:** Next.js App Router, Tailwind, TypeScript, Jest + jsdom + testing-library.

**Spec:** `docs/superpowers/specs/2026-08-03-gadonghr-rebrand-design.md`
**Stage 1:** complete — tokens, primitives, seal-reservation test all green.

## Scale, stated honestly

**37,068 lines of TSX across 78 files.** 74 use `rounded`, 63 use `shadow`, 71 are card-shaped. The largest single screen is `payroll/page.tsx` at 2,048 lines.

This is days of work, not one sitting. The plan is deliberately structured so that stopping between waves leaves the product in a coherent state rather than half-converted.

## Global Constraints

- **Use the primitives.** `Field`, `Seal`, `Button`, `DataTable`, `Notice` from `@/components/official`. Conversion is *use the component*, never *invent the markup*.
- **No cards, no drop shadows, no rounded containers.** Buttons and seals use `2px`; nothing else is rounded.
- **`--seal` is RESERVED.** Only `Seal.tsx` may reference it — `seal-reservation.test.ts` fails the build otherwise. Fix the screen, never the test.
- **Every number right-aligned with `tabular-nums`.**
- **No colour-coded status without a text label beside it.**
- **No icon without a word**, unless universally understood in the domain.
- **Disabled, not hidden** — a blocked action stays visible with its reason.
- **Statutory values carry a `Seal`** citing CPF Act / EA / EPF Act. Never the Thai LPA.
- **The eyebrow carries the form number the user already knows** — `IR8A`, `IR21`, `CPF e-Submit`, `Appendix 8A`, `EA Form`, `Form E`, `CP39`.
- **Backend must not move:** 1,920 tests green under UTC and Asia/Singapore.
- **`tsc --noEmit` clean after every task.**
- **Commit after every task.**

---

## The conversion recipe

This is the substance of the plan. Every screen task applies it; nothing else is invented.

| Found | Replaced with |
|---|---|
| `<div className="... rounded-lg shadow ... bg-white">` card | `<section>` with `border-b border-rule` between groups |
| Card header `<h2>` | `<h2>` + `<p className="eyebrow">` carrying the form number |
| Label/value pair in a card | `<Field label value hint? seal? />` |
| `<table>` with a total row | `<DataTable columns rows total />` |
| Alert / warning box | `<Notice heading>` — border **ink**, not seal |
| `<button className="... rounded-lg bg-indigo-600">` | `<Button variant="accent">` |
| Hidden action (`{cond && <button>}`) | `<Button disabled reason="…">` |
| `bg-white` / `bg-slate-50` surface | `bg-paper` |
| `text-slate-900` | `text-ink` |
| `text-slate-500` / `-400` | `text-muted` |
| `border-slate-200` | `border-rule` |
| `bg-indigo-600` action | `bg-accent` |
| Status pill, colour only | colour **plus** the status word |
| Any statutory figure | wrap with `<Seal cite="…" />` |

**Per-screen exit criteria** — a screen is done when:

```bash
# no forbidden vocabulary
grep -cE "rounded-(lg|xl|2xl|full)|shadow-|bg-white" <file>   # → 0
# no legacy palette
grep -cE "indigo-|slate-[0-9]|emerald-|amber-" <file>          # → 0
```

...and `tsc --noEmit` is clean and the frontend suite is green.

---

## Task 1: Shared chrome — `(dashboard)/layout.tsx`

Highest leverage in the codebase: 671 lines, 48 violations, and it frames **every** dashboard screen. Converting it alone changes the entire product's first impression.

**Files:**
- Modify: `frontend/src/app/(dashboard)/layout.tsx`
- Test: `frontend/__tests__/dashboard-chrome.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Seal` from `@/components/official`
- Produces: the document shell every screen renders inside

- [ ] **Step 1: Write the failing test**

```tsx
import { readFileSync } from 'fs';
import { join } from 'path';

const LAYOUT = readFileSync(
  join(__dirname, '..', 'src', 'app', '(dashboard)', 'layout.tsx'), 'utf8');

describe('dashboard chrome speaks the document vocabulary', () => {
  it('uses no rounded containers', () => {
    expect(LAYOUT).not.toMatch(/rounded-(lg|xl|2xl|full)/);
  });
  it('uses no drop shadows', () => {
    expect(LAYOUT).not.toMatch(/shadow-(sm|md|lg|xl|2xl)/);
  });
  it('uses no legacy palette', () => {
    expect(LAYOUT).not.toMatch(/indigo-|slate-[0-9]|emerald-|amber-/);
  });
  it('uses the Official Record tokens', () => {
    expect(LAYOUT).toMatch(/bg-paper|text-ink|border-rule|text-muted/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest --projects frontend --runInBand dashboard-chrome`
Expected: FAIL on all four — the layout is entirely card vocabulary today.

- [ ] **Step 3: Convert the layout**

Apply the recipe. Specifically:
- sidebar surface `bg-slate-900` → `bg-shadow` (the one legitimate dark surface)
- nav items: remove `rounded-lg`; current page marked with a 2px `border-l border-accent`
- topbar: `bg-white shadow` → `bg-paper border-b border-rule`
- content well: remove card wrapper; page content sits directly on `bg-page`
- every nav icon keeps its word — no icon-only navigation

- [ ] **Step 4: Verify**

```bash
npx jest --projects frontend --runInBand dashboard-chrome
npx tsc --noEmit -p frontend/tsconfig.json
```
Expected: 4 passing, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(design): convert dashboard chrome to Official Record"
```

---

## Task 2: Reference screen — `payroll/me` (the payslip)

Done fully and carefully, because it is the most document-like screen in the product and becomes the worked example every later screen copies. A payslip is *exactly* the artefact this design system was built for: a figure someone may have to defend.

**Files:**
- Modify: `frontend/src/app/(dashboard)/payroll/me/page.tsx`
- Test: `frontend/__tests__/payslip-screen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { readFileSync } from 'fs';
import { join } from 'path';

const SCREEN = readFileSync(
  join(__dirname, '..', 'src', 'app', '(dashboard)', 'payroll', 'me', 'page.tsx'), 'utf8');

describe('payslip screen', () => {
  it('uses the Official Record primitives', () => {
    expect(SCREEN).toMatch(/from '@\/components\/official'/);
  });
  it('cites the statutory authority for CPF', () => {
    expect(SCREEN).toMatch(/Seal[\s\S]{0,120}CPF Act/);
  });
  it('carries the form number in an eyebrow', () => {
    expect(SCREEN).toMatch(/eyebrow|IR8A/);
  });
  it('uses no card vocabulary', () => {
    expect(SCREEN).not.toMatch(/rounded-(lg|xl|2xl|full)|shadow-(sm|md|lg)/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest --projects frontend --runInBand payslip-screen`

- [ ] **Step 3: Convert**

- Earnings/deductions become a `DataTable` with `total` = net pay
- CPF employee/employer rows carry `<Seal cite="CPF Act s.7 · Jan 2026 table" />`
- SDL carries `<Seal cite="SDL Act · 0.25% cap 4,500" />`
- Payment date carries `<Seal cite="EA s.21 · within 7 days" />`
- Eyebrow: the payslip period and `IR8A` where year-end applies
- Employee summary rows become `Field`

- [ ] **Step 4: Verify + commit**

```bash
npx jest --projects frontend --runInBand
npx tsc --noEmit -p frontend/tsconfig.json
git add -A && git commit -m "feat(design): convert payslip screen — reference implementation"
```

---

## Task 3: Wave A — payroll area

**Files:** `payroll/page.tsx` (2,048 lines), `payroll/iras-submissions/page.tsx`

The largest screen in the product. Seals: CPF, SDL, FWL, IRAS deadlines. Eyebrows: `CPF e-Submit`, `IR8A`, `IR21`, `Appendix 8A`.

- [ ] Apply the recipe to `payroll/page.tsx`
- [ ] Apply the recipe to `payroll/iras-submissions/page.tsx`
- [ ] Per-screen exit criteria pass for both
- [ ] `npx tsc --noEmit` clean; frontend suite green
- [ ] Commit: `feat(design): convert payroll screens`

---

## Task 4: Wave B — leave and attendance

**Files:** `leave/page.tsx`, `leave/registry/page.tsx`, `attendance/page.tsx`, `attendance/registry/page.tsx` (1,959 lines), `attendance/schedule/page.tsx`

Seals: `EA s.43 · floor 7` (annual), `EA s.89 · floor 14` (sick), `EA s.38 · 1.5×` (OT). Running totals rather than post-hoc errors — "46.0 of 48" while there is still room to act.

- [ ] Apply the recipe to all five screens
- [ ] Exit criteria pass for each
- [ ] Commit: `feat(design): convert leave and attendance screens`

---

## Task 5: Wave C — employee and org

**Files:** `employees/page.tsx`, `employees/[id]/page.tsx` (1,490 lines), `staff/page.tsx`, `movements/page.tsx`, `movements/[id]/page.tsx`, `offboarding/page.tsx`

Seals: notice periods (`EA s.10`), CPF status. Blocked deletions name the rule and its expiry — "retained until 12 Mar 2028 under s.114", not "cannot delete".

- [ ] Apply the recipe to all six screens
- [ ] Exit criteria pass for each
- [ ] Commit: `feat(design): convert employee and org screens`

---

## Task 6: Wave D — remaining dashboard screens

**Files:** the remaining ~35 `(dashboard)` screens — benefits, training, performance, recruitment, claims, assets, reports, surveys, succession, support, hr-cases, loans, documents, notifications, settings/*

Lower statutory density; mostly mechanical recipe application.

- [ ] Apply the recipe area by area, committing per area
- [ ] Exit criteria pass for each screen
- [ ] Frontend suite green after each area

---

## Task 7: Wave E — unauthenticated and platform screens

**Files:** `login`, `register`, `auth/*` (4), `onboard/*` (2), `platform/*` (2)

These are the first thing a prospect sees, and the platform console is operator-only with different physics — a candidate for the `--shadow` dark surface.

- [ ] Apply the recipe
- [ ] Commit: `feat(design): convert auth, onboarding and platform screens`

---

## Task 8: Stage 2 verification

- [ ] **Repo-wide exit criteria**

```bash
cd frontend/src
grep -rlE "rounded-(lg|xl|2xl|full)|shadow-(sm|md|lg|xl)" --include='*.tsx' . | wc -l   # → 0
grep -rlE "indigo-|slate-[0-9]|emerald-|amber-" --include='*.tsx' . | wc -l             # → 0
```

- [ ] **Delete the legacy palette** from `globals.css` — the block labelled "being retired" in Stage 1. Nothing should reference it once every screen is converted.
- [ ] Frontend suite green; `tsc --noEmit` clean
- [ ] Backend unchanged: 1,920 tests, UTC and Asia/Singapore
- [ ] `seal-reservation.test.ts` still green — the reservation survived 74 screens
- [ ] Commit: `chore(design): Stage 2 complete, legacy palette removed`

---

## Out of scope

- Server provisioning, `app.bevorasg.com` DNS/TLS, CI/CD migration — blocked on GaDong server access
- SMTP credentials for `enquiries@bevorasg.com` — blocked; the Titan/vorkhive.com credentials on the 165 server belong to the previous company and are deliberately not carried over
- Malaysia P2–P5
