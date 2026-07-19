/**
 * Скрипт копирования файлов из public/ в dist/
 * Нужен для Vercel, чтобы MSX/TV конфиги (start.json, menu.json)
 * были доступны по корневому пути вместе с собранным Expo-приложением.
 */
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(publicDir)) {
  console.log('[copy-public] public/ directory not found, skipping');
  process.exit(0);
}

if (!fs.existsSync(distDir)) {
  console.log('[copy-public] dist/ directory not found, creating it');
  fs.mkdirSync(distDir, { recursive: true });
}

const files = fs.readdirSync(publicDir);
for (const file of files) {
  const src = path.join(publicDir, file);
  const dest = path.join(distDir, file);
  
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, dest);
    console.log(`[copy-public] Copied ${src} -> ${dest}`);
  }
}

console.log('[copy-public] Done');
