import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, TouchableHighlight, Pressable, Alert, Animated, Dimensions, useWindowDimensions, ActivityIndicator, Linking, Modal, ScrollView, Platform, FlatList, NativeModules, DeviceEventEmitter, AppState, AppStateStatus } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useRoute, useNavigation, useIsFocused } from '@react-navigation/native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { fetchEpgForChannel, EpgProgram } from '../utils/epgParser';
import { BackHandler } from 'react-native';



const resolveUrl = (baseUrl: string, relativeUrl: string): string => {
  const [basePath, baseQuery] = baseUrl.split('?');
  let resolved = relativeUrl;
  
  if (!relativeUrl.startsWith('http://') && !relativeUrl.startsWith('https://')) {
    const lastSlashIndex = basePath.lastIndexOf('/');
    const base = lastSlashIndex !== -1 ? basePath.substring(0, lastSlashIndex + 1) : basePath;
    
    if (relativeUrl.startsWith('/')) {
      const match = basePath.match(/^(https?:\/\/[^\/]+)/);
      const host = match ? match[1] : '';
      resolved = host + relativeUrl;
    } else {
      resolved = base + relativeUrl;
    }
  }

  if (baseQuery) {
    if (!resolved.includes('?')) {
      resolved += '?' + baseQuery;
    } else {
      resolved += '&' + baseQuery;
    }
  }
  
  return resolved;
};

interface HLSQuality {
  name: string;
  url: string;
  resolution?: string;
  bandwidth?: number;
}

const parseHlsMasterPlaylist = (masterUrl: string, content: string): HLSQuality[] => {
  const lines = content.split('\n');
  const qualities: HLSQuality[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
      const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : undefined;
      const resolution = resolutionMatch ? resolutionMatch[1] : undefined;
      
      let url = '';
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          url = nextLine;
          break;
        }
      }
      
      if (url) {
        const absoluteUrl = resolveUrl(masterUrl, url);
        let name = '';
        if (resolution) {
          const height = resolution.split('x')[1];
          name = `${height}p`;
          if (height === '1080') name += ' (FHD)';
          else if (height === '720') name += ' (HD)';
          else if (height === '576' || height === '480') name += ' (SD)';
          else if (parseInt(height, 10) <= 360) name += ' (Низкое)';
        } else if (bandwidth) {
          const mbps = (bandwidth / 1000000).toFixed(1);
          name = `${mbps} Mbps`;
        } else {
          name = `Поток ${qualities.length + 1}`;
        }
        
        qualities.push({
          name,
          url: absoluteUrl,
          resolution,
          bandwidth
        });
      }
    }
  }
  
  return qualities.sort((a, b) => {
    if (a.bandwidth && b.bandwidth) return b.bandwidth - a.bandwidth;
    if (a.resolution && b.resolution) {
      const hA = parseInt(a.resolution.split('x')[1], 10);
      const hB = parseInt(b.resolution.split('x')[1], 10);
      return hB - hA;
    }
    return 0;
  });
};

