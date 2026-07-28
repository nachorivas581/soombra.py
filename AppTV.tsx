// ============================================================
// Código completo de AppTV.tsx
// ============================================================

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  TextInput,
  StatusBar,
  Dimensions,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Image,
  Platform,
  RefreshControl,
  Modal,
  Alert,
  Animated,
  Easing,
  Linking,
  TVEventHandler,
  findNodeHandle,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { XMLParser } from 'fast-xml-parser';

// ============================================================
// CONFIGURACIÓN
// ============================================================
const dims = Dimensions.get('window') || { width: 1280, height: 720 };
const { width: W, height: H } = dims;
const isTV = Platform.isTV || (W >= 1280 && H >= 720);

// --- Configuración PLEX ---
const PLEX_BASE_URL = 'http://plex.naphdev.dpdns.org';
const PLEX_TOKEN = 'VatLRJ2ArQnxu2d1F8ni';

// --- Configuración para canales M3U (opcional) ---
const M3U_URL = '';
const RESOLVER_URL = 'https://resolver1.naphdev.dpdns.org';

// ============================================================
// CONFIGURACIÓN DEL PARSER XML
// ============================================================
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name: string, jpath: string) => {
    return ['MediaContainer', 'Directory', 'Video', 'Location', 'Media', 'Part'].includes(name);
  },
});

// ============================================================
// FUNCIÓN AUXILIAR: Asegurar arrays
// ============================================================
const ensureArray = (value: any): any[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.every(k => !isNaN(Number(k)))) {
      return keys.map(k => value[k]);
    }
    return [value];
  }
  return [value];
};

// ============================================================
// TIPOS
// ============================================================
interface Canal {
  id: string;
  numero: number;
  name: string;
  url: string;
  logo: string;
  category: string;
  nowPlaying?: string;
  embedSlug?: string;
  sources?: string[];
}

interface MediaItem {
  id: string;
  title: string;
  poster: string;
  backdrop?: string;
  year?: number;
  rating?: string;
  overview?: string;
  type?: 'movie' | 'tv';
  streamUrl?: string;
  driveFileId?: string;
  genreIds?: number[];
}

interface PlexShow {
  id: string;
  title: string;
  poster: string;
  backdrop?: string;
  year?: number;
  rating?: string;
  overview?: string;
  seasons: PlexSeason[];
  genreIds?: number[];
}

interface PlexSeason {
  number: number;
  label: string;
  episodes: PlexEpisode[];
}

interface PlexEpisode {
  id: string;
  code: string;
  title: string;
  streamUrl: string;
  driveFileId: string;
  fileName: string;
  poster?: string;
  overview?: string;
  airDate?: string;
  runtime?: number;
}

interface ContinueWatchingItem {
  id: string;
  title: string;
  poster: string;
  progress: number;
  duration: number;
  type: 'movie' | 'episode';
  streamUrl: string;
  showId?: string;
  showName?: string;
  episodeCode?: string;
  profileId?: string;
  watchedAt?: number;
}

interface Profile {
  id: string;
  name: string;
  avatar: string;
  isActive?: boolean;
}

// ============================================================
// UTILIDADES (para canales)
// ============================================================
function extractEmbedSlug(url: string): string | null {
  const m1 = url.match(/[?&]stream=([^&]+)/i);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]canal=([^&]+)/i);
  if (m2) return m2[1];
  return null;
}

function convertirMpdAHls(url: string): string {
  const regex = /^(https?:\/\/router\.cdn\.rcs\.net\.ar\/mnp\/([^/]+))\/output\.mpd$/i;
  const m = url.match(regex);
  if (m) return `${m[1]}_hls/playlist.m3u8`;
  return url;
}

async function lockLandscape() {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch (e) {
    console.log('[ORIENTATION] lockLandscape ERROR', e);
  }
}

// ============================================================
// FIX: helper para construir la URL de "children" sin duplicar
// ============================================================
function buildChildrenUrl(key: string): string {
  if (!key) return '';
  return key.includes('/children') ? `${PLEX_BASE_URL}${key}` : `${PLEX_BASE_URL}${key}/children`;
}

// ============================================================
// FIX: helper para extraer la URL real de streaming desde Media > Part > key
// ============================================================
function getPartStreamUrl(video: any): string {
  const mediaArr = ensureArray(video.Media);
  const media = mediaArr[0];
  if (!media) return '';
  const mediaAttrs = media.$ || media;
  const partArr = ensureArray(mediaAttrs.Part);
  const part = partArr[0];
  if (!part) return '';
  const partAttrs = part.$ || part;
  const partKey = partAttrs.key || '';
  if (!partKey) return '';
  return `${PLEX_BASE_URL}${partKey}?X-Plex-Token=${PLEX_TOKEN}`;
}

// --- Funciones de perfil ---
const PROFILES_KEY = '@nexus_profiles';
const CURRENT_PROFILE_KEY = '@nexus_current_profile';

