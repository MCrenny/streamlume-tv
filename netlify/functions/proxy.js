// Netlify Function — прокси для медиа-контента (HLS, EPG, изображения)
// Автоматически деплоится вместе с сайтом на Netlify

exports.handler = async function (event, context) {
  // Обработка CORS preflight (OPTIONS запрос от браузера)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    };
  }

  const targetUrl = event.queryStringParameters?.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing "url" query parameter' }),
    };
  }

  try {
    const decodedUrl = decodeURIComponent(targetUrl);

    // Определяем тип контента по расширению
    const isM3U = decodedUrl.endsWith('.m3u') || decodedUrl.endsWith('.m3u8');
    const isEpg = decodedUrl.includes('epg') || decodedUrl.endsWith('.xml');
    const isImage = decodedUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i);

    let contentType = 'application/octet-stream';
    if (isM3U) contentType = 'audio/x-mpegurl';
    else if (isEpg) contentType = 'application/xml';
    else if (isImage) contentType = 'image/jpeg';

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: `Proxy error: ${response.status} ${response.statusText}`,
      };
    }

    const text = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': contentType,
        'Cache-Control': isM3U ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400',
      },
      body: text,
    };
  } catch (error) {
    console.error('[Proxy] Error:', error.message);
    return {
      statusCode: 500,
      body: `Proxy error: ${error.message}`,
    };
  }
};