export const PlayerScreen = () => {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  // On web (MSX), useIsFocused can misbehave — treat web as always focused
  const isFocusedNative = useIsFocused();
  
  // Calculate exact pixel dimensions for Tizen WebKit compatibility
  const leftPanelWidth = width * 0.40;
  const playerWidth = leftPanelWidth - 40; // padding 20 * 2
  const playerHeight = playerWidth * (9 / 16);
  useKeepAwake(); // Prevents the screen from turning off while PlayerScreen is active
  const isScreenFocused = Platform.OS === 'web' ? true : isFocusedNative;
  const { url, title, tvgId, channel, initialFullscreen, isArchive } = route.params || {};
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen !== false);
  const isFullscreenRef = useRef(isFullscreen);
  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);
  const { tvgUrl } = useStore();
  const [programs, setPrograms] = useState<EpgProgram[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(true);
  const [activeTab, setActiveTab] = useState<'live' | 'archive'>('live');
  const [isLiveTabFocused, setIsLiveTabFocused] = useState(false);
  const [isArchiveTabFocused, setIsArchiveTabFocused] = useState(false);
  const [isEpgPlayerFocused, setIsEpgPlayerFocused] = useState(false);
  const [currentChannel, setCurrentChannel] = useState(channel || { id: tvgId || url, name: title, url, tvgId, logo: '', group: 'Избранное' });
  const [variantIndex, setVariantIndex] = useState(0);
  const variants = currentChannel?.variants || [currentChannel];
  const currentVariant = variants[variantIndex] || variants[0];
  
  const videoRef = useRef<any>(null);
  const { favorites, toggleFavorite, moveFavorite, playNextChannel, playPrevChannel, isAuthorized, activationKey, isFreeMode, trialStartDate } = useStore();
  const isTrialActive = trialStartDate != null && (Date.now() - trialStartDate <= 3 * 24 * 60 * 60 * 1000);
  const isPremium = isAuthorized || isTrialActive;



  const [isBackFocused, setIsBackFocused] = useState(false);
  const [isFavoriteFocused, setIsFavoriteFocused] = useState(false);
  const [isSortUpFocused, setIsSortUpFocused] = useState(false);
  const [isSortDownFocused, setIsSortDownFocused] = useState(false);
  const [isAspectFocused, setIsAspectFocused] = useState(false);
  const [isExpandFocused, setIsExpandFocused] = useState(false);
  const [isLeftArrowFocused, setIsLeftArrowFocused] = useState(false);
  const [isRightArrowFocused, setIsRightArrowFocused] = useState(false);
  const [isPlayFocused, setIsPlayFocused] = useState(false);
  const [isPrevFocused, setIsPrevFocused] = useState(false);
  const [isNextFocused, setIsNextFocused] = useState(false);
  
  const isFavorite = favorites.some(f => f.id === currentChannel.id);
  // Позиция текущего канала в списке Избранного (без 18+ контента)
  const cleanFavorites = favorites.filter(f => f.id);
  const favIdx = cleanFavorites.findIndex(f => f.id === currentChannel.id);
  
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isErrorReconnecting, setIsErrorReconnecting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showPremiumToast = () => {
    setToastMessage("Режим доступен только в Премиум подписке.");
    setTimeout(() => setToastMessage(null), 3000);
  };

  const withPremium = (action: () => void) => {
    return () => {
      if (!isPremium) {
        showPremiumToast();
      }
      action();
    };
  };

  const handleToggleFavorite = () => {
    if (!isPremium) {
      Alert.alert(
        '🔒 Функция PRO',
        'Избранное доступно только в PRO-версии StreamLume.\n\nПолучите ключ через @StreameLumeBot.',
        [{ text: 'Понятно', style: 'cancel' }]
      );
      return;
    }
    toggleFavorite(currentChannel);
  };

  // HLS Quality states
  const [hlsQualities, setHlsQualities] = useState<HLSQuality[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<HLSQuality | null>(null);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [isQualityBtnFocused, setIsQualityBtnFocused] = useState(false);
  const [focusedQualityIndex, setFocusedQualityIndex] = useState<number | null>(null);
  const [isCloseQualityFocused, setIsCloseQualityFocused] = useState(false);

  // Aspect‑ratio handling (default, 16:9, 16:10, 4:3, 5:4, 1.85:1, 2.35:1)
  const aspectRatios = ['default', '16:9', '16:10', '4:3', '5:4', '1.85:1', '2.35:1'];
  const [aspectIndex, setAspectIndex] = useState(0);
  const currentAspect = aspectRatios[aspectIndex];
  const toggleAspect = () => {
    const nextIndex = (aspectIndex + 1) % aspectRatios.length;
    setAspectIndex(nextIndex);
    const nextAspect = aspectRatios[nextIndex];
    const aspectLabel = nextAspect === 'default' ? 'Авто' : nextAspect;
    setToastMessage(`Соотношение сторон: ${aspectLabel}`);
    setTimeout(() => setToastMessage(null), 2000);
  };
  const [playerKey, setPlayerKey] = useState(0);
  const [bufferingStart, setBufferingStart] = useState<number | null>(null);
  const [stableStart, setStableStart] = useState<number | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);





  useEffect(() => {
    const backAction = () => {
      if (isFullscreenRef.current) {
        if (initialFullscreen === false) {
          setIsFullscreen(false);
          return true;
        }
      }
      navigation.goBack();
      return true;
    };

    let backHandler: any = null;
    let webKeyDownHandler: any = null;

    if (Platform.OS !== 'web') {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    } else {
      webKeyDownHandler = (e: any) => {
        // Wake up controls on any key press in fullscreen
        if (isFullscreenRef.current) {
          resetTimer();
        }

        // 8 = Backspace, 27 = Escape, 461 = LG Back, 10009 = Tizen Return
        if (e.keyCode === 8 || e.keyCode === 27 || e.keyCode === 461 || e.keyCode === 10009) {
          e.preventDefault();
          e.stopPropagation();
          backAction();
        }
      };
      window.addEventListener('keydown', webKeyDownHandler, { capture: true });
    }

    resetTimer();

    return () => {
      if (Platform.OS !== 'web') {
        ScreenOrientation.unlockAsync();
      } else {
        if (webKeyDownHandler) {
          window.removeEventListener('keydown', webKeyDownHandler, { capture: true });
        }
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      if (backHandler) backHandler.remove();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);


  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    
    setShowControls(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    timerRef.current = setTimeout(() => {
      hideControls();
    }, 4000);
  };

  const hideControls = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 500,
      useNativeDriver: true,
    }).start(() => setShowControls(false));
  };

  const toggleControls = () => {
    if (showControls) {
      hideControls();
    } else {
      resetTimer();
    }
  };

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
    resetTimer();
  };

  useEffect(() => {
    setSelectedQuality(null);
    setHlsQualities([]);

    const streamUrl = currentVariant?.url;
    if (!streamUrl) return;

    if (streamUrl.toLowerCase().includes('.m3u8')) {
      const loadHls = async () => {
        try {
          console.log(`[DEBUG] Fetching HLS master playlist for analysis: ${streamUrl}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(streamUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Televizo/1.9.3.4 (Linux;Android 11)', ...(currentVariant?.headers || {}) }
          });
          clearTimeout(timeoutId);

          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          const parsed = parseHlsMasterPlaylist(streamUrl, text);
          console.log(`[DEBUG] Found ${parsed.length} HLS quality variants`);
          setHlsQualities(parsed);
        } catch (err) {
          console.warn("[Player] Failed to load HLS master playlist for quality selection:", err);
        }
      };

      loadHls();
    }
  }, [currentVariant]);

  useEffect(() => {
    if (!isFullscreen && isScreenFocused) {
      const timer = setTimeout(() => {
        const btn = document.getElementById('player-expand-btn');
        if (btn) btn.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isFullscreen, isScreenFocused]);

  const selectQuality = (quality: HLSQuality | null) => {
    setSelectedQuality(quality);
    setPlayerKey(prev => prev + 1);
    setIsErrorReconnecting(false);
    setIsBuffering(true);
    setIsInitialLoading(true);
    setShowQualityModal(false);
    resetTimer();
  };

  const handleNext = () => {
    const nextCh = playNextChannel();
    if (nextCh) {
      setCurrentChannel(nextCh);
      setVariantIndex(0);
      setBufferingStart(null);
      setStableStart(null);
      setIsBuffering(true);
      resetTimer();
    }
  };

  const handlePrev = () => {
    const prevCh = playPrevChannel();
    if (prevCh) {
      setCurrentChannel(prevCh);
      setVariantIndex(0);
      setBufferingStart(null);
      setStableStart(null);
      setIsBuffering(true);
      resetTimer();
    }
  };

  const playExternally = async () => {
    const streamUrl = currentVariant?.url;
    if (!streamUrl) return;

    // Ставим внутреннее видео на паузу перед запуском внешнего плеера
    if (videoRef.current) {
      try {
        await videoRef.current.pauseAsync();
        setIsPlaying(false);
      } catch (e) {
        console.warn("Failed to pause video", e);
      }
    }

    if (typeof window !== 'undefined' && window.MSX && window.MSX.video) {
      window.MSX.video.play(streamUrl);
    } else {
      window.open(streamUrl, '_blank');
    }
  };

  const handleVideoError = (e?: any) => {
    console.warn("Video Error: ", e);
    setIsBuffering(false);
    setIsErrorReconnecting(true);
    console.log("[Player] Auto-reconnecting due to error...");
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = setTimeout(() => {
      setPlayerKey(prev => prev + 1);
    }, 3000);
  };

  const lastPositionRef = useRef<number>(0);
  const lastPositionTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    setPlayerKey(0);
    setIsErrorReconnecting(false);
    setIsBuffering(true);
    setIsInitialLoading(true);
    lastPositionRef.current = 0;
    lastPositionTimeRef.current = Date.now();
  }, [currentChannel, variantIndex]);

  useEffect(() => {
    let bufferingTimer: NodeJS.Timeout;
    if (isBuffering && isPlaying) {
      bufferingTimer = setTimeout(() => {
        console.log("[Player] Buffering timeout! Forcing reconnect...");
        handleVideoError(new Error("Buffering timeout"));
      }, 10000); // 10 seconds of buffering -> reconnect
    }
    return () => {
      if (bufferingTimer) clearTimeout(bufferingTimer);
    };
  }, [isBuffering, isPlaying]);

  // Watchdog removed because it breaks live IPTV streams (positionMillis stays 0)

  useEffect(() => {
    const loadEpg = async () => {
      if (!tvgUrl || (!tvgId && !currentChannel?.tvgName && !currentChannel?.name)) {
        setLoadingEpg(false);
        return;
      }
      setLoadingEpg(true);
      const searchIds = [tvgId, currentChannel?.tvgName, currentChannel?.name].filter(Boolean);
      const data = await fetchEpgForChannel(tvgUrl, searchIds as string[]);
      setPrograms(data);
      setLoadingEpg(false);
    };
    loadEpg();
  }, [tvgUrl, tvgId, currentChannel]);

  const now = new Date();
  const livePrograms = programs.filter(p => p.stop > now || (p.start <= now && p.stop >= now));
  const archivePrograms = programs.filter(p => p.stop <= now).reverse();
  const currentProgram = programs.find(p => p.start <= now && p.stop >= now);

  const getArchiveUrl = (program: EpgProgram) => {
    const startUnix = Math.floor(program.start.getTime() / 1000);
    const stopUnix = Math.floor(program.stop.getTime() / 1000);
    let baseUrl = currentChannel?.url || url;
    if (currentChannel?.catchupSource) {
        const duration = stopUnix - startUnix;
        baseUrl = currentChannel.catchupSource
            .replace('{catchup-id}', currentChannel.tvgId || '')
            .replace('{start}', startUnix.toString())
            .replace('{duration}', duration.toString());
    } else if (currentChannel?.catchup === 'append') {
        const separator = baseUrl.includes('?') ? '&' : '?';
        baseUrl = `${baseUrl}${separator}utc=${startUnix}&lutc=${stopUnix}`;
    }
    return baseUrl;
  };

  const formatTime = (d: Date) => {
    const today = new Date();
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.getDate() === tomorrow.getDate() && d.getMonth() === tomorrow.getMonth();

    if (isToday) return 'Сегодня';
    if (isYesterday) return 'Вчера';
    if (isTomorrow) return 'Завтра';
    return `${d.getDate()}.${d.getMonth() + 1}`;
  };

  const playArchive = (program: EpgProgram) => {
      const archUrl = getArchiveUrl(program);
      // @ts-ignore
      navigation.navigate('Player', {
         url: archUrl,
         title: `${currentChannel.name} - ${program.title}`,
         tvgId,
         channel: currentChannel,
         isArchive: true,
         initialFullscreen: true
      });
  };

  const renderProgramItem = ({ item, index }: { item: EpgProgram, index: number }) => {
    const isCurrent = item === currentProgram;
    const isArchiveTab = activeTab === 'archive';
    return (
      <Pressable
        style={(state: any) => [
          styles.programItem,
          isCurrent && styles.programItemCurrent,
          state.focused && styles.programItemFocused
        ]}
        onPress={() => {
          if (isArchiveTab) {
            playArchive(item);
          } else if (isCurrent) {
            setIsFullscreen(true);
          }
        }}
        focusable={true}
        accessible={true}
      >
        {(state: any) => (
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={[styles.programTitle, isCurrent && styles.programTitleCurrent, state.focused && styles.textFocused]} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Text style={[styles.programTime, state.focused && styles.textFocused]}>
                {isCurrent ? 'Сейчас' : formatTime(item.start)} / {item.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — {item.stop.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
              {isCurrent && <Text style={styles.nowPlayingText}>В эфире</Text>}
            </View>
          </View>
        )}
      </Pressable>
    );
  };

  const touchStartX = useRef(0);
  const onTouchStart = (e: any) => { 
    touchStartX.current = e.nativeEvent.pageX; 
  };
  
  const onTouchEnd = (e: any) => {
    const touchEndX = e.nativeEvent.pageX;
    const distance = touchStartX.current - touchEndX;
    
    if (distance > 50) {
      handleNext(); // swipe left
    } else if (e.nativeEvent.pageX - touchStartX.current > 50) {
      handlePrev(); // swipe right
    } else {
      toggleControls(); // tap
    }
  };

  const getResizeMode = (aspect: string) => {
    if (aspect === 'default') {
      return ResizeMode.CONTAIN;
    }
    return ResizeMode.STRETCH;
  };





  return (
    <View style={[styles.container, !isFullscreen && { flexDirection: 'row' }]} onTouchStart={isFullscreen ? onTouchStart : undefined} onTouchEnd={isFullscreen ? onTouchEnd : undefined}>
        <StatusBar hidden={true} />
        
        <View style={isFullscreen ? StyleSheet.absoluteFill : styles.leftPanel}>
          <View 
            style={[
              isFullscreen 
                ? [StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }] 
                : [styles.playerContainer, { width: playerWidth, height: playerHeight }]
            ]}
          >
            
            <View 
              pointerEvents={isFullscreen ? "auto" : "none"} 
              style={[StyleSheet.absoluteFill, isFullscreen && { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }]}
            >
              <Video
                key={`${selectedQuality ? selectedQuality.url : (currentVariant?.url || '')}_${playerKey}`}
                ref={videoRef}
                style={[StyleSheet.absoluteFill]}
                source={{
                  uri: selectedQuality ? selectedQuality.url : (currentVariant?.url || ''),
                  headers: { 'User-Agent': 'Televizo/1.9.3.4 (Linux;Android 11)', ...(currentVariant?.headers || {}) }
                }}
                shouldPlay={isPlaying}
                resizeMode={getResizeMode(currentAspect)}
                onPlaybackStatusUpdate={(status: any) => {
                  if (status.isLoaded) {
                    setIsErrorReconnecting(false);
                    setIsBuffering(status.isBuffering);
                    
                    if (status.isPlaying && status.positionMillis !== undefined) {
                      if (status.positionMillis !== lastPositionRef.current) {
                        lastPositionRef.current = status.positionMillis;
                        lastPositionTimeRef.current = Date.now();
                      }
                    }

                    if (status.didJustFinish) {
                      handleNext();
                    }
                    if (status.isPlaying) {
                      setIsInitialLoading(false);
                      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    }
                  } else if (status.error) {
                    console.error("ExoPlayer error: ", status.error);
                    handleVideoError(status.error);
                  }
                }}
                onError={handleVideoError}
              />
            </View>
          </View>

          {!isFullscreen && (
            <>
              <View style={[styles.controlsRow, { justifyContent: 'center' }]}>
                <Pressable 
                  style={[styles.iconBtn, {marginHorizontal: 4}, isPrevFocused && styles.iconBtnFocused]}
                  onPress={handlePrev}
                  onFocus={() => setIsPrevFocused(true)}
                  onBlur={() => setIsPrevFocused(false)}
                  focusable={true}
                >
                  <Ionicons name="play-skip-back" size={24} color={isPrevFocused ? "#000" : "#fff"} />
                </Pressable>

                <Pressable 
                  style={[styles.iconBtn, {marginHorizontal: 4}, isPlayFocused && styles.iconBtnFocused]}
                  onPress={togglePlayPause}
                  onFocus={() => setIsPlayFocused(true)}
                  onBlur={() => setIsPlayFocused(false)}
                  focusable={true}
                >
                  <Ionicons name={isPlaying ? "pause" : "play"} size={24} color={isPlayFocused ? "#000" : "#fff"} />
                </Pressable>

                <Pressable 
                  style={[styles.iconBtn, {marginHorizontal: 4}, isNextFocused && styles.iconBtnFocused]}
                  onPress={handleNext}
                  onFocus={() => setIsNextFocused(true)}
                  onBlur={() => setIsNextFocused(false)}
                  focusable={true}
                >
                  <Ionicons name="play-skip-forward" size={24} color={isNextFocused ? "#000" : "#fff"} />
                </Pressable>

                <Pressable 
                  style={[styles.iconBtn, {marginHorizontal: 4}, isFavoriteFocused && styles.iconBtnFocused]}
                  onPress={handleToggleFavorite}
                  onFocus={() => setIsFavoriteFocused(true)}
                  onBlur={() => setIsFavoriteFocused(false)}
                  focusable={true}
                >
                  <Ionicons name={isFavorite ? "star" : "star-outline"} size={24} color={isFavoriteFocused ? "#000" : (isFavorite ? "#FFD700" : "#fff")} />
                </Pressable>

                {/* Кнопки сортировки в Избранном — видны только когда канал в Избранном */}
                {isFavorite && (
                  <>
                    <Pressable
                      style={[
                        styles.iconBtn,
                        {marginHorizontal: 4},
                        isSortUpFocused && styles.iconBtnFocused,
                        favIdx <= 0 && { opacity: 0.35 }
                      ]}
                      onPress={() => {
                        if (favIdx > 0) {
                          moveFavorite(currentChannel.id, 'up');
                        }
                      }}
                      onFocus={() => setIsSortUpFocused(true)}
                      onBlur={() => setIsSortUpFocused(false)}
                      focusable={true}
                    >
                      <Ionicons name="chevron-up" size={24} color={isSortUpFocused ? "#000" : "#FFD700"} />
                    </Pressable>

                    <Pressable
                      style={[
                        styles.iconBtn,
                        {marginHorizontal: 4},
                        isSortDownFocused && styles.iconBtnFocused,
                        favIdx >= cleanFavorites.length - 1 && { opacity: 0.35 }
                      ]}
                      onPress={() => {
                        if (favIdx < cleanFavorites.length - 1) {
                          moveFavorite(currentChannel.id, 'down');
                        }
                      }}
                      onFocus={() => setIsSortDownFocused(true)}
                      onBlur={() => setIsSortDownFocused(false)}
                      focusable={true}
                    >
                      <Ionicons name="chevron-down" size={24} color={isSortDownFocused ? "#000" : "#FFD700"} />
                    </Pressable>
                  </>
                )}

                <Pressable 
                  style={[styles.iconBtn, {marginHorizontal: 4}, isExpandFocused && styles.iconBtnFocused]}
                  onPress={() => setIsFullscreen(true)}
                  onFocus={() => setIsExpandFocused(true)}
                  onBlur={() => setIsExpandFocused(false)}
                  focusable={true}
                  // @ts-ignore
                  hasTVPreferredFocus={isScreenFocused}
                  nativeID="player-expand-btn"
                >
                  <Ionicons name="expand" size={24} color={isExpandFocused ? "#000" : "#fff"} />
                </Pressable>
              </View>
              
              <View style={styles.channelInfo}>
                <Text style={styles.channelTitle} numberOfLines={1}>{currentChannel.name}</Text>
                {currentProgram ? (
                  <View>
                    <Text style={styles.currentProgramTitle} numberOfLines={2}>{currentProgram.title}</Text>
                    <Text style={styles.currentProgramTime}>
                      {currentProgram.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {currentProgram.stop.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.noDataText}>Нет данных о текущей передаче</Text>
                )}
              </View>
            </>
          )}

          {isFullscreen && showControls ? (
            <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
              {/* Top Bar */}
              <LinearGradient
                colors={['rgba(0,0,0,0.8)', 'transparent']}
                style={styles.topBar}
              >
                <Pressable 
                  style={[
                    styles.iconBtn, 
                    isBackFocused && styles.iconBtnFocused
                  ]} 
                  onPress={() => { if (initialFullscreen === false) { setIsFullscreen(false); } else { navigation.goBack(); } }}
                  onFocus={() => {
                    setIsBackFocused(true);
                    resetTimer();
                  }}
                  onBlur={() => setIsBackFocused(false)}
                  focusable={true}
                  accessible={true}
                >
                  <Ionicons name="chevron-back" size={30} color={isBackFocused ? "#000000" : "#ffffff"} />
                </Pressable>

                <View style={styles.titleContainer}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.title} numberOfLines={1}>{currentChannel.name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    {isErrorReconnecting ? (
                      <>
                        <ActivityIndicator size="small" color="#FF3B30" style={{ marginRight: 6 }} />
                        <Text style={[styles.liveBadge, { marginTop: 0, color: '#FF3B30' }]}>ОШИБКА...</Text>
                      </>
                    ) : (isBuffering || isInitialLoading) ? (
                      <>
                        <ActivityIndicator size="small" color="#FFCC00" style={{ marginRight: 6 }} />
                        <Text style={[styles.liveBadge, { marginTop: 0, color: '#FFCC00' }]}>ЗАГРУЗКА...</Text>
                      </>
                    ) : (
                      <Text style={[styles.liveBadge, { marginTop: 0, color: '#34C759' }]}>● {isArchive ? 'АРХИВ' : 'LIVE'}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.topRightControls}>
                  {/* Removed Play and Favorite buttons from Top Bar */}
                  
                  <Pressable 
                    style={[
                      styles.iconBtn, 
                      {marginRight: 10}, 
                      isAspectFocused && styles.iconBtnFocused
                    ]} 
                    onPress={toggleAspect}
                    onFocus={() => {
                      setIsAspectFocused(true);
                      resetTimer();
                    }}
                    onBlur={() => setIsAspectFocused(false)}
                    focusable={true}
                    accessible={true}
                  >
                    <Ionicons 
                      name={currentAspect === 'auto' ? 'resize' : 'crop'} 
                      size={24} 
                      color={isAspectFocused ? "#000000" : "#ffffff"} 
                    />
                  </Pressable>


                  {!Platform.isTV && (
                    <Pressable 
                      style={[
                        styles.iconBtn, 
                        {marginRight: 10}, 
                        isQualityBtnFocused && styles.iconBtnFocused
                      ]} 
                      onPress={() => {
                        setShowQualityModal(true);
                        resetTimer();
                      }}
                      onFocus={() => {
                        setIsQualityBtnFocused(true);
                        resetTimer();
                      }}
                      onBlur={() => setIsQualityBtnFocused(false)}
                      focusable={true}
                      accessible={true}
                    >
                      <Ionicons 
                        name="settings-outline" 
                        size={24} 
                        color={isQualityBtnFocused ? "#000000" : "#ffffff"} 
                      />
                    </Pressable>
                  )}

                  <Pressable 
                    style={[
                      styles.iconBtn, 
                      isExpandFocused && styles.iconBtnFocused
                    ]} 
                    onPress={playExternally}
                    onFocus={() => {
                      setIsExpandFocused(true);
                      resetTimer();
                    }}
                    onBlur={() => setIsExpandFocused(false)}
                    focusable={true}
                    accessible={true}
                  >
                    <Ionicons name="open-outline" size={24} color={isExpandFocused ? "#000000" : "#ffffff"} />
                  </Pressable>
                </View>
              </LinearGradient>

              {/* Center Arrows */}
              <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 30 }]} pointerEvents="box-none">
                <Pressable
                  style={[
                    styles.iconBtn,
                    { backgroundColor: 'rgba(0,0,0,0.5)', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
                    isLeftArrowFocused && styles.iconBtnFocused
                  ]}
                  onPress={() => {
                    handlePrev();
                    resetTimer();
                  }}
                  onFocus={() => {
                    setIsLeftArrowFocused(true);
                    resetTimer();
                  }}
                  onBlur={() => setIsLeftArrowFocused(false)}
                  focusable={true}
                  accessible={true}
                >
                  <Ionicons name="chevron-back" size={40} color={isLeftArrowFocused ? "#000000" : "#ffffff"} />
                </Pressable>

                <Pressable
                  style={[
                    styles.iconBtn,
                    { backgroundColor: 'rgba(0,0,0,0.5)', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
                    isRightArrowFocused && styles.iconBtnFocused
                  ]}
                  onPress={() => {
                    handleNext();
                    resetTimer();
                  }}
                  onFocus={() => {
                    setIsRightArrowFocused(true);
                    resetTimer();
                  }}
                  onBlur={() => setIsRightArrowFocused(false)}
                  focusable={true}
                  accessible={true}
                >
                  <Ionicons name="chevron-forward" size={40} color={isRightArrowFocused ? "#000000" : "#ffffff"} />
                </Pressable>
              </View>

              {/* Bottom Info Bar */}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.8)']}
                style={styles.bottomBar}
              >
                <View style={styles.epgInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable 
                      style={[
                        styles.iconBtn, 
                        {marginRight: 15}, 
                        isPlayFocused && styles.iconBtnFocused
                      ]} 
                      onPress={togglePlayPause}
                      onFocus={() => {
                        setIsPlayFocused(true);
                        resetTimer();
                      }}
                      onBlur={() => setIsPlayFocused(false)}
                      focusable={true}
                      accessible={true}
                      // @ts-ignore
                      hasTVPreferredFocus={isScreenFocused}
                    >
                      <Ionicons name={isPlaying ? "pause" : "play"} size={28} color={isPlayFocused ? "#000000" : "#ffffff"} />
                    </Pressable>

                    <Pressable 
                      style={[
                        styles.iconBtn, 
                        {marginRight: 15}, 
                        isFavoriteFocused && styles.iconBtnFocused
                      ]} 
                      onPress={handleToggleFavorite}
                      onFocus={() => {
                        setIsFavoriteFocused(true);
                        resetTimer();
                      }}
                      onBlur={() => setIsFavoriteFocused(false)}
                      focusable={true}
                      accessible={true}
                    >
                      <Ionicons 
                        name={isFavorite ? "star" : "star-outline"} 
                        size={28} 
                        color={isFavoriteFocused ? "#000000" : (isFavorite ? "#FFD700" : "#ffffff")} 
                      />
                    </Pressable>

                    <Pressable 
                      style={[
                        styles.iconBtn, 
                        {marginRight: 15}, 
                        isSortUpFocused && styles.iconBtnFocused
                      ]} 
                      onPress={() => {
                        if (isArchive) {
                          playNextArchive();
                        } else {
                          const currentList = activeTab === 'live' ? livePrograms : archivePrograms;
                          const currentIndex = currentList.findIndex(p => p.id === currentChannel.id);
                          if (currentIndex > 0) {
                            onChannelSelect(currentList[currentIndex - 1]);
                          }
                        }
                      }}
                      onFocus={() => {
                        setIsSortUpFocused(true);
                        resetTimer();
                      }}
                      onBlur={() => setIsSortUpFocused(false)}
                      focusable={true}
                      accessible={true}
                    >
                      <Ionicons name="chevron-up" size={28} color={isSortUpFocused ? "#000000" : "#ffffff"} />
                    </Pressable>

                    <Pressable 
                      style={[
                        styles.iconBtn, 
                        isSortDownFocused && styles.iconBtnFocused
                      ]} 
                      onPress={() => {
                        if (isArchive) {
                          playPrevArchive();
                        } else {
                          const currentList = activeTab === 'live' ? livePrograms : archivePrograms;
                          const currentIndex = currentList.findIndex(p => p.id === currentChannel.id);
                          if (currentIndex < currentList.length - 1) {
                            onChannelSelect(currentList[currentIndex + 1]);
                          }
                        }
                      }}
                      onFocus={() => {
                        setIsSortDownFocused(true);
                        resetTimer();
                      }}
                      onBlur={() => setIsSortDownFocused(false)}
                      focusable={true}
                      accessible={true}
                    >
                      <Ionicons name="chevron-down" size={28} color={isSortDownFocused ? "#000000" : "#ffffff"} />
                    </Pressable>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>
          ) : isFullscreen ? (
            <TouchableHighlight 
              style={StyleSheet.absoluteFill} 
              onPress={resetTimer}
              focusable={true}
              accessible={true}
              // @ts-ignore
              hasTVPreferredFocus={isScreenFocused}
              underlayColor="transparent"
            >
              <View style={StyleSheet.absoluteFill} />
            </TouchableHighlight>
          ) : null}
        </View>

        {!isFullscreen && (
          <View style={styles.rightPanel}>
            <View style={styles.tabContainer}>
              <Pressable 
                style={[styles.tabBtn, activeTab === 'live' && styles.tabBtnActive, isLiveTabFocused && styles.tabBtnFocused]}
                onPress={() => setActiveTab('live')}
                onFocus={() => setIsLiveTabFocused(true)}
                onBlur={() => setIsLiveTabFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={[styles.tabText, activeTab === 'live' && styles.tabTextActive, isLiveTabFocused && styles.textFocused]}>Прямой эфир</Text>
              </Pressable>
              <Pressable 
                style={[styles.tabBtn, activeTab === 'archive' && styles.tabBtnActive, isArchiveTabFocused && styles.tabBtnFocused]}
                onPress={() => setActiveTab('archive')}
                onFocus={() => setIsArchiveTabFocused(true)}
                onBlur={() => setIsArchiveTabFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={[styles.tabText, activeTab === 'archive' && styles.tabTextActive, isArchiveTabFocused && styles.textFocused]}>Архив</Text>
              </Pressable>
            </View>

            {loadingEpg ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0A84FF" />
                <Text style={styles.loadingText}>Программа обновляется...</Text>
              </View>
            ) : (
              <FlatList
                data={activeTab === 'live' ? livePrograms : archivePrograms}
                keyExtractor={(item: any) => item.id}
                renderItem={renderProgramItem}
                contentContainerStyle={styles.listContent}
                removeClippedSubviews={true}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.noDataText}>
                      {activeTab === 'archive' ? 'Архив недоступен' : 'Нет данных программы передач'}
                    </Text>
                  </View>
                }
              />
            )}
          </View>
        )}

        {toastMessage && (
          <Animated.View style={styles.toastContainer}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}

      <Modal visible={showQualityModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Качество видео</Text>
            {hlsQualities.length > 0 ? (
              <ScrollView style={{ maxHeight: 300 }}>
                <TouchableOpacity
                  style={[
                    styles.variantBtn,
                    focusedQualityIndex === -1 && styles.variantBtnFocused,
                    selectedQuality === null && styles.variantBtnActive
                  ]}
                  onPress={() => selectQuality(null)}
                  onFocus={() => setFocusedQualityIndex(-1)}
                  onBlur={() => setFocusedQualityIndex(null)}
                  focusable={true}
                  accessible={true}
                >
                  <Text
                    style={[
                      styles.variantText,
                      focusedQualityIndex === -1 && styles.variantTextFocused,
                      selectedQuality === null && styles.variantTextActive
                    ]}
                  >
                    Автоматически (HLS ABR) {selectedQuality === null ? ' ✓' : ''}
                  </Text>
                </TouchableOpacity>

                {hlsQualities.map((qual, index) => {
                  const isItemFocused = focusedQualityIndex === index;
                  const isCurrent = selectedQuality?.url === qual.url;
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.variantBtn,
                        isItemFocused && styles.variantBtnFocused,
                        isCurrent && styles.variantBtnActive
                      ]}
                      onPress={() => selectQuality(qual)}
                      onFocus={() => setFocusedQualityIndex(index)}
                      onBlur={() => setFocusedQualityIndex(null)}
                      focusable={true}
                      accessible={true}
                    >
                      <Text
                        style={[
                          styles.variantText,
                          isItemFocused && styles.variantTextFocused,
                          isCurrent && styles.variantTextActive
                        ]}
                      >
                        {qual.name} {isCurrent ? ' ✓' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={{ marginVertical: 15, alignItems: 'center' }}>
                <Ionicons name="information-circle-outline" size={48} color="#0A84FF" style={{ marginBottom: 10 }} />
                <Text style={styles.infoText}>Для этого канала доступен один поток</Text>
                <Text style={styles.infoSubText}>
                  Качество видео регулируется автоматически (HLS Adaptive Bitrate) в зависимости от скорости вашего интернет-соединения.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.modalBtnCancel,
                { marginTop: 20 },
                isCloseQualityFocused && styles.modalBtnCancelFocused
              ]}
              onPress={() => {
                setShowQualityModal(false);
                setIsCloseQualityFocused(false);
              }}
              onFocus={() => setIsCloseQualityFocused(true)}
              onBlur={() => setIsCloseQualityFocused(false)}
              focusable={true}
              accessible={true}
            >
              <Text style={[styles.modalBtnText, isCloseQualityFocused && styles.modalBtnTextFocused]}>
                Закрыть
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
};

const styles = StyleSheet.create({
  leftPanel: {
    width: '40%',
    backgroundColor: '#0a0a0c',
    borderRightWidth: 1,
    borderRightColor: '#1c1c1e',
    padding: 20,
    justifyContent: 'center',
  },
  rightPanel: {
    width: '60%',
    backgroundColor: '#111113',
  },
  playerContainer: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#3a3a3c',
    marginBottom: 10,
  },
  playerContainerFocused: {
    borderColor: '#fff',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 5,
  },
  channelInfo: {
    paddingHorizontal: 10,
  },
  channelTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  currentProgramTitle: {
    fontSize: 16,
    color: '#e5e5ea',
    marginBottom: 5,
  },
  currentProgramTime: {
    fontSize: 14,
    color: '#8e8e93',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
  },
  tabBtnActive: {
    backgroundColor: '#0A84FF',
  },
  tabBtnFocused: {
    backgroundColor: '#fff',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8e8e93',
  },
  tabTextActive: {
    color: '#fff',
  },
  textFocused: {
    color: '#000',
  },
  listContent: {
    padding: 15,
  },
  programItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
    borderRadius: 8,
  },
  programItemCurrent: {
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#0A84FF',
  },
  programItemFocused: {
    backgroundColor: '#fff',
  },
  programTime: {
    width: 60,
    fontSize: 15,
    color: '#8e8e93',
    fontWeight: '600',
  },
  programTitle: {
    fontSize: 15,
    color: '#e5e5ea',
  },
  programTitleCurrent: {
    color: '#0A84FF',
    fontWeight: 'bold',
  },
  nowPlayingText: {
    fontSize: 12,
    color: '#34C759',
    marginTop: 4,
    fontWeight: 'bold',
  },
  emptyContainer: {
    padding: 30,
    alignItems: 'center',
  },
  noDataText: {
    color: '#8e8e93',
    fontSize: 15,
  },

  container: {
    flex: 1,
    backgroundColor: '#000',
    width: '100%',
    height: '100%',
  },
  video: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  bottomBar: {
    paddingHorizontal: 30,
    paddingBottom: 20,
    paddingTop: 60,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 20,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  topRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveBadge: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 2,
  },
  iconBtn: {
    padding: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  iconBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    borderWidth: 2,
    transform: [{ scale: 1.1 }],
  },
  centerControls: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainPlayBtn: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(10, 132, 255, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: 'rgba(10, 132, 255, 0.8)',
  },
  mainPlayBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    borderWidth: 2,
    transform: [{ scale: 1.1 }],
  },
  epgInfo: {
    flex: 1,
    marginBottom: 10,
  },
  epgTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  epgProgram: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    marginTop: 10,
    width: '60%',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#0A84FF',
    borderRadius: 2,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bufferingText: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 1,
  },
  toastContainer: {
    position: 'absolute',
    top: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(10, 132, 255, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 50,
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  loadingText: {
    color: '#ffffff',
    marginTop: 10,
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorBtnTextFocused: {
    color: '#121212',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2C2C2E',
    width: '90%',
    maxWidth: 450,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  variantBtn: {
    backgroundColor: '#2C2C2E',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  variantBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#0A84FF',
  },
  variantBtnActive: {
    borderColor: '#0A84FF',
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
  },
  variantText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  variantTextFocused: {
    color: '#121212',
    fontWeight: 'bold',
  },
  variantTextActive: {
    color: '#0A84FF',
    fontWeight: 'bold',
  },
  modalBtnCancel: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    backgroundColor: '#2C2C2E',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modalBtnCancelFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#FF3B30',
  },
  modalBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalBtnTextFocused: {
    color: '#121212',
  },
  infoText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  infoSubText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  }
});
