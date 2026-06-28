const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 80;

app.use(cors());

const followRedirectsGet = (urlStr, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const client = urlStr.startsWith('https') ? require('https') : require('http');
  
  const options = {
    headers: {
      'User-Agent': 'Televizo/1.9.3.4 (Linux;Android 11)'
    }
  };

  client.get(urlStr, options, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let redirectUrl = proxyRes.headers.location;
      if (!redirectUrl.startsWith('http')) {
        redirectUrl = new URL(redirectUrl, urlStr).toString();
      }
      return followRedirectsGet(redirectUrl, res);
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
        res.setHeader('Content-Length', Buffer.byteLength(newBody));
        res.send(newBody);
      });
    } else {
      proxyRes.pipe(res);
    }
  }).on('error', (err) => res.status(500).send(err.message));
};

app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  followRedirectsGet(targetUrl, res);
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
