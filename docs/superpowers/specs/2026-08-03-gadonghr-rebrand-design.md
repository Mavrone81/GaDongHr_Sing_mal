# GaDongHR Rebrand — Design Spec

**Date:** 2026-08-03
**Status:** Approved for implementation
**Target repo:** `github.com/Mavrone81/GaDongHr_Sing_mal`
**Design source:** "Official Record — a portable design system" (GaDong house standard)

---

## 1. Context

GaDong, a Thai HR company, has acquired the GaDongHR application with service
rights. The product is rebranded **GaDongHR** and redeployed on GaDong
infrastructure, because the previous company no longer funds the current server.

Three facts shape everything below:

- **Statutory scope is unchanged.** GaDongHR remains Singapore, with Malaysia
  in progress (P0/P1 complete on this branch). GaDong's Thai platform is a
  separate product being built independently — this is not a Thailand port, and
  the seal points at SG/MY authorities, never the Thai Labour Protection Act.
- **Fresh start.** No tenants, payslips or uploads migrate. This removes the
  usual cost of renaming cookies and the JWT issuer, and it means the databases
  are created new on the target server rather than moved.
- **The design system is the acquirer's house standard**, not a style being
  borrowed. Partial adoption would read as wrong to them, so it is adopted in
  full — including the rules that forbid the current UI's entire vocabulary.

### 1.1 Scope boundary

This spec covers **the rebrand only**. Two adjacent pieces are explicitly out:

- **Server provisioning, deployment and CI/CD migration** — blocked on
  credentials and DNS for the GaDong server. Planned separately once available.
- **Malaysia P2–P5** — `statutory-my-service`, the PCB engine, MY leave and
  filing. Unaffected by the rebrand and continues on its own plan.

---

## 2. Identity

Exact strings. Nothing here is inferred.

| Surface | From | To |
|---|---|---|
| Display name | GaDongHR | `GaDongHR` |
| Code identifier | `gadonghr` | `gadonghr` |
| Root package | `gadonghr-hrms` | `gadonghr` |
| JWT issuer | `gadonghr` | `gadonghr` |
| Cookies (8) | `gadonghr_token`, `gadonghr_refresh`, `gadonghr_admin`, `gadonghr_platform`, `gadonghr_pdpa`, `gadonghr_security`, `gadonghr_sso`, `gadonghr_user` | `gadonghr_*` |
| Email domains | `@gadonghr.sg` `.com` `.app` `.test` | `@gadonghr.*` |
| Logo component | `GaDongLogo.tsx`, `GaDongMark` | `GaDongLogo.tsx`, `GaDongMark` |

**The JWT issuer is the sharp edge — 9 lines across 6 files.** Corrected during
spec self-review, which found my first pass listed only the verifiers and missed
the signer entirely. Changing verifiers without the signer breaks every login:

| File | Role |
|---|---|
| `services/auth-service/src/utils/jwt.utils.js:39,53` | **SIGNS** access + refresh tokens — the one that must not be missed |
| `services/admin-service/src/utils/jwt.js:15,20` | signs and verifies platform tokens |
| `shared/auth-middleware/index.js:46` | verifies, used by every service |
| `services/api-gateway/src/index.js:189` | verifies at the gateway |
| `e2e/lib/jwt.ts:45`, `e2e/scripts/seed-test-users.js:42`, `e2e/tests/security-h-tier.spec.ts:71` | forge tokens in the test harness — must match or every E2E fails |

All nine change in one commit. Fresh-start data makes this free; there are no
live tokens to invalidate.

**Deliberately NOT renamed:** `hrms_*` databases, `hrms-*` container names, the
compose project. These read "HRMS" — generic, not branded. Renaming them buys no
brand value and would mean a data migration; on a fresh deployment they are
simply created under those names.

---

## 3. Tokens and type

The eight tokens are adopted verbatim into `frontend/src/app/globals.css` as CSS
variables and `frontend/tailwind.config.ts` as the palette:

```
--paper     #FCFBF7    surfaces (never pure white)
--ink       #171614    body text, 2px section rules
--rule      #DBD5C6    hairlines — the most-used token by a wide margin
--seal      #A8322A    RESERVED — authority citations only
--accent    #1B4A3C    primary actions, current page
--highlight #C08A3E    sparing emphasis, never at body size
--muted     #6E685C    secondary text
--shadow    #102A22    dark surfaces only
```

`--accent` is **not** swapped for a brand colour. The document's step 1 says to
substitute your own; here GaDong is the brand and this is their palette, so it
stays as published.

### 3.1 The existing indigo remap is removed, not repointed

The 2026 GaDongHR rebrand aliased Tailwind's `indigo` scale to navy so that
`bg-indigo-600` rendered navy across ~72 files without touching them. That trick
is retired here. Keeping it would deliver Official Record colours through a class
named `indigo` — a lie in the config that makes every subsequent reader distrust
it. Screens are hand-converted anyway (§5), so they receive real token classes.

### 3.2 Type

One humanist sans, one mono. Hierarchy from weight and space, never a second
typeface. Scale as published: page title 1.75rem/620, section head 1.5rem/640,
subhead 1.06rem/660, body 1rem/400 at line-height 1.6, label .9375rem, secondary
.8125rem muted, eyebrow .625rem/660 mono uppercase with .16em tracking.

