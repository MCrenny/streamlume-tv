#!/usr/bin/env node
/**
 * Скрипт скачивания плейлистов раз в сутки.
 *
 * Читает манифест scripts/playlist-manifest.json,
 * для каждого плейлиста скачивает URL с подменой User-Agent,
 * проверяет что это валидный #EXTM3U,
 * и сохраняет в папку playlists/ (создаёт если нет).
 *
 * Используется:
 *   - локально: node scripts/fetch-playlists.js
 *   - в GitHub Action: .github/workflows/update-playlists.yml
 *   - в prebuild скрипте Netlify (fallback если GitHub Action не успел)
 *
 * Идемпотентен: при повторном запуске перезаписывает только изменённые файлы.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'playlist-manifest.json');
const PLAYLISTS_DIR = path.join(ROOT, 'playlists');

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

async function fetchWithRetry(url, userAgent, retries = 3, timeoutMs = 30000) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': '*/*',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      console.warn(`  [attempt ${attempt}/${retries}] failed: ${err.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * attempt)); // exponential-ish backoff
      }
    }
  }
  throw lastErr;
}

function isValidM3U(text) {
  const trimmed = text.trimStart().slice(0, 100).toLowerCase();
  return trimmed.startsWith('#extm3u');
}

async function downloadPlaylist(pl, userAgent) {
  console.log(`[${pl.id}] ${pl.name} → ${pl.url}`);
  const text = await fetchWithRetry(pl.url, userAgent);

  if (!isValidM3U(text)) {
    // iptvin.ru при блокировке отдаёт HTML-страницу с "403 Access Denied"
    // Начинаем проверку с 200 символов чтобы поймать это
    const sample = text.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`Invalid M3U content (possibly an error page): "${sample}..."`);
  }

  const sizeKB = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1);
  console.log(`  OK: ${sizeKB} KB, ${text.split('\n').length} lines`);
  return text;
}

function hasContentChanged(filePath, newContent) {
  if (!fs.existsSync(filePath)) return true;
  const old = fs.readFileSync(filePath, 'utf8');
  return old !== newContent;
}

async function main() {
  const manifest = loadManifest();
  const userAgent = manifest.userAgent;
  if (!userAgent) {
    throw new Error('manifest.userAgent is required');
  }

  if (!fs.existsSync(PLAYLISTS_DIR)) {
    fs.mkdirSync(PLAYLISTS_DIR, { recursive: true });
    console.log(`Created ${PLAYLISTS_DIR}`);
  }

  console.log(`\n=== Fetching ${manifest.playlists.length} playlists ===\n`);

  const results = { ok: [], failed: [], changed: [], unchanged: [] };

  for (const pl of manifest.playlists) {
    try {
      const text = await downloadPlaylist(pl, userAgent);
      const destPath = path.join(PLAYLISTS_DIR, pl.filename);
      const changed = hasContentChanged(destPath, text);
      fs.writeFileSync(destPath, text, 'utf8');
      results.ok.push(pl.id);
      if (changed) results.changed.push(pl.id);
      else results.unchanged.push(pl.id);
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
      results.failed.push({ id: pl.id, error: err.message });
    }
  }

  console.log('\n=== Summary ===');
  console.log(`OK:        ${results.ok.length}/${manifest.playlists.length}`);
  console.log(`Changed:   ${results.changed.length} (${results.changed.join(', ')})`);
  console.log(`Unchanged: ${results.unchanged.length} (${results.unchanged.join(', ')})`);
  if (results.failed.length) {
    console.log(`FAILED:    ${results.failed.length}`);
    for (const f of results.failed) {
      console.log(`  - ${f.id}: ${f.error}`);
    }
    // Exit non-zero only if ALL failed — partial success still commits what we got
    if (results.failed.length === manifest.playlists.length) {
      process.exit(1);
    }
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
