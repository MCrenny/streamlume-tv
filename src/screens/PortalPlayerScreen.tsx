import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  route: any;
  navigation: any;
}

function WebIframe({ url, onLoad, onError }: { url: string; onLoad: () => void; onError: () => void }) {
  return (
    <iframe
      src={url}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        border: 'none',
        margin: 0,
        padding: 0,
      }}
      onLoad={onLoad}
      onError={onError}
      allow="autoplay; fullscreen; encrypted-media"
      sandbox="allow-scripts allow-forms allow-popups allow-presentation allow-same-origin"
      title="Плеер"
    />
  );
}

export default function PortalPlayerScreen({ route, navigation }: Props) {
  const rawUrl: string = (route.params || {}).url || '';
  // Парсер kinogo возвращает protocol-relative URL вида "//api.ortified.ws/...".
  // На HTTP-контексте (старые ТВ, локальный IP) такой URL резолвится в http://... и ломается.
  // Гарантируем абсолютный https-адрес.
  const url = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
  const title: string = (route.params || {}).title;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  useEffect(() => {
    // Escape/Backspace + коды LG Back(461) и Tizen Return(10009) для надёжности на ТВ-пульте
    const handler = (e: KeyboardEvent) => {
      const kc = (e as any).keyCode;
      if (e.key === 'Escape' || e.key === 'Backspace' || kc === 461 || kc === 10009) {
        e.preventDefault();
        handleClose();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handler, true);
      return () => window.removeEventListener('keydown', handler, true);
    }
  }, [handleClose]);

  if (!url) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF453A" />
          <Text style={styles.errorText}>URL фильма не найден</Text>
          <Pressable style={styles.retryBtn} onPress={handleClose}>
            <Text style={styles.retryText}>Назад</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0A84FF" />
          <Text style={styles.loadingText}>Загрузка плеера...</Text>
          {title && <Text style={styles.movieTitle}>{title}</Text>}
        </View>
      )}

      {error ? (
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={64} color="#FF453A" />
          <Text style={styles.errorText}>Не удалось загрузить плеер</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setError(false); setLoading(true); }}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <WebIframe
          url={url}
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
        />
      )}

      <Pressable onPress={handleClose} style={styles.closeBtn}>
        <Ionicons name="close-circle" size={36} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'fixed',
    top: 12,
    right: 12,
    zIndex: 9999,
    padding: 4,
  },
  loadingOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    zIndex: 10,
  },
  loadingText: { color: '#8E8E93', marginTop: 12, fontSize: 14 },
  movieTitle: { color: '#fff', marginTop: 8, fontSize: 16, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20 },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingHorizontal: 32,
  },
  errorText: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16 },
  retryBtn: {
    marginTop: 24,
    backgroundColor: '#0A84FF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