`:lang(th) { line-height: 1.85 }` is included even though the UI is English.
It costs one line, and the acquirer is a Thai company — at Latin leading, Thai
marks clip, which is illegible to a native reader and invisible to everyone
testing in English.

---

## 4. Primitives and the seal

Five components carry the system. Everything else composes from them.

| Component | Role |
|---|---|
| `Field` | Label left, value right, hairline between. Replaces the card as the atom. |
| `Seal` | `§` citation attached to any value an external authority sets. |
| `Button` | `accent` / `secondary` / `quiet` / disabled-but-visible. |
| `DataTable` | Right-aligned figures, `tabular-nums`, 2px ink rule above the total. |
| `Notice` | Ink border — **not** seal red, even when it carries a citation. |

`tabular-nums` is load-bearing, not decoration: without it a column of money does
not align, and scanning the column is the only reason it exists.

### 4.1 Where the seal attaches — the product-specific decision

The document's step 3 — "find your equivalent of the form number" — is the one it
says people skip and the one that decides whether the system feels native. For an
SG/MY payroll product, the authorities users already answer to are:

| Value on screen | Seal |
|---|---|
| CPF employee/employer contribution | `CPF Act s.7 · Jan 2026 table` |
| Skills Development Levy | `SDL Act · 0.25% cap 4,500` |
| Annual leave entitlement (SG) | `EA s.43 · floor 7` |
| Sick leave (SG) | `EA s.89 · floor 14` |
| Overtime rate (SG) | `EA s.38 · 1.5×` |
| Salary payment deadline | `EA s.21 · within 7 days` |
| IR8A / IR21 filing deadline | `IRAS · by 1 Mar` / `IRAS · LWD − 30d` |
| EPF / SOCSO / EIS (MY, P2+) | `EPF Act 1991`, `SOCSO Act 1969`, `EIS Act 2017` |
| Annual leave (MY, P4) | `EA 1955 s.60E · 8/12/16 by service` |
| Overtime (MY, P4) | `EA 1955 s.60A · 1.5/2/3×` |

**The eyebrow carries the form number the user already knows** — `IR8A`,
`IR21`, `CPF e-Submit`, `Appendix 8A`, and for Malaysia `EA Form`, `Form E`,
`CP39`. These are the identifiers on the paperwork an HR officer already handles,
which is precisely the document's point.

*This mapping is my judgement and the part most worth challenging.* It is drawn
from the statutory references already cited throughout the codebase and the PRD,
not invented — but if GaDong's HR officers quote different identifiers, this is
the table to correct.

### 4.2 Enforcing the reservation

The document asks for this explicitly, having watched its own rule erode "within
hours of being written down". A test asserts `var(--seal)` and the `seal` token
appear only inside the `Seal` component. Seal red must never mark an error, a
destructive action or a validation failure — the instant it does, the citation
stops reading as special and the language collapses into decoration.

---

## 5. Screen conversion

**Approach B — hand-converted, no codemod.**

The scale is honest: **74 of 78 `.tsx` files use `rounded`, 63 use `shadow`, 71
are card-shaped.** Official Record forbids all three, so nearly the entire
frontend changes. This is not the 2-file colour remap the last rebrand was.

Conversion rules per screen:

- Card containers → sections separated by hairline `--rule`, grouped by whitespace
- `rounded-lg/xl/2xl/full` → removed. The system is **not** zero-radius: buttons
  and seals use `2px`. Intent is mapped, not deleted.
- `shadow-*` → removed entirely
- Label/value pairs → `Field`
- Any table with a total → `DataTable` with `tabular-nums`
- Statutory values → gain a `Seal`
- Status colours → must carry a text label beside them
- Icons → must carry a word, unless universally understood in the domain
- Disabled actions stay **visible with the reason beside them**, never hidden

### 5.1 Two-stage delivery

1. **Foundation** — identity, tokens, primitives, enforcement test. Reviewable
   on its own; nothing depends on 74 files having moved.
2. **Conversion** — screens, in priority order: payroll → payslip → leave →
   employee → dashboard → settings → platform console.

Splitting this way means the rename and the design foundation are verifiable
before most of the frontend moves, rather than arriving as one unreviewable
commit.

---

## 6. Verification

- Full backend suite green (currently **103 suites / 1,909 tests**, UTC and
  Asia/Singapore) — the rebrand must not move a single test
- Cross-tenant isolation still 16/16
- Frontend suite green; `tsc --noEmit` clean
- Seal-reservation test passes
- No `gadonghr` / `GaDongHR` in tracked files, mirroring the EzyHRM sweep
- Auth works end to end after the issuer/cookie rename — login, refresh,
  platform login, all three JWT verify sites agreeing

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| JWT issuer changed in some of the 9 sites but not the signer → every login breaks | All 9 in one commit, signer first; auth E2E in the verification list. This spec's own first draft made exactly this mistake |
| 74 hand-converted files drift in style | Primitives land first, so conversion is *use the component*, not *invent the markup* |
| Seal reservation erodes | Enforced by test, per the document's own warning |
| Rebrand collides with in-flight Malaysia work | Rebrand touches naming/UI; Malaysia touches statutory services. Little overlap, but the rebrand lands first so P2 starts from GaDongHR |
| Old-brand strings survive in DB seeds/fixtures | Sweep mirrors the EzyHRM removal, which found 3 tracked lines and 2 untracked |
