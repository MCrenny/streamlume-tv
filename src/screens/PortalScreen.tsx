import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const KINOGO_URL = 'https://kinogo.is/';
const HIDE_DELAY = 5000; // мс бездействия, после которого маска с кнопкой прячется

/**
 * Видео-портал kinogo в <iframe>.
 *
 * Главная идея: клавиатурный фокус ОСТАЁТСЯ в нашем приложении (мы НЕ уводим
 * его в iframe через iframe.focus()). Поэтому:
 *   - кнопка «Назад» на пульте ловится обработчиком в index.html (portalMode)
 *     и корректно возвращает в StreamLume;
 *   - курсор/мышь при этом свободно кликает по kinogo — мышь НЕ требует
 *     клавиатурного фокуса, клики уходят в iframe по позиции указателя.
 *
 * Сверху наложена «маска» с кнопкой «Назад в StreamLume», которая сама
 * прячется (чтобы не перекрывать сайт). Чтобы вызвать кнопку снова, нужно
 * навести курсор на самый верх экрана (тонкая невидимая полоса-ловушка) или
 * нажать любую клавишу.
 */
export default function PortalScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [maskVisible, setMaskVisible] = useState(true); // показываем сразу при входе
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupIframe = useCallback(() => {
    try {
      if (wrapperRef.current && wrapperRef.current.parentNode) {
        wrapperRef.current.parentNode.removeChild(wrapperRef.current);
      }
    } catch (_) { /* ignore */ }
    iframeRef.current = null;
    wrapperRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    (window as any).portalMode = false;
    (window as any).closePortal = null;
    cleanupIframe();
    navigation.goBack();
  }, [navigation, cleanupIframe]);

  // Показать маску с кнопкой и (пере)запустить таймер автоскрытия
  const revealMask = useCallback(() => {
    setMaskVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setMaskVisible(false), HIDE_DELAY);
  }, []);

  // Регистрируем closePortal для обработки Back из index.html
  useEffect(() => {
    (window as any).closePortal = handleClose;
    return () => {
      (window as any).closePortal = null;
    };
  }, [handleClose]);

  // Создаём iframe с kinogo.is через чистый DOM.
  // ВАЖНО: намеренно НЕ вызываем iframe.focus() — иначе клавиатурный фокус
  // уходит в iframe и кнопка «Назад» на пульте перестаёт доходить до нас.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    cleanupIframe();

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9990;overflow:hidden;background:#000;';

    const iframe = document.createElement('iframe');
    iframe.src = KINOGO_URL;
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;margin:0;padding:0;';
    iframe.allow = 'autoplay; fullscreen; encrypted-media';
    iframe.sandbox = 'allow-scripts allow-forms allow-popups allow-presentation allow-same-origin';
    iframe.title = 'Видео-портал';
    // Не задаём tabIndex / не фокусируем — фокус остаётся в родителе.

    wrapper.appendChild(iframe);
    document.body.appendChild(wrapper);

    iframeRef.current = iframe;
    wrapperRef.current = wrapper;

    // Режим портала: index.html пропускает Back в наш closePortal,
    // а стрелки не перехватывает нашей фокус-навигацией.
    (window as any).portalMode = true;

    iframe.onload = () => setLoading(false);

    const fallback = setTimeout(() => setLoading(false), 8000);

    // Стартовый показ маски + таймер автоскрытия
    revealMask();

    return () => {
      clearTimeout(fallback);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      (window as any).portalMode = false;
      cleanupIframe();
    };
  }, [cleanupIframe, revealMask]);

  // Любая клавиша в родителе → снова показать кнопку (работает, пока фокус в родителе)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = () => revealMask();
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [revealMask]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0A84FF" />
          <Text style={styles.loadingText}>Загрузка портала...</Text>
        </View>
      )}

      {/* Тонкая невидимая полоса во весь верх экрана: навели курсор → появилась кнопка.
          Высота минимальна, чтобы почти не перекрывать сайт (только самый верх). */}
      <View
        style={styles.revealStrip}
        onPointerEnter={revealMask}
        onPointerMove={revealMask}
      />

      {/* Маска с кнопкой «Назад» — сама пропадает через HIDE_DELAY */}
      {maskVisible && (
        <View
          style={styles.maskBar}
          onPointerEnter={revealMask}
          onPointerMove={revealMask}
        >
          <TouchableOpacity style={styles.backBtn} onPress={handleClose} activeOpacity={0.85}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
            <Text style={styles.backBtnText}>Назад в StreamLume</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            Кнопка скоро скроется. Наведите курсор на верх экрана — она появится снова. Кнопка «Назад» на пульте тоже выходит.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // Полоса-ловушка наверху: невидимая, но ловит курсор (pointerEvents по умолчанию auto).
  revealStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
    zIndex: 99998,
    // backgroundColor намеренно не задан → прозрачная
  },
  // Маска с кнопкой: появляется над iframe и сама прячется.
  maskBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 99999,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,132,255,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  backBtnText: { color: '#fff', fontSize: 14, fontWeight: '600', marginLeft: 6 },
  hint: {
    flex: 1,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginLeft: 14,
    flexShrink: 1,
  },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', zIndex: 10,
  },
  loadingText: { color: '#8E8E93', marginTop: 12, fontSize: 14 },
});
