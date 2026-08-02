'use strict';
// Seed assets and assign them to employees
// Usage: node scripts/seed-assets.js

const http = require('http');

const GATEWAY = 'http://localhost:4000';
const AUTH_URL = 'http://localhost:4001';

async function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname, port: parsed.port || 80,
      path: parsed.pathname + parsed.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const ASSETS = [
  // Laptops
  { name: 'MacBook Pro 14" M3', category: 'LAPTOP', serialNumber: 'C02XK3PBJGH7', purchaseDate: '2024-01-15', purchaseValue: 2899, currentValue: 2200, location: 'Office Level 3' },
  { name: 'MacBook Pro 14" M3', category: 'LAPTOP', serialNumber: 'C02XK3PBJGH8', purchaseDate: '2024-01-15', purchaseValue: 2899, currentValue: 2200, location: 'Office Level 3' },
  { name: 'Dell XPS 15 9530',   category: 'LAPTOP', serialNumber: 'DXPS15-8823-A', purchaseDate: '2023-08-10', purchaseValue: 2200, currentValue: 1600, location: 'Office Level 2' },
  { name: 'Dell XPS 15 9530',   category: 'LAPTOP', serialNumber: 'DXPS15-8823-B', purchaseDate: '2023-08-10', purchaseValue: 2200, currentValue: 1600, location: 'Office Level 2' },
  { name: 'Lenovo ThinkPad X1 Carbon', category: 'LAPTOP', serialNumber: 'LTP-X1C-0041', purchaseDate: '2023-03-20', purchaseValue: 1800, currentValue: 1200, location: 'IT Store' },
  { name: 'Lenovo ThinkPad X1 Carbon', category: 'LAPTOP', serialNumber: 'LTP-X1C-0042', purchaseDate: '2023-03-20', purchaseValue: 1800, currentValue: 1200, location: 'IT Store' },
  // Monitors
  { name: 'Dell U2722D 27" 4K Monitor', category: 'MONITOR', serialNumber: 'DU2722-1101', purchaseDate: '2023-06-01', purchaseValue: 650, currentValue: 480, location: 'Office Level 3' },
  { name: 'Dell U2722D 27" 4K Monitor', category: 'MONITOR', serialNumber: 'DU2722-1102', purchaseDate: '2023-06-01', purchaseValue: 650, currentValue: 480, location: 'Office Level 3' },
  { name: 'LG 32UN880 UltraFine', category: 'MONITOR', serialNumber: 'LGU32-5501', purchaseDate: '2024-02-14', purchaseValue: 880, currentValue: 750, location: 'Office Level 2' },
  { name: 'Samsung 27" Curved', category: 'MONITOR', serialNumber: 'SAM27C-3310', purchaseDate: '2022-11-05', purchaseValue: 420, currentValue: 220, location: 'IT Store' },
  // Phones
  { name: 'iPhone 15 Pro 256GB', category: 'PHONE', serialNumber: 'F9Q5K3JPJXK1', purchaseDate: '2024-03-01', purchaseValue: 1599, currentValue: 1400, location: 'IT Store' },
  { name: 'iPhone 15 Pro 256GB', category: 'PHONE', serialNumber: 'F9Q5K3JPJXK2', purchaseDate: '2024-03-01', purchaseValue: 1599, currentValue: 1400, location: 'IT Store' },
  { name: 'Samsung Galaxy S24+', category: 'PHONE', serialNumber: 'SGS24P-7721', purchaseDate: '2024-04-10', purchaseValue: 1299, currentValue: 1100, location: 'IT Store' },
  // Peripherals
  { name: 'Apple Magic Keyboard + Mouse Set', category: 'PERIPHERAL', serialNumber: 'AMKM-SET-001', purchaseDate: '2023-08-01', purchaseValue: 280, currentValue: 200, location: 'Office Level 3' },
  { name: 'Apple Magic Keyboard + Mouse Set', category: 'PERIPHERAL', serialNumber: 'AMKM-SET-002', purchaseDate: '2023-08-01', purchaseValue: 280, currentValue: 200, location: 'Office Level 3' },
  { name: 'Logitech MX Keys + MX Master 3', category: 'PERIPHERAL', serialNumber: 'LMX-SET-011', purchaseDate: '2023-09-15', purchaseValue: 250, currentValue: 175, location: 'Office Level 2' },
  { name: 'USB-C Hub 10-in-1', category: 'PERIPHERAL', serialNumber: 'UCH-10-221', purchaseDate: '2023-07-20', purchaseValue: 89, currentValue: 60, location: 'IT Store' },
  { name: 'USB-C Hub 10-in-1', category: 'PERIPHERAL', serialNumber: 'UCH-10-222', purchaseDate: '2023-07-20', purchaseValue: 89, currentValue: 60, location: 'IT Store' },
  // Furniture
  { name: 'Herman Miller Aeron Chair (Size B)', category: 'FURNITURE', serialNumber: 'HMA-B-2201', purchaseDate: '2022-06-15', purchaseValue: 1650, currentValue: 1100, location: 'Office Level 3' },
  { name: 'Herman Miller Aeron Chair (Size B)', category: 'FURNITURE', serialNumber: 'HMA-B-2202', purchaseDate: '2022-06-15', purchaseValue: 1650, currentValue: 1100, location: 'Office Level 3' },
  { name: 'Standing Desk Flexispot E7', category: 'FURNITURE', serialNumber: 'FX-E7-0801', purchaseDate: '2022-08-20', purchaseValue: 890, currentValue: 600, location: 'Office Level 2' },
  // Other
  { name: 'Office Access Card', category: 'OTHER', serialNumber: 'ACC-2024-0011', purchaseDate: '2024-01-02', purchaseValue: 15, currentValue: 15, location: 'Reception' },
  { name: 'Office Access Card', category: 'OTHER', serialNumber: 'ACC-2024-0012', purchaseDate: '2024-01-02', purchaseValue: 15, currentValue: 15, location: 'Reception' },
  { name: 'Office Access Card', category: 'OTHER', serialNumber: 'ACC-2024-0013', purchaseDate: '2024-01-02', purchaseValue: 15, currentValue: 15, location: 'Reception' },
  { name: 'Office Access Card', category: 'OTHER', serialNumber: 'ACC-2024-0014', purchaseDate: '2024-01-02', purchaseValue: 15, currentValue: 15, location: 'Reception' },
  { name: 'Yealink Video Conference Unit', category: 'OTHER', serialNumber: 'YLK-VC-401', purchaseDate: '2023-01-10', purchaseValue: 1200, currentValue: 900, location: 'Meeting Room A' },
];

