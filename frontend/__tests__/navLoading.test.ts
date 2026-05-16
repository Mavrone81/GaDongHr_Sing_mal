/**
 * Unit tests for the navigation loading overlay logic in the dashboard layout.
 *
 * The layout tracks isNavigating + navTarget state. Tests verify:
 *   A) Clicking a non-active link sets isNavigating=true and navTarget
 *   B) Clicking the already-active link does NOT trigger loading (no round-trip)
 *   C) A pathname change clears isNavigating (simulating page arrival)
 */

// ── Pure state machine extracted from the layout ──────────────────────────────

interface NavState {
  isNavigating: boolean;
  navTarget: string;
}

function handleNavClick(
  state: NavState,
  opts: { isActive: boolean; itemName: string }
): NavState {
  if (opts.isActive) return state; // already on this page — no loading needed
  return { isNavigating: true, navTarget: opts.itemName };
}

function handlePathnameChange(state: NavState): NavState {
  return { ...state, isNavigating: false };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Navigation loading overlay logic', () => {
  const initial: NavState = { isNavigating: false, navTarget: '' };

  describe('A) Clicking a non-active link', () => {
    test('sets isNavigating to true', () => {
      const next = handleNavClick(initial, { isActive: false, itemName: 'Employees' });
      expect(next.isNavigating).toBe(true);
    });

    test('sets navTarget to the item name', () => {
      const next = handleNavClick(initial, { isActive: false, itemName: 'Payroll' });
      expect(next.navTarget).toBe('Payroll');
    });

    test('stores the correct name for any nav item', () => {
      const items = ['Dashboard', 'Attendance', 'Leave', 'Reports', 'Settings'];
      items.forEach(name => {
        const next = handleNavClick(initial, { isActive: false, itemName: name });
        expect(next.navTarget).toBe(name);
        expect(next.isNavigating).toBe(true);
      });
    });
  });

  describe('B) Clicking the already-active link', () => {
    test('does not change state (no loading overlay shown)', () => {
      const next = handleNavClick(initial, { isActive: true, itemName: 'Dashboard' });
      expect(next.isNavigating).toBe(false);
      expect(next.navTarget).toBe('');
    });

    test('does not trigger loading even if previous state had a target', () => {
      const state: NavState = { isNavigating: false, navTarget: 'Previous' };
      const next = handleNavClick(state, { isActive: true, itemName: 'Dashboard' });
      expect(next.isNavigating).toBe(false);
    });
  });

  describe('C) Pathname change clears loading state', () => {
    test('clears isNavigating when new page mounts', () => {
      const navigating: NavState = { isNavigating: true, navTarget: 'Employees' };
      const arrived = handlePathnameChange(navigating);
      expect(arrived.isNavigating).toBe(false);
    });

    test('preserves navTarget after clearing (label stays until next click)', () => {
      const navigating: NavState = { isNavigating: true, navTarget: 'Employees' };
      const arrived = handlePathnameChange(navigating);
      // navTarget is preserved — cleared on next click, not on arrival
      expect(arrived.navTarget).toBe('Employees');
    });

    test('is a no-op if not navigating', () => {
      const arrived = handlePathnameChange(initial);
      expect(arrived.isNavigating).toBe(false);
    });
  });
});
