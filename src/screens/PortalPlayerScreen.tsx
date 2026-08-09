import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  route: any;
  navigation: any;
}

const CURSOR_SPEED = 30;
const CURSOR_SIZE = 24;

export default function PortalPlayerScreen({ route, navigation }: Props) {
  const rawUrl: string = (route.params || {}).url || '';
  const url = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
  const title: string = (route.params || {}).title;
  const [loading, setLoading] = useState(true);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { width, height } = useWindowDimensions();

  // Виртуальный курсор: позиция на экране
  const [cursor, setCursor] = useState({ x: width / 2, y: height / 2 });
  const [cursorVisible, setCursorVisible] = useState(false);
  const cursorTimer = useRef<NodeJS.Timeout | null>(null);
  const moveTimer = useRef<NodeJS.Timeout | null>(null);
  const heldKey = useRef<string | null>(null);

  const handleClose = useCallback(() => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
    heldKey.current = null;
    // Гасим режим портала, иначе index.html продолжит перехватывать стрелки/Back
    // и навигация сломается после возврата на каталог.
    if (typeof window !== 'undefined') {
      (window as any).portalMode = false;
      (window as any).closePortal = null;
    }
    cleanupIframe();
    navigation.goBack();
  }, [navigation]);

  // Регистрируем closePortal, чтобы обработчик «Назад» пульта в index.html
  // (portalMode) мог корректно закрыть плеер. Фокус намеренно оставляем в нашем
  // документе — НЕ делаем iframe.focus(), иначе Back пульта уходит в чужой iframe.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).portalMode = true;
      (window as any).closePortal = handleClose;
    }
    return () => {
      if (typeof window !== 'undefined') {
        (window as any).portalMode = false;
        (window as any).closePortal = null;
      }
    };
  }, [handleClose]);

  const cleanupIframe = useCallback(() => {
    try {
      if (wrapperRef.current && wrapperRef.current.parentNode) {
        wrapperRef.current.parentNode.removeChild(wrapperRef.current);
      }
    } catch (_) { /* ignore */ }
    iframeRef.current = null;
    wrapperRef.current = null;
  }, []);

  // Показать курсор при любом нажатии клавиши, скрыть через 3 сек
  const flashCursor = useCallback(() => {
    setCursorVisible(true);
    if (cursorTimer.current) clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => setCursorVisible(false), 3000);
  }, []);

  // Клик в позиции курсора — dispatch MouseEvent на элемент в этой точке
  const clickAtCursor = useCallback((cursorX: number, cursorY: number) => {
    if (typeof document === 'undefined') return;
    const el = document.elementFromPoint(cursorX, cursorY);
    if (!el) return;
    const events = ['mousedown', 'mouseup', 'click'];
    for (const type of events) {
      el.dispatchEvent(new MouseEvent(type, {
        clientX: cursorX,
        clientY: cursorY,
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
  }, []);

  // Создаём iframe через чистый DOM
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !url) return;

    cleanupIframe();

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9990;overflow:hidden;background:#000;';

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;margin:0;padding:0;';
    iframe.allow = 'autoplay; fullscreen; encrypted-media';
    iframe.sandbox = 'allow-scripts allow-forms allow-popups allow-presentation allow-same-origin';
    iframe.title = 'Плеер';
    iframe.tabIndex = 0;

    wrapper.appendChild(iframe);
    document.body.appendChild(wrapper);

    iframeRef.current = iframe;
    wrapperRef.current = wrapper;

    // Намеренно НЕ вызываем iframe.focus(): при фокусе на чужом cross-origin
    // iframe кнопка «Назад» на пульте уходит в него и не доходит до нашего
    // обработчика (portalMode в index.html). Фокус остаётся в нашем документе.

    return () => {
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      if (moveTimer.current) clearTimeout(moveTimer.current);
      cleanupIframe();
    };
  }, [url, cleanupIframe]);

  // Спиннер убираем по таймеру
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 4000);
    return () => clearTimeout(t);
  }, []);

  // Навигация по пульту
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const kc = (e as any).keyCode;

      // Назад
      if (e.key === 'Escape' || e.key === 'Backspace' || kc === 461 || kc === 10009) {
        e.preventDefault();
        e.stopPropagation();
        if (moveTimer.current) clearTimeout(moveTimer.current);
        heldKey.current = null;
        handleClose();
        return;
      }

      // Стрелки — двигаем виртуальный курсор
      const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (isArrow) {
        e.preventDefault();
        e.stopPropagation();
        flashCursor();

        // Движение при удержании клавиши — запускаем повтор
        if (heldKey.current !== e.key) {
          heldKey.current = e.key;
          if (moveTimer.current) clearTimeout(moveTimer.current);

          const move = () => {
            setCursor((prev) => {
              let nx = prev.x;
              let ny = prev.y;
              if (e.key === 'ArrowUp') ny = Math.max(CURSOR_SPEED, prev.y - CURSOR_SPEED);
              if (e.key === 'ArrowDown') ny = Math.min(height - CURSOR_SPEED, prev.y + CURSOR_SPEED);
              if (e.key === 'ArrowLeft') nx = Math.max(CURSOR_SPEED, prev.x - CURSOR_SPEED);
              if (e.key === 'ArrowRight') nx = Math.min(width - CURSOR_SPEED, prev.x + CURSOR_SPEED);
              return { x: nx, y: ny };
            });
            moveTimer.current = setTimeout(move, 80);
          };
          moveTimer.current = setTimeout(move, 300);
        }
        return;
      }

      // Enter / OK — клик в позиции курсора
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        flashCursor();
        clickAtCursor(cursor.x, cursor.y);
        return;
      }
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      if (e.key === heldKey.current) {
        heldKey.current = null;
        if (moveTimer.current) clearTimeout(moveTimer.current);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handler, true);
      window.addEventListener('keyup', keyUpHandler, true);
      return () => {
        window.removeEventListener('keydown', handler, true);
        window.removeEventListener('keyup', keyUpHandler, true);
      };
    }
  }, [handleClose, cursor, width, height, flashCursor, clickAtCursor]);

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

      {/* Виртуальный курсор — рендерится поверх iframe */}
      {cursorVisible && (
        <View
          style={[
            styles.cursor,
            {
              left: cursor.x - CURSOR_SIZE / 2,
              top: cursor.y - CURSOR_SIZE / 2,
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="cursor" size={CURSOR_SIZE} color="#0A84FF" />
        </View>
      )}

      {/* Подсказка */}
      {cursorVisible && (
        <View style={styles.cursorHint} pointerEvents="none">
          <Text style={styles.cursorHintText}>Стрелки — движение · OK — клик · Назад — выйти</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  cursor: {
    position: 'absolute',
    zIndex: 99999,
  },
  cursorHint: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 99999,
  },
  cursorHintText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  loadingOverlay: {
    position: 'absolute',
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
