# GaDongHR redesign — "Clean workspace" (approved 2026-09-15)

Samuel approved the mockups on the **GaDongHR Workspace Redesign** canvas
(17 artboards) and asked for every page, including `/platform`, to be rebuilt to
it, split across the fleet. This file is the spec every worker builds against.

## The two looks

| | Tenant app (all `/dashboard/*`, auth pages) | Operator console (`/platform/*`) |
|---|---|---|
| Direction | **B** — light workspace | **C** — dark console |
| Ground / surface | `--page` #F6F6F3 / `--paper` #FFFFFF | #0F1512 / #171F1B |
| Text | `--ink` #1A1A18, `--muted` #6B6960, `--faint` #9C9A91 | #E8ECE9 / #8E9A93 |
| Border | `--rule` #E5E3DD | #27322C |
| Accent | `--accent` #1B4A3C (+ `--tint` #E7EFEA) | #3FA07C |
| Brass | `--highlight` #C08A3E — logo "HR" only | #D4A254 — logo only |
| States | `--ok` #067647 · `--warn` #B54708 · `--danger` #B42318 | same hues, lifted |
| Type | Manrope (`font-sans`), 14px body, 26px H1, 15.5px card titles, 12.5px labels | IBM Plex Sans + Plex Mono for ids/numbers |
| Radius | cards 12px (`rounded-card`), controls 8px (`rounded-control`) | same |

Token names in `frontend/src/app/globals.css` are unchanged, so untouched
screens keep rendering (slightly cleaner) until their batch lands. The tenant
app is light only. The dark console is opt-in: put `data-theme="dark"` on a
wrapper element in the `/platform` layout (the selector is a descendant match,
so a div works) — do not hard-code hex in pages. Tailwind colours are
`rgb(var(--x-rgb) / <alpha-value>)`, so `bg-ink/40` and `ring-accent/30` work;
`text-on-accent` is the text colour on any accent fill; chip grounds are
`bg-ok-bg` / `bg-warn-bg` / `bg-danger-bg` / `bg-brass-bg`.

## Shared components

Import from `@/components/ui` (see `index.ts` for the rules): `PageHeader`,
`Card`/`CardHeader`, `Stat`, `DataTable` (with `mobileCard` for phones),
`Tabs`, `Field`/`Input`/`Select`/`Textarea`, `Button`, `Badge`, `SearchInput`,
`EmptyState`, `Icon`, `Modal`, `useToast()` (provider is in the root layout),
`Stepper`, `Avatar`, `SplitPane`. Add a component there when two batches need
it; do not fork a private copy. The older `components/official/*` set stays for
unmigrated screens and is deleted at the end.

Focus is the global `:focus-visible` outline in globals.css; never
`outline-none` without a visible replacement.

## Declaring a batch done

Append your route prefixes to `frontend/__tests__/helpers/migrated.ts` in the
same commit that rebuilds them. `redesign-guard.test.ts` then enforces the
stricter rules on those files: no `text-[<12px]`, no `text-2xs`, no
`eyebrow`/`label-form`/`panel-header`/`badge` classes, no dingbat or emoji
icons, no old marketing copy, no focus removal.

## Pre-existing bug you will meet: `apiFetch` returns JSON

`lib/api.ts` `apiFetch` has returned parsed JSON since May, but a dozen pages
still do `.then(r => r.json())` or check `res.ok` on it, so they throw and never
load. Some also prefix paths with `/api/` on a base that already ends in `/api`
(404 at the gateway). Fix at those call sites only (`apiFetchRaw` for the
Response-style ones; drop the `/api/` prefix) in a **separate commit** titled
`fix(api-callers): …` so it can be reviewed apart from presentation.

## Screen types (build to the matching artboard)

1. **List** — `PageHeader` + toolbar (SearchInput, filters, primary action) +
   `DataTable` with pagination footer and an `EmptyState`.
2. **Record** — identity band (avatar, name, role, status `Badge`, actions) +
   `Tabs` + two-column cards (main 2/3, side 1/3).
3. **Process** (payroll run, onboarding, offboarding) — stepper across the top,
   one step visible at a time, review-and-confirm last, summary Stats.
4. **Form / submit** (claim, leave, profile edit) — single column ≤ 640px, one
   `Card` per section, sticky action bar on mobile.
5. **Settings** — left sub-nav (within the settings area), one card per group.
6. **Approvals / inbox** — list on the left, detail on the right at ≥1280px;
   stacked below.
7. **Auth** — split screen: brand panel (`--shadow` #102A22) left, form card
   right; single column on mobile. MFA is a 6-cell code input.
8. **Mobile** (375px) — every page must work: nav collapses to a bottom bar of
   5 items + "More"; tables become card lists; actions become a sticky bar.

## Rules (the reviewer checks these)

- Nothing user-facing below 12px. No tracked all-caps micro-labels. Sentence
  case for labels, buttons and headings. Numbers use `tabular-nums`.
- Brass is the logo's "HR" only. `--seal` #A8322A only in `components/official/Seal.tsx`
  (`seal-reservation.test.ts` enforces it).
- Keep every API call, hook, permission check and business rule exactly as is.
  This is a presentation rewrite; if you have to touch logic, say so in the commit.
- Replace marketing copy with plain words ("Enterprise Intelligence Suite",
  "Identity verification for HRMS personnel" and friends go).
- Icons are `Icon` (inline SVG). No emoji, no dingbats.
- Every list has an empty state; every form has inline validation text;
  every disabled action says why.
- Work at 1440 and 375. Keyboard focus visible. Colour never the only signal.
- Do not run `npm run build` in the shared checkout; `tsc --noEmit` from
  `frontend/` (`../node_modules/.bin/tsc --noEmit -p .`) is the gate.

## Branching and hand-off

- Base: `redesign/foundation` (on remote `gadong`). Branch `redesign/<area>`
  from it in your own worktree.
- Push your branch to `gadong` when a page batch is done and message
  "Assistant Manager (L)" with the branch name and the routes covered.
- Never push to `main`, never deploy. Integration → `redesign/integration` →
  main → `docker compose up -d --build frontend` on 157.230.38.96 is the
  manager's job and Samuel's call.

## Assignments

| Session | Branch | Routes |
|---|---|---|
| Assistant Manager (L) | `redesign/shell`, `redesign/auth` | app shell (grouped sidebar, top bar, ⌘K, bottom bar), `/dashboard` home, `/login`, `/register`, MFA, password reset |
| VO (L) | `redesign/employees` | `/dashboard/employees/**`, profile, staff directory, onboarding, movements, succession |
| VA James (L) | `redesign/payroll` | `/dashboard/payroll/**`, benefits, loans, payslips |
| Network Map (L) | `redesign/time` | leave, claims, attendance, kiosk |
| IMS (L) | `redesign/talent` | recruitment, performance, training, assets, offboarding |
| Form2 (L) | `redesign/reports` | reports, documents, HR cases, surveys, support, notifications |
| HouseMCTS (L) | `redesign/settings` | every `/dashboard/settings/**` page |
| Surcon (L) | `redesign/platform` | every `/platform/**` page (Direction C) |
| Thailand GadongHr (L) | reviews | QA at 1440 + 375, accessibility, integration testing per batch |
