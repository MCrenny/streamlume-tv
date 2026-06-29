const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 80;

app.use(cors());

const proxyCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const followRedirectsGet = (urlStr, res, originalUrl = null) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const client = urlStr.startsWith('https') ? require('https') : require('http');
  
  const options = {
    headers: {
      'User-Agent': 'Televizo/1.9.3.4 (Linux;Android 11)'
    }
  };

  try {
    client.get(urlStr, options, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        let redirectUrl = proxyRes.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, urlStr).toString();
        }
        return followRedirectsGet(redirectUrl, res, originalUrl);
      }
      Object.keys(proxyRes.headers).forEach(key => {
        if (key.toLowerCase() !== 'access-control-allow-origin' && key.toLowerCase() !== 'host') {
          try { res.setHeader(key, proxyRes.headers[key]); } catch (e) {}
        }
      });
      res.status(proxyRes.statusCode);
      
      if (proxyRes.headers['content-type'] && proxyRes.headers['content-type'].toLowerCase().includes('mpegurl') || urlStr.includes('.m3u')) {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          const lines = body.split('\n').map(line => {
            const tLine = line.trim();
            if (tLine.length === 0 || tLine.startsWith('#')) return line;
            try {
              return new URL(tLine, urlStr).toString();
            } catch (e) {
              return line;
            }
          });
          const newBody = lines.join('\n');
          if (originalUrl) {
            proxyCache.set(originalUrl, {
              data: newBody,
              timestamp: Date.now()
            });
          }
          res.setHeader('Content-Length', Buffer.byteLength(newBody));
          res.send(newBody);
        });
      } else {
        proxyRes.pipe(res);
      }
    }).on('error', (err) => res.status(500).send(err.message));
  } catch (err) {
    console.error('Proxy Error: Invalid URL or request failed', err.message);
    res.status(400).send('Invalid URL');
  }
};

app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  
  if (targetUrl === '/api/public.m3u') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    return res.send(publicPlaylistCache);
  }
  
  if (proxyCache.has(targetUrl)) {
    const cached = proxyCache.get(targetUrl);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'audio/x-mpegurl');
      res.setHeader('Content-Length', Buffer.byteLength(cached.data));
      return res.send(cached.data);
    } else {
      proxyCache.delete(targetUrl);
    }
  }
  
  followRedirectsGet(targetUrl, res, targetUrl);
});

// Disable cache for HTML and JS so TV always gets fresh version
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

// --- БОТ-ПАРСЕР ОБЩЕДОСТУПНЫХ ПЛЕЙЛИСТОВ ---
const PUBLIC_SOURCES = [
  'https://smolnp.github.io/IPTVru//IPTVru.m3u'
];

let publicPlaylistCache = '#EXTM3U\n';
let isParsing = false;

const updatePublicPlaylist = () => {
  if (isParsing) return;
  isParsing = true;
  console.log('Бот-парсер начал сбор общедоступных плейлистов...');
  
  const https = require('https');
  let newContent = '#EXTM3U\n';
  let completed = 0;
  
  if (PUBLIC_SOURCES.length === 0) {
    isParsing = false;
    return;
  }
  
  PUBLIC_SOURCES.forEach(urlStr => {
    https.get(urlStr, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        // Убираем #EXTM3U из скачанных файлов, чтобы не было дублей заголовка
        const lines = body.split('\n').filter(line => !line.includes('#EXTM3U'));
        newContent += lines.join('\n') + '\n';
        
        completed++;
        if (completed === PUBLIC_SOURCES.length) {
          publicPlaylistCache = newContent;
          console.log('Бот-парсер успешно обновил общедоступный плейлист.');
          isParsing = false;
        }
      });
    }).on('error', (err) => {
      console.error('Ошибка бота-парсера для', urlStr, err.message);
      completed++;
      if (completed === PUBLIC_SOURCES.length) isParsing = false;
    });
  });
};

// Запускаем парсер при старте и раз в сутки (24 часа)
updatePublicPlaylist();
setInterval(updatePublicPlaylist, 24 * 60 * 60 * 1000);

app.get('/api/public.m3u', (req, res) => {
  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(publicPlaylistCache);
});
// ----------------------------------------

app.get(['/start.json', '/msx/start.json'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'start.json'));
});
app.get('/menu.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    "type": "pages",
    "headline": "StreamLume",
    "pages": [{
      "items": [{
        "type": "button",
        "layout": "0,0,12,2",
        "title": "Запустить StreamLume",
        "action": "link:https://streamlume-tv-svmorozoww.amvera.io/index.html?v=" + Date.now()
      }]
    }]
  });
});

// Serve static files with normal caching (important for fonts and JS bundles with hashes)
app.use(express.static(path.join(__dirname, 'dist')));

app.listen(PORT, () => console.log('Server running on ' + PORT));