// Which asset categories to assign to each employee (by index in returned employees array)
// employee index -> [asset name substrings to assign]
const ASSIGN_PLAN = [
  // Wei Jing Lim (Engineering)
  [0, 'MacBook Pro', 'Dell U2722D 27" 4K Monitor', 'Apple Magic Keyboard', 'Office Access Card'],
  // Priya Nair (Engineering)
  [1, 'MacBook Pro', 'LG 32UN880', 'Logitech MX', 'iPhone 15 Pro', 'Office Access Card'],
  // Ahmad Fadzillah (Engineering)
  [2, 'Dell XPS 15', 'Dell U2722D 27" 4K Monitor', 'USB-C Hub', 'Office Access Card'],
  // Marcus Tan (Engineering)
  [3, 'Dell XPS 15', 'Samsung 27"', 'Logitech MX', 'Samsung Galaxy', 'Office Access Card'],
  // Rachel Ong (HR)
  [4, 'Lenovo ThinkPad', 'iPhone 15 Pro', 'Office Access Card'],
  // Siti Aminah (HR)
  [5, 'Lenovo ThinkPad', 'USB-C Hub', 'Office Access Card'],
  // David Chen (Finance)
  [6, 'MacBook Pro', 'Standing Desk', 'Herman Miller', 'Office Access Card'],
  // Kavitha (Finance)
  [7, 'Dell XPS', 'Herman Miller', 'Office Access Card'],
];

async function main() {
  console.log('🔐 Logging in...');
  // Required in every environment — no fallback literal (see note in seed.js).
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('SEED_ADMIN_PASSWORD env var is required'); process.exit(1);
  }
  const loginRes = await request('POST', `${AUTH_URL}/auth/login`, { email: 'admin@vorkhive.sg', password: adminPassword });
  if (!loginRes.body.accessToken) { console.error('Login failed:', loginRes.body); process.exit(1); }
  const TOKEN = loginRes.body.accessToken;
  console.log('✅ Logged in\n');

  // Fetch employees
  console.log('👥 Fetching employees...');
  const empRes = await request('GET', `${GATEWAY}/api/employees?limit=200&isActive=true`, null, TOKEN);
  const employees = empRes.body.employees || [];
  console.log(`   Found ${employees.length} employees\n`);

  // Create assets
  console.log('📦 Creating assets...');
  const createdAssets = [];
  for (const a of ASSETS) {
    const r = await request('POST', `${GATEWAY}/api/assets`, a, TOKEN);
    if (r.status === 201) {
      createdAssets.push(r.body);
      console.log(`   ✅ ${r.body.assetCode} — ${r.body.name}`);
    } else {
      console.log(`   ⚠️  Failed: ${a.name} — ${JSON.stringify(r.body)}`);
    }
  }
  console.log(`\n   Created ${createdAssets.length} assets\n`);

  // Assign assets to employees
  console.log('🔗 Assigning assets to employees...');
  for (const [empIdx, ...nameMatches] of ASSIGN_PLAN) {
    const emp = employees[empIdx];
    if (!emp) { console.log(`   ⚠️  No employee at index ${empIdx}`); continue; }

    for (const match of nameMatches) {
      const asset = createdAssets.find(a => a.name.includes(match) && a.status === 'AVAILABLE');
      if (!asset) { console.log(`   ⚠️  No available asset matching "${match}" for ${emp.fullName}`); continue; }

      const r = await request('POST', `${GATEWAY}/api/assets/${asset.id}/assign`,
        { employeeId: emp.id, notes: `Assigned during onboarding — ${emp.fullName}` }, TOKEN);

      if (r.status === 201) {
        // Mark asset as assigned in local list so next iteration skips it
        const idx = createdAssets.findIndex(a => a.id === asset.id);
        if (idx !== -1) createdAssets[idx] = { ...createdAssets[idx], status: 'ASSIGNED' };
        console.log(`   ✅ ${emp.fullName} ← ${asset.assetCode} ${asset.name}`);
      } else {
        console.log(`   ⚠️  Failed assigning ${asset.assetCode} to ${emp.fullName}: ${JSON.stringify(r.body)}`);
      }
    }
  }

  console.log('\n🎉 Asset seeding complete!\n');

  // Summary
  const finalRes = await request('GET', `${GATEWAY}/api/assets?limit=200`, null, TOKEN);
  const all = finalRes.body.assets || [];
  const available = all.filter(a => a.status === 'AVAILABLE').length;
  const assigned = all.filter(a => a.status === 'ASSIGNED').length;
  console.log(`📊 Summary: ${all.length} total assets — ${assigned} assigned, ${available} available`);
}

main().catch(e => { console.error(e); process.exit(1); });