async function getProfiles(): Promise<Profile[]> {
  try {
    const raw = await AsyncStorage.getItem(PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveProfiles(profiles: Profile[]) {
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

async function getCurrentProfileId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(CURRENT_PROFILE_KEY);
    return id;
  } catch {
    return null;
  }
}

async function setCurrentProfileId(id: string) {
  await AsyncStorage.setItem(CURRENT_PROFILE_KEY, id);
}

async function getContinueWatching(profileId?: string): Promise<ContinueWatchingItem[]> {
  const pid = profileId || (await getCurrentProfileId()) || 'default';
  const raw = await AsyncStorage.getItem(`continueWatching_${pid}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveContinueWatching(item: ContinueWatchingItem, profileId?: string) {
  try {
    const pid = profileId || (await getCurrentProfileId()) || 'default';
    const raw = await AsyncStorage.getItem(`continueWatching_${pid}`);
    const list: ContinueWatchingItem[] = raw ? JSON.parse(raw) : [];
    const existingIndex = list.findIndex(i => i.id === item.id);
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...item };
    } else {
      list.push(item);
    }
    const sorted = list.sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
    await AsyncStorage.setItem(`continueWatching_${pid}`, JSON.stringify(sorted));
  } catch (e) {
    console.log('[SAVE] Error guardando continuar viendo', e);
  }
}

async function getFavorites(profileId?: string): Promise<string[]> {
  const pid = profileId || (await getCurrentProfileId()) || 'default';
  const raw = await AsyncStorage.getItem(`favorites_${pid}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveFavorites(favorites: string[], profileId?: string) {
  const pid = profileId || (await getCurrentProfileId()) || 'default';
  await AsyncStorage.setItem(`favorites_${pid}`, JSON.stringify(favorites));
}

// ============================================================
// FUNCIONES PLEX (CORREGIDAS Y CON FILTRO POR SECCIÓN)
// ============================================================

// 1. Cargar Películas desde Plex
const cargarPeliculasPlex = async (): Promise<MediaItem[]> => {
  console.log('[PLEX] Iniciando carga de películas...');
  try {
    const sectionsRes = await fetch(`${PLEX_BASE_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`);
    const sectionsText = await sectionsRes.text();
    const sectionsParsed = xmlParser.parse(sectionsText);

    const containers = ensureArray(sectionsParsed.MediaContainer);
    let movieSectionKey = '1';
    for (const container of containers) {
      const dirs = ensureArray(container.Directory);
      for (const dir of dirs) {
        const attrs = dir.$ || dir;
        if (attrs.type === 'movie') {
          movieSectionKey = attrs.key;
          break;
        }
      }
      if (movieSectionKey !== '1') break;
    }

    const moviesRes = await fetch(`${PLEX_BASE_URL}/library/sections/${movieSectionKey}/all?X-Plex-Token=${PLEX_TOKEN}`);
    const moviesText = await moviesRes.text();
    const moviesParsed = xmlParser.parse(moviesText);

    const movieContainers = ensureArray(moviesParsed.MediaContainer);
    let videos: any[] = [];
    for (const mc of movieContainers) {
      videos = videos.concat(ensureArray(mc.Video));
    }

    const items: MediaItem[] = videos.map((v: any) => {
      const attrs = v.$ || v;
      const streamUrl = getPartStreamUrl(v);
      if (!streamUrl) {
        console.warn(`[PLEX] "${attrs.title}" no tiene Media/Part.key, no se podrá reproducir`);
      } else {
        console.log(`[PLEX] streamUrl para "${attrs.title}": ${streamUrl}`);
      }

      return {
        id: attrs.ratingKey || '',
        title: attrs.title || 'Sin título',
        poster: `${PLEX_BASE_URL}${attrs.thumb || ''}?X-Plex-Token=${PLEX_TOKEN}`,
        backdrop: attrs.art ? `${PLEX_BASE_URL}${attrs.art}?X-Plex-Token=${PLEX_TOKEN}` : undefined,
        year: parseInt(attrs.year, 10) || undefined,
        rating: attrs.rating || '0.0',
        overview: attrs.summary || 'Sin descripción.',
        type: 'movie',
        streamUrl,
        driveFileId: '',
        genreIds: [],
      };
    });

    console.log(`[PLEX] ${items.length} películas cargadas`);
    return items;
  } catch (e) {
    console.error('[PLEX] Error cargando películas', e);
    return [];
  }
};

// 2. Cargar Series desde Plex con filtro opcional por nombre de sección
const cargarSeriesPlexLocal = async (sectionNameFilter?: string | RegExp): Promise<PlexShow[]> => {
  console.log('[PLEX] Iniciando carga de series con filtro:', sectionNameFilter || 'todas');
  try {
    const sectionsRes = await fetch(`${PLEX_BASE_URL}/library/sections?X-Plex-Token=${PLEX_TOKEN}`);
    const sectionsText = await sectionsRes.text();
    const sectionsParsed = xmlParser.parse(sectionsText);

    const containers = ensureArray(sectionsParsed.MediaContainer);
    let allShows: PlexShow[] = [];

    for (const container of containers) {
      const dirs = ensureArray(container.Directory);
      for (const dir of dirs) {
        const attrs = dir.$ || dir;
        if (attrs.type === 'show') {
          const sectionTitle = attrs.title || 'Sin nombre';
          // Aplicar filtro si se especificó
          if (sectionNameFilter) {
            if (typeof sectionNameFilter === 'string') {
              if (!sectionTitle.toLowerCase().includes(sectionNameFilter.toLowerCase())) {
                continue; // Saltar esta sección
              }
            } else if (sectionNameFilter instanceof RegExp) {
              if (!sectionNameFilter.test(sectionTitle)) {
                continue;
              }
            }
          }

          const showSectionKey = attrs.key;
          console.log(`[PLEX] Procesando sección: ${sectionTitle} (key: ${showSectionKey})`);

          const showsRes = await fetch(`${PLEX_BASE_URL}/library/sections/${showSectionKey}/all?X-Plex-Token=${PLEX_TOKEN}`);
          const showsText = await showsRes.text();
          const showsParsed = xmlParser.parse(showsText);

          const showContainers = ensureArray(showsParsed.MediaContainer);
          let showsData: any[] = [];
          for (const mc of showContainers) {
            showsData = showsData.concat(ensureArray(mc.Directory));
          }
          console.log(`[PLEX] ${showsData.length} series encontradas en ${sectionTitle}`);

          for (const show of showsData) {
            const showAttrs = show.$ || show;
            const showKey = showAttrs.key;
            if (!showKey) continue;

            const seasonsUrl = buildChildrenUrl(showKey);
            console.log(`[PLEX] URL temporadas para "${showAttrs.title}": ${seasonsUrl}`);
            const seasonsRes = await fetch(`${seasonsUrl}?X-Plex-Token=${PLEX_TOKEN}`);
            const seasonsText = await seasonsRes.text();
            const seasonsParsed = xmlParser.parse(seasonsText);

            const seasonContainers = ensureArray(seasonsParsed.MediaContainer);
            let seasonsData: any[] = [];
            for (const mc of seasonContainers) {
              seasonsData = seasonsData.concat(ensureArray(mc.Directory));
            }
            console.log(`[PLEX] ${seasonsData.length} temporadas encontradas para ${showAttrs.title}`);

            const seasons: PlexSeason[] = [];

            for (const season of seasonsData) {
              const seasonAttrs = season.$ || season;
              const seasonKey = seasonAttrs.key;
              const seasonNumber = parseInt(seasonAttrs.index, 10) || 0;
              if (!seasonKey) continue;

              const episodesUrl = buildChildrenUrl(seasonKey);
              console.log(`[PLEX] URL episodios temporada ${seasonNumber}: ${episodesUrl}`);
              const epsRes = await fetch(`${episodesUrl}?X-Plex-Token=${PLEX_TOKEN}`);
              const epsText = await epsRes.text();
              const epsParsed = xmlParser.parse(epsText);

              const epsContainers = ensureArray(epsParsed.MediaContainer);
              let epsData: any[] = [];
              for (const mc of epsContainers) {
                epsData = epsData.concat(ensureArray(mc.Video));
              }
              console.log(`[PLEX] ${epsData.length} episodios encontrados en temporada ${seasonNumber}`);

              const episodes: PlexEpisode[] = epsData.map((ep: any) => {
                const epAttrs = ep.$ || ep;
                const epNumber = parseInt(epAttrs.index, 10) || 0;
                const seasonNum = parseInt(epAttrs.parentIndex, 10) || seasonNumber;
                const ratingKey = epAttrs.ratingKey;
                if (!ratingKey) {
                  console.warn('[PLEX] Episodio sin ratingKey:', epAttrs);
                }

                const streamUrl = getPartStreamUrl(ep);
                if (!streamUrl) {
                  console.warn(`[PLEX] Episodio "${epAttrs.title}" sin Media/Part.key, no se podrá reproducir`);
                }

                return {
                  id: ratingKey || '',
                  code: `S${String(seasonNum).padStart(2, '0')}E${String(epNumber).padStart(2, '0')}`,
                  title: epAttrs.title || `Episodio ${epNumber}`,
                  streamUrl,
                  driveFileId: '',
                  fileName: '',
                  poster: epAttrs.thumb ? `${PLEX_BASE_URL}${epAttrs.thumb}?X-Plex-Token=${PLEX_TOKEN}` : undefined,
                  overview: epAttrs.summary || '',
                };
              });

              seasons.push({
                number: seasonNumber,
                label: seasonAttrs.title || `Temporada ${seasonNumber}`,
                episodes: episodes.sort((a, b) => parseInt(a.code.split('E')[1], 10) - parseInt(b.code.split('E')[1], 10)),
              });
            }

            allShows.push({
              id: showAttrs.ratingKey || '',
              title: showAttrs.title || 'Sin título',
              poster: `${PLEX_BASE_URL}${showAttrs.thumb || ''}?X-Plex-Token=${PLEX_TOKEN}`,
              backdrop: showAttrs.art ? `${PLEX_BASE_URL}${showAttrs.art}?X-Plex-Token=${PLEX_TOKEN}` : undefined,
              year: parseInt(showAttrs.year, 10) || undefined,
              rating: showAttrs.rating || '0.0',
              overview: showAttrs.summary || 'Sin descripción.',
              seasons: seasons.sort((a, b) => a.number - b.number),
              genreIds: [],
            });
          }
        }
      }
    }

    console.log(`[PLEX] Total: ${allShows.length} series cargadas con filtro ${sectionNameFilter || 'todas'}`);
    return allShows;
  } catch (e) {
    console.error('[PLEX] Error cargando series', e);
    return [];
  }
};

// ============================================================
// CANALES MANUALES (ejemplo reducido)
// ============================================================
const CANALES_MANUALES: Canal[] = [
  { id: 'man-1', numero: 1, name: 'Directv Sports', embedSlug: 'dsports', logo: 'https://media.bss-prd.directvgo.com/media/catalog/product/cache/74c1057f7991b4edb2bc7bdaa94de933/l/o/logo-directv-sports_4x3_final.png', category: 'Deportes', nowPlaying: 'Fútbol: Copa Libertadores', url: 'https://streamhdx.com/live1.php?stream=dsports' },
  { id: 'man-2', numero: 2, name: 'Direct Sports 2', embedSlug: 'dsports2', logo: 'https://canalesenvivo.masterperu.club/wp-content/uploads/2025/01/DirecTV-Sports-2.webp', category: 'Deportes', nowPlaying: 'Directv Sports 2', url: 'https://streamhdx.com/live1.php?stream=dsports2' },
];

// ============================================================
// MAPEO DE SLUGS (para canales)
// ============================================================
const SLUG_MAP: Record<string, string> = {
  'dsports': 'directv-sports',
  'dsports2': 'directv-sports-2',
  'dsportsplus': 'directv-sports-plus',
  'tycsports': 'tyc-sports',
  'tntsports': 'tnt-sports',
  'espnpremium': 'espn-premium',
  'espn': 'espn-1',
  'espn2': 'espn-2',
  'espn3': 'espn-3',
  'espn4': 'espn-4',
  'espn5': 'espn-5',
  'espn6': 'espn-6',
  'telefe': 'telefe',
  'tntseries': 'tnt-series',
  'disneychannel': 'disney-channel',
  'tnt': 'tnt',
  'warnerchannel': 'warner-channel',
  'fx': 'fx',
  'comedycentral': 'comedy-central',
  'golden': 'golden',
  'goldenedge': 'golden-edge',
  'discoveryscience': 'discovery-science',
  'universalpremiere': 'universal-premiere',
  'animalplanet': 'animal-planet',
  'discoveryturbo': 'discovery-turbo',
  'tntnovelas': 'tnt-novelas',
};

// ============================================================
// FUNCIÓN ACTUALIZADA: getSourceOptionsForSlug (con filtro por categoría)
// ============================================================
function getSourceOptionsForSlug(embedSlug: string, category?: string): { label: string; url: string }[] {
  const slug = SLUG_MAP[embedSlug] || embedSlug;
  const options: { label: string; url: string }[] = [];
  if (embedSlug) {
    // Si la categoría NO es "Entretenimiento", agregamos la fuente SigNex (streamhdx)
    if (!category || !category.toLowerCase().includes('entretenimiento')) {
      options.push({ label: 'SigNex', url: `https://streamhdx.com/live1.php?stream=${embedSlug}` });
    }
    options.push({ label: 'SigNex2', url: `https://gambeta.vip/canal/${slug}` });
    options.push({ label: 'SigNex3', url: `https://streamtp99a.sbs/global1.php?stream=${embedSlug}` });
    options.push({ label: 'SigNex4', url: `https://regionales.saohgdasregions.fun/stream.php?canal=${embedSlug}` });
    options.push({ label: 'SigNex5', url: `https://tvlibreonline.tv/en-vivo/${slug}` });
  }
  return options;
}

// ============================================================
// NUEVA FUNCIÓN: resolveSingleSource con timeout y verificación
// ============================================================
async function resolveSingleSource(sourceUrl: string): Promise<string> {
  console.log('[RESOLVE] Intentando resolver:', sourceUrl);
  // Crear URL del proxy
  const proxyUrl = `${RESOLVER_URL}/proxy/playlist.m3u8?src=${encodeURIComponent(sourceUrl)}`;

  // Timeout de 10 segundos
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout de 10 segundos')), 10000)
  );

  // Intenta hacer fetch del m3u8 para verificar que esté accesible
  const fetchPromise = fetch(proxyUrl, { method: 'HEAD' })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${response.statusText}`);
      }
      return proxyUrl;
    });

  return Promise.race([fetchPromise, timeoutPromise]);
}

// ============================================================
// COMPONENTE FOCUSABLE (mejorado para control remoto)
// ============================================================
const Focusable = memo(({ children, onPress, onLongPress, style, activeOpacity = 0.7, hasTVPreferredFocus = false, tvParallaxProperties, ...props }: any) => {
  const [focused, setFocused] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: focused ? 1.08 : 1,
      friction: 4,
      tension: 150,
      useNativeDriver: true,
    }).start();
    Animated.timing(glowAnim, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [focused]);

  const focusableStyle = [
    style,
    focused && stylesTV.focused,
    { transform: [{ scale: scaleAnim }] },
    focused && {
      shadowColor: '#ff1744',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.8] }),
      shadowRadius: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 25] }),
      elevation: focused ? 15 : 0,
    },
  ];

  return (
    <TouchableOpacity
      {...props}
      style={focusableStyle}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={activeOpacity}
      hasTVPreferredFocus={hasTVPreferredFocus}
      tvParallaxProperties={tvParallaxProperties || { enabled: true, shiftDistanceX: 10, shiftDistanceY: 10, tiltAngle: 0.05, magnification: 1.05 }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {children}
    </TouchableOpacity>
  );
});

// ============================================================
// COMPONENTE: SELECTOR DE FUENTES (MODAL)
// ============================================================
const SourceSelectorModal = memo(({ visible, options, selectedIndex, onSelect, onClose }: { visible: boolean; options: { label: string; url: string }[]; selectedIndex: number; onSelect: (index: number) => void; onClose: () => void }) => {
  if (!visible) return null;
  if (!options || options.length === 0) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={stylesTV.sourceModalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={stylesTV.sourceModalContent}>
          <View style={stylesTV.sourceModalHeader}>
            <Text style={stylesTV.sourceModalTitle}>📡 Seleccionar fuente</Text>
            <Focusable onPress={onClose}>
              <Ionicons name="close" size={isTV ? 36 : 28} color="#fff" />
            </Focusable>
          </View>
          {options.map((opt, idx) => (
            <Focusable
              key={idx}
              style={[stylesTV.sourceOption, idx === selectedIndex && stylesTV.sourceOptionSelected]}
              onPress={() => { onSelect(idx); onClose(); }}
              hasTVPreferredFocus={idx === 0}
            >
              <Text style={[stylesTV.sourceOptionText, idx === selectedIndex && stylesTV.sourceOptionTextSelected]}>
                {opt.label}
              </Text>
              {idx === selectedIndex && <Ionicons name="checkmark-circle" size={isTV ? 28 : 22} color="#ff1744" />}
            </Focusable>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
});

// ============================================================
// COMPONENTE: DIÁLOGO DE REANUDACIÓN
// ============================================================
const ResumeDialog = memo(({ visible, item, onResume, onRestart, onCancel }: { visible: boolean; item: ContinueWatchingItem | null; onResume: () => void; onRestart: () => void; onCancel: () => void }) => {
  if (!visible || !item) return null;
  const progressPercent = item.duration > 0 ? Math.min(100, (item.progress / item.duration) * 100) : 0;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={stylesTV.resumeOverlay} activeOpacity={1} onPress={onCancel}>
        <View style={stylesTV.resumeContent}>
          <View style={stylesTV.resumeHeader}>
            <Text style={stylesTV.resumeTitle}>⏳ ¿Dónde quieres comenzar?</Text>
            <Focusable onPress={onCancel}>
              <Ionicons name="close" size={isTV ? 36 : 28} color="#fff" />
            </Focusable>
          </View>
          <Image source={{ uri: item.poster }} style={stylesTV.resumePoster} />
          <Text style={stylesTV.resumeItemTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={stylesTV.resumeProgressText}>Progreso guardado: {Math.round(progressPercent)}%</Text>
          <View style={stylesTV.resumeButtons}>
            <Focusable style={[stylesTV.resumeBtn, stylesTV.resumeBtnPrimary]} onPress={onResume} hasTVPreferredFocus={true}>
              <Ionicons name="play-forward" size={isTV ? 28 : 24} color="#fff" />
              <Text style={stylesTV.resumeBtnText}>Continuar (desde {Math.round(progressPercent)}%)</Text>
            </Focusable>
            <Focusable style={[stylesTV.resumeBtn, stylesTV.resumeBtnSecondary]} onPress={onRestart}>
              <Ionicons name="refresh" size={isTV ? 28 : 24} color="#fff" />
              <Text style={stylesTV.resumeBtnText}>Desde el principio</Text>
            </Focusable>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
});

// ============================================================
// PANTALLA DE PERFILES
// ============================================================
const ProfileScreen = memo(({ profiles, onSelectProfile, onCreateProfile, onDeleteProfile }: { profiles: Profile[]; onSelectProfile: (id: string) => void; onCreateProfile: (profile: Profile) => void; onDeleteProfile: (id: string) => void }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const avatars = ['👤', '👩', '🧑', '👨', '👧', '👦', '👩‍🦰', '🧔', '👴', '👵', '🤴', '👸', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟'];

  const handleCreate = async () => {
    if (!newProfileName.trim()) return;
    const newProfile: Profile = {
      id: `profile_${Date.now()}`,
      name: newProfileName.trim(),
      avatar: avatars[Math.floor(Math.random() * avatars.length)],
    };
    await onCreateProfile(newProfile);
    setNewProfileName('');
    setShowCreate(false);
  };

  if (showCreate) {
    return (
      <View style={stylesTV.profileFullScreen}>
        <LinearGradient colors={['#0a0a12', '#1a0a20']} style={StyleSheet.absoluteFill} />
        <View style={stylesTV.profileCreateFull}>
          <Text style={stylesTV.profileCreateTitleFull}>Crear perfil</Text>
          <TextInput
            style={stylesTV.profileInputFull}
            placeholder="Nombre del perfil"
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={newProfileName}
            onChangeText={setNewProfileName}
            autoFocus={!isTV}
            onSubmitEditing={handleCreate}
          />
          <View style={stylesTV.profileCreateActionsFull}>
            <Focusable style={[stylesTV.resumeBtn, stylesTV.resumeBtnPrimary]} onPress={handleCreate}>
              <Text style={stylesTV.resumeBtnText}>Crear</Text>
            </Focusable>
            <Focusable style={[stylesTV.resumeBtn, stylesTV.resumeBtnSecondary]} onPress={() => setShowCreate(false)}>
              <Text style={stylesTV.resumeBtnText}>Cancelar</Text>
            </Focusable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={stylesTV.profileFullScreen}>
      <LinearGradient colors={['#0a0a12', '#1a0a20']} style={StyleSheet.absoluteFill} />
      <View style={stylesTV.profileFullContent}>
        <Text style={stylesTV.profileFullTitle}>¿Quién está viendo?</Text>
        <View style={stylesTV.profileFullList}>
          {profiles.map((p) => (
            <Focusable
              key={p.id}
              style={stylesTV.profileFullItem}
              onPress={() => onSelectProfile(p.id)}
              hasTVPreferredFocus={p === profiles[0]}
              tvParallaxProperties={{ enabled: true, shiftDistanceX: 15, shiftDistanceY: 15, tiltAngle: 0.1, magnification: 1.1 }}
            >
              <View style={stylesTV.profileFullAvatarContainer}>
                <Text style={stylesTV.profileFullAvatar}>{p.avatar}</Text>
                {profiles.length > 1 && (
                  <TouchableOpacity style={stylesTV.profileFullDelete} onPress={() => onDeleteProfile(p.id)} activeOpacity={0.6}>
                    <Ionicons name="close-circle" size={isTV ? 32 : 24} color="#ff1744" />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={stylesTV.profileFullName}>{p.name}</Text>
            </Focusable>
          ))}
          <Focusable style={stylesTV.profileFullAdd} onPress={() => setShowCreate(true)}>
            <View style={stylesTV.profileFullAddCircle}>
              <Ionicons name="add" size={isTV ? 60 : 40} color="#fff" />
            </View>
            <Text style={stylesTV.profileFullAddText}>Agregar perfil</Text>
          </Focusable>
        </View>
        <Text style={stylesTV.profileFullHint}>Selecciona un perfil para comenzar</Text>
      </View>
    </View>
  );
});

// ============================================================
// COMPONENTE: BÚSQUEDA GLOBAL
// ============================================================
const GlobalSearch = memo(({ visible, onClose, movies, series, anime, doramas, channels, onPlayMedia, onSelectShow, onSelectChannel }: any) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const q = query.toLowerCase().trim();
    const allResults: any[] = [];
    movies.forEach((m: MediaItem) => {
      if (m.title.toLowerCase().includes(q)) allResults.push({ ...m, _type: 'movie', _source: 'Película' });
    });
    series.forEach((s: PlexShow) => {
      if (s.title.toLowerCase().includes(q)) allResults.push({ ...s, _type: 'series', _source: 'Serie' });
    });
    anime.forEach((s: PlexShow) => {
      if (s.title.toLowerCase().includes(q)) allResults.push({ ...s, _type: 'anime', _source: 'Anime' });
    });
    doramas.forEach((s: PlexShow) => {
      if (s.title.toLowerCase().includes(q)) allResults.push({ ...s, _type: 'dorama', _source: 'Dorama' });
    });
    channels.forEach((c: Canal) => {
      if (c.name.toLowerCase().includes(q)) allResults.push({ ...c, _type: 'channel', _source: 'Canal TV' });
    });
    setResults(allResults.slice(0, 50));
  }, [query, movies, series, anime, doramas, channels]);

  const renderItem = ({ item }: { item: any }) => {
    const isMedia = item._type === 'movie' || item._type === 'series' || item._type === 'anime' || item._type === 'dorama';
    const isChannel = item._type === 'channel';
    const poster = isMedia ? item.poster : item.logo || 'https://via.placeholder.com/500x750.png?text=Canal';
    return (
      <Focusable
        style={stylesTV.searchResultItem}
        onPress={() => {
          if (isChannel) {
            onSelectChannel(item);
            onClose();
          } else if (item._type === 'movie' && item.streamUrl) {
            onPlayMedia(item, 'movie', item.title, item.streamUrl, item.poster);
            onClose();
          } else if ((item._type === 'series' || item._type === 'anime' || item._type === 'dorama') && item.seasons) {
            onSelectShow(item);
            onClose();
          } else {
            Alert.alert('Info', 'Contenido no disponible para reproducción directa');
          }
        }}
      >
        <Image source={{ uri: poster }} style={stylesTV.searchResultPoster} />
        <View style={stylesTV.searchResultInfo}>
          <Text style={stylesTV.searchResultTitle} numberOfLines={2}>{item.title || item.name}</Text>
          <Text style={stylesTV.searchResultSource}>{item._source}</Text>
          {isMedia && item.year && <Text style={stylesTV.searchResultYear}>{item.year}</Text>}
          {isChannel && item.nowPlaying && <Text style={stylesTV.searchResultNow}>{item.nowPlaying}</Text>}
        </View>
      </Focusable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={stylesTV.searchContainer}>
        <View style={stylesTV.searchHeader}>
          <Ionicons name="search" size={isTV ? 32 : 24} color="rgba(255,255,255,0.6)" />
          <TextInput
            style={stylesTV.searchInput}
            placeholder="Buscar películas, series, canales..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={query}
            onChangeText={setQuery}
            autoFocus={!isTV}
          />
          <Focusable onPress={onClose} style={stylesTV.closeOverlayBtn}>
            <Ionicons name="close" size={isTV ? 32 : 24} color="#fff" />
          </Focusable>
        </View>
        {query.trim() === '' ? (
          <View style={stylesTV.searchEmpty}>
            <Ionicons name="search-outline" size={isTV ? 80 : 60} color="rgba(255,255,255,0.2)" />
            <Text style={stylesTV.searchEmptyText}>Busca contenido en toda la plataforma</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={stylesTV.searchEmpty}>
            <Ionicons name="sad-outline" size={isTV ? 80 : 60} color="rgba(255,255,255,0.2)" />
            <Text style={stylesTV.searchEmptyText}>No se encontraron resultados para "{query}"</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item, index) => `${item.id || item._type}-${index}`}
            renderItem={renderItem}
            numColumns={isTV ? 3 : 2}
            contentContainerStyle={stylesTV.searchResultsList}
          />
        )}
      </View>
    </Modal>
  );
});

// ============================================================
// COMPONENTE: LISTA DE CANALES
// ============================================================
const ChannelList = memo(({ channels, currentChannel, favorites, onSelectChannel, onToggleFavorite, onClose, isOverlay = false }: any) => {
  const listRef = useRef<FlatList>(null);
  const renderChannel = ({ item, index }: { item: Canal; index: number }) => {
    const isActive = currentChannel?.id === item.id;
    const isFav = favorites.includes(item.id);
    return (
      <Focusable
        style={[
          stylesTV.channelItem,
          isActive && stylesTV.channelItemActive,
        ]}
        onPress={() => {
          onSelectChannel(item);
          if (isOverlay && onClose) onClose();
        }}
        onLongPress={() => {
          onToggleFavorite(item.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }}
        hasTVPreferredFocus={index === 0 && !isOverlay}
      >
        <View style={stylesTV.channelLogoContainer}>
          {item.logo ? (
            <Image source={{ uri: item.logo }} style={stylesTV.channelLogo} />
          ) : (
            <Text style={stylesTV.channelLogoFallback}>{item.numero}</Text>
          )}
        </View>
        <View style={stylesTV.channelInfo}>
          <Text style={stylesTV.channelName} numberOfLines={1}>{item.name}</Text>
          {item.nowPlaying && <Text style={stylesTV.channelNow} numberOfLines={1}>{item.nowPlaying}</Text>}
        </View>
        {isActive && <View style={stylesTV.channelActiveIndicator}><Ionicons name="play" size={isTV ? 20 : 16} color="#ff1744" /></View>}
        {isFav && !isActive && <Ionicons name="star" size={isTV ? 22 : 18} color="#F5C842" style={{ marginLeft: 4 }} />}
      </Focusable>
    );
  };

  return (
    <View style={[stylesTV.channelListContainer, isOverlay && stylesTV.channelListOverlay]}>
      {isOverlay && (
        <View style={stylesTV.channelListHeader}>
          <Text style={stylesTV.rightTitle}>📺 CANALES</Text>
          <Focusable onPress={onClose} style={stylesTV.closeOverlayBtn}>
            <Ionicons name="close" size={isTV ? 32 : 28} color="#fff" />
          </Focusable>
        </View>
      )}
      <FlatList
        ref={listRef}
        data={channels}
        keyExtractor={(item: Canal) => item.id}
        renderItem={renderChannel}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: isTV ? 40 : 20 }}
      />
    </View>
  );
});

// ============================================================
// COMPONENTE: REPRODUCTOR EN MINIATURA (TV en vivo) - ACTUALIZADO para manejar errores
// ============================================================
const LivePlayerMini = memo(({ url, channel, loading, onToggleFullscreen, onToggleChannelOverlay, fullscreen = false, sourceOptions = [], selectedSourceIndex = 0, onSelectSource, onSourceError }: any) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);
  const controlsAnim = useRef(new Animated.Value(0)).current;
  const hideTimeout = useRef<NodeJS.Timeout | null>(null);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);

  const messages = [
    "📢 Aviso: Estamos mejorando la calidad del servicio.",
    "🚀 Día a día estamos trabajando para mejorar.",
    "🎬 Pronto más contenido exclusivo.",
    "📡 Disfruta de la mejor programación.",
    "💡 Sugerencias: escríbenos a soporte@nexustv.com",
    "🔥 No te pierdas los estrenos de esta semana.",
  ];
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const player = useVideoPlayer(url && url.startsWith('http') ? url : null, (p) => {
    if (url && url.startsWith('http')) {
      p.loop = false;
      p.play();
      setIsPlaying(true);
    }
  }, [url]);

  // Detectar errores del reproductor
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (p: any) => {
      if (p?.error) {
        console.log('[LIVE-PLAYER] ERROR', p.error);
        // Notificar al padre para que intente con la siguiente fuente
        if (onSourceError) onSourceError();
      }
    });
    return () => sub.remove();
  }, [player, onSourceError]);

  useEffect(() => {
    if (controlsVisible) {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => {
        setControlsVisible(false);
        Animated.timing(controlsAnim, { toValue: 0, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
      }, 4000);
    }
    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [controlsVisible]);

  const showControls = () => {
    setControlsVisible(true);
    Animated.timing(controlsAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  };

  const togglePlay = () => {
    if (player.playing) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
    showControls();
  };

  const { height: windowHeight } = Dimensions.get('window') || { height: 720 };
  const availableHeight = windowHeight - (isTV ? 80 : 60);
  const playerHeight = fullscreen ? '100%' : availableHeight * 0.65;

  const showPlayer = !loading && url && url.startsWith('http');

  return (
    <View style={stylesTV.liveContainer}>
      <View style={{ height: playerHeight, backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
        {showPlayer ? (
          <>
            <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="fill" nativeControls={false} onTouchStart={showControls} />
            <Animated.View style={[stylesTV.miniControls, { opacity: controlsAnim }]} pointerEvents={controlsVisible ? 'box-none' : 'none'}>
              <LinearGradient colors={['rgba(0,0,0,0.8)', 'transparent', 'rgba(0,0,0,0.8)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
              <View style={stylesTV.miniTopBar}>
                <Text style={stylesTV.miniTitle} numberOfLines={1}>{channel?.name || 'TV en vivo'}</Text>
                <View style={stylesTV.miniActions}>
                  {sourceOptions.length > 1 && fullscreen && (
                    <Focusable onPress={() => setSourceModalVisible(true)} style={[stylesTV.miniBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                      <Ionicons name="radio-outline" size={isTV ? 30 : 24} color="#fff" />
                    </Focusable>
                  )}
                  <Focusable onPress={onToggleFullscreen} style={[stylesTV.miniBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                    <Ionicons name={fullscreen ? "contract-outline" : "expand-outline"} size={isTV ? 30 : 24} color="#fff" />
                  </Focusable>
                  <Focusable onPress={onToggleChannelOverlay} style={[stylesTV.miniBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                    <Ionicons name="list" size={isTV ? 30 : 24} color="#fff" />
                  </Focusable>
                </View>
              </View>
              <View style={stylesTV.miniCenter}>
                <Focusable style={stylesTV.miniPlayBtn} onPress={togglePlay}>
                  <LinearGradient colors={['#ff1744', '#d50000']} style={stylesTV.miniPlayGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={isTV ? 48 : 36} color="#fff" />
                  </LinearGradient>
                </Focusable>
              </View>
            </Animated.View>
            <SourceSelectorModal visible={sourceModalVisible} options={sourceOptions} selectedIndex={selectedSourceIndex} onSelect={onSelectSource} onClose={() => setSourceModalVisible(false)} />
          </>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
            <ActivityIndicator size="large" color="#ff1744" />
            <Text style={stylesTV.loadingText}>Cargando señal...</Text>
          </View>
        )}
      </View>
      {!fullscreen && (
        <View style={stylesTV.messagesSection}>
          <View style={stylesTV.messagesContainer}>
            <Ionicons name="information-circle-outline" size={isTV ? 32 : 24} color="rgba(255,255,255,0.6)" style={stylesTV.messageIcon} />
            <Text style={stylesTV.messageText} key={currentMessageIndex}>
              {loading ? '🔄 Cargando señal...' : messages[currentMessageIndex]}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
});

// ============================================================
// COMPONENTE: HEADER SUPERIOR
// ============================================================
const AppHeader = memo(({ onSettingsPress, onHistoryPress, onContinueWatchingPress, onSearchPress, onProfilePress, userName = 'Invitado', avatarUrl }: any) => {
  return (
    <LinearGradient colors={['rgba(20,10,30,0.95)', 'rgba(10,10,20,0.9)']} style={stylesTV.headerContainer} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
      <View style={stylesTV.headerLeft}>
        <Focusable onPress={onProfilePress} style={stylesTV.avatarContainer}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={stylesTV.avatar} />
          ) : (
            <LinearGradient colors={['#ff1744', '#d50000']} style={stylesTV.avatarPlaceholder}>
              <Ionicons name="person" size={isTV ? 32 : 24} color="#fff" />
            </LinearGradient>
          )}
        </Focusable>
        <Text style={stylesTV.userName}>{userName}</Text>
      </View>
      <View style={stylesTV.headerRight}>
        <Focusable style={[stylesTV.headerBtn, stylesTV.headerBtnPrimary]} onPress={onSearchPress}>
          <Ionicons name="search" size={isTV ? 28 : 24} color="#fff" />
          <Text style={stylesTV.headerBtnText}>Buscar</Text>
        </Focusable>
        <Focusable style={[stylesTV.headerBtn, stylesTV.headerBtnPrimary]} onPress={onContinueWatchingPress}>
          <Ionicons name="time-outline" size={isTV ? 28 : 24} color="#fff" />
          <Text style={stylesTV.headerBtnText}>Continuar</Text>
        </Focusable>
        <Focusable style={[stylesTV.headerBtn, stylesTV.headerBtnSecondary]} onPress={onHistoryPress}>
          <Ionicons name="calendar-outline" size={isTV ? 28 : 24} color="#fff" />
          <Text style={stylesTV.headerBtnText}>Historial</Text>
        </Focusable>
        <Focusable style={[stylesTV.headerBtn, stylesTV.headerBtnSecondary]} onPress={onSettingsPress}>
          <Ionicons name="settings-outline" size={isTV ? 28 : 24} color="#fff" />
          <Text style={stylesTV.headerBtnText}>Ajustes</Text>
        </Focusable>
      </View>
    </LinearGradient>
  );
});

// ============================================================
// VISTAS: CONTINUAR VIENDO, HISTORIAL, AJUSTES
// ============================================================
const ContinueWatchingView = memo(({ items, onPlay }: any) => {
  const renderItem = ({ item, index }: { item: ContinueWatchingItem; index: number }) => {
    const progressPercent = item.duration > 0 ? (item.progress / item.duration) * 100 : 0;
    const isWatched = progressPercent > 90;
    return (
      <Focusable style={stylesTV.gridItem} onPress={() => onPlay(item)} tvParallaxProperties={{ enabled: true, shiftDistanceX: 15, shiftDistanceY: 15, tiltAngle: 0.1, magnification: 1.1 }} hasTVPreferredFocus={index === 0}>
        <View style={stylesTV.gridPosterContainer}>
          <Image source={{ uri: item.poster }} style={stylesTV.gridPoster} />
          <View style={[stylesTV.continueProgressBar, { position: 'absolute', bottom: 0, left: 0, right: 0, height: isTV ? 8 : 6, backgroundColor: 'rgba(0,0,0,0.7)' }]}>
            <View style={[stylesTV.continueProgressFill, { width: `${Math.min(progressPercent, 100)}%` }]} />
          </View>
          {isWatched && (
            <View style={[stylesTV.gridRating, { top: 8, right: 8, bottom: undefined }]}>
              <Text style={{ color: '#4CAF50', fontSize: isTV ? 16 : 12, fontWeight: '700' }}>✓ Visto</Text>
            </View>
          )}
        </View>
        <Text style={stylesTV.gridTitle} numberOfLines={2}>{item.title}</Text>
      </Focusable>
    );
  };
  return (
    <View style={stylesTV.gridContainer}>
      <Text style={stylesTV.gridSectionTitle}>⏳ Continuar viendo</Text>
      {items.length === 0 ? (
        <View style={stylesTV.centerLoading}>
          <Ionicons name="tv-outline" size={isTV ? 80 : 60} color="rgba(255,255,255,0.3)" />
          <Text style={stylesTV.loadingText}>No hay contenido en "Continuar viendo"</Text>
        </View>
      ) : (
        <FlatList data={items} keyExtractor={(item) => item.id} numColumns={isTV ? 6 : 4} renderItem={renderItem} contentContainerStyle={{ paddingBottom: isTV ? 40 : 20 }} />
      )}
    </View>
  );
});

const HistoryView = memo(({ items, onPlay }: any) => {
  const renderItem = ({ item, index }: { item: ContinueWatchingItem; index: number }) => {
    const progressPercent = item.duration > 0 ? (item.progress / item.duration) * 100 : 0;
    return (
      <Focusable style={stylesTV.gridItem} onPress={() => onPlay(item)} tvParallaxProperties={{ enabled: true, shiftDistanceX: 15, shiftDistanceY: 15, tiltAngle: 0.1, magnification: 1.1 }} hasTVPreferredFocus={index === 0}>
        <View style={stylesTV.gridPosterContainer}>
          <Image source={{ uri: item.poster }} style={stylesTV.gridPoster} />
          <View style={[stylesTV.continueProgressBar, { position: 'absolute', bottom: 0, left: 0, right: 0, height: isTV ? 8 : 6, backgroundColor: 'rgba(0,0,0,0.7)' }]}>
            <View style={[stylesTV.continueProgressFill, { width: `${Math.min(progressPercent, 100)}%` }]} />
          </View>
        </View>
        <Text style={stylesTV.gridTitle} numberOfLines={2}>{item.title}</Text>
      </Focusable>
    );
  };
  return (
    <View style={stylesTV.gridContainer}>
      <Text style={stylesTV.gridSectionTitle}>📜 Historial</Text>
      {items.length === 0 ? (
        <View style={stylesTV.centerLoading}>
          <Ionicons name="calendar-outline" size={isTV ? 80 : 60} color="rgba(255,255,255,0.3)" />
          <Text style={stylesTV.loadingText}>No hay historial de reproducción</Text>
        </View>
      ) : (
        <FlatList data={items} keyExtractor={(item) => item.id} numColumns={isTV ? 6 : 4} renderItem={renderItem} contentContainerStyle={{ paddingBottom: isTV ? 40 : 20 }} />
      )}
    </View>
  );
});

const SettingsView = memo(() => {
  const [deviceInfo, setDeviceInfo] = useState<any>({});
  useEffect(() => {
    setDeviceInfo({
      appVersion: Constants.expoConfig?.version || Constants.manifest?.version || '1.0.0',
      brand: Device.brand || 'Desconocido',
      mac: Device.macAddress || 'No disponible',
    });
  }, []);
  const openWhatsApp = () => {
    const url = `https://wa.me/5492995958958?text=Hola%20NEXUS%20TV%2C%20tengo%20una%20consulta`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'No se pudo abrir WhatsApp'));
  };
  return (
    <View style={stylesTV.settingsContainer}>
      <Text style={stylesTV.gridSectionTitle}>⚙️ Ajustes</Text>
      <View style={stylesTV.settingsCard}>
        <View style={stylesTV.settingsItem}>
          <Ionicons name="information-circle-outline" size={isTV ? 36 : 28} color="#ff1744" />
          <Text style={stylesTV.settingsLabel}>Versión de la app:</Text>
          <Text style={stylesTV.settingsValue}>{deviceInfo.appVersion}</Text>
        </View>
        <View style={stylesTV.settingsItem}>
          <Ionicons name="wifi-outline" size={isTV ? 36 : 28} color="#ff1744" />
          <Text style={stylesTV.settingsLabel}>Dirección MAC:</Text>
          <Text style={stylesTV.settingsValue}>{deviceInfo.mac}</Text>
        </View>
        <Focusable style={stylesTV.settingsWhatsAppBtn} onPress={openWhatsApp}>
          <Ionicons name="logo-whatsapp" size={isTV ? 36 : 28} color="#25D366" />
          <Text style={stylesTV.settingsWhatsAppText}>Contactar por WhatsApp</Text>
        </Focusable>
      </View>
    </View>
  );
});

// ============================================================
// REPRODUCTOR POR WEBVIEW (para casos puntuales)
// ============================================================
const WebViewPlayer = memo(({ url, onClose, title }: { url: string; onClose: () => void; title?: string }) => {
  const webViewRef = useRef<WebView>(null);
  useEffect(() => {
    console.log('[WebViewPlayer] Abriendo URL:', url);
    lockLandscape();
    return () => {};
  }, []);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <style>
        body { margin: 0; background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
        #video-container { width: 100vw; height: 100vh; background: #000; }
        video { width: 100%; height: 100%; object-fit: contain; background: #000; }
        #error-msg { color: #ff1744; font-family: sans-serif; text-align: center; padding: 20px; display: none; }
      </style>
    </head>
    <body>
      <div id="video-container">
        <video id="video" controls autoplay playsinline></video>
        <div id="error-msg">Error al cargar el stream. Intente recargar.</div>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/hls.js@0.14.17/dist/hls.min.js"></script>
      <script>
        (function() {
          var video = document.getElementById('video');
          var errorDiv = document.getElementById('error-msg');
          var streamUrl = '${url}';
          function loadStream() {
            if (Hls.isSupported()) {
              var hls = new Hls({ enableWorker: true, lowLatencyMode: true, fragLoadingMaxRetry: 10, manifestLoadingMaxRetry: 10, levelLoadingMaxRetry: 10, maxBufferLength: 30, maxMaxBufferLength: 60 });
              hls.loadSource(streamUrl);
              hls.attachMedia(video);
              hls.on(Hls.Events.MANIFEST_PARSED, function() {
                video.play().catch(function(e) { console.log('Autoplay blocked', e); });
              });
              hls.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) { errorDiv.style.display = 'block'; console.log('HLS Fatal Error', data); }
              });
              window.__hls = hls;
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = streamUrl;
              video.addEventListener('loadedmetadata', function() { video.play(); });
            } else {
              errorDiv.style.display = 'block';
              errorDiv.innerText = 'Reproductor no soportado en este dispositivo.';
            }
          }
          if (document.readyState === 'complete') { loadStream(); } else { window.addEventListener('load', loadStream); }
          setTimeout(function() {
            if (!window.__hls && video.src === '') { video.src = streamUrl; video.play(); }
          }, 3000);
        })();
      </script>
    </body>
    </html>
  `;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar hidden />
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: htmlContent }}
          style={{ flex: 1, backgroundColor: '#000' }}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          userAgent="Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36"
          onError={(e) => console.log('[WebViewPlayer] Error:', e.nativeEvent)}
        />
      </View>
    </Modal>
  );
});

// ============================================================
// REPRODUCTOR MODAL MEJORADO (CON BARRA DE PROGRESO FUNCIONAL Y SIN BOTÓN DE CIERRE)
// ============================================================
const ReproductorMejorado = memo(({ url, onClose, title, id, poster, type = 'movie', showId, showName, episodeCode, sourceOptions = [], selectedSourceIndex = 0, onSelectSource, initialTime = 0 }: any) => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [savedProgress, setSavedProgress] = useState(0);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [hasSetInitialTime, setHasSetInitialTime] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  useKeepAwake();

  const controlsAnim = useRef(new Animated.Value(1)).current;
  const hideTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const progressTrackRef = useRef<View>(null);

  // Manejo de control remoto dentro del reproductor
  useEffect(() => {
    let tvEventHandler: any;
    if (Platform.isTV) {
      tvEventHandler = new TVEventHandler();
      tvEventHandler.enable(this, (cmp: any, evt: any) => {
        if (evt && evt.eventType === 'right') {
          seek(5);
        } else if (evt && evt.eventType === 'left') {
          seek(-5);
        }
      });
    }
    return () => {
      if (tvEventHandler) tvEventHandler.disable();
    };
  }, [duration]);

  // Si la URL es inválida, mostrar error inmediatamente
  useEffect(() => {
    if (!url || !url.startsWith('http')) {
      setError('URL de stream inválida');
      setLoading(false);
    }
  }, [url]);

  const player = useVideoPlayer(url && url.startsWith('http') ? url : null, (p) => {
    p.loop = false;
    p.play();
    setIsPlaying(true);
    if (initialTime > 0 && !hasSetInitialTime) {
      p.currentTime = initialTime;
      setCurrentTime(initialTime);
      setHasSetInitialTime(true);
    }
  }, [url]);

  useEffect(() => {
    if (player && initialTime > 0 && !hasSetInitialTime) {
      player.currentTime = initialTime;
      setCurrentTime(initialTime);
      setHasSetInitialTime(true);
    }
  }, [player, initialTime]);

  useEffect(() => {
    if (!player || !id) return;
    saveIntervalRef.current = setInterval(() => {
      const current = player.currentTime || 0;
      const dur = (player as any).duration || 0;
      if (dur > 0 && current > 5 && Math.abs(current - savedProgress) > 5) {
        setSavedProgress(current);
        saveContinueWatching({
          id: id,
          title: title,
          poster: poster,
          progress: current,
          duration: dur,
          type: type,
          streamUrl: url,
          showId: showId,
          showName: showName,
          episodeCode: episodeCode,
          watchedAt: Date.now(),
        });
      }
    }, 5000);
    return () => {
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
    };
  }, [player, id, savedProgress]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    console.log('[PLAYER] Cerrando reproductor');
    const current = player.currentTime || 0;
    const dur = (player as any).duration || 0;
    if (dur > 0 && current > 5 && id) {
      saveContinueWatching({
        id: id,
        title: title,
        poster: poster,
        progress: current,
        duration: dur,
        type: type,
        streamUrl: url,
        showId: showId,
        showName: showName,
        episodeCode: episodeCode,
        watchedAt: Date.now(),
      });
    }
    try {
      if (player && typeof player.pause === 'function') player.pause();
    } catch (e) {}
    onClose();
  }, [isClosing, player, id, title, poster, type, url, showId, showName, episodeCode, onClose]);

  useEffect(() => {
    if (controlsVisible) {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(() => {
        setControlsVisible(false);
        Animated.timing(controlsAnim, { toValue: 0, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
      }, 3000);
    }
    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    };
  }, [controlsVisible]);

  const showControls = () => {
    setControlsVisible(true);
    Animated.timing(controlsAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  };

  const togglePlay = () => {
    if (player.playing) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
    showControls();
  };

  const seek = (seconds: number) => {
    const newTime = Math.max(0, Math.min(duration, (player.currentTime || 0) + seconds));
    player.currentTime = newTime;
    setCurrentTime(newTime);
    showControls();
  };

  // ===== CORRECCIÓN: MANEJO DE TOQUE EN LA BARRA DE PROGRESO =====
  const handleSeekBarPress = (event: any) => {
    if (!progressTrackRef.current || duration <= 0) return;

    progressTrackRef.current.measure((x, y, width, height, pageX, pageY) => {
      if (width === 0) return;

      let locationX = event.nativeEvent?.locationX;
      if (locationX === undefined && event.nativeEvent?.pageX !== undefined) {
        locationX = event.nativeEvent.pageX - pageX;
      }
      if (locationX === undefined) return;

      const progress = Math.max(0, Math.min(1, locationX / width));
      const newTime = progress * duration;
      player.currentTime = newTime;
      setCurrentTime(newTime);
      showControls();
    });
  };
  // ===============================================================

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setRetryCount(prev => prev + 1);
    if (player) {
      player.replace(url);
    } else {
      setLoading(false);
      setLoading(true);
    }
  };

  useEffect(() => {
    const sub1 = player.addListener('playingChange', (p: any) => {
      const playing = p?.isPlaying ?? p;
      setIsPlaying(!!playing);
      if (playing) setLoading(false);
    });
    const sub2 = player.addListener('statusChange', (p: any) => {
      if (p?.error) {
        console.log('[PLAYER] ERROR', p.error);
        const errorMsg = `Error de reproducción (intento ${retryCount + 1})`;
        if (retryCount < 3) {
          setRetryCount(prev => prev + 1);
          setLoading(true);
          if (player) player.replace(url);
        } else {
          setError(errorMsg + '. Presiona Reintentar.');
        }
        setLoading(false);
      }
    });
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [player, retryCount, url]);

  useEffect(() => {
    const interval = setInterval(() => {
      const ct = player.currentTime || 0;
      const dur = (player as any).duration || 0;
      setCurrentTime(ct);
      setDuration(dur);
    }, 200);
    return () => clearInterval(interval);
  }, [player]);

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  useEffect(() => {
    lockLandscape();
    return () => {};
  }, []);

  if (error) {
    return (
      <Modal visible animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
        <View style={stylesTV.modalFullscreen}>
          <View style={stylesTV.modalError}>
            <Ionicons name="alert-circle-outline" size={isTV ? 80 : 60} color="#ff1744" />
            <Text style={stylesTV.errorText}>{error}</Text>
            <Focusable style={[stylesTV.resumeBtn, stylesTV.resumeBtnPrimary, { marginTop: 20 }]} onPress={handleRetry}>
              <Text style={stylesTV.resumeBtnText}>Reintentar</Text>
            </Focusable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
      <View style={stylesTV.modalFullscreen}>
        {loading && (
          <View style={stylesTV.modalLoading}>
            <ActivityIndicator size="large" color="#ff1744" />
            <Text style={stylesTV.loadingText}>Cargando...</Text>
          </View>
        )}
        <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="contain" nativeControls={false} onTouchStart={showControls} />
        <Animated.View style={[stylesTV.modalControls, { opacity: controlsAnim }]} pointerEvents={controlsVisible ? 'box-none' : 'none'}>
          <LinearGradient colors={['rgba(0,0,0,0.8)', 'transparent', 'rgba(0,0,0,0.8)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={stylesTV.modalControlTop}>
            <Text style={stylesTV.playerTitle} numberOfLines={1}>{title || 'Reproduciendo'}</Text>
            {sourceOptions.length > 1 && (
              <Focusable onPress={() => setSourceModalVisible(true)} style={stylesTV.sourceBtn}>
                <Ionicons name="radio-outline" size={isTV ? 34 : 28} color="#fff" />
              </Focusable>
            )}
          </View>
          <View style={stylesTV.modalControlCenter}>
            <Focusable style={stylesTV.controlBtn} onPress={() => seek(-10)}>
              <Ionicons name="play-back" size={isTV ? 44 : 36} color="#fff" />
              <Text style={stylesTV.controlLabel}>10</Text>
            </Focusable>
            <Focusable style={stylesTV.modalPlayBtn} onPress={togglePlay}>
              <LinearGradient colors={['#ff1744', '#d50000']} style={stylesTV.modalPlayGradient}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={isTV ? 56 : 48} color="#fff" />
              </LinearGradient>
            </Focusable>
            <Focusable style={stylesTV.controlBtn} onPress={() => seek(10)}>
              <Ionicons name="play-forward" size={isTV ? 44 : 36} color="#fff" />
              <Text style={stylesTV.controlLabel}>10</Text>
            </Focusable>
          </View>
          {duration > 0 && (
            <View style={stylesTV.modalControlBottom}>
              <Text style={stylesTV.timeText}>{formatTime(currentTime)}</Text>
              <View style={stylesTV.progressTrack} ref={progressTrackRef}>
                <View style={stylesTV.progressBg} />
                <View style={[stylesTV.progressFill, { width: `${progress * 100}%`, backgroundColor: '#ff1744' }]} />
                <View style={[stylesTV.progressThumb, { left: `${progress * 100}%` }]} />
                <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={0.9} onPress={handleSeekBarPress} />
              </View>
              <Text style={stylesTV.timeText}>{formatTime(duration)}</Text>
            </View>
          )}
        </Animated.View>
        <SourceSelectorModal visible={sourceModalVisible} options={sourceOptions} selectedIndex={selectedSourceIndex} onSelect={onSelectSource} onClose={() => setSourceModalVisible(false)} />
      </View>
    </Modal>
  );
});

// ============================================================
// COMPONENTES DE GRID (Películas y Series)
// ============================================================
const MoviesGrid = memo(({ items, loading, onRefresh, onPlay }: any) => {
  const [busqueda, setBusqueda] = useState('');
  const filtered = items.filter((i: MediaItem) => i.title.toLowerCase().includes(busqueda.toLowerCase()));

  const renderMovie = ({ item, index }: { item: MediaItem; index: number }) => (
    <Focusable style={stylesTV.gridItem} onPress={() => onPlay(item)} tvParallaxProperties={{ enabled: true, shiftDistanceX: 15, shiftDistanceY: 15, tiltAngle: 0.1, magnification: 1.1 }} hasTVPreferredFocus={index === 0}>
      <View style={stylesTV.gridPosterContainer}>
        <Image source={{ uri: item.poster }} style={stylesTV.gridPoster} />
        {item.rating && (
          <View style={stylesTV.gridRating}>
            <Ionicons name="star" size={isTV ? 18 : 14} color="#F5C842" />
            <Text style={stylesTV.gridRatingText}>{item.rating}</Text>
          </View>
        )}
      </View>
      <Text style={stylesTV.gridTitle} numberOfLines={2}>{item.title}</Text>
      {item.year && <Text style={stylesTV.gridYear}>{item.year}</Text>}
    </Focusable>
  );

  return (
    <View style={stylesTV.gridContainer}>
      <View style={stylesTV.gridSearch}>
        <Ionicons name="search" size={isTV ? 32 : 24} color="rgba(255,255,255,0.5)" />
        <TextInput style={stylesTV.gridSearchInput} placeholder="Buscar películas..." placeholderTextColor="rgba(255,255,255,0.4)" value={busqueda} onChangeText={setBusqueda} />
      </View>
      {loading ? (
        <View style={stylesTV.centerLoading}>
          <ActivityIndicator size="large" color="#ff1744" />
          <Text style={stylesTV.loadingText}>Cargando películas...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i: MediaItem) => i.id}
          numColumns={isTV ? 6 : 4}
          renderItem={renderMovie}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#ff1744" colors={['#ff1744']} />}
          contentContainerStyle={{ paddingBottom: isTV ? 40 : 20 }}
        />
      )}
    </View>
  );
});

const SeriesGrid = memo(({ shows, loading, onRefresh, onSelectShow, title }: any) => {
  const [busqueda, setBusqueda] = useState('');
  const filtered = shows.filter((s: PlexShow) => s.title.toLowerCase().includes(busqueda.toLowerCase()));

  const renderShow = ({ item, index }: { item: PlexShow; index: number }) => (
    <Focusable style={stylesTV.gridItem} onPress={() => onSelectShow(item)} tvParallaxProperties={{ enabled: true, shiftDistanceX: 15, shiftDistanceY: 15, tiltAngle: 0.1, magnification: 1.1 }} hasTVPreferredFocus={index === 0}>
      <View style={stylesTV.gridPosterContainer}>
        <Image source={{ uri: item.poster }} style={stylesTV.gridPoster} />
        {item.rating && (
          <View style={stylesTV.gridRating}>
            <Ionicons name="star" size={isTV ? 18 : 14} color="#F5C842" />
            <Text style={stylesTV.gridRatingText}>{item.rating}</Text>
          </View>
        )}
      </View>
      <Text style={stylesTV.gridTitle} numberOfLines={2}>{item.title}</Text>
      {item.year && <Text style={stylesTV.gridYear}>{item.year}</Text>}
    </Focusable>
  );

  return (
    <View style={stylesTV.gridContainer}>
      <Text style={stylesTV.gridSectionTitle}>{title || 'Series'}</Text>
      <View style={stylesTV.gridSearch}>
        <Ionicons name="search" size={isTV ? 32 : 24} color="rgba(255,255,255,0.5)" />
        <TextInput style={stylesTV.gridSearchInput} placeholder="Buscar series..." placeholderTextColor="rgba(255,255,255,0.4)" value={busqueda} onChangeText={setBusqueda} />
      </View>
      {loading ? (
        <View style={stylesTV.centerLoading}>
          <ActivityIndicator size="large" color="#ff1744" />
          <Text style={stylesTV.loadingText}>Cargando series...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: PlexShow) => item.id}
          numColumns={isTV ? 6 : 4}
          renderItem={renderShow}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#ff1744" colors={['#ff1744']} />}
          contentContainerStyle={{ paddingBottom: isTV ? 40 : 20 }}
        />
      )}
    </View>
  );
});

// ============================================================
// DETALLE DE SERIE (CON KEYS CORREGIDOS)
// ============================================================
const SeriesDetail = memo(({ show, onBack, onPlayEpisode }: { show: PlexShow; onBack: () => void; onPlayEpisode: (ep: PlexEpisode) => void }) => {
  const renderEpisode = ({ item: ep, index }: { item: PlexEpisode; index: number }) => (
    <Focusable style={stylesTV.detailEpisodeRow} onPress={() => onPlayEpisode(ep)} hasTVPreferredFocus={index === 0}>
      <View style={stylesTV.detailEpisodeCodeBox}>
        <Text style={stylesTV.detailEpisodeCode}>{ep.code}</Text>
      </View>
      <Text style={stylesTV.detailEpisodeTitle} numberOfLines={1}>{ep.title}</Text>
      <Ionicons name="play-circle-outline" size={isTV ? 34 : 28} color="rgba(255,255,255,0.6)" />
    </Focusable>
  );

  return (
    <View style={stylesTV.gridContainer}>
      <Focusable style={stylesTV.detailBackBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={isTV ? 34 : 28} color="#fff" />
        <Text style={stylesTV.detailBackText} numberOfLines={1}>{show.title}</Text>
      </Focusable>
      {show.overview ? <Text style={stylesTV.detailOverview} numberOfLines={3}>{show.overview}</Text> : null}
      {(!show.seasons || show.seasons.length === 0) ? (
        <View style={stylesTV.centerLoading}>
          <Text style={stylesTV.loadingText}>No se encontraron episodios para esta serie.</Text>
        </View>
      ) : (
        <FlatList
          data={show.seasons}
          keyExtractor={(s: PlexSeason) => String(s.number)}
          renderItem={({ item: season }) => (
            <View style={stylesTV.detailSeasonBlock}>
              <Text style={stylesTV.gridSectionTitle}>{season.label}</Text>
              {season.episodes.map((ep, idx) => (
                <View key={ep.id || `ep-${idx}`}>
                  {renderEpisode({ item: ep, index: idx })}
                </View>
              ))}
            </View>
          )}
          contentContainerStyle={{ paddingBottom: isTV ? 40 : 30 }}
        />
      )}
    </View>
  );
});

// ============================================================
// COMPONENTE PRINCIPAL AppTV
// ============================================================
export default function AppTV() {
  const [selectedMenu, setSelectedMenu] = useState('TV');
  const [listaCanales, setListaCanales] = useState<Canal[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [currentChannel, setCurrentChannel] = useState<Canal | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLiveFullscreen, setIsLiveFullscreen] = useState(false);
  const [showChannelOverlay, setShowChannelOverlay] = useState(false);
  const [driveMovies, setDriveMovies] = useState<MediaItem[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [plexShows, setPlexShows] = useState<PlexShow[]>([]);
  const [loadingPlex, setLoadingPlex] = useState(false);
  const [animeShows, setAnimeShows] = useState<PlexShow[]>([]);
  const [loadingAnime, setLoadingAnime] = useState(false);
  const [doramasShows, setDoramasShows] = useState<PlexShow[]>([]);
  const [loadingDoramas, setLoadingDoramas] = useState(false);
  const [selectedShow, setSelectedShow] = useState<PlexShow | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'detail'>('grid');
  const [continueWatchingItems, setContinueWatchingItems] = useState<ContinueWatchingItem[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [showProfileScreen, setShowProfileScreen] = useState(true);
  const [searchVisible, setSearchVisible] = useState(false);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playerTitle, setPlayerTitle] = useState<string>('');
  const [playerId, setPlayerId] = useState<string>('');
  const [playerPoster, setPlayerPoster] = useState<string>('');
  const [playerType, setPlayerType] = useState<string>('movie');
  const [playerShowId, setPlayerShowId] = useState<string>('');
  const [playerShowName, setPlayerShowName] = useState<string>('');
  const [playerEpisodeCode, setPlayerEpisodeCode] = useState<string>('');
  const [playerInitialTime, setPlayerInitialTime] = useState<number>(0);
  const [sourceOptions, setSourceOptions] = useState<{ label: string; url: string }[]>([]);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number>(0);
  const [resumeDialogVisible, setResumeDialogVisible] = useState(false);
  const [resumeItem, setResumeItem] = useState<ContinueWatchingItem | null>(null);

  const driveMoviesLoaded = useRef(false);
  const plexLoaded = useRef(false);
  const animeLoaded = useRef(false);
  const doramasLoaded = useRef(false);

  useKeepAwake();

  // ---- CARGAS CON PLEX ----
  const cargarPeliculas = useCallback(async (force = false) => {
    if (force) driveMoviesLoaded.current = false;
    if (loadingDrive || driveMoviesLoaded.current) return;
    setLoadingDrive(true);
    try {
      const items = await cargarPeliculasPlex();
      setDriveMovies(items);
      driveMoviesLoaded.current = true;
    } catch (e) {
      console.log('[MOVIES] ERROR cargando desde Plex', e);
    } finally {
      setLoadingDrive(false);
    }
  }, [loadingDrive]);

  const cargarSeries = useCallback(async (force = false) => {
    if (force) plexLoaded.current = false;
    if (loadingPlex || plexLoaded.current) return;
    setLoadingPlex(true);
    try {
      const shows = await cargarSeriesPlexLocal('Series');
      setPlexShows(shows);
      plexLoaded.current = true;
    } catch (e) {
      console.log('[SERIES] ERROR cargando desde Plex', e);
    } finally {
      setLoadingPlex(false);
    }
  }, [loadingPlex]);

  const cargarAnimePlex = useCallback(async (force = false) => {
    if (force) animeLoaded.current = false;
    if (loadingAnime || animeLoaded.current) return;
    setLoadingAnime(true);
    try {
      const shows = await cargarSeriesPlexLocal('Anime');
      setAnimeShows(shows);
      animeLoaded.current = true;
    } catch (e) {
      console.log('[ANIME] ERROR cargando desde Plex', e);
    } finally {
      setLoadingAnime(false);
    }
  }, [loadingAnime]);

  const cargarDoramasPlex = useCallback(async (force = false) => {
    if (force) doramasLoaded.current = false;
    if (loadingDoramas || doramasLoaded.current) return;
    setLoadingDoramas(true);
    try {
      const shows = await cargarSeriesPlexLocal('Dorama');
      setDoramasShows(shows);
      doramasLoaded.current = true;
    } catch (e) {
      console.log('[DORAMAS] ERROR cargando desde Plex', e);
    } finally {
      setLoadingDoramas(false);
    }
  }, [loadingDoramas]);

  // ---- CARGA DE CANALES M3U ----
  const cargarListaM3U = useCallback(async () => {
    console.log('[M3U] Cargando lista...');
    setLoadingChannels(true);
    try {
      const res = await fetch(`${M3U_URL}?t=${Date.now()}`, { cache: 'no-store' });
      const txt = await res.text();
      const lineas = txt.split('\n');
      const parsed: Canal[] = [];
      let info = { name: '', logo: '', category: 'General' };
      let idx = 20;
      lineas.forEach(l => {
        const lim = l.trim();
        if (lim.startsWith('#EXTINF:')) {
          const parts = lim.split(',');
          info.name = parts[parts.length - 1].trim() || 'Canal';
          info.logo = lim.match(/tvg-logo="([^"]+)"/i)?.[1] ?? '';
          info.category = lim.match(/group-title="([^"]+)"/i)?.[1] ?? 'General';
        } else if (lim.startsWith('http')) {
          let url = convertirMpdAHls(lim);
          const slug = extractEmbedSlug(url);
          parsed.push({
            id: String(3000 + idx),
            numero: idx++,
            name: info.name,
            logo: info.logo,
            category: info.category,
            url,
            ...(slug ? { embedSlug: slug } : {}),
          });
          info = { name: '', logo: '', category: 'General' };
        }
      });
      console.log('[M3U] Cargados', parsed.length, 'canales desde playlist remota');
      setListaCanales([...CANALES_MANUALES, ...parsed]);
      if (parsed.length > 0) {
        const firstChannel = [...CANALES_MANUALES, ...parsed][0];
        setCurrentChannel(firstChannel);
        playChannel(firstChannel);
      }
    } catch (e) {
      console.log('[M3U] ERROR cargando playlist remota, usando solo canales manuales', e);
      setListaCanales(CANALES_MANUALES);
      if (CANALES_MANUALES.length > 0) {
        setCurrentChannel(CANALES_MANUALES[0]);
        playChannel(CANALES_MANUALES[0]);
      }
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  // ---- PERFILES Y CONTINUAR VIENDO ----
  const loadContinueWatching = useCallback(async () => {
    const items = await getContinueWatching();
    setContinueWatchingItems(items);
  }, []);

  const loadProfiles = useCallback(async () => {
    const profs = await getProfiles();
    setProfiles(profs);
    const activeId = await getCurrentProfileId();
    if (activeId && profs.some(p => p.id === activeId)) {
      setCurrentProfileId(activeId);
      const favs = await getFavorites(activeId);
      setFavorites(favs);
      setShowProfileScreen(false);
    } else if (profs.length > 0) {
      const first = profs[0];
      setCurrentProfileId(first.id);
      await setCurrentProfileId(first.id);
      const favs = await getFavorites(first.id);
      setFavorites(favs);
      setShowProfileScreen(false);
    } else {
      setShowProfileScreen(true);
    }
  }, []);

  const handleSelectProfile = async (id: string) => {
    setCurrentProfileId(id);
    await setCurrentProfileId(id);
    const favs = await getFavorites(id);
    setFavorites(favs);
    await loadContinueWatching();
    setShowProfileScreen(false);
  };

  const handleCreateProfile = async (newProfile: Profile) => {
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    await saveProfiles(updated);
    await handleSelectProfile(newProfile.id);
  };

  const handleDeleteProfile = async (id: string) => {
    if (profiles.length <= 1) {
      Alert.alert('Error', 'Debes tener al menos un perfil.');
      return;
    }
    Alert.alert('Eliminar perfil', `¿Eliminar "${profiles.find(p => p.id === id)?.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const updated = profiles.filter(p => p.id !== id);
          setProfiles(updated);
          await saveProfiles(updated);
          if (currentProfileId === id) {
            const newId = updated[0].id;
            setCurrentProfileId(newId);
            await setCurrentProfileId(newId);
            const favs = await getFavorites(newId);
            setFavorites(favs);
            await loadContinueWatching();
          }
        },
      },
    ]);
  };

  // ---- REPRODUCCIÓN DE CANALES CON FALLBACK AUTOMÁTICO ----
  const playChannel = useCallback(async (channel: Canal) => {
    console.log('[CHANNEL] Seleccionando', channel.name, '| embedSlug:', channel.embedSlug, '| url:', channel.url);
    setCurrentChannel(channel);
    setLoadingChannels(true);

    let opts: { label: string; url: string }[] = [];
    if (channel.embedSlug) {
      opts = getSourceOptionsForSlug(channel.embedSlug, channel.category);
      if (channel.url && !opts.some(o => o.url === channel.url)) {
        opts.push({ label: 'Directo', url: channel.url });
      }
      setSourceOptions(opts);
    } else {
      opts = [{ label: 'Directo', url: channel.url }];
      setSourceOptions(opts);
    }

    // Función para intentar una fuente específica
    const trySource = async (index: number): Promise<boolean> => {
      if (index >= opts.length) return false;
      const source = opts[index];
      console.log(`[CHANNEL] Intentando fuente ${index+1}/${opts.length}: ${source.label}`);
      try {
        const streamUrl = await resolveSingleSource(source.url);
        if (streamUrl) {
          setCurrentUrl(streamUrl);
          setSelectedSourceIndex(index);
          return true;
        }
        return false;
      } catch (err) {
        console.log(`[CHANNEL] Fuente ${source.label} falló:`, err);
        return false;
      }
    };

    // Intentar secuencialmente
    let success = false;
    for (let i = 0; i < opts.length; i++) {
      if (await trySource(i)) {
        success = true;
        break;
      }
    }

    if (!success) {
      Alert.alert('Error', `No se pudo cargar ningún stream para ${channel.name}.`);
      setCurrentUrl(null);
    }

    setLoadingChannels(false);
  }, []);

  // Selección manual de fuente (también con fallback automático)
  const selectSource = useCallback(async (index: number) => {
    if (index < 0 || index >= sourceOptions.length) return;
    setSelectedSourceIndex(index);
    setLoadingChannels(true);

    const opts = sourceOptions;
    const trySource = async (idx: number): Promise<boolean> => {
      if (idx >= opts.length) return false;
      const source = opts[idx];
      console.log(`[SOURCE] Intentando fuente ${idx+1}/${opts.length}: ${source.label}`);
      try {
        const streamUrl = await resolveSingleSource(source.url);
        if (streamUrl) {
          setCurrentUrl(streamUrl);
          setSelectedSourceIndex(idx);
          return true;
        }
        return false;
      } catch (err) {
        console.log(`[SOURCE] Fuente ${source.label} falló:`, err);
        return false;
      }
    };

    let success = false;
    for (let i = index; i < opts.length; i++) {
      if (await trySource(i)) {
        success = true;
        break;
      }
    }
    // Si fallaron desde index hasta el final, intentar desde el principio (sin repetir la que ya falló)
    if (!success) {
      for (let i = 0; i < index; i++) {
        if (await trySource(i)) {
          success = true;
          break;
        }
      }
    }

    if (!success) {
      Alert.alert('Error', 'No se pudo cargar ninguna fuente disponible.');
      setCurrentUrl(null);
    }
    setLoadingChannels(false);
  }, [sourceOptions]);

  // ---- FUNCIONES PARA ABRIR REPRODUCTOR ----
  const openPlayer = (item: any, type: string, title: string, url: string, poster: string, showId?: string, showName?: string, episodeCode?: string, initialTime = 0) => {
    if (!url) {
      console.warn('[PLAYER] Se intentó abrir el reproductor sin URL válida para', title);
      Alert.alert('Error', `No se encontró un archivo reproducible para "${title}".`);
      return;
    }
    setPlayerTitle(title);
    setPlayerUrl(url);
    setPlayerId(item.id || item.driveFileId || `temp-${Date.now()}`);
    setPlayerPoster(poster);
    setPlayerType(type);
    setPlayerShowId(showId || '');
    setPlayerShowName(showName || '');
    setPlayerEpisodeCode(episodeCode || '');
    setPlayerInitialTime(initialTime);
    setSourceOptions([]);
    setSelectedSourceIndex(0);
    setPlayerVisible(true);
  };

  const handlePlayWithResume = (item: ContinueWatchingItem) => {
    if (!item.progress || item.progress < 3) {
      openPlayer(item, item.type, item.title, item.streamUrl, item.poster, item.showId, item.showName, item.episodeCode, 0);
      return;
    }
    setResumeItem(item);
    setResumeDialogVisible(true);
  };

  const handleResume = () => {
    if (resumeItem) {
      openPlayer(resumeItem, resumeItem.type, resumeItem.title, resumeItem.streamUrl, resumeItem.poster, resumeItem.showId, resumeItem.showName, resumeItem.episodeCode, resumeItem.progress);
    }
    setResumeDialogVisible(false);
    setResumeItem(null);
  };

  const handleRestart = () => {
    if (resumeItem) {
      openPlayer(resumeItem, resumeItem.type, resumeItem.title, resumeItem.streamUrl, resumeItem.poster, resumeItem.showId, resumeItem.showName, resumeItem.episodeCode, 0);
    }
    setResumeDialogVisible(false);
    setResumeItem(null);
  };

  const handleCancelResume = () => {
    setResumeDialogVisible(false);
    setResumeItem(null);
  };

  // ---- FULLSCREEN ----
  const toggleLiveFullscreen = () => {
    setIsLiveFullscreen(!isLiveFullscreen);
    if (!isLiveFullscreen) setShowChannelOverlay(false);
  };

  // ---- NAVEGACIÓN ----
  const navigateToMenu = (menuId: string) => {
    setSelectedMenu(menuId);
    setViewMode('grid');
    setSelectedShow(null);
    if (menuId === 'DORAMAS') cargarDoramasPlex();
    if (menuId === 'ANIME') cargarAnimePlex();
    if (menuId === 'SERIES') cargarSeries();
    if (menuId === 'PELÍCULAS') cargarPeliculas();
    if (menuId === 'CONTINUAR' || menuId === 'HISTORIAL') loadContinueWatching();
  };

  // ---- MANEJO DE TECLA BACK (TV) ----
  useEffect(() => {
    let tvEventHandler: any;
    if (Platform.isTV) {
      tvEventHandler = new TVEventHandler();
      tvEventHandler.enable(this, (cmp: any, evt: any) => {
        if (evt && evt.eventType === 'back') {
          if (resumeDialogVisible) { handleCancelResume(); }
          else if (playerVisible) { setPlayerVisible(false); }
          else if (showChannelOverlay) { setShowChannelOverlay(false); }
          else if (isLiveFullscreen) { toggleLiveFullscreen(); }
          else if (viewMode === 'detail') { setViewMode('grid'); setSelectedShow(null); }
          else if (searchVisible) { setSearchVisible(false); }
        }
      });
    }
    return () => {
      if (tvEventHandler) tvEventHandler.disable();
    };
  }, [resumeDialogVisible, playerVisible, showChannelOverlay, isLiveFullscreen, viewMode, searchVisible]);

  // ---- INICIALIZACIÓN ----
  useEffect(() => {
    const init = async () => {
      await loadProfiles();
      await cargarListaM3U();
      await cargarPeliculas();
      await cargarSeries();
      await cargarAnimePlex();
      await cargarDoramasPlex();
      await loadContinueWatching();
      await lockLandscape();
    };
    init();
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      console.log('[DIMENSIONS] Cambio detectado ->', window.width, 'x', window.height);
    });
    return () => {
      sub.remove();
    };
  }, []);

  // ---- CONTENIDO DEL CENTRO ----
  const renderCenterContent = () => {
    if (viewMode === 'detail' && selectedShow) {
      return (
        <SeriesDetail
          show={selectedShow}
          onBack={() => { setViewMode('grid'); setSelectedShow(null); }}
          onPlayEpisode={(ep: PlexEpisode) => {
            openPlayer(ep, 'episode', `${selectedShow.title} - ${ep.code}`, ep.streamUrl, ep.poster || selectedShow.poster, selectedShow.id, selectedShow.title, ep.code, 0);
          }}
        />
      );
    }

    if (selectedMenu === 'TV') {
      return (
        <LivePlayerMini
          url={currentUrl}
          channel={currentChannel}
          loading={loadingChannels}
          onToggleFullscreen={toggleLiveFullscreen}
          onToggleChannelOverlay={() => setShowChannelOverlay(!showChannelOverlay)}
          fullscreen={false}
          sourceOptions={sourceOptions}
          selectedSourceIndex={selectedSourceIndex}
          onSelectSource={selectSource}
          onSourceError={() => {
            // Si el reproductor da error, intentar con la siguiente fuente automáticamente
            if (sourceOptions.length > 1 && selectedSourceIndex < sourceOptions.length - 1) {
              selectSource(selectedSourceIndex + 1);
            } else {
              Alert.alert('Error', 'El stream ha fallado y no hay más fuentes disponibles.');
            }
          }}
        />
      );
    } else if (selectedMenu === 'PELÍCULAS') {
      return (
        <MoviesGrid
          items={driveMovies}
          loading={loadingDrive}
          onRefresh={() => cargarPeliculas(true)}
          onPlay={(item: MediaItem) => {
            openPlayer(item, 'movie', item.title, item.streamUrl || '', item.poster, undefined, undefined, undefined, 0);
          }}
        />
      );
    } else if (selectedMenu === 'SERIES') {
      return (
        <SeriesGrid
          shows={plexShows}
          loading={loadingPlex}
          onRefresh={() => cargarSeries(true)}
          onSelectShow={(show: PlexShow) => {
            setSelectedShow(show);
            setViewMode('detail');
          }}
        />
      );
    } else if (selectedMenu === 'ANIME') {
      return (
        <SeriesGrid
          shows={animeShows}
          loading={loadingAnime}
          onRefresh={() => cargarAnimePlex(true)}
          onSelectShow={(show: PlexShow) => {
            setSelectedShow(show);
            setViewMode('detail');
          }}
          title="Anime"
        />
      );
    } else if (selectedMenu === 'DORAMAS') {
      return (
        <SeriesGrid
          shows={doramasShows}
          loading={loadingDoramas}
          onRefresh={() => cargarDoramasPlex(true)}
          onSelectShow={(show: PlexShow) => {
            setSelectedShow(show);
            setViewMode('detail');
          }}
          title="Doramas"
        />
      );
    } else if (selectedMenu === 'CONTINUAR') {
      return <ContinueWatchingView items={continueWatchingItems} onPlay={handlePlayWithResume} />;
    } else if (selectedMenu === 'HISTORIAL') {
      return <HistoryView items={continueWatchingItems} onPlay={handlePlayWithResume} />;
    } else if (selectedMenu === 'AJUSTES') {
      return <SettingsView />;
    } else {
      return (
        <View style={stylesTV.centerPlaceholder}>
          <Text style={stylesTV.placeholderText}>Sección en desarrollo</Text>
        </View>
      );
    }
  };

  // ---- RENDER PRINCIPAL ----
  const currentProfile = profiles.find(p => p.id === currentProfileId);

  if (showProfileScreen) {
    return (
      <View style={stylesTV.container}>
        <StatusBar hidden />
        <ProfileScreen
          profiles={profiles}
          onSelectProfile={handleSelectProfile}
          onCreateProfile={handleCreateProfile}
          onDeleteProfile={handleDeleteProfile}
        />
      </View>
    );
  }

  return (
    <View style={stylesTV.container}>
      <StatusBar hidden />

      <GlobalSearch
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        movies={driveMovies}
        series={plexShows}
        anime={animeShows}
        doramas={doramasShows}
        channels={listaCanales}
        onPlayMedia={openPlayer}
        onSelectShow={(show: PlexShow) => {
          const found = [...plexShows, ...animeShows, ...doramasShows].find(s => s.id === show.id);
          if (found) {
            setSelectedShow(found);
            setViewMode('detail');
            setSelectedMenu('SERIES');
          }
        }}
        onSelectChannel={playChannel}
      />

      <ResumeDialog
        visible={resumeDialogVisible}
        item={resumeItem}
        onResume={handleResume}
        onRestart={handleRestart}
        onCancel={handleCancelResume}
      />

      {playerVisible && playerUrl && (
        <ReproductorMejorado
          url={playerUrl}
          onClose={() => setPlayerVisible(false)}
          title={playerTitle}
          id={playerId}
          poster={playerPoster}
          type={playerType}
          showId={playerShowId}
          showName={playerShowName}
          episodeCode={playerEpisodeCode}
          sourceOptions={sourceOptions}
          selectedSourceIndex={selectedSourceIndex}
          onSelectSource={selectSource}
          initialTime={playerInitialTime}
        />
      )}

      {selectedMenu === 'TV' && isLiveFullscreen ? (
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#000' }}>
          <View style={{ flex: 1 }}>
            <LivePlayerMini
              url={currentUrl}
              channel={currentChannel}
              loading={loadingChannels}
              onToggleFullscreen={toggleLiveFullscreen}
              onToggleChannelOverlay={() => setShowChannelOverlay(!showChannelOverlay)}
              fullscreen={true}
              sourceOptions={sourceOptions}
              selectedSourceIndex={selectedSourceIndex}
              onSelectSource={selectSource}
              onSourceError={() => {
                if (sourceOptions.length > 1 && selectedSourceIndex < sourceOptions.length - 1) {
                  selectSource(selectedSourceIndex + 1);
                } else {
                  Alert.alert('Error', 'El stream ha fallado y no hay más fuentes disponibles.');
                }
              }}
            />
          </View>
          {showChannelOverlay && (
            <View style={stylesTV.channelListOverlayContainer}>
              <ChannelList
                channels={listaCanales}
                currentChannel={currentChannel}
                favorites={favorites}
                onSelectChannel={playChannel}
                onToggleFavorite={async (id: string) => {
                  const newFavs = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id];
                  setFavorites(newFavs);
                  await saveFavorites(newFavs);
                }}
                onClose={() => setShowChannelOverlay(false)}
                isOverlay={true}
              />
            </View>
          )}
        </View>
      ) : (
        <View style={stylesTV.layout}>
          <View style={stylesTV.leftPanel}>
            <View style={stylesTV.logoContainer}>
              <Text style={stylesTV.logoText}>NEXUS<Text style={stylesTV.logoAccent}>TV</Text></Text>
            </View>
            <FlatList
              data={[
                { id: 'TV', label: 'TV', icon: 'tv' },
                { id: 'PELÍCULAS', label: 'PELÍCULAS', icon: 'film' },
                { id: 'SERIES', label: 'SERIES', icon: 'tv-outline' },
                { id: 'ANIME', label: 'ANIME', icon: 'brush' },
                { id: 'DORAMAS', label: 'DORAMAS', icon: 'heart' },
              ]}
              keyExtractor={item => item.id}
              renderItem={({ item }) => {
                const isActive = selectedMenu === item.id;
                return (
                  <Focusable
                    style={[stylesTV.menuItem, isActive && stylesTV.menuItemActive]}
                    onPress={() => navigateToMenu(item.id)}
                    hasTVPreferredFocus={item.id === 'TV'}
                  >
                    <Ionicons
                      name={item.icon as any}
                      size={isTV ? 28 : 22}
                      color={isActive ? '#ff1744' : 'rgba(255,255,255,0.6)'}
                      style={stylesTV.menuIcon}
                    />
                    <Text style={[stylesTV.menuText, isActive && stylesTV.menuTextActive]}>
                      {item.label}
                    </Text>
                    {isActive && <View style={stylesTV.menuIndicator} />}
                  </Focusable>
                );
              }}
              contentContainerStyle={{ paddingBottom: isTV ? 60 : 40 }}
            />
          </View>

          <View style={[stylesTV.centerPanel, { overflow: 'hidden' }]}>
            <AppHeader
              userName={currentProfile?.name || 'Invitado'}
              avatarUrl={undefined}
              onSettingsPress={() => navigateToMenu('AJUSTES')}
              onHistoryPress={() => { navigateToMenu('HISTORIAL'); loadContinueWatching(); }}
              onContinueWatchingPress={() => { navigateToMenu('CONTINUAR'); loadContinueWatching(); }}
              onSearchPress={() => setSearchVisible(true)}
              onProfilePress={() => setShowProfileScreen(true)}
            />
            <View style={{ flex: 1, overflow: 'hidden' }}>
              {renderCenterContent()}
            </View>
          </View>

          {selectedMenu === 'TV' && viewMode !== 'detail' && (
            <View style={stylesTV.rightPanel}>
              <ChannelList
                channels={listaCanales}
                currentChannel={currentChannel}
                favorites={favorites}
                onSelectChannel={playChannel}
                onToggleFavorite={async (id: string) => {
                  const newFavs = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id];
                  setFavorites(newFavs);
                  await saveFavorites(newFavs);
                }}
                isOverlay={false}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ============================================================
// ESTILOS (RENOVADOS Y COMPLETOS)
// ============================================================
const stylesTV = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
  },
  leftPanel: {
    width: isTV ? 240 : 190,
    backgroundColor: 'rgba(20, 15, 35, 0.85)',
    backdropFilter: 'blur(25px)',
    paddingVertical: isTV ? 40 : 25,
    paddingHorizontal: isTV ? 20 : 15,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 25,
  },
  logoContainer: {
    marginBottom: isTV ? 60 : 40,
    paddingLeft: 10,
  },
  logoText: {
    color: '#fff',
    fontSize: isTV ? 44 : 34,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: 'rgba(255,23,68,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 20,
  },
  logoAccent: {
    color: '#ff1744',
    textShadowColor: 'rgba(255,23,68,0.9)',
    textShadowRadius: 25,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: isTV ? 18 : 14,
    paddingHorizontal: isTV ? 20 : 16,
    marginBottom: isTV ? 8 : 4,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  menuItemActive: {
    backgroundColor: 'rgba(255,23,68,0.12)',
    borderRightWidth: 4,
    borderRightColor: '#ff1744',
    borderColor: 'rgba(255,23,68,0.3)',
  },
  menuIcon: {
    marginRight: isTV ? 18 : 14,
    textShadowColor: 'rgba(255,23,68,0.3)',
    textShadowRadius: 10,
  },
  menuText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: isTV ? 20 : 16,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  menuTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
    textShadowColor: 'rgba(255,23,68,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  menuIndicator: {
    position: 'absolute',
    right: 0,
    top: '15%',
    height: '70%',
    width: 4,
    backgroundColor: '#ff1744',
    borderRadius: 4,
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 15,
  },
  centerPanel: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  centerPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: isTV ? 32 : 22,
    fontWeight: '600',
    letterSpacing: 2,
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  rightPanel: {
    width: isTV ? 340 : 280,
    backgroundColor: 'rgba(20, 15, 35, 0.85)',
    backdropFilter: 'blur(25px)',
    paddingVertical: isTV ? 25 : 15,
    paddingHorizontal: isTV ? 15 : 10,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 25,
  },
  channelListContainer: {
    flex: 1,
  },
  channelListOverlay: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: isTV ? 340 : 280,
    backgroundColor: 'rgba(20, 15, 35, 0.96)',
    backdropFilter: 'blur(30px)',
    paddingVertical: isTV ? 25 : 15,
    paddingHorizontal: isTV ? 15 : 10,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.1)',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: -10, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 40,
    elevation: 35,
  },
  channelListOverlayContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: isTV ? 340 : 280,
    zIndex: 20,
  },
  channelListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: isTV ? 20 : 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginBottom: isTV ? 15 : 10,
  },
  rightTitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: isTV ? 22 : 17,
    fontWeight: '800',
    letterSpacing: 2,
    textShadowColor: 'rgba(255,23,68,0.3)',
    textShadowRadius: 8,
  },
  closeOverlayBtn: {
    padding: isTV ? 12 : 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: isTV ? 16 : 12,
    paddingHorizontal: isTV ? 16 : 12,
    borderRadius: 12,
    marginBottom: isTV ? 6 : 4,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  channelItemActive: {
    backgroundColor: 'rgba(255,23,68,0.12)',
    borderLeftWidth: 4,
    borderLeftColor: '#ff1744',
    borderColor: 'rgba(255,23,68,0.25)',
  },
  channelLogoContainer: {
    width: isTV ? 56 : 44,
    height: isTV ? 56 : 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: isTV ? 16 : 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  channelLogo: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  channelLogoFallback: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: isTV ? 22 : 16,
    fontWeight: '800',
  },
  channelInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  channelName: {
    color: '#FFFFFF',
    fontSize: isTV ? 18 : 15,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  channelNow: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: isTV ? 14 : 12,
    marginTop: 2,
  },
  channelActiveIndicator: {
    marginLeft: 4,
  },
  headerContainer: {
    height: isTV ? 80 : 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: isTV ? 30 : 20,
    backgroundColor: 'rgba(10, 10, 26, 0.7)',
    backdropFilter: 'blur(20px)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: isTV ? 16 : 12,
  },
  avatar: {
    width: isTV ? 48 : 36,
    height: isTV ? 48 : 36,
    borderRadius: isTV ? 24 : 18,
    borderWidth: 2,
    borderColor: 'rgba(255,23,68,0.4)',
  },
  avatarPlaceholder: {
    width: isTV ? 48 : 36,
    height: isTV ? 48 : 36,
    borderRadius: isTV ? 24 : 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,23,68,0.6)',
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  userName: {
    color: '#fff',
    fontSize: isTV ? 22 : 18,
    fontWeight: '700',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: isTV ? 30 : 20,
    paddingVertical: isTV ? 10 : 6,
    paddingHorizontal: isTV ? 18 : 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  headerBtnPrimary: {
    backgroundColor: 'rgba(255,23,68,0.15)',
    borderColor: 'rgba(255,23,68,0.3)',
  },
  headerBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  headerBtnText: {
    color: '#fff',
    fontSize: isTV ? 18 : 14,
    fontWeight: '600',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  liveContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  miniControls: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: isTV ? 25 : 15,
  },
  miniTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: isTV ? 20 : 10,
  },
  miniTitle: {
    color: '#fff',
    fontSize: isTV ? 30 : 22,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    letterSpacing: 0.5,
  },
  miniActions: {
    flexDirection: 'row',
    gap: isTV ? 16 : 12,
  },
  miniBtn: {
    padding: isTV ? 14 : 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backdropFilter: 'blur(10px)',
  },
  miniCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPlayBtn: {
    padding: 8,
  },
  miniPlayGradient: {
    width: isTV ? 110 : 80,
    height: isTV ? 110 : 80,
    borderRadius: isTV ? 55 : 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 20,
  },
  messagesSection: {
    flex: 0.35,
    backgroundColor: 'rgba(10,10,26,0.85)',
    backdropFilter: 'blur(20px)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  messagesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: isTV ? 20 : 16,
    paddingHorizontal: isTV ? 32 : 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  messageIcon: {
    marginRight: isTV ? 16 : 12,
  },
  messageText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: isTV ? 20 : 16,
    fontWeight: '500',
    textAlign: 'center',
    flex: 1,
    letterSpacing: 0.3,
  },
  gridContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: isTV ? 30 : 20,
    paddingTop: isTV ? 30 : 20,
  },
  gridSectionTitle: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: isTV ? 30 : 24,
    fontWeight: '800',
    marginBottom: isTV ? 20 : 15,
    letterSpacing: 1.5,
    textShadowColor: 'rgba(255,23,68,0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  gridSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    paddingHorizontal: isTV ? 20 : 16,
    marginBottom: isTV ? 25 : 20,
    height: isTV ? 60 : 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(10px)',
  },
  gridSearchInput: {
    flex: 1,
    color: '#fff',
    fontSize: isTV ? 20 : 16,
    marginLeft: isTV ? 16 : 12,
    fontWeight: '400',
  },
  gridItem: {
    width: isTV ? '15%' : '23%',
    marginRight: isTV ? '2%' : '2%',
    marginBottom: isTV ? 32 : 24,
    alignItems: 'center',
  },
  gridPosterContainer: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 16,
    backgroundColor: '#1a1a2e',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 10,
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  gridPoster: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  gridRating: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: isTV ? 12 : 8,
    paddingVertical: isTV ? 6 : 4,
    borderRadius: 12,
    backdropFilter: 'blur(5px)',
  },
  gridRatingText: {
    color: '#fff',
    fontSize: isTV ? 16 : 12,
    marginLeft: 4,
    fontWeight: '700',
  },
  gridTitle: {
    color: '#fff',
    fontSize: isTV ? 18 : 14,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    letterSpacing: 0.3,
  },
  gridYear: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: isTV ? 16 : 12,
    textAlign: 'center',
    marginTop: 2,
    fontWeight: '500',
  },
  detailBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: isTV ? 20 : 12,
    paddingVertical: isTV ? 12 : 8,
    paddingHorizontal: isTV ? 18 : 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'flex-start',
  },
  detailBackText: {
    color: '#fff',
    fontSize: isTV ? 22 : 18,
    fontWeight: '700',
    marginLeft: 6,
  },
  detailOverview: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: isTV ? 18 : 14,
    marginBottom: isTV ? 28 : 20,
    lineHeight: isTV ? 26 : 20,
    paddingHorizontal: 4,
    letterSpacing: 0.3,
  },
  detailSeasonBlock: {
    marginBottom: isTV ? 36 : 28,
  },
  detailEpisodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: isTV ? 18 : 14,
    paddingHorizontal: isTV ? 16 : 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    marginBottom: isTV ? 8 : 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  detailEpisodeCodeBox: {
    backgroundColor: 'rgba(255,23,68,0.15)',
    paddingHorizontal: isTV ? 14 : 10,
    paddingVertical: isTV ? 8 : 6,
    borderRadius: 8,
    marginRight: isTV ? 18 : 14,
    borderWidth: 1,
    borderColor: 'rgba(255,23,68,0.2)',
  },
  detailEpisodeCode: {
    color: '#ff1744',
    fontSize: isTV ? 16 : 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailEpisodeTitle: {
    color: '#fff',
    fontSize: isTV ? 18 : 15,
    flex: 1,
    fontWeight: '500',
  },
  modalFullscreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    zIndex: 10,
  },
  modalControls: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingHorizontal: isTV ? 30 : 20,
    paddingVertical: isTV ? 60 : 40,
  },
  modalControlTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  playerTitle: {
    color: '#fff',
    fontSize: isTV ? 28 : 22,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    flex: 1,
    letterSpacing: 0.5,
  },
  sourceBtn: {
    padding: isTV ? 12 : 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 30,
    marginLeft: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalControlCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: isTV ? 40 : 30,
  },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  modalPlayBtn: {
    width: isTV ? 110 : 90,
    height: isTV ? 110 : 90,
    borderRadius: isTV ? 55 : 45,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 30,
    elevation: 20,
  },
  modalPlayGradient: {
    width: '100%',
    height: '100%',
    borderRadius: isTV ? 55 : 45,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalControlBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: isTV ? 20 : 16,
  },
  modalError: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  controlLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: isTV ? 16 : 12,
    marginTop: 2,
    fontWeight: '600',
  },
  timeText: {
    color: '#fff',
    fontSize: isTV ? 20 : 16,
    fontWeight: '600',
    minWidth: isTV ? 70 : 50,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
  },
  errorText: {
    color: '#fff',
    fontSize: isTV ? 24 : 18,
    marginTop: 16,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  progressTrack: {
    flex: 1,
    height: isTV ? 14 : 10,
    justifyContent: 'center',
    position: 'relative',
  },
  progressBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: isTV ? 6 : 4,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    height: isTV ? 8 : 6,
    borderRadius: 4,
    backgroundColor: '#ff1744',
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
  },
  progressThumb: {
    position: 'absolute',
    width: isTV ? 30 : 24,
    height: isTV ? 30 : 24,
    borderRadius: isTV ? 15 : 12,
    top: isTV ? -12 : -9,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    marginLeft: isTV ? -15 : -12,
    borderWidth: 2,
    borderColor: '#ff1744',
  },
  sourceModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  sourceModalContent: {
    width: isTV ? '60%' : '85%',
    maxHeight: '70%',
    backgroundColor: 'rgba(20, 15, 35, 0.95)',
    borderRadius: 24,
    padding: isTV ? 30 : 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 30,
  },
  sourceModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: isTV ? 25 : 20,
  },
  sourceModalTitle: {
    color: '#fff',
    fontSize: isTV ? 28 : 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sourceOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: isTV ? 18 : 14,
    paddingHorizontal: isTV ? 16 : 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  sourceOptionSelected: {
    backgroundColor: 'rgba(255,23,68,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,23,68,0.3)',
  },
  sourceOptionText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: isTV ? 20 : 16,
    fontWeight: '500',
  },
  sourceOptionTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  resumeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  resumeContent: {
    width: isTV ? '60%' : '85%',
    backgroundColor: 'rgba(20, 15, 35, 0.95)',
    borderRadius: 24,
    padding: isTV ? 30 : 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 30,
  },
  resumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: isTV ? 20 : 16,
  },
  resumeTitle: {
    color: '#fff',
    fontSize: isTV ? 28 : 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  resumePoster: {
    width: isTV ? 160 : 120,
    height: isTV ? 240 : 180,
    borderRadius: 16,
    marginBottom: isTV ? 20 : 16,
    backgroundColor: '#2a2a3e',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  resumeItemTitle: {
    color: '#fff',
    fontSize: isTV ? 22 : 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: isTV ? 12 : 8,
    letterSpacing: 0.3,
  },
  resumeProgressText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: isTV ? 20 : 16,
    marginBottom: isTV ? 25 : 20,
    fontWeight: '500',
  },
  resumeButtons: {
    width: '100%',
  },
  resumeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: isTV ? 18 : 14,
    borderRadius: 14,
    marginBottom: isTV ? 16 : 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  resumeBtnPrimary: {
    backgroundColor: '#ff1744',
    borderColor: 'rgba(255,23,68,0.5)',
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 10,
  },
  resumeBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  resumeBtnText: {
    color: '#fff',
    fontSize: isTV ? 20 : 16,
    fontWeight: '700',
    marginLeft: 10,
    letterSpacing: 0.3,
  },
  profileFullScreen: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileFullContent: {
    width: '80%',
    maxWidth: 1000,
    alignItems: 'center',
  },
  profileFullTitle: {
    color: '#fff',
    fontSize: isTV ? 52 : 36,
    fontWeight: '900',
    marginBottom: isTV ? 50 : 30,
    textShadowColor: 'rgba(255,23,68,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 20,
    letterSpacing: 2,
  },
  profileFullList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: isTV ? 30 : 20,
  },
  profileFullItem: {
    alignItems: 'center',
    padding: isTV ? 20 : 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: isTV ? 150 : 110,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  profileFullAvatarContainer: {
    position: 'relative',
    marginBottom: 10,
  },
  profileFullAvatar: {
    fontSize: isTV ? 80 : 54,
    width: isTV ? 130 : 90,
    height: isTV ? 130 : 90,
    textAlign: 'center',
    lineHeight: isTV ? 130 : 90,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 65,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  profileFullDelete: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 14,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,23,68,0.3)',
  },
  profileFullName: {
    color: '#fff',
    fontSize: isTV ? 22 : 17,
    fontWeight: '700',
    marginTop: 8,
    letterSpacing: 0.5,
  },
  profileFullAdd: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: isTV ? 20 : 12,
    minWidth: isTV ? 150 : 110,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
    borderStyle: 'dashed',
  },
  profileFullAddCircle: {
    width: isTV ? 130 : 90,
    height: isTV ? 130 : 90,
    borderRadius: 65,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  profileFullAddText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: isTV ? 18 : 14,
    marginTop: 8,
    fontWeight: '600',
  },
  profileFullHint: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: isTV ? 20 : 15,
    marginTop: isTV ? 40 : 20,
    letterSpacing: 1,
    fontWeight: '400',
  },
  profileCreateFull: {
    width: '60%',
    maxWidth: 500,
    backgroundColor: 'rgba(20, 15, 35, 0.95)',
    borderRadius: 28,
    padding: isTV ? 40 : 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 30,
  },
  profileCreateTitleFull: {
    color: '#fff',
    fontSize: isTV ? 34 : 26,
    fontWeight: '800',
    marginBottom: 30,
    letterSpacing: 0.5,
  },
  profileInputFull: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: isTV ? 20 : 16,
    padding: isTV ? 16 : 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 24,
  },
  profileCreateActionsFull: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
  },
  searchContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    paddingTop: isTV ? 40 : 20,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: isTV ? 30 : 20,
    paddingBottom: isTV ? 20 : 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: isTV ? 26 : 20,
    marginLeft: isTV ? 16 : 12,
    backgroundColor: 'transparent',
    fontWeight: '500',
  },
  searchEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchEmptyText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: isTV ? 24 : 18,
    marginTop: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  searchResultsList: {
    padding: isTV ? 20 : 12,
  },
  searchResultItem: {
    flexDirection: 'row',
    padding: isTV ? 16 : 12,
    marginBottom: isTV ? 12 : 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    flex: 1,
    marginHorizontal: isTV ? 8 : 4,
  },
  searchResultPoster: {
    width: isTV ? 80 : 60,
    height: isTV ? 120 : 90,
    borderRadius: 10,
    marginRight: isTV ? 16 : 12,
  },
  searchResultInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  searchResultTitle: {
    color: '#fff',
    fontSize: isTV ? 20 : 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  searchResultSource: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: isTV ? 16 : 12,
    marginTop: 4,
  },
  searchResultYear: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: isTV ? 14 : 10,
  },
  searchResultNow: {
    color: '#ff1744',
    fontSize: isTV ? 16 : 12,
    marginTop: 4,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: isTV ? 22 : 17,
    marginTop: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  continueProgressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: isTV ? 8 : 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  continueProgressFill: {
    height: isTV ? 8 : 6,
    backgroundColor: '#ff1744',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  focused: {
    borderColor: '#ff1744',
    borderWidth: 2,
    shadowColor: '#ff1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 25,
    transform: [{ scale: 1.05 }],
  },
  settingsContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: isTV ? 40 : 30,
    paddingTop: isTV ? 40 : 30,
  },
  settingsCard: {
    backgroundColor: 'rgba(20, 15, 35, 0.8)',
    borderRadius: 20,
    padding: isTV ? 32 : 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(20px)',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: isTV ? 16 : 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  settingsLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: isTV ? 20 : 16,
    fontWeight: '500',
    marginLeft: isTV ? 20 : 14,
    flex: 1,
    letterSpacing: 0.3,
  },
  settingsValue: {
    color: '#fff',
    fontSize: isTV ? 20 : 16,
    fontWeight: '600',
  },
  settingsWhatsAppBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: isTV ? 30 : 20,
    paddingVertical: isTV ? 18 : 12,
    backgroundColor: 'rgba(37,211,102,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(37,211,102,0.3)',
  },
  settingsWhatsAppText: {
    color: '#25D366',
    fontSize: isTV ? 22 : 18,
    fontWeight: '700',
    marginLeft: 12,
    letterSpacing: 0.5,
  },
});
