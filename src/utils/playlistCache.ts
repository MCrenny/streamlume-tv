import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

const getFilenameFromUrl = (url: string) => {
  return encodeURIComponent(url) + '.m3u';
};

/**
 * Скачивает плейлист и возвращает его текст.
 *
 * С December 2026 плейлисты раздаются с нашего же домена
 * (streamlume-tv.netlify.app/playlists/*.m3u), обновляются раз в сутки
 * GitHub Action'ом. Поэтому:
 *   - CORS не проблема (same-origin)
 *   - внешние прокси (allorigins) больше не нужны
 *   - кеш браузера/ТВ сам всё разруливает
 *
 * Локальный кеш в localStorage (web) или FileSystem (native) нужен только
 * чтобы не дёргать сервер при каждой смене плейлиста в UI.
 */
export const fetchAndCachePlaylist = async (url: string): Promise<string> => {
  if (Platform.OS === 'web') {
    const cacheKey = `playlist_${url}`;
    const cacheDateKey = `playlist_date_${url}`;

    // 1. Пробуем кеш (если свежий — отдаём сразу)
    try {
      const cachedDate = localStorage.getItem(cacheDateKey);
      const cachedText = localStorage.getItem(cacheKey);
      if (cachedDate && cachedText && (Date.now() - parseInt(cachedDate, 10) < CACHE_TTL)) {
        console.log('[Cache] Using localStorage cache for web');
        return cachedText;
      }
    } catch (e) {
      // localStorage может быть недоступен (приватный режим / квота) — не критично, идём дальше
      console.warn('[Cache] localStorage read failed, will fetch fresh', e);
    }

    // 2. Скачиваем с нашего же домена (same-origin, CORS не нужен)
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Playlist fetch failed: HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();

    // 3. Сохраняем в кеш (если плейлист слишком большой и переполняет квоту — просто пропускаем)
    try {
      localStorage.setItem(cacheKey, text);
      localStorage.setItem(cacheDateKey, Date.now().toString());
    } catch (e) {
      console.warn('[Cache] localStorage write failed (quota?), skipping cache', e);
    }

    return text;
  }

  // === Native (iOS/Android/TV) ===
  const filename = getFilenameFromUrl(url);
  const fileUri = `${FileSystem.documentDirectory}${filename}`;

  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (fileInfo.exists) {
      if (fileInfo.modificationTime) {
        const modTimeMs = fileInfo.modificationTime * 1000;
        if (Date.now() - modTimeMs < CACHE_TTL) {
          console.log('[Cache] Using local file system cache');
          return await FileSystem.readAsStringAsync(fileUri);
        }
      }
    }

    console.log('[Cache] Downloading fresh playlist to file system');
    const downloadResult = await FileSystem.downloadAsync(url, fileUri);
    if (downloadResult.status !== 200) {
      throw new Error(`Failed to download playlist: ${downloadResult.status}`);
    }

    return await FileSystem.readAsStringAsync(fileUri);
  } catch (error) {
    console.error('[Cache] error:', error);
    // Если сеть упала — пробуем отдать устаревший кеш (лучше что-то, чем ничего)
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (fileInfo.exists) {
      console.log('[Cache] Falling back to stale cache due to network error');
      return await FileSystem.readAsStringAsync(fileUri);
    }
    throw error;
  }
};
