import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const PORTAL_URL = 'https://kinogo.is';

function WebIframe({ url, onLoad, onError }: { url: string; onLoad: () => void; onError: () => void }) {
  return (
    <iframe
      src={url}
      style={{ width: '100%', height: '100%', border: 'none' }}
      onLoad={onLoad}
      onError={onError}
      allow="autoplay; fullscreen"
      title="Видео-портал"
    />
  );
}

export default function PortalScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0A84FF" />
          <Text style={styles.loadingText}>Загрузка портала...</Text>
        </View>
      )}

      {error ? (
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={64} color="#FF453A" />
          <Text style={styles.errorText}>Не удалось загрузить портал</Text>
          <Text style={styles.errorHint}>Проверьте подключение к интернету</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setError(false); setLoading(true); }}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.webviewContainer}>
          {Platform.OS === 'web' ? (
            <WebIframe
              url={PORTAL_URL}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setError(true); }}
            />
          ) : (
            <WebView
              source={{ uri: PORTAL_URL }}
              style={styles.webview}
              onLoadStart={() => { setLoading(true); setError(false); }}
              onLoadEnd={() => setLoading(false)}
              onError={() => { setLoading(false); setError(true); }}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
            />
          )}
        </View>
      )}

      <Pressable
        onPress={handleClose}
        style={styles.closeBtn}
      >
        <Ionicons name="close-circle" size={36} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 100,
    padding: 4,
  },
  webviewContainer: { flex: 1 },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    zIndex: 10,
  },
  loadingText: { color: '#8E8E93', marginTop: 12, fontSize: 14 },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingHorizontal: 32,
  },
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
});
