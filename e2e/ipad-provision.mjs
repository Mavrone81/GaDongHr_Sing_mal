import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3005';

const USER = {
  id: 'u1', name: 'Admin Tester', email: 'admin@hrms.com',
  role: 'SUPER_ADMIN', employeeId: null, permissions: [],
};

const viewports = [
  { name: 'ipad-portrait',  width: 768,  height: 1024 },
  { name: 'ipad-landscape', width: 1024, height: 768  },
  { name: 'ipad-air-portrait', width: 820, height: 1180 },
];

const browser = await chromium.launch();
let failures = 0;

for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addCookies([
    { name: 'gadonghr_token', value: 'test-token', domain: 'localhost', path: '/' },
  ]);
  const page = await context.newPage();

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    let body = {};
    if (url.includes('/auth/me')) body = USER;
    else if (url.includes('/employees/applications')) body = [];
    else if (url.includes('/users/pending-invites')) body = [];
    else if (url.includes('/employees')) body = { employees: [] };
    else if (url.includes('/notifications')) body = { notifications: [], unread: 0 };
    else body = {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(`${BASE}/employees`, { waitUntil: 'networkidle' }).catch(() => {});

  // Find the Provision Identity button (the header action, not modal text)
  const btn = page.locator('button:has-text("Provision Identity")').first();
  let result = { vp: vp.name, found: false };
  try {
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    const box = await btn.boundingBox();
    const inViewportX = box && box.x >= 0 && (box.x + box.width) <= vp.width + 0.5;
    const inViewportY = box && box.y >= 0 && (box.y + box.height) <= vp.height + 0.5;
    const visible = await btn.isVisible();
    // Also confirm clickable (not obscured/clipped) via elementFromPoint at its center
    const clickable = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      return !!el.closest('button');
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    result = { vp: vp.name, found: true, visible, box, inViewportX, inViewportY, clickable };
    if (!(visible && inViewportX && clickable)) failures++;
  } catch (e) {
    result.error = String(e).split('\n')[0];
    failures++;
  }
  console.log(JSON.stringify(result));
  await page.screenshot({ path: `/tmp/provision-${vp.name}.png`, fullPage: false });
  await context.close();
}

await browser.close();
console.log(`\nFAILURES: ${failures}`);
process.exit(failures ? 1 : 0);
