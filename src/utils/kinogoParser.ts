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
 * реальные браузерные запросы, а allorigins иногда успешно проксирует такой трафик.
 *
 * Каждый прокси нестабилен (лимиты/перебои), поэтому перебираем их по очереди и
 * возвращаем первый ответ, который выглядит как настоящий HTML kinogo.
 * `expect` — проверка валидности (наличие карточек фильмов на главной; наличие
 * <title> на странице фильма), чтобы отсечь Cloudflare-блок-страницы.
 */
const PROXIES: Array<(u: string) => string> = [
  // allorigins /get оборачивает HTML в { contents: "..." } — раскручиваем ниже
  (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u),
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  // Локальный/Netlify серверный прокси — оставляем последним (Cloudflare блокирует
  // его в проде, но локально через node server.js он работает для разработки).
  (u) => '/.netlify/functions/proxy?url=' + encodeURIComponent(u),
];

function unwrap(proxyIndex: number, raw: string): string {
  if (proxyIndex === 0) {
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

async function fetchKinogoHtml(targetUrl: string, isValid: (html: string) => boolean): Promise<string> {
  // Запускаем ВСЕ прокси параллельно и берём первый валидный ответ.
  // Прокси нестабильны (Cloudflare/лимиты), поэтому гонки дают максимальную
  // скорость и надёжность: если один упал или отдал блок-страницу — выручает другой.
  let lastError: any = null;
  const attempts = PROXIES.map(async (buildUrl, i) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 18000);
      const resp = await fetch(buildUrl(targetUrl), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const html = unwrap(i, await resp.text());
      if (!isValid(html)) throw new Error('некорректный ответ (возможно Cloudflare-блок)');
      return html;
    } catch (e) {
      lastError = e;
      throw e;
    }
  });
  try {
    // Promise.any вернёт первый УСПЕШНЫЙ результат, игнорируя отвергнутые
    return await (Promise as any).any(attempts);
  } catch {
    throw lastError || new Error('Все CORS-прокси недоступны');
  }
}

const looksLikeMoviesPage = (html: string) => html.includes('class="card d-flex"');
const looksLikeMoviePage = (html: string) => /<title>[^<]/i.test(html);

export async function fetchKinogoMovies(page = 1): Promise<Movie[]> {
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
          genres = genreLinks.map(g => g.replace(/>|<\/a>/g, '')).join(', ');
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

  return movies;
}

export async function fetchMoviePage(url: string): Promise<{ playerUrl?: string; title?: string }> {
  const html = await fetchKinogoHtml(url, looksLikeMoviePage);

  const titleMatch = html.match(/<title>([^|<]+)/);
  const playerMatch = html.match(/(?:player|iframe|embed)[^"]*src="([^"]+)"/i)
    || html.match(/<iframe[^>]+src="([^"]+)"/i);

  // ortified-плеер отдаётся protocol-relative ("//api.ortified.ws/...").
  // Гарантируем абсолютный https-адрес, иначе на HTTP-контексте iframe ломается.
  const playerUrl = playerMatch?.[1]?.replace(/^\/\//, 'https://');

  return {
    title: titleMatch?.[1]?.trim(),
    playerUrl,
  };
}
