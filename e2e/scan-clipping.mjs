import { chromium } from '@playwright/test';
const BASE = 'http://localhost:3005';
const USER = { id:'u1', name:'Admin Tester', email:'admin@hrms.com', role:'SUPER_ADMIN', employeeId:'E1', permissions:[] };

// Static dashboard routes (skip dynamic [id] detail pages for the automated sweep)
const routes = [
  '/', '/assets', '/attendance', '/attendance/registry', '/attendance/schedule',
  '/benefits', '/claims', '/claims/registry', '/documents', '/employees',
  '/hr-cases', '/leave', '/leave/registry', '/loans', '/movements', '/notifications',
  '/offboarding', '/payroll', '/payroll/iras-submissions', '/payroll/me', '/performance',
  '/recruitment', '/reports', '/reports/analytics', '/settings', '/settings/api',
  '/settings/audit', '/settings/overrides', '/settings/pdpa', '/settings/rates',
  '/settings/roles', '/settings/security', '/settings/users', '/staff', '/succession',
  '/succession/my-team', '/support', '/support/admin', '/surveys', '/training',
];

const viewports = [
  { name: 'portrait', width: 768, height: 1024 },
  { name: 'landscape', width: 1024, height: 768 },
];

function mockBody(url) {
  if (url.includes('/auth/me')) return USER;
  if (url.includes('/auth/refresh')) return { ok: true };
  // Return an object that also behaves for array-expecting callers by
  // covering the common envelope keys. Most callers do `data.X || []`.
  return {
    data: [], items: [], results: [], rows: [], list: [],
    employees: [], applications: [], notifications: [], records: [],
    users: [], roles: [], assets: [], claims: [], leaves: [], loans: [],
    documents: [], cases: [], surveys: [], movements: [], payslips: [],
    total: 0, unread: 0, count: 0, page: 1, totalPages: 1, meta: {},
    pendingInvites: [], summary: {}, stats: {}, analytics: {},
  };
}

const browser = await chromium.launch();
const findings = [];

for (const route of routes) {
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await context.addCookies([{ name:'vorkhive_token', value:'t', domain:'localhost', path:'/' }]);
    const page = await context.newPage();
    await page.route('**/api/**', async (route2) => {
      await route2.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(mockBody(route2.request().url())) }).catch(()=>{});
    });
    let pageErr = null;
    page.on('pageerror', e => { pageErr = String(e).split('\n')[0]; });
    try {
      await page.goto(`${BASE}${route}`, { waitUntil:'networkidle', timeout:20000 });
    } catch {}
    await page.waitForTimeout(800);

    const res = await page.evaluate(() => {
      const vw = window.innerWidth;
      const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const els = Array.from(document.querySelectorAll('button, a[href], input, select, [role="button"]'));
      const clipped = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;            // hidden
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        // element extends past the right edge of the viewport
        if (r.right > vw + 1) {
          // is it reachable by horizontal scrolling? check for a scrollable ancestor
          let reachable = docOverflow;
          let p = el.parentElement;
          while (p && !reachable) {
            const ps = getComputedStyle(p);
            if ((ps.overflowX === 'auto' || ps.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) reachable = true;
            p = p.parentElement;
          }
          if (!reachable) {
            const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g,' ').slice(0, 40);
            clipped.push({ label, right: Math.round(r.right), tag: el.tagName.toLowerCase() });
          }
        }
      }
      // de-dup by label+right
      const seen = new Set();
      const uniq = clipped.filter(c => { const k = c.label+c.right; if (seen.has(k)) return false; seen.add(k); return true; });
      return { vw, docOverflow, clipped: uniq, bodyTextLen: document.body.innerText.trim().length };
    });

    if (pageErr || res.clipped.length > 0) {
      findings.push({ route, vp: vp.name, vw: res.vw, pageErr, empty: res.bodyTextLen < 40, clipped: res.clipped });
    }
    await context.close();
  }
  process.stdout.write('.');
}
process.stdout.write('\n');
await browser.close();

console.log('\n===== CLIPPING / ERROR FINDINGS =====');
if (!findings.length) console.log('No clipped interactive elements found on any page. ✅');
for (const f of findings) {
  console.log(`\n[${f.route}] @${f.vp} (${f.vw}px)${f.empty ? ' (page rendered little/no content)' : ''}${f.pageErr ? ' PAGEERROR: '+f.pageErr : ''}`);
  for (const c of f.clipped) console.log(`   • <${c.tag}> "${c.label}" right=${c.right} > ${f.vw}`);
}
console.log(`\nTotal pages with findings: ${new Set(findings.map(f=>f.route)).size}`);
