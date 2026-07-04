const fs = require('fs');
const path = require('path');

// Only fix import.meta in JS bundles. Do NOT touch index.html.
function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let changed = false;
      if (content.includes('import.meta.env')) {
        console.log(`Fixing import.meta.env in ${fullPath}`);
        content = content.replace(/import\.meta\.env/g, '({MODE:"production"})');
        changed = true;
      }
      if (content.includes('import.meta')) {
        console.log(`Fixing remaining import.meta in ${fullPath}`);
        content = content.replace(/import\.meta/g, '({env:{MODE:"production"},url:window.location.href})');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

processDir(path.join(__dirname, 'dist'));
console.log('Done fixing JS bundles.');
