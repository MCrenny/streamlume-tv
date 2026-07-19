/**
 * Пост-сборочный скрипт: подготовка dist/ для деплоя на Netlify/Vercel.
 *
 * Что делает:
 *  1. msx/*.json    → dist/msx/*.json    (MSX запрашивает /msx/start.json по hostname)
 *  2. public/*      → dist/*             (стартовые конфиги, КРОМЕ index.html)
 *  3. public/index.html (шаблон с polyfills/MSX-плагином) +
 *     загрузчик бандла из Expo-сгенерированного dist/index.html
 *     → итоговый dist/index.html
 *
 * Почему так: public/index.html содержит важные TV- polyfills
 * (фокус-менеджер пульта, MSX TVX-плагин, обработчик ошибок, globalThis),
 * но НЕ содержит загрузчика React-бандла. Expo сам вставляет
 * <script src="/_expo/static/js/web/index-HASH.js" defer> в dist/index.html.
 * Мы находим этот тег и вшиваем в шаблон — иначе приложение не загрузится.
 *
 * Содержимое JSON-файлов не модифицируется.
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

// 1. msx/ → dist/msx/  (MSX автоматически запрашивает /msx/start.json по hostname)
copyFiles(msxDir, path.join(distDir, 'msx'), 'msx/');

// 2. public/ → dist/  (start.json, menu.json — НО НЕ index.html!)
//    index.html из public/ — это шаблон-обёртка с polyfills/MSX-плагином/фокус-менеджером,
//    но БЕЗ загрузчика бандла. Expo сам генерит dist/index.html с правильным <script src="/_expo/...">.
//    Если перезаписать dist/index.html шаблоном — приложение не загрузится (пустой чёрный экран).
//    Поэтому копируем из public/ всё, КРОМЕ index.html.
copyFilesExcludingIndex(publicDir, distDir);

// 3. Внедряем загрузчик бандла в шаблон index.html.
//    Берём путь к бандлу из сгенерированного Expo dist/index.html
//    и вшиваем его в шаблон public/index.html, сохраняя все polyfills.
injectBundleScript(distDir, publicDir);

console.log('[copy-public] Done');

// Копирует файлы из srcDir в destDir, пропуская index.html
function copyFilesExcludingIndex(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    console.log('[copy-public] public/ directory not found, skipping');
    return;
  }
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    if (file === 'index.html') continue; // index.html обрабатываем отдельно (шаг 3)
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
      console.log(`[copy-public] Copied ${src} -> ${dest}`);
    }
  }
}

// Находит путь к бандлу в сгенерированном Expo dist/index.html
// и вшивает его в шаблон public/index.html (с polyfills), перезаписывая dist/index.html
function injectBundleScript(distDir, publicDir) {
  const expoIndexPath = path.join(distDir, 'index.html');
  const templatePath = path.join(publicDir, 'index.html');

  if (!fs.existsSync(expoIndexPath)) {
    console.log('[copy-public] WARNING: dist/index.html not found after expo export, skipping bundle injection');
    return;
  }
  if (!fs.existsSync(templatePath)) {
    console.log('[copy-public] WARNING: public/index.html template not found, keeping Expo-generated index.html as is');
    return;
  }

  const expoIndex = fs.readFileSync(expoIndexPath, 'utf8');
  const template = fs.readFileSync(templatePath, 'utf8');

  // Ищем тег загрузчика бандла: <script src="/_expo/static/js/web/index-HASH.js" defer></script>
  const bundleMatch = expoIndex.match(/<script\s+src="(\/_expo\/static\/js\/web\/[^"]+\.js)"\s+defer><\/script>/);
  if (!bundleMatch) {
    console.log('[copy-public] WARNING: no bundle <script> tag found in Expo-generated index.html, keeping it as is');
    return;
  }
  const bundleScript = bundleMatch[0];
  console.log(`[copy-public] Found bundle script: ${bundleMatch[1]}`);

  // Проверяем, что шаблон ещё не содержит этот тег (идемпотентность)
  if (template.includes(bundleScript)) {
    console.log('[copy-public] Template already contains bundle script, copying as is');
    fs.copyFileSync(templatePath, expoIndexPath);
    return;
  }

  // Вшиваем тег бандла перед </body> в шаблон
  let merged;
  if (template.includes('</body>')) {
    merged = template.replace('</body>', `  ${bundleScript}\n</body>`);
  } else {
    // На всякий случай — если </body> нет, добавляем в конец
    merged = template.trimEnd() + '\n' + bundleScript + '\n</body>\n</html>\n';
  }

  fs.writeFileSync(expoIndexPath, merged, 'utf8');
  console.log(`[copy-public] Injected bundle script into template, wrote ${expoIndexPath}`);
}
