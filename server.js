/**
 * StreamLume TV — Production Server
 * 
 * Используется для деплоя на Render.com (бесплатно).
 * Раздаёт статику из dist/ и проксирует медиа-контент.
 */

const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS для всех запросов
app.use(cors({
  origin: '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['*'],
}));

// === Прокси для медиа-контента ===
// HLS плэйлисты (.m3u8), EPG (.xml), изображения
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    
    // Определяем контент-тайп
    const isM3U = decodedUrl.endsWith('.m3u') || decodedUrl.endsWith('.m3u8');
    const isEpg = decodedUrl.includes('epg') || decodedUrl.endsWith('.xml');
    const isImage = decodedUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i);

    let contentType = 'application/octet-stream';
    if (isM3U) contentType = 'audio/x-mpegurl';
    else if (isEpg) contentType = 'application/xml';
    else if (isImage) contentType = 'image/jpeg';

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      return res.status(response.status).send(`Proxy error: ${response.status}`);
    }

    // Копируем нужные заголовки
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    
    if (isM3U) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    const text = await response.text();
    return res.status(response.status).send(text);
  } catch (error) {
    console.error('[Proxy] Error:', error.message);
    return res.status(500).send(`Proxy error: ${error.message}`);
  }
});

// === Статика (собранное веб-приложение) ===
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath, {
  maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
  setHeaders: (res, filePath) => {
    // Кешируем ассеты навсегда
    if (filePath.includes('/assets/') || filePath.includes('/_expo/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// SPA fallback — все маршруты отдаём index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// === Запуск ===
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 StreamLume TV запущен на порту ${PORT}`);
  console.log(`📁 Статика из: ${distPath}`);
  console.log(`🌐 Открой в браузере: http://localhost:${PORT}`);
});
