// Vercel Serverless Function — прокси для медиа-контента (HLS, EPG, изображения)
// Заменяет Express-прокси, который был на Amvera
// Использует Node.js runtime (по умолчанию) для надёжной работы с HLS-потоками

/**
 * @param {import('@vercel/node').VercelRequest} request
 * @param {import('@vercel/node').VercelResponse} response
 */
module.exports = async function handler(request, response) {
  const { url: targetUrl } = request.query;

  if (!targetUrl) {
    return response.status(400).json({ error: 'Missing "url" query parameter' });
  }

  try {
    const decodedUrl = decodeURIComponent(targetUrl);

    // Определяем тип контента по расширению
    const isM3U = decodedUrl.endsWith('.m3u') || decodedUrl.endsWith('.m3u8');
    const isEpg = decodedUrl.includes('epg') || decodedUrl.endsWith('.xml');
    const isImage = Boolean(decodedUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i));

    let contentType = 'application/octet-stream';
    if (isM3U) contentType = 'audio/x-mpegurl';
    else if (isEpg) contentType = 'application/xml';
    else if (isImage) contentType = 'image/jpeg';

    // Создаём запрос к целевому URL
    const proxyResponse = await fetch(decodedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!proxyResponse.ok) {
      return response
        .status(proxyResponse.status)
        .send(`Proxy error: ${proxyResponse.status} ${proxyResponse.statusText}`);
    }

    // Проксируем ответ с правильными CORS-заголовками
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', '*');
    response.setHeader('Content-Type', contentType);

    // Для HLS контента не кешируем (потоковое видео)
    if (isM3U) {
      response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    // Проксируем тело ответа
    const text = await proxyResponse.text();
    return response.status(proxyResponse.status).send(text);
  } catch (error) {
    console.error('Proxy error:', error);
    return response
      .status(500)
      .send(`Proxy error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};
