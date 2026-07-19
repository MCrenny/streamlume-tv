import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const getFilenameFromUrl = (url: string) => {
  return encodeURIComponent(url) + '.m3u';
};

export const fetchAndCachePlaylist = async (url: string): Promise<string> => {
  if (Platform.OS === 'web') {
    // For web, use localStorage as simple cache, and AllOrigins as CORS proxy
    const cacheKey = `playlist_${url}`;
    const cacheDateKey = `playlist_date_${url}`;
    
    const cachedDate = localStorage.getItem(cacheDateKey);
    const cachedText = localStorage.getItem(cacheKey);
    
    if (cachedDate && cachedText && (Date.now() - parseInt(cachedDate, 10) < CACHE_TTL)) {
      console.log('[Cache] Using localStorage cache for web');
      return cachedText;
    }

    // Direct fetch might fail on web due to CORS, so we try direct first, then proxy
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Direct fetch failed');
      const text = await response.text();
      localStorage.setItem(cacheKey, text);
      localStorage.setItem(cacheDateKey, Date.now().toString());
      return text;
    } catch (e) {
      console.log('[Cache] Direct fetch failed, falling back to CORS proxy', e);
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Proxy fetch failed');
      const text = await response.text();
      localStorage.setItem(cacheKey, text);
      localStorage.setItem(cacheDateKey, Date.now().toString());
      return text;
    }
  }

  // Native iOS/Android/TV implementation using FileSystem
  const filename = getFilenameFromUrl(url);
  const fileUri = `${FileSystem.documentDirectory}${filename}`;

  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (fileInfo.exists) {
      // Check modification date
      if (fileInfo.modificationTime) {
        // modificationTime is in seconds from epoch
        const modTimeMs = fileInfo.modificationTime * 1000;
        if (Date.now() - modTimeMs < CACHE_TTL) {
          console.log('[Cache] Using local file system cache');
          return await FileSystem.readAsStringAsync(fileUri);
        }
      } else {
         // If modificationTime is not available, we can't reliably check age, but let's assume it's old to be safe
         // and fetch again.
      }
    }

    // File doesn't exist or is too old, download it
    console.log('[Cache] Downloading fresh playlist to file system');
    const downloadResult = await FileSystem.downloadAsync(url, fileUri);
    if (downloadResult.status !== 200) {
       throw new Error(`Failed to download playlist: ${downloadResult.status}`);
    }
    
    return await FileSystem.readAsStringAsync(fileUri);
  } catch (error) {
    console.error('Cache error:', error);
    // If download fails (e.g. no internet), try reading from cache anyway if it exists
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (fileInfo.exists) {
        console.log('[Cache] Falling back to stale cache due to network error');
        return await FileSystem.readAsStringAsync(fileUri);
    }
    throw error;
  }
};
