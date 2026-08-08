import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, TextInput, FlatList, Image, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchKinogoMovies, fetchMoviePage, readStaleMovies, Movie } from '../utils/kinogoParser';

export default function PortalScreen({ navigation }: any) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  // Диагностический отчёт: показывает на экране ТВ причину сбоя без DevTools.
  // Нужен потому что ТВ на Tizen 2-3 (старый WebKit) — консоль там не посмотреть.
  const [diag, setDiag] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  // Какой фильм сейчас резолвит свой URL плеера (для локального спиннера на карточке)
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  // На ТВ (landscape) 5 колонок делали карточки слишком мелкими — текст
  // наезжал на бейдж рейтинга. 4 колонки дают карточки крупнее и читабельнее.
  const numColumns = isLandscape ? 4 : 3;

  // Загрузка первой страницы
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setDiag('');

    // Диагностика: проверяем поддержку JS-API прямо на устройстве, чтобы
    // понять — падает ли из-за старого WebKit (Tizen 2-3), или из-за сети.
    const checks: string[] = [];
    checks.push('UA: ' + (typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 60) : 'no navigator'));
    checks.push('Promise.allSettled: ' + (typeof (Promise as any).allSettled === 'function' ? 'OK' : 'ОТСУТСТВУЕТ'));
    checks.push('fetch: ' + (typeof fetch === 'function' ? 'OK' : 'ОТСУТСТВУЕТ'));
    checks.push('AbortController: ' + (typeof AbortController !== 'undefined' ? 'OK' : 'ОТСУТСТВУЕТ'));

    fetchKinogoMovies(1)
      .then((list) => {
        if (!cancelled) {
          setMovies(list);
          setPage(1);
        }
      })
      .catch((e) => {
        console.error('[Portal] fetchKinogoMovies failed:', e);
        if (cancelled) return;
        checks.push('РЕЗУЛЬТАТ: ' + (e?.message || String(e)).slice(0, 300));
        setDiag(checks.join('\n'));
        // Stale-fallback: если все прокси временно недоступны, показываем
        // последний успешно загруженный каталог из кеша (лучше старый, чем пусто)
        const stale = readStaleMovies(1);
        if (stale && stale.length > 0) {
          setMovies(stale);
        } else {
          setError(true);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Сбрасываем скролл-фокус при смене раскладки
  useEffect(() => { setFocusedIdx(0); }, [numColumns]);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Закрытие по пульту: Escape / Backspace + коды LG Back(461) и Tizen Return(10009)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const kc = (e as any).keyCode;
      if (e.key === 'Escape' || e.key === 'Backspace' || kc === 461 || kc === 10009) {
        e.preventDefault();
        handleClose();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [handleClose]);

  // Чистим body-стили, оставшиеся от прошлой iframe-реализации
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.body.style.margin = '';
      document.body.style.padding = '';
    }
  }, []);

  const filteredMovies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return movies;
    return movies.filter((m) => m.title.toLowerCase().includes(q));
  }, [movies, searchQuery]);

  // Открытие фильма: сначала резолвим URL плеера через страницу фильма
  const openMovie = useCallback(async (movie: Movie) => {
    if (resolvingId) return;
    setResolvingId(movie.id);
    try {
      const { playerUrl, title } = await fetchMoviePage(movie.url);
      if (playerUrl) {
        navigation.navigate('PortalPlayer', { url: playerUrl, title: title || movie.title });
      } else {
        // eslint-disable-next-line no-alert
        if (typeof window !== 'undefined') {
          window.alert('Не удалось найти видео-плеер для этого фильма.');
        }
      }
    } catch (e) {
      console.error('[Portal] fetchMoviePage failed:', e);
      if (typeof window !== 'undefined') {
        window.alert('Ошибка при загрузке фильма. Попробуйте позже.');
      }
    } finally {
      setResolvingId(null);
    }
  }, [navigation, resolvingId]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const list = await fetchKinogoMovies(nextPage);
      if (list.length > 0) {
        setMovies((prev) => [...prev, ...list]);
        setPage(nextPage);
      }
    } catch (e) {
      console.error('[Portal] loadMore failed:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [page, loadingMore]);

  if (loading) {
    return (
      <View style={styles.centerWrap}>
        <ActivityIndicator size="large" color="#0A84FF" />
        <Text style={styles.loadingText}>Загрузка фильмов...</Text>
        <Text style={styles.loadingHint}>Источник может отвечать несколько секунд</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerWrap}>
        <Ionicons name="cloud-offline-outline" size={64} color="#FF453A" />
        <Text style={styles.errorText}>Не удалось загрузить фильмы</Text>
        <Text style={styles.errorHint}>Источник сейчас недоступен. Попробуйте позже.</Text>
        {diag ? (
          <View style={styles.diagBox}>
            {diag.split('\n').map((line, i) => (
              <Text key={i} style={styles.diagText}>{line}</Text>
            ))}
          </View>
        ) : null}
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.retryBtn}
          focusable
          accessible
        >
          <Text style={styles.retryText}>Назад</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Шапка */}
      <View style={styles.header}>
        <Pressable
          onPress={handleClose}
          onFocus={() => setSearchFocused(false)}
          focusable
          accessible
          style={(state: any) => [styles.backBtn, state.focused && styles.backBtnFocused]}
        >
          {(state: any) => (
            <Ionicons name="arrow-back" size={22} color={state.focused ? '#000' : '#0A84FF'} />
          )}
        </Pressable>

        <Text style={styles.title}>🎬 Видео-портал</Text>

        <TextInput
          style={[styles.searchInput, searchFocused && styles.searchInputFocused]}
          placeholder="Поиск фильма..."
          placeholderTextColor="#8E8E93"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
      </View>

      {/* Сетка фильмов */}
      <FlatList
        key={`grid-${numColumns}`}
        data={filteredMovies}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews={false}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {searchQuery ? 'Ничего не найдено' : 'Фильмы не найдены'}
            </Text>
          </View>
        }
        ListFooterComponent={
          !searchQuery ? (
            <View style={styles.footerWrap}>
              <Pressable
                onPress={loadMore}
                onFocus={() => setSearchFocused(false)}
                focusable
                accessible
                style={(state: any) => [styles.moreBtn, state.focused && styles.moreBtnFocused]}
              >
                {(state: any) => (
                  <Text style={[styles.moreBtnText, state.focused && styles.moreBtnTextFocused]}>
                    {loadingMore ? 'Загрузка...' : 'Ещё фильмы'}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const isFocused = focusedIdx === index;
          const isResolving = resolvingId === item.id;
          return (
            <Pressable
              onPress={() => openMovie(item)}
              onFocus={() => setFocusedIdx(index)}
              focusable={!isResolving}
              accessible={true}
              hasTVPreferredFocus={index === 0}
              style={[
                styles.card,
                isFocused && styles.cardFocused,
              ]}
            >
              {/* Постер */}
              <View style={styles.posterWrap}>
                {item.poster ? (
                  <Image
                    source={{ uri: item.poster }}
                    style={styles.poster}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.poster, styles.posterFallback]}>
                    <Ionicons name="film-outline" size={40} color="#3a3a3c" />
                  </View>
                )}
                {isResolving && (
                  <View style={styles.resolvingOverlay}>
                    <ActivityIndicator size="small" color="#0A84FF" />
                  </View>
                )}
                {item.rating ? (
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingText}>★ {item.rating}</Text>
                  </View>
                ) : null}
              </View>
              {/* Название + год */}
              <View style={styles.cardInfo}>
                <Text style={[styles.movieTitle, isFocused && styles.movieTitleFocused]} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.year ? (
                  <Text style={[styles.movieYear, isFocused && styles.movieYearFocused]} numberOfLines={1}>
                    {item.year}{item.genre ? ` · ${item.genre}` : ''}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingHorizontal: 32,
  },
  loadingText: { color: '#8E8E93', marginTop: 12, fontSize: 14 },
  // Диагностический блок: технический отчёт прямо на экране ТВ (monospace,
  // мелкий — чтобы влезло много строк; контрастный фон для читаемости).
  diagBox: {
    marginTop: 20,
    marginBottom: 12,
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 8,
    padding: 12,
    minWidth: 600,
    maxWidth: '90%',
  },
  diagText: {
    color: '#30D158',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    fontSize: 13,
    lineHeight: 18,
  },
  loadingHint: { color: '#48484A', marginTop: 6, fontSize: 12, textAlign: 'center' },
  errorText: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16 },
  errorHint: { color: '#8E8E93', fontSize: 14, marginTop: 8, textAlign: 'center' },
  retryBtn: {
    marginTop: 24,
    backgroundColor: '#0A84FF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(10,132,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  backBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 16,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#2c2c2e',
    color: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  searchInputFocused: {
    borderColor: '#0A84FF',
    backgroundColor: 'rgba(10,132,255,0.08)',
  },

  list: {
    padding: 8,
  },
  card: {
    flex: 1,
    margin: 6,
    borderRadius: 10,
    backgroundColor: '#1c1c1e',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    transform: [{ scale: 1.05 }],
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  posterWrap: {
    width: '100%',
    aspectRatio: 0.66,
    backgroundColor: '#050505',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  resolvingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  ratingText: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: 'bold',
  },
  cardInfo: {
    padding: 10,
  },
  movieTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  movieTitleFocused: {
    color: '#000',
  },
  movieYear: {
    color: '#8E8E93',
    fontSize: 13,
    marginTop: 4,
  },
  movieYearFocused: {
    color: '#333',
  },

  emptyWrap: {
    padding: 60,
    alignItems: 'center',
  },
  emptyText: {
    color: '#8E8E93',
    fontSize: 16,
  },
  footerWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  moreBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(10,132,255,0.15)',
    borderWidth: 1.5,
    borderColor: '#0A84FF',
  },
  moreBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    transform: [{ scale: 1.05 }],
  },
  moreBtnText: {
    color: '#0A84FF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  moreBtnTextFocused: {
    color: '#000',
  },
});
