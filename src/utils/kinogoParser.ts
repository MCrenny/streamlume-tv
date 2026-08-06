import { Platform } from 'react-native';

export interface Movie {
  id: string;
  title: string;
  url: string;
  poster: string;
  rating?: string;
  year?: string;
  genre?: string;
}

/**
 * kinogo.is защищён Cloudflare и блокирует серверные запросы (Netlify-функция
 * получает «Just a moment...» вместо HTML). Поэтому HTML тянем НАПРЯМУЮ из
 * браузера пользователя через публичные CORS-прокси — Cloudflare чаще пропускает
 * реальные браузерные запросы.
 *
 * Каждый прокси нестабилен (лимиты/перебои/блокировки), и набор рабочих меняется
 * со временем. Поэтому:
 *   - держим ШИРОКИЙ ПУЛ прокси;
 *   - запускаем их ПАРАЛЛЕЛЬНО и берём первый валидный ответ (Promise.any);
 *   - ответ проверяем на реальный контент (наличие карточек / <title>), чтобы
 *     отсечь Cloudflare-блок-страницы.
 *
 * Порядок в массиве = приоритет: рабочие на момент измерения идут первыми.
 */
const PROXIES: Array<(u: string) => string> = [
  // proxy.cors.sh — быстрый и стабильный, обходит Cloudflare
  (u) => 'https://proxy.cors.sh/' + u,
  // allorigins /get — оборачивает HTML в { contents: "..." } (раскручиваем ниже)
  (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u),
  // allorigins /raw — отдаёт HTML как есть
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  // codetabs
  (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
  // corsproxy.io
  (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  // Локальный/Netlify серверный прокси — последним (в проде Cloudflare его
  // блокирует, но локально через node server.js он работает для разработки)
  (u) => '/.netlify/functions/proxy?url=' + encodeURIComponent(u),
];

function unwrap(proxyIndex: number, raw: string): string {
  if (PROXIES[proxyIndex]('').includes('allorigins.win/get')) {
    // allorigins /get → { contents: "..." }
    try {
      const parsed = JSON.parse(raw);
      return parsed.contents || '';
    } catch {
      return raw;
    }
  }
  return raw;
}

const looksLikeMoviesPage = (html: string) => html.includes('class="card d-flex"');
const looksLikeMoviePage = (html: string) => /<title>[^<]/i.test(html);

async function fetchKinogoHtml(
  targetUrl: string,
  isValid: (html: string) => boolean,
): Promise<string> {
  // Запускаем ВСЕ прокси параллельно и берём первый валидный ответ.
  const attempts = PROXIES.map(async (buildUrl, i) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(buildUrl(targetUrl), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const html = unwrap(i, await resp.text());
      if (!isValid(html)) throw new Error('некорректный ответ (возможно Cloudflare-блок)');
      return html;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  });
  try {
    // Promise.any вернёт первый УСПЕШНЫЙ результат, игнорируя отвергнутые
    return await (Promise as any).any(attempts);
  } catch {
    throw new Error('Все CORS-прокси недоступны');
  }
}

// === Кеш в localStorage (web) ===
// Каталог и URL плееров кешируем, чтобы:
//   - при перезаходе фильмы показывались мгновенно (без дёрганья нестабильных прокси);
//   - если все прокси временно лежат — показать хоть что-то (stale-fallback).
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 часа — каталог обновляется, но не каждую минуту
const MOVIES_CACHE_KEY = 'kinogo_movies_page_';
const PLAYER_CACHE_KEY = 'kinogo_player_';

function readCache(key: string): { value: any; fresh: boolean } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const dateStr = localStorage.getItem(key + '_date');
    const valueStr = localStorage.getItem(key);
    if (!dateStr || !valueStr) return null;
    const fresh = Date.now() - parseInt(dateStr, 10) < CACHE_TTL;
    return { value: JSON.parse(valueStr), fresh };
  } catch {
    return null;
  }
}

function writeCache(key: string, value: any): void {
  if (Platform.OS !== 'web') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(key + '_date', Date.now().toString());
  } catch (e) {
    // переполнение квоты — не критично, просто не кешируем
    console.warn('[Kinogo Cache] write failed', e);
  }
}

