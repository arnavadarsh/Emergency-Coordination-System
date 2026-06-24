const fs = require('fs');
const glob = require('glob');
const path = require('path');

const files = glob.sync('src/**/*.entity.ts');
let updatedCount = 0;

for (const f of files) {
  let code = fs.readFileSync(f, 'utf8');
  if (code.includes("type: 'enum',") || code.includes("type: 'enum'")) {
    console.log('Fixing enums in', f);
    code = code.replace(/type: 'enum'(,?)/g, "type: process.env.USE_SQLITE === 'true' ? 'varchar' : 'enum'$1");
    fs.writeFileSync(f, code);
    updatedCount++;
  }
}

console.log('Fixed', updatedCount, 'files.');