const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 80;

app.use(cors());

const followRedirectsGet = (urlStr, res) => {
  const client = urlStr.startsWith('https') ? require('https') : require('http');
  client.get(urlStr, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let redirectUrl = proxyRes.headers.location;
      if (!redirectUrl.startsWith('http')) {
        redirectUrl = new URL(redirectUrl, urlStr).toString();
      }
      return followRedirectsGet(redirectUrl, res);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    Object.keys(proxyRes.headers).forEach(key => {
      if (key.toLowerCase() !== 'access-control-allow-origin' && key.toLowerCase() !== 'host') {
        try { res.setHeader(key, proxyRes.headers[key]); } catch (e) {}
      }
    });
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  }).on('error', (err) => res.status(500).send(err.message));
};

app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  followRedirectsGet(targetUrl, res);
});

app.get(['/start.json', '/msx/start.json'], (req, res) => res.sendFile(path.join(__dirname, 'start.json')));
app.use(express.static(path.join(__dirname, 'dist')));
app.listen(PORT, () => console.log('Server running on ' + PORT));
