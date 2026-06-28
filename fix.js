const fs = require('fs');
const path = require('path');

function processDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (fs.statSync(fullPath).isDirectory()) {
      if (fullPath.includes('node_modules')) continue;
      processDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      if (file === 'fix.js' || file === 'server.js') continue;
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('import.meta')) {
        console.log(`Fixing import.meta in ${fullPath}`);
        content = content.replace(/import\.meta\.env/g, '({MODE:"production"})');
        content = content.replace(/import\.meta/g, '({env:{MODE:"production"},url:window.location.href})');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
      if (content.includes('aspectRatio:')) {
        console.log(`Patching aspectRatio and tile widths in ${fullPath}`);
        content = content.replace(/width:'13%'/g, "width:'17.5%'");
        content = content.replace(/width:'9%'/g, "width:'12%'");
        content = content.replace(/width:'24%'/g, "width:'30%'");
        content = content.replace(/aspectRatio:1\.35\b/g, "aspectRatio:1.35,height:'11vw'");
        content = content.replace(/aspectRatio:1\.4\b/g, "aspectRatio:1.4,height:'8vw'");
        content = content.replace(/aspectRatio:1\.3\b/g, "aspectRatio:1.3,height:'20vw'");
        fs.writeFileSync(fullPath, content, 'utf8');
      }
      if (content.includes("useState)('small')") && !content.includes("localStorage.getItem('viewMode')")) {
        console.log(`Patching viewMode persistence in ${fullPath}`);
        content = content.replace(
          /\[([a-zA-Z0-9_]+),([a-zA-Z0-9_]+)\]=\(0,t\.useState\)\('small'\)/g,
          `[$1,$2]=(0,t.useState)(()=>{try{return localStorage.getItem('viewMode')||'small'}catch(e){return'small'}})`
        );
        content = content.replace(
          /([a-zA-Z0-9_]+)\(([a-zA-Z0-9_]+)\[([a-zA-Z0-9_]+)\]\)(?=\},onFocus:)/g,
          `$1($2[$3]);try{localStorage.setItem('viewMode',$2[$3])}catch(err){}`
        );
        fs.writeFileSync(fullPath, content, 'utf8');
      }
      if (content.includes('TVXPlugin.executeAction')) {
        console.log(`Removing TVXPlugin native bypass from ${fullPath}`);
        content = content.replace(/'undefined'!=typeof TVXPlugin\?TVXPlugin\.executeAction\("video:"\+[a-zA-Z0-9_]+\.url\):/g, "");
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    } else if (file === 'index.html') {
      // no-op for index.html, we modify it directly
    }
  }
}

processDir(path.join(__dirname));
console.log('Done fixing JS bundles and injecting polyfills.');
