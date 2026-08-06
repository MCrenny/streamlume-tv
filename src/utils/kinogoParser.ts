export interface Movie {
  id: string;
  title: string;
  url: string;
  poster: string;
  rating?: string;
  year?: string;
  genre?: string;
}

const PROXY_BASE = '/.netlify/functions/proxy?url=';

export async function fetchKinogoMovies(page = 1): Promise<Movie[]> {
  const url = page === 1 ? 'https://kinogo.is/' : `https://kinogo.is/page/${page}/`;
  const resp = await fetch(PROXY_BASE + encodeURIComponent(url));
  const html = await resp.text();

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
  const resp = await fetch(PROXY_BASE + encodeURIComponent(url));
  const html = await resp.text();

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
