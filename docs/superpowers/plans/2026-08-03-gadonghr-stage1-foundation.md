# GaDongHR Rebrand — Stage 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename GaDongHR → GaDongHR everywhere, replace the theme with the Official Record tokens, build the five primitives, and lock the seal reservation with a test — so Stage 2 can hand-convert 74 screens against a vocabulary that already exists.

**Architecture:** Identity first (JWT issuer and cookies must move atomically or auth breaks), then tokens, then primitives, then enforcement. No screens are converted here; Stage 2 does that.

**Tech Stack:** Next.js App Router, Tailwind, TypeScript, Jest, Express microservices, RS256 JWT.

**Spec:** `docs/superpowers/specs/2026-08-03-gadonghr-rebrand-design.md`

## Global Constraints

- **Display name is `GaDongHR`; code identifier is `gadonghr`.** Never "GaDong HR", never "Gadong".
- **App URL is `app.bevorasg.com`.** Replaces `app.bevorasg.com` in CORS origins, email links and docs.
- **All 9 JWT issuer sites change in ONE commit**, signer included. Verifiers without the signer breaks every login.
- **All 8 cookies rename together:** `gadonghr_token`, `_refresh`, `_admin`, `_platform`, `_pdpa`, `_security`, `_sso`, `_user` → `gadonghr_*`.
- **`--seal` (#A8322A) is RESERVED** for authority citations. Never errors, never destructive actions. Enforced by test in Task 6.
- **No cards, no drop shadows, no rounded containers** in new components. Buttons and seals use `border-radius: 2px`; nothing else is rounded.
- **Every number right-aligned with `tabular-nums`.**
- **Do NOT rename** `hrms_*` databases, `hrms-*` containers, or the compose project — they read "HRMS", not "GaDongHR".
- **Statutory scope is unchanged** — Singapore + Malaysia. The seal cites CPF Act / EA / EPF Act, never the Thai LPA.
- **The backend suite must not move:** 103 suites / 1,909 tests, green under UTC *and* Asia/Singapore.
- **Commit after every task.**

---

## File Structure

| File | Responsibility |
|---|---|
| `services/auth-service/src/utils/jwt.utils.js` | **Signs** tokens — issuer |
| `services/admin-service/src/utils/jwt.js` | Signs + verifies platform tokens |
| `shared/auth-middleware/index.js` | Verifies, used by every service |
| `services/api-gateway/src/index.js` | Verifies at the gateway |
| `e2e/lib/jwt.ts`, `e2e/scripts/seed-test-users.js`, `e2e/tests/security-h-tier.spec.ts` | Forge tokens in tests |
| `frontend/src/lib/api.ts` | Cookie names |
| `frontend/src/app/globals.css` | Official Record CSS variables |
| `frontend/tailwind.config.ts` | Palette; remove the indigo remap |
| `frontend/src/components/official/*.tsx` | The five primitives |
| `frontend/src/components/GaDongLogo.tsx` | Replaces `GaDongLogo.tsx` |
| `frontend/__tests__/seal-reservation.test.ts` | Enforces the reservation |

---

## Task 1: JWT issuer — all 9 sites atomically

**Files:**
- Modify: `services/auth-service/src/utils/jwt.utils.js:39,53`
- Modify: `services/admin-service/src/utils/jwt.js:15,20`
- Modify: `shared/auth-middleware/index.js:46`
- Modify: `services/api-gateway/src/index.js:189`
- Modify: `e2e/lib/jwt.ts:45`, `e2e/scripts/seed-test-users.js:42`, `e2e/tests/security-h-tier.spec.ts:71`
- Test: `services/auth-service/__tests__/jwt-issuer.unit.test.js`

**Interfaces:**
- Produces: every RS256 token signed and verified with `issuer: 'gadonghr'`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
/**
 * The issuer must match between signer and verifiers. It is asserted here
 * because changing the verifiers without the signer (or vice versa) breaks
 * every login instantly, and the spec's own first draft made exactly that
 * mistake by listing only the verifiers.
 */
const fs = require('fs');
const path = require('path');

const SIGN_SITES = [
  '../src/utils/jwt.utils.js',
  '../../admin-service/src/utils/jwt.js',
];
const VERIFY_SITES = [
  '../../../shared/auth-middleware/index.js',
  '../../api-gateway/src/index.js',
];

describe('JWT issuer is gadonghr everywhere', () => {
  test.each([...SIGN_SITES, ...VERIFY_SITES])('%s uses gadonghr', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    expect(src).toMatch(/issuer:\s*'gadonghr'/);
    expect(src).not.toMatch(/issuer:\s*'gadonghr'/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest --projects services/auth-service --runInBand jwt-issuer`
Expected: FAIL — every site still says `gadonghr`.

- [ ] **Step 3: Replace the issuer at all 9 lines**

```bash
git grep -l "issuer: *'gadonghr'" | xargs perl -pi -e "s/issuer: *'gadonghr'/issuer: 'gadonghr'/g"
git grep -n "issuer: *'gadonghr'" | wc -l   # expect 9
git grep -n "issuer: *'gadonghr'" | wc -l   # expect 0
```

- [ ] **Step 4: Run the test and the auth suite**

Run: `npx jest --projects services/auth-service --runInBand`
Expected: PASS, including the new issuer test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(auth): JWT issuer gadonghr -> gadonghr across all 9 sites"
```

---

## Task 2: Cookie rename — all 8 together

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: every file matching `git grep -l "gadonghr_"` under `services/`, `frontend/`, `e2e/`
- Test: `frontend/__tests__/cookie-names.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: cookie prefix `gadonghr_`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * Cookie names are part of the brand surface — they are visible in devtools
 * and in any audit. A fresh-start deployment means renaming them costs
 * nothing, so no gadonghr_ prefix should survive.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const API = readFileSync(join(__dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');

describe('cookie names are gadonghr-prefixed', () => {
  it('uses the gadonghr access cookie', () => {
    expect(API).toContain("'gadonghr_token'");
  });
  it('uses the gadonghr refresh cookie', () => {
    expect(API).toContain("'gadonghr_refresh'");
  });
  it('retains no gadonghr_ prefix', () => {
    expect(API).not.toMatch(/gadonghr_/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest --projects frontend --runInBand cookie-names`
Expected: FAIL — `api.ts` still declares `gadonghr_token`.

- [ ] **Step 3: Rename every cookie**

```bash
git grep -l "gadonghr_" -- services frontend e2e shared \
  | xargs perl -pi -e "s/gadonghr_/gadonghr_/g"
git grep -n "gadonghr_" -- services frontend e2e shared | wc -l   # expect 0
```

- [ ] **Step 4: Verify**

Run: `npx jest --projects frontend --runInBand cookie-names`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(auth): rename all 8 cookies gadonghr_* -> gadonghr_*"
```

---

## Task 3: Product name, package, URL and logo component

**Files:**
- Modify: `package.json` (`name`), `package-lock.json`
- Rename: `frontend/src/components/GaDongLogo.tsx` → `GaDongLogo.tsx`
- Modify: every file referencing `GaDongHR` / `gadonghr` / `app.bevorasg.com`

**Interfaces:**
- Produces: `GaDongLogo`, `GaDongMark` exported from `frontend/src/components/GaDongLogo.tsx`

- [ ] **Step 1: Rename the logo component and its exports**

```bash
git mv frontend/src/components/GaDongLogo.tsx frontend/src/components/GaDongLogo.tsx
perl -pi -e "s/GaDongLogo/GaDongLogo/g; s/GaDongMark/GaDongMark/g" \
  $(git grep -l "GaDongLogo\|GaDongMark")
```

- [ ] **Step 2: Replace remaining brand strings**

```bash
# Display name, then lowercase identifier, then the app URL.
git grep -l "GaDongHR" | xargs perl -pi -e "s/GaDongHR/GaDongHR/g"
git grep -l "gadonghr" | xargs perl -pi -e "s/gadonghr/gadonghr/g"
git grep -l "app\.gadonghr\.com" | xargs perl -pi -e "s/app\.gadonghr\.com/app.bevorasg.com/g"
```

Note the third line: step 2's blanket replace turns `app.bevorasg.com` into
`app.bevorasg.com`, which is **not** the real URL — it is corrected to
`app.bevorasg.com` immediately after.

- [ ] **Step 3: Set the package name**

`package.json` → `"name": "gadonghr"`. Update the two matching fields in
`package-lock.json`.

- [ ] **Step 4: Verify nothing named GaDongHR survives**

```bash
git grep -Iic "gadonghr" | wc -l    # expect 0
grep -rn "app.bevorasg.com" .github/ docker-compose.yml 2>/dev/null | head
npx tsc --noEmit -p frontend/tsconfig.json
```

- [ ] **Step 5: Run the full backend + frontend suites**

Run: `npm run test:backend && npm run test:frontend`
Expected: 103 suites / 1,909 backend, 89 frontend — unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(brand): GaDongHR -> GaDongHR; app URL -> app.bevorasg.com"
```

---

## Task 4: Official Record tokens

**Files:**
- Modify: `frontend/src/app/globals.css` (replace the `:root` token block)
- Modify: `frontend/tailwind.config.ts` (replace palette, remove the indigo remap)
- Test: `frontend/__tests__/design-tokens.test.ts`

**Interfaces:**
- Produces: CSS vars `--paper --ink --rule --seal --accent --highlight --muted --shadow`; Tailwind colours `paper ink rule seal accent highlight muted shadow`

- [ ] **Step 1: Write the failing test**

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

const TOKENS: Record<string, string> = {
  '--paper': '#FCFBF7', '--ink': '#171614', '--rule': '#DBD5C6',
  '--seal': '#A8322A', '--accent': '#1B4A3C', '--highlight': '#C08A3E',
  '--muted': '#6E685C', '--shadow': '#102A22',
};

describe('Official Record tokens', () => {
  it.each(Object.entries(TOKENS))('%s is %s', (name, hex) => {
    expect(CSS.toUpperCase()).toContain(`${name.toUpperCase()}: ${hex}`);
  });

  // The previous rebrand aliased Tailwind's indigo scale so brand colour
  // arrived through a class named "indigo". Keeping that here would deliver
  // Official Record colours under a false name.
  it('no longer defines indigo aliases', () => {
    expect(CSS).not.toMatch(/--indigo-/);
  });

  it('sets looser leading for Thai', () => {
    expect(CSS).toMatch(/:lang\(th\)[\s\S]{0,60}line-height:\s*1\.85/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest --projects frontend --runInBand design-tokens`
Expected: FAIL — globals.css still defines `--indigo-*`.

- [ ] **Step 3: Replace the token block in `globals.css`**

```css
:root {
  /* Official Record — GaDong house design system.
     Eight tokens. The discipline is the RESERVATION: --seal means exactly
     one thing (an authority citation) and appears nowhere else. */
  --paper:     #FCFBF7;   /* surfaces — never pure white */
  --ink:       #171614;   /* body text, 2px section rules */
  --rule:      #DBD5C6;   /* hairlines — most-used token by a wide margin */
  --seal:      #A8322A;   /* RESERVED — authority citations only */
  --accent:    #1B4A3C;   /* primary actions, current page */
  --highlight: #C08A3E;   /* sparing emphasis, never at body size */
  --muted:     #6E685C;   /* secondary text */
  --shadow:    #102A22;   /* dark surfaces only */
  --page:      #F2F1EC;
}

@media (prefers-color-scheme: dark) {
  :root { --page:#12100D; --paper:#1A1815; --ink:#EDE9E0; --rule:#332F28; --muted:#9A9384; }
}
:root[data-theme="dark"]  { --page:#12100D; --paper:#1A1815; --ink:#EDE9E0; --rule:#332F28; --muted:#9A9384; }
:root[data-theme="light"] { --page:#F2F1EC; --paper:#FCFBF7; --ink:#171614; --rule:#DBD5C6; --muted:#6E685C; }

/* Thai marks sit above and below the baseline. At Latin leading they clip —
   illegible to a native reader, invisible to anyone testing in English. */
:lang(th) { line-height: 1.85; }
```

Delete every `--indigo-*`, `--gold-*` and `--navy-*` declaration.

- [ ] **Step 4: Replace the Tailwind palette**

In `frontend/tailwind.config.ts`, remove the `indigo` remap block and add:

```ts
colors: {
  paper:     '#FCFBF7',
  ink:       '#171614',
  rule:      '#DBD5C6',
  seal:      '#A8322A',
  accent:    '#1B4A3C',
  highlight: '#C08A3E',
  muted:     '#6E685C',
  shadow:    '#102A22',
  page:      '#F2F1EC',
},
```

- [ ] **Step 5: Verify**

Run: `npx jest --projects frontend --runInBand design-tokens`
Expected: PASS — 10 assertions.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(design): adopt Official Record tokens, retire the indigo remap"
```

---

## Task 5: The five primitives

**Files:**
- Modify: `frontend/package.json` — add test infrastructure (see Step 0)
- Create: `frontend/src/components/official/Field.tsx`, `Seal.tsx`, `Button.tsx`, `DataTable.tsx`, `Notice.tsx`, `index.ts`
- Test: `frontend/__tests__/official-primitives.test.tsx`

⚠ **Step 0 is not optional.** The frontend currently runs
`testEnvironment: "node"` with `testMatch: ["**/__tests__/**/*.test.ts"]` and has
no `@testing-library/react` — its existing tests are pure logic
(`attendanceUtils`, `timezone`), so component rendering was never set up. Without
Step 0 these tests are not even discovered, let alone run. Found during plan
self-review rather than mid-task.

- [ ] **Step 0: Add component-test infrastructure**

```bash
npm install --save-dev --workspace frontend \
  @testing-library/react @testing-library/jest-dom jest-environment-jsdom
```

Then in `frontend/package.json` jest config:

```json
"testEnvironment": "jsdom",
"testMatch": ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
"setupFilesAfterEach": ["<rootDir>/jest.setup.ts"]
```

Create `frontend/jest.setup.ts`:

```ts
import '@testing-library/jest-dom';
```

Verify the existing 89 tests still pass under jsdom before continuing:

```bash
npx jest --projects frontend --runInBand
```
Expected: 89 passing. jsdom is a superset of what those tests needed, so a
failure here means a genuine environment assumption to fix, not a flake.

**Interfaces:**
- Produces:
  - `<Field label={string} hint?={string} value={ReactNode} seal?={ReactNode} />`
  - `<Seal cite={string} />` — renders `§ {cite}`
  - `<Button variant?={'accent'|'secondary'|'quiet'} disabled?={boolean} reason?={string} />`
  - `<DataTable columns={{key,label,numeric?}[]} rows={Record<string,ReactNode>[]} total?={{label,value}} />`
  - `<Notice heading={string} children={ReactNode} seal?={ReactNode} />`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { Field, Seal, Button, DataTable, Notice } from '../src/components/official';

describe('Field', () => {
  it('renders label and value', () => {
    render(<Field label="Sick leave" value="30 days" />);
    expect(screen.getByText('Sick leave')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });
  it('renders the hint as secondary text', () => {
    render(<Field label="Sick leave" hint="Annual entitlement" value="30 days" />);
    expect(screen.getByText('Annual entitlement')).toBeInTheDocument();
  });
});

describe('Seal', () => {
  it('prefixes the citation with a section mark', () => {
    render(<Seal cite="CPF Act s.7" />);
    expect(screen.getByText(/CPF Act s\.7/)).toBeInTheDocument();
  });
});

describe('Button', () => {
  // Hiding an action teaches the user the feature is missing; a server
  // rejection after clicking teaches them the product is unreliable.
  it('stays visible when disabled and shows the reason', () => {
    render(<Button disabled reason="Run already finalised">Approve</Button>);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Run already finalised')).toBeInTheDocument();
  });
});

describe('DataTable', () => {
  it('renders rows and a total', () => {
    render(
      <DataTable
        columns={[{ key: 'item', label: 'Item' }, { key: 'amount', label: 'Amount', numeric: true }]}
        rows={[{ item: 'Base salary', amount: '24,000.00' }]}
        total={{ label: 'Net', value: '24,000.00' }}
      />,
    );
    expect(screen.getByText('Base salary')).toBeInTheDocument();
    expect(screen.getByText('Net')).toBeInTheDocument();
  });
});

describe('Notice', () => {
  it('renders heading and body', () => {
    render(<Notice heading="Rejected — below statutory floor">Minimum is 7 days.</Notice>);
    expect(screen.getByText('Rejected — below statutory floor')).toBeInTheDocument();
    expect(screen.getByText('Minimum is 7 days.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest --projects frontend --runInBand official-primitives`
Expected: FAIL — `Cannot find module '../src/components/official'`.

- [ ] **Step 3: Implement the primitives**

`Seal.tsx` — the ONLY file permitted to reference the seal token:

```tsx
/**
 * A citation attached to any value an external authority sets.
 *
 * This is the ONLY component allowed to use the seal token. The reservation is
 * enforced by frontend/__tests__/seal-reservation.test.ts, because the design
 * document watched this exact rule erode within hours of being written down.
 * The instant seal red marks an error or a delete button, the citation stops
 * reading as special and the whole language collapses into decoration.
 */
export function Seal({ cite }: { cite: string }) {
  return (
    <span className="inline-flex items-center gap-1 border border-seal text-seal rounded-[2px]
                     px-1 py-[0.05rem] font-mono text-[0.5625rem] tracking-[0.04em] uppercase">
      <span aria-hidden="true">§</span>{cite}
    </span>
  );
}
```

`Field.tsx`:

```tsx
/** Label left, value right, hairline between. Replaces the card as the atom. */
export function Field({ label, hint, value, seal }: {
  label: string; hint?: string; value: React.ReactNode; seal?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-2 border-b border-rule last:border-b-0">
      <span className="text-[0.9375rem]">
        {label}
        {hint && <small className="block text-muted text-xs">{hint}</small>}
        {seal && <span className="mt-1 block">{seal}</span>}
      </span>
      <span className="font-semibold whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}
```

`Button.tsx`:

```tsx
/** Disabled actions stay VISIBLE with the reason beside them — never hidden. */
export function Button({ variant = 'accent', disabled, reason, children, ...rest }: {
  variant?: 'accent' | 'secondary' | 'quiet'; disabled?: boolean; reason?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-block rounded-[2px] px-3.5 py-2 text-sm font-semibold border';
  const styles = disabled
    ? 'bg-transparent text-muted border-rule cursor-not-allowed'
    : variant === 'accent'    ? 'bg-accent text-white border-accent'
    : variant === 'secondary' ? 'bg-transparent text-accent border-accent'
    :                           'bg-transparent text-muted border-rule';
  return (
    <>
      <button className={`${base} ${styles}`} aria-disabled={disabled} disabled={disabled} {...rest}>
        {children}
      </button>
      {disabled && reason && <span className="ml-2 text-xs text-muted">{reason}</span>}
    </>
  );
}
```

`DataTable.tsx`:

```tsx
/**
 * tabular-nums is load-bearing, not a nicety: without it a column of figures
 * does not line up, and scanning the column is the only reason it exists.
 */
export function DataTable({ columns, rows, total }: {
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, React.ReactNode>[];
  total?: { label: string; value: React.ReactNode };
}) {
  return (
    <>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>{columns.map((c, i) => (
            <th key={c.key} className={`font-mono text-[0.625rem] tracking-wider uppercase text-muted
                       font-semibold py-1.5 border-b border-rule ${i === 0 ? 'text-left' : 'text-right'}`}>
              {c.label}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{columns.map((c, i) => (
              <td key={c.key} className={`py-1.5 border-b border-rule last:border-b-0
                         ${i === 0 ? 'text-left' : 'text-right tabular-nums'}`}>
                {r[c.key]}
              </td>
            ))}</tr>
          ))}
        </tbody>
      </table>
      {total && (
        <div className="flex justify-between border-t-2 border-ink pt-2 mt-1 font-bold tabular-nums">
          <span>{total.label}</span><span>{total.value}</span>
        </div>
      )}
    </>
  );
}
```

`Notice.tsx` — border is **ink, not seal**, even when it carries a citation:

```tsx
/**
 * The border is ink even when the notice carries a citation. The seal marks the
 * authority; the notice is only a container. Using red for both dilutes the
 * reservation.
 */
export function Notice({ heading, children, seal }: {
  heading: string; children: React.ReactNode; seal?: React.ReactNode;
}) {
  return (
    <div className="border border-ink p-3 my-3 text-sm">
      <div className="font-mono text-[0.625rem] tracking-wider uppercase font-semibold mb-1">{heading}</div>
      {children}
      {seal && <div className="mt-2">{seal}</div>}
    </div>
  );
}
```

`index.ts`:

```ts
export { Field } from './Field';
export { Seal } from './Seal';
export { Button } from './Button';
export { DataTable } from './DataTable';
export { Notice } from './Notice';
```

- [ ] **Step 4: Verify**

Run: `npx jest --projects frontend --runInBand official-primitives`
Expected: PASS — 7 assertions.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(design): five Official Record primitives"
```

---

## Task 6: Enforce the seal reservation

**Files:**
- Create: `frontend/__tests__/seal-reservation.test.ts`

**Interfaces:**
- Consumes: `frontend/src/components/official/Seal.tsx` from Task 5

- [ ] **Step 1: Write the test**

```typescript
/**
 * "Reserve one colour for one meaning." The design document asks for this as a
 * TEST, not a convention, having watched its own rule erode within hours of
 * being written down.
 *
 * Seal red marks an authority citation and nothing else — never an error, never
 * a destructive action, never a validation failure.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry) ? [full] : [];
  });
}

describe('the seal token is reserved', () => {
  it('appears only in Seal.tsx and the token definition', () => {
    const offenders = sourceFiles(SRC).filter((f) => {
      if (f.endsWith('Seal.tsx')) return false;
      if (f.endsWith('globals.css')) return false;   // where the token is DEFINED
      const src = readFileSync(f, 'utf8');
      return /var\(--seal\)|\bborder-seal\b|\btext-seal\b|\bbg-seal\b/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx jest --projects frontend --runInBand seal-reservation`
Expected: PASS. If it fails, a screen is already misusing the token — fix the screen, never the test.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(design): enforce the seal reservation"
```

---

## Task 7: Stage 1 verification

- [ ] **Step 1: Full backend suite, both timezones**

```bash
npm run test:backend
TZ=Asia/Singapore npm run test:backend
```
Expected: **103 suites / 1,909 tests** in both. The rebrand must not move a single backend test.

- [ ] **Step 2: Cross-tenant isolation**

```bash
npm run test:isolation
```
Expected: 16/16.

- [ ] **Step 3: Frontend + types**

```bash
npm run test:frontend
npx tsc --noEmit -p frontend/tsconfig.json
```
Expected: 89 existing + the new token/primitive/seal/cookie tests; zero type errors.

- [ ] **Step 4: Brand sweep**

```bash
git grep -Iic "gadonghr" | wc -l   # expect 0
```

- [ ] **Step 5: Commit the verification note**

```bash
git add -A && git commit -m "chore(gadonghr): Stage 1 foundation verified"
```

---

## Out of scope (Stage 2 and beyond)

- Hand-converting 74 `.tsx` files to the primitives (Stage 2)
- Attaching seals to statutory values on real screens (Stage 2)
- Server provisioning, `app.bevorasg.com` DNS/TLS, CI/CD migration — blocked on GaDong server access
- Malaysia P2–P5
