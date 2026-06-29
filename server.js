const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 80;

app.use(cors());

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR);
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Cleanup old cache files to prevent disk exhaustion
setInterval(() => {
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach(file => {
      if (file === 'public.m3u') return; // keep public playlist
      const filePath = path.join(CACHE_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && now - stats.mtimeMs > 2 * CACHE_TTL_MS) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 30 * 60 * 1000); // Check every 30 mins

// Helper to download and parse M3U to a file using streams (Zero RAM usage)
const downloadAndParseM3U = (urlStr, destPath, originalUrl, callback, redirectCount = 0) => {
  if (redirectCount > 5) return callback(new Error('Too many redirects'));
  const client = urlStr.startsWith('https') ? https : http;
  const options = { headers: { 'User-Agent': 'Televizo/1.9.3.4 (Linux;Android 11)' } };

  client.get(urlStr, options, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let redirectUrl = res.headers.location;
      if (!redirectUrl.startsWith('http')) {
        redirectUrl = new URL(redirectUrl, urlStr).toString();
      }
      return downloadAndParseM3U(redirectUrl, destPath, originalUrl, callback, redirectCount + 1);
    }
    
    if (res.statusCode !== 200) {
      return callback(new Error(`Failed with status ${res.statusCode}`));
    }

    const fileStream = fs.createWriteStream(destPath);
    const rl = readline.createInterface({ input: res, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const tLine = line.trim();
      if (tLine.length === 0 || tLine.startsWith('#')) {
        fileStream.write(line + '\n');
      } else {
        try {
          fileStream.write(new URL(tLine, originalUrl).toString() + '\n');
        } catch (e) {
          fileStream.write(line + '\n');
        }
      }
    });

    rl.on('close', () => {
      fileStream.end();
      callback(null);
    });
    
    res.on('error', (err) => {
      fileStream.end();
      callback(err);
    });
  }).on('error', callback);
};

app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  
  if (targetUrl === '/api/public.m3u') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    const publicPath = path.join(CACHE_DIR, 'public.m3u');
    if (fs.existsSync(publicPath)) {
      return res.sendFile(publicPath); // Zero-copy disk serve
    } else {
      return res.status(404).send('Public playlist not ready');
    }
  }

  const urlHash = crypto.createHash('md5').update(targetUrl).digest('hex');
  const cacheFilePath = path.join(CACHE_DIR, `${urlHash}.m3u`);

  const serveCachedFile = () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.sendFile(cacheFilePath); // Zero-copy disk serve
  };

  // Do not cache .m3u8 live streams for more than 2 seconds, but cache main .m3u playlists for 1 hour
  const isLiveStream = targetUrl.split('?')[0].endsWith('.m3u8');
  const dynamicCacheTtl = isLiveStream ? 2000 : CACHE_TTL_MS;

  if (fs.existsSync(cacheFilePath)) {
    const stats = fs.statSync(cacheFilePath);
    if (Date.now() - stats.mtimeMs < dynamicCacheTtl) {
      return serveCachedFile();
    }
  }

  // If not cached or expired, download streaming to disk
  downloadAndParseM3U(targetUrl, cacheFilePath, targetUrl, (err) => {
    if (err) {
      console.error('Proxy Error:', err.message);
      // Fallback to old cache if possible
      if (fs.existsSync(cacheFilePath)) {
        return serveCachedFile();
      }
      return res.status(400).send('Invalid URL or request failed');
    }
    serveCachedFile();
  });
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

let isParsing = false;

const updatePublicPlaylist = () => {
  if (isParsing || PUBLIC_SOURCES.length === 0) return;
  isParsing = true;
  console.log('Бот-парсер начал сбор общедоступных плейлистов на диск...');
  
  const publicPath = path.join(CACHE_DIR, 'public.m3u');
  const tempPath = path.join(CACHE_DIR, 'public_temp.m3u');
  const fileStream = fs.createWriteStream(tempPath);
  fileStream.write('#EXTM3U\n');
  
  const processSource = (index) => {
    if (index >= PUBLIC_SOURCES.length) {
      fileStream.end(() => {
        // Atomic replace old file with new file
        fs.renameSync(tempPath, publicPath);
        console.log('Бот-парсер успешно обновил общедоступный плейлист на диске.');
        isParsing = false;
      });
      return;
    }
    
    const urlStr = PUBLIC_SOURCES[index];
    https.get(urlStr, (res) => {
      const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.includes('#EXTM3U')) {
          fileStream.write(line + '\n');
        }
      });
      rl.on('close', () => {
        processSource(index + 1);
      });
    }).on('error', (err) => {
      console.error('Ошибка бота-парсера для', urlStr, err.message);
      processSource(index + 1);
    });
  };
  
  processSource(0);
};

// Запускаем парсер при старте и раз в сутки (24 часа)
updatePublicPlaylist();
setInterval(updatePublicPlaylist, 24 * 60 * 60 * 1000);

app.get('/api/public.m3u', (req, res) => {
  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const publicPath = path.join(CACHE_DIR, 'public.m3u');
  if (fs.existsSync(publicPath)) {
    res.sendFile(publicPath);
  } else {
    res.status(404).send('Playlist not ready');
  }
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

// Serve static files with normal caching
app.use(express.static(path.join(__dirname, 'dist')));

app.listen(PORT, () => console.log('Server running on ' + PORT));