/**
 * Возвращает устаревший (просроченный) кеш каталога, если он есть.
 * Используется как fallback, когда все прокси временно недоступны:
 * лучше показать старый список фильмов, чем пустой экран.
 */
export function readStaleMovies(page = 1): Movie[] | null {
  const cached = readCache(MOVIES_CACHE_KEY + page);
  if (cached && Array.isArray(cached.value) && cached.value.length > 0) {
    return cached.value as Movie[];
  }
  return null;
}

export async function fetchKinogoMovies(page = 1): Promise<Movie[]> {
  const cacheKey = MOVIES_CACHE_KEY + page;

  // 1. Свежий кеш — отдаём сразу, без запросов к прокси
  const cached = readCache(cacheKey);
  if (cached && cached.fresh && Array.isArray(cached.value)) {
    return cached.value as Movie[];
  }

  // 2. Тянем HTML через пул прокси
  const url = page === 1 ? 'https://kinogo.is/' : `https://kinogo.is/page/${page}/`;
  const html = await fetchKinogoHtml(url, looksLikeMoviesPage);

  const movies: Movie[] = [];
  const cardRegex = /<div class="card d-flex">([\s\S]*?)(?=<div class="card d-flex">|<div class="pagination)/g;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const card = match[1];

    const titleMatch = card.match(/<div class="card__title"><a href="([^"]+)">([^<]+)<\/a><\/div>/);
    const posterMatch = card.match(/<img[^>]*(?:data-src|src)="([^"]+)"[^>]*alt="([^"]*)">/);
    const ratingMatch = card.match(/<span>([\d.]+)<\/span>\/5/);
    const yearMatch = card.match(/Год выпуска:<\/span>\s*(?:<a[^>]*>)?(\d{4})/);
    const genreMatch = card.match(/Жанр:<\/span>\s*([\s\S]*?)<\/li>/);

    if (titleMatch && posterMatch) {
      const movieUrl = titleMatch[1];
      const id = movieUrl.match(/\/(\d+)-/)?.[1] || String(movies.length);

      let posterUrl = posterMatch[1];
      if (posterUrl.startsWith('/')) {
        posterUrl = 'https://kinogo.is' + posterUrl;
      }

      let genres = '';
      if (genreMatch) {
        const genreLinks = genreMatch[1].match(/>([^<]+)<\/a>/g);
        if (genreLinks) {
          genres = genreLinks.map((g) => g.replace(/>|<\/a>/g, '')).join(', ');
        }
      }

      movies.push({
        id,
        title: titleMatch[2].replace(/ \(\d{4}\)$/, ''),
        url: movieUrl.startsWith('http') ? movieUrl : 'https://kinogo.is' + movieUrl,
        poster: posterUrl,
        rating: ratingMatch?.[1],
        year: yearMatch?.[1],
        genre: genres,
      });
    }
  }

  // 3. Сохраняем в кеш
  if (movies.length > 0) {
    writeCache(cacheKey, movies);
  }

  return movies;
}

export async function fetchMoviePage(
  url: string,
): Promise<{ playerUrl?: string; title?: string }> {
  // Кеш URL плеера по странице фильма (URL плеера стабилен — нет смысла тянуть каждый раз)
  const cacheKey = PLAYER_CACHE_KEY + url;
  const cached = readCache(cacheKey);
  if (cached && cached.fresh && cached.value && cached.value.playerUrl) {
    return cached.value;
  }

  const html = await fetchKinogoHtml(url, looksLikeMoviePage);

  const titleMatch = html.match(/<title>([^|<]+)/);
  const playerMatch =
    html.match(/(?:player|iframe|embed)[^"]*src="([^"]+)"/i) ||
    html.match(/<iframe[^>]+src="([^"]+)"/i);

  // ortified-плеер отдаётся protocol-relative ("//api.ortified.ws/...").
  // Гарантируем абсолютный https-адрес, иначе на HTTP-контексте iframe ломается.
  const playerUrl = playerMatch?.[1]?.replace(/^\/\//, 'https://');

  const result = {
    title: titleMatch?.[1]?.trim(),
    playerUrl,
  };

  if (playerUrl) {
    writeCache(cacheKey, result);
  }

  return result;
}
