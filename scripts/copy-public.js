/**
 * Пост-сборочный скрипт: подготовка dist/ для деплоя на Netlify/Vercel.
 *
 * Что делает:
 *  1. msx/*.json       → dist/msx/*.json       (MSX запрашивает /msx/start.json по hostname)
 *  2. public/*         → dist/*                (стартовые конфиги, КРОМЕ index.html)
 *  3. public/index.html (шаблон с polyfills/MSX-плагином) +
 *     загрузчик бандла из Expo-сгенерированного dist/index.html
 *     → итоговый dist/index.html
 *  4. playlists/*.m3u  → dist/playlists/*.m3u  (скачанные плейлисты для автономной работы)
 *
 * Почему так: public/index.html содержит важные TV- polyfills
 * (фокус-менеджер пульта, MSX TVX-плагин, обработчик ошибок, globalThis),
 * но НЕ содержит загрузчика React-бандла. Expo сам вставляет
 * <script src="/_expo/static/js/web/index-HASH.js" defer> в dist/index.html.
 * Мы находим этот тег и вшиваем в шаблон — иначе приложение не загрузится.
 *
 * Плейлисты скачиваются раз в сутки GitHub Action'ом (.github/workflows/update-playlists.yml)
 * и коммитятся в playlists/. Если при сборке их там нет (например, свежий клон) —
 * запускаем scripts/fetch-playlists.js на лету как fallback.
 *
 * Содержимое JSON-файлов не модифицируется.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const publicDir = path.join(__dirname, '..', 'public');
const msxDir = path.join(__dirname, '..', 'msx');
const playlistsDir = path.join(__dirname, '..', 'playlists');
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

// 4. playlists/ → dist/playlists/  (плейлисты для автономной работы приложения).
//    Если папка пустая/отсутствует — запускаем fetch-playlists.js как fallback
//    (нужно для случая, когда GitHub Action ещё не успел или репозиторий только склонировали).
ensurePlaylists(playlistsDir, distDir);

console.log('[copy-public] Done');

// Гарантирует, что в playlists/ есть .m3u файлы.
// Если их нет — запускает scripts/fetch-playlists.js.
// Затем копирует playlists/ → dist/playlists/.
function ensurePlaylists(srcPlaylistsDir, distDir) {
  let needFetch = !fs.existsSync(srcPlaylistsDir);
  if (!needFetch) {
    const files = fs.readdirSync(srcPlaylistsDir).filter(f => f.endsWith('.m3u'));
    if (files.length === 0) needFetch = true;
  }
  if (needFetch) {
    console.log('[copy-public] playlists/ empty or missing — running fetch-playlists.js as fallback');
    try {
      execSync('node scripts/fetch-playlists.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    } catch (e) {
      console.warn('[copy-public] WARNING: fetch-playlists.js fallback failed:', e.message);
      console.warn('[copy-public] The app will start without pre-fetched playlists (it will try to fetch on demand)');
    }
  }
  copyFiles(srcPlaylistsDir, path.join(distDir, 'playlists'), 'playlists/');
}

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
