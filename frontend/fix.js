const fs = require('fs');
let code = fs.readFileSync('src/app/(dashboard)/layout.tsx', 'utf8');
code = code.replace(/\{ name: string; path: string; icon: string \}/g, '{ name: string; path: string; icon: string; badge?: string }');
fs.writeFileSync('src/app/(dashboard)/layout.tsx', code);
