/**
 * Paths (relative to frontend/src) that have been rebuilt to the 2026-09
 * redesign. The redesign guard (redesign-guard.test.ts) runs its stricter
 * rules — no sub-12px sizes, no legacy eyebrow/badge classes, no dingbat
 * icons — on every .tsx file under these prefixes.
 *
 * When your batch lands, APPEND your routes here in the same commit. That is
 * how a batch declares itself done, and how it stays done.
 */
export const MIGRATED: string[] = [
  'components/ui/',
  'app/layout.tsx',
  // redesign/talent (IMs (L))
  'app/(dashboard)/assets/',
  'app/(dashboard)/offboarding/',
  // redesign/shell adds: components/auth/, components/CommandPalette.tsx,
  // components/NotificationBell.tsx, components/TrialBanner.tsx,
  // app/(dashboard)/layout.tsx, app/login/, app/register/, app/auth/*
];
