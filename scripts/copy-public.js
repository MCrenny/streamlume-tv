/**
 * Скрипт копирования файлов из public/ в dist/
 * Нужен для Netlify/Vercel, чтобы MSX/TV конфиги (start.json, menu.json)
 * были доступны по корневому пути вместе с собранным Expo-приложением.
 *
 * Дополнительно копирует папку msx/ → dist/msx/, чтобы Media Station X
 * находил /msx/start.json автоматически (MSX добавляет путь /msx/start.json
 * к hostname, который пользователь вводит в Start Parameter).
 * Содержимое JSON-файлов не модифицируется — копируются как есть.
 */
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const msxDir = path.join(__dirname, '..', 'msx');
const distDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(distDir)) {
  console.log('[copy-public] dist/ directory not found, creating it');
  fs.mkdirSync(distDir, { recursive: true });
}

// Копирует все файлы (не рекурсивно) из srcDir в destDir
function copyFiles(srcDir, destDir, label) {
  if (!fs.existsSync(srcDir)) {
    console.log(`[copy-public] ${label} directory not found, skipping`);
    return;
  }
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
      console.log(`[copy-public] Copied ${src} -> ${dest}`);
    }
  }
}

// 1. public/ → dist/  (корневые start.json, menu.json, index.html)
copyFiles(publicDir, distDir, 'public/');

// 2. msx/ → dist/msx/  (MSX автоматически запрашивает /msx/start.json по hostname)
copyFiles(msxDir, path.join(distDir, 'msx'), 'msx/');

console.log('[copy-public] Done');
