/**
 * The dashboard chrome frames every screen in the product, so it is the single
 * highest-leverage file in the product: until it moves, every screen still sits
 * inside the old shell.
 *
 * Asserted at source level rather than by rendering, because the layout pulls in
 * Next.js routing, auth context and the notification bell — mounting it would
 * test the harness more than the design.
 *
 * 2026-09 redesign: the chrome is a light 240px sidebar with grouped, icon-led
 * navigation, a 60px top bar with breadcrumb, ⌘K search and account menu, and a
 * phone bottom bar. Radii are the named tokens only; no ad-hoc Tailwind scale.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { CARD, LEGACY_HUE, withoutSpinners } from './helpers/vocabulary';

const LAYOUT = readFileSync(
  join(__dirname, '..', 'src', 'app', '(dashboard)', 'layout.tsx'),
  'utf8',
);

describe('dashboard chrome speaks the redesign vocabulary', () => {
  it('uses only the named radii and shadow', () => {
    expect(withoutSpinners(LAYOUT).match(CARD)?.[0] ?? null).toBeNull();
  });

  it('uses no legacy palette', () => {
    expect(LAYOUT.match(LEGACY_HUE)?.[0] ?? null).toBeNull();
    expect(LAYOUT).not.toMatch(/#0a1628/i);
  });

  it('uses the design tokens', () => {
    expect(LAYOUT).toMatch(/bg-paper|text-ink|border-rule|text-muted/);
    expect(LAYOUT).toMatch(/bg-tint/);
  });

  it('nav icons are named Icon glyphs, not dingbats', () => {
    expect(LAYOUT).not.toMatch(/icon: '[^a-zA-Z]/);
    expect(LAYOUT).toMatch(/icon: IconName/);
  });

  it('has the ⌘K palette, breadcrumb and phone bottom bar', () => {
    expect(LAYOUT).toMatch(/CommandPalette/);
    expect(LAYOUT).toMatch(/aria-label="Breadcrumb"/);
    expect(LAYOUT).toMatch(/aria-label="Quick navigation"/);
  });

  it('prints no tracked all-caps micro labels', () => {
    expect(LAYOUT).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/);
    expect(LAYOUT).not.toMatch(/Terminate Session|Command Centre|Authenticating Identity/);
  });
});
