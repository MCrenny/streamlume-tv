require('dotenv').config();
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 80;

// Основной сервер с плейлистами и ботом
const IPTVPAY_URL = process.env.IPTVPAY_URL || 'https://iptvpay-svmorozoww.amvera.io';

// CORS — только свои домены
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || [
  'https://streamlume-tv-svmorozoww.amvera.io',
  'https://iptvpay-svmorozoww.amvera.io',
  'http://localhost:8081',
  'http://localhost:19006'
].join(',')).split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без origin (TV-браузеры, MSX, curl)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  }
}));

// --- Кэш для /proxy ---
const CACHE_DIR = path.join(__dirname, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час

// Очистка старого кэша каждые 30 минут
setInterval(() => {
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(CACHE_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && now - stats.mtimeMs > 2 * CACHE_TTL_MS) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 30 * 60 * 1000);

// Скачивание и парсинг M3U на диск (стриминг, без RAM)
const downloadAndParseM3U = (urlStr, destPath, originalUrl, callback, redirectCount = 0) => {
  let cbCalled = false;
  const done = (err) => { if (!cbCalled) { cbCalled = true; callback(err); } };

  if (redirectCount > 5) return done(new Error('Too many redirects'));

  const client = urlStr.startsWith('https') ? https : http;
  const isEpg = urlStr.includes('epg');
  const ua = isEpg
    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    : 'Televizo/1.9.3.4 (Linux;Android 11)';

  client.get(urlStr, { headers: { 'User-Agent': ua } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let loc = res.headers.location;
      if (!loc.startsWith('http')) loc = new URL(loc, urlStr).toString();
      return downloadAndParseM3U(loc, destPath, originalUrl, done, redirectCount + 1);
    }
    if (res.statusCode !== 200) return done(new Error(`HTTP ${res.statusCode}`));

    let stream = res;
    if (res.headers['content-encoding'] === 'gzip') stream = res.pipe(zlib.createGunzip());

    const fileStream = fs.createWriteStream(destPath);

    if (isEpg || urlStr.toLowerCase().endsWith('.xml')) {
      stream.pipe(fileStream);
      fileStream.on('finish', () => done(null));
      fileStream.on('error', done);
      stream.on('error', (e) => { fileStream.end(); done(e); });
      return;
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        fileStream.write(line + '\n');
      } else {
        try { fileStream.write(new URL(t, originalUrl).toString() + '\n'); }
        catch { fileStream.write(line + '\n'); }
      }
    });
    rl.on('close', () => fileStream.end());
    fileStream.on('finish', () => done(null));
    res.on('error', (e) => { fileStream.end(); done(e); });
  }).on('error', done);
};

// --- /proxy — проксирование внешних плейлистов с проверкой ключа ---
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) return res.status(400).send('Missing url parameter');


  const urlHash = crypto.createHash('md5').update(targetUrl).digest('hex');
  const cacheFilePath = path.join(CACHE_DIR, `${urlHash}.m3u`);

  const serve = () => {
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.sendFile(cacheFilePath);
  };

  const isLive = targetUrl.split('?')[0].endsWith('.m3u8');
  const ttl = isLive ? 2000 : CACHE_TTL_MS;

  if (fs.existsSync(cacheFilePath)) {
    const age = Date.now() - fs.statSync(cacheFilePath).mtimeMs;
    if (age < ttl) return serve();
  }

  downloadAndParseM3U(targetUrl, cacheFilePath, targetUrl, (err) => {
    if (err) {
      console.error('[Proxy] Error:', err.message);
      if (fs.existsSync(cacheFilePath)) return serve();
      return res.status(400).send('Invalid URL or request failed');
    }
    serve();
  });
});

// --- /api/playlist — проксируем к основному серверу (убираем дублирование) ---
app.get('/api/playlist', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(401).send('#EXTM3U\n#EXTINF:-1,Требуется ключ\nhttp://invalid\n');

  try {
    const upstream = await fetch(`${IPTVPAY_URL}/api/playlist?key=${encodeURIComponent(key)}`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/x-mpegurl');
    res.status(upstream.status);
    const text = await upstream.text();
    res.send(text);
  } catch (e) {
    console.error('[Playlist proxy] Error:', e.message);
    res.status(502).send('Upstream error');
  }
});

// --- /api/public.m3u — проксируем публичный плейлист с основного сервера ---
app.get('/api/public.m3u', async (req, res) => {
  try {
    const upstream = await fetch(`${IPTVPAY_URL}/api/playlist?key=PUBLIC`);
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const text = await upstream.text();
    res.send(text);
  } catch (e) {
    console.error('[Public playlist proxy] Error:', e.message);
    res.status(502).send('Upstream error');
  }
});

// Отключаем кэш для HTML/JS
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Короткие ссылки для MSX
app.get(['/s', '/m', '/tv', '/msx', '/777'], (req, res) => res.redirect('/start.json'));

app.get(['/start.json', '/msx/start.json'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'start.json'));
});

app.get('/menu.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    "type": "pages",
    "headline": "StreamLume TV",
    "pages": [{
      "items": [{
        "type": "button",
        "layout": "0,0,12,2",
        "title": "Загрузка StreamLume...",
        "action": "link:https://streamlume-tv-svmorozoww.amvera.io/index.html"
      }]
    }]
  });
});

app.get('/', (req, res, next) => {
  const accept = req.headers.accept || '';
  const ua = req.headers['user-agent'] || '';
  if (accept.indexOf('text/html') === -1 || ua.includes('MSX') || ua.includes('TVX') || ua.includes('Media Station X')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.sendFile(path.join(__dirname, 'start.json'));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'dist')));

app.use((err, req, res, next) => {
  console.error('Express error:', err.message);
  if (!res.headersSent) res.status(500).send('Internal Server Error');
});

const server = app.listen(PORT, () => console.log(`[StreamLume TV] Server running on port ${PORT}`));
server.on('error', (err) => console.error('SERVER ERROR:', err.code, err.message));
