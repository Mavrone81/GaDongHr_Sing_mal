/**
 * The dashboard chrome frames every screen in the product, so it is the single
 * highest-leverage file in the conversion: 671 lines, and until it moves, every
 * converted screen still sits inside a card-and-shadow shell.
 *
 * Asserted at source level rather than by rendering, because the layout pulls in
 * Next.js routing, auth context and the notification bell — mounting it would
 * test the harness more than the design.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const LAYOUT = readFileSync(
  join(__dirname, '..', 'src', 'app', '(dashboard)', 'layout.tsx'),
  'utf8',
);

describe('dashboard chrome speaks the document vocabulary', () => {
  // It is a document, not a dashboard.
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
