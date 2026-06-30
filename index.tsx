import React, { useState, useEffect, useRef, useCallback, memo, forwardRef, useImperativeHandle } from 'react';
import {
  StyleSheet, Text, View, ActivityIndicator, TextInput, StatusBar,
  Dimensions, PanResponder, FlatList, TouchableOpacity, ScrollView,
  Animated, Easing, Image, Platform, UIManager, LayoutAnimation,
  RefreshControl, Modal, Alert, TouchableWithoutFeedback, Pressable,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MMKV } from 'react-native-mmkv';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: W, height: H } = Dimensions.get('window');
const storage = new MMKV();

/* ═══════════════════════════════════════════════════════════
   CONFIGURACIÓN
═══════════════════════════════════════════════════════════ */
const TMDB_API_KEY           = 'cd567a4b1c99d7e5acebd57afda5a196';
const GOOGLE_DRIVE_API_KEY   = 'AIzaSyAsQYU7JBhGalFd8woneHClsm5FJdOTHF4';
const DRIVE_FOLDER_PELICULAS = '10G68TcC3ywAUfyXz82QntyCRwb-2yKq2';
const DRIVE_FOLDER_SERIES    = '1J4v2HMFaKy2ZKg20QU7kmH7k7rRV13Zh';
const M3U_URL                = 'https://naphdev.online/list.m3u';
const EMBED_BASE             = 'https://embed.saohgdasregions.fun/embed2';

const ACCENT_COLORS: Record<string, string> = {
  red:    '#E50914',
  violet: '#6C63FF',
  blue:   '#3B82F6',
  green:  '#10B981',
};

/* ═══════════════════════════════════════════════════════════
   DESIGN TOKENS (mejorados)
═══════════════════════════════════════════════════════════ */
const T = {
  color: {
    bg:              '#07070F',
    surface:         '#0E0E1C',
    surfaceElevated: '#151526',
    surfaceHigh:     '#1C1C32',
    border:          'rgba(255,255,255,0.07)',
    borderAccent:    'rgba(255,255,255,0.12)',
    primary:         '#E50914',
    primaryDim:      'rgba(229,9,20,0.15)',
    gold:            '#F5A623',
    textPrimary:     '#FFFFFF',
    textSecondary:   'rgba(255,255,255,0.65)',
    textMuted:       'rgba(255,255,255,0.32)',
    success:         '#21D07A',
    live:            '#FF2D55',
    glassWhite:      'rgba(255,255,255,0.06)',
    glassBorder:     'rgba(255,255,255,0.10)',
    glassBackground: 'rgba(30,30,50,0.75)',
  },
  font: {
    xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, xxl: 30, hero: 38,
    regular: '400' as const, medium: '500' as const, semibold: '600' as const,
    bold: '700' as const, extrabold: '800' as const, black: '900' as const,
  },
  space: { xs: 4, sm: 8, md: 14, lg: 20, xl: 28, xxl: 40 },
  radius: { sm: 6, md: 10, lg: 16, xl: 22, xxl: 28, full: 999 },
};

const IS_TV     = Platform.isTV || W >= 960;
const IS_TABLET = !IS_TV && W >= 600;
const IS_SMALL  = !IS_TV && !IS_TABLET && W <= 480;
const SCALE     = IS_TV ? 1.6 : IS_TABLET ? 1.25 : IS_SMALL ? 0.88 : 1;
const s         = (n: number) => Math.round(n * SCALE);

const LIVE_PLAYER_H = IS_TV ? Math.round(W * 0.38) : IS_TABLET ? 240 : IS_SMALL ? 160 : 210;
const MEDIA_COLS    = IS_TV ? 4 : IS_TABLET ? 3 : 2;
const CARD_W = (W - T.space.lg * 2 - T.space.md * (MEDIA_COLS - 1)) / MEDIA_COLS;
const CARD_H = CARD_W * 1.5 + 70;

/* ═══════════════════════════════════════════════════════════
   TIPOS
═══════════════════════════════════════════════════════════ */
interface Canal {
  id: string; numero: number; name: string; url: string;
  logo: string; category: string; nowPlaying?: string;
  needsWebView?: boolean; embedSlug?: string;
}
interface MediaItem {
  id: string; title: string; poster: string; backdrop?: string; genre?: string;
  year?: number; rating?: string; seasons?: number; overview?: string;
  type?: 'movie' | 'tv'; custom?: boolean; streamUrl?: string; driveFileId?: string;
}
interface PlexShow {
  id: string; title: string; poster: string; backdrop?: string;
  year?: number; rating?: string; overview?: string; seasons: PlexSeason[];
}
interface PlexSeason { number: number; label: string; episodes: PlexEpisode[]; }
interface PlexEpisode {
  id: string; code: string; title: string; streamUrl: string;
  driveFileId: string; fileName: string; poster?: string;
  overview?: string; airDate?: string; runtime?: number;
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
  season?: number;
  episode?: number;
}

/* ═══════════════════════════════════════════════════════════
   UTILIDADES
═══════════════════════════════════════════════════════════ */
const PROXY_URL = 'https://br.naphdev.dpdns.org/stream';
function driveStreamUrl(fileId: string): string { return `${PROXY_URL}/${fileId}`; }
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

/* ═══════════════════════════════════════════════════════════
   CANALES MANUALES
═══════════════════════════════════════════════════════════ */
const CANALES_MANUALES: Canal[] = [
  { id: 'man-1',  numero: 1,  name: 'DSports',        embedSlug: 'directvsports',    logo: 'https://upload.wikimedia.org/wikipedia/commons/0/05/DirecTV_Sports_logo.svg', category: 'Deportes', nowPlaying: 'Fútbol: Copa Libertadores', url: '' },
  { id: 'man-2',  numero: 2,  name: 'DSports 2',      embedSlug: 'directvsports2',   logo: '', category: 'Deportes', nowPlaying: 'Tenis: Wimbledon',       url: '' },
  { id: 'man-3',  numero: 3,  name: 'DSports +',      embedSlug: 'directvsportsplus', logo: '', category: 'Deportes', nowPlaying: 'Motociclismo: MotoGP',   url: '' },
  { id: 'man-4',  numero: 4,  name: 'TyC Sports',     embedSlug: 'tycsports',        logo: '', category: 'Deportes', nowPlaying: 'Noticias Deportivas',    url: '' },
  { id: 'man-5',  numero: 5,  name: 'TNT Sports',     embedSlug: 'tntsports',        logo: '', category: 'Deportes', nowPlaying: 'Fútbol Argentino',       url: '' },
  { id: 'man-6',  numero: 6,  name: 'ESPN Premium',   embedSlug: 'espnpremium',      logo: '', category: 'Deportes', nowPlaying: 'Fútbol Europeo',         url: '' },
  { id: 'man-7',  numero: 7,  name: 'ESPN 1',         embedSlug: 'espn',             logo: '', category: 'Deportes', nowPlaying: 'Baloncesto NBA',         url: '' },
  { id: 'man-8',  numero: 8,  name: 'ESPN 2',         embedSlug: 'espn2',            logo: '', category: 'Deportes', nowPlaying: 'Béisbol MLB',            url: '' },
  { id: 'man-9',  numero: 9,  name: 'ESPN 3',         embedSlug: 'espn3',            logo: '', category: 'Deportes', nowPlaying: 'Análisis Deportivo',     url: '' },
  { id: 'man-10', numero: 10, name: 'ESPN 4',         embedSlug: 'espn4',            logo: '', category: 'Deportes', nowPlaying: 'Rugby',                  url: '' },
  { id: 'man-11', numero: 11, name: 'ESPN 5',         embedSlug: 'espn5',            logo: '', category: 'Deportes', nowPlaying: 'Hockey',                 url: '' },
  { id: 'man-12', numero: 12, name: 'Claro Sports',   embedSlug: 'clarosports',      logo: '', category: 'Deportes', nowPlaying: 'Deportes en Vivo',       url: '' },
  { id: 'man-13', numero: 13, name: 'TNT Series',     embedSlug: 'tntseries',        logo: '', category: 'Entretenimiento', nowPlaying: 'Series 24/7',  url: '' },
  { id: 'man-14', numero: 14, name: 'Disney Channel', embedSlug: 'disney',           logo: '', category: 'Entretenimiento', nowPlaying: 'Disney 24/7',  url: '' },
  { id: 'man-15', numero: 15, name: 'TNT',            embedSlug: 'tnt',              logo: '', category: 'Entretenimiento', nowPlaying: 'TNT 24/7',     url: '' },
  { id: 'man-16', numero: 16, name: 'Warner Channel', embedSlug: 'warner',           logo: '', category: 'Entretenimiento', nowPlaying: 'Warner 24/7',  url: '' },
  { id: 'man-17', numero: 17, name: 'FX',             embedSlug: 'fx',               logo: '', category: 'Entretenimiento', nowPlaying: 'FX 24/7',      url: '' },
  { id: 'man-18', numero: 18, name: 'Comedy Central', embedSlug: 'comedy',           logo: '', category: 'Entretenimiento', nowPlaying: 'Comedy 24/7',  url: '' },
  { id: 'man-19', numero: 19, name: 'Golden',         embedSlug: 'golden',           logo: '', category: 'Entretenimiento', nowPlaying: 'Golden',        url: '' },
  { id: 'man-20', numero: 20, name: 'Golden Edge',    embedSlug: 'goldenedge',       logo: '', category: 'Entretenimiento', nowPlaying: 'Golden',        url: '' },
].map(c => ({ ...c, needsWebView: true, url: c.embedSlug ? `${EMBED_BASE}/${c.embedSlug}.html` : c.url }));

/* ═══════════════════════════════════════════════════════════
   FALLBACKS TMDB
═══════════════════════════════════════════════════════════ */
const MOVIES_FALLBACK: MediaItem[] = [
  { id: 'mov1', title: 'Inception',    poster: 'https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg', genre: 'Ciencia ficción', year: 2010, rating: '8.8', type: 'movie' },
  { id: 'mov2', title: 'Interstellar', poster: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', genre: 'Ciencia ficción', year: 2014, rating: '8.6', type: 'movie' },
];
const SERIES_FALLBACK: MediaItem[] = [
  { id: 'ser1', title: 'Breaking Bad',    poster: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', genre: 'Drama',          seasons: 5, rating: '9.5', type: 'tv' },
  { id: 'ser2', title: 'Stranger Things', poster: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg', genre: 'Ciencia ficción', seasons: 4, rating: '8.7', type: 'tv' },
];

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function esUrlManifiesto(v: string) { return /(\.m3u8|\.mpd)(\?|#|$)/i.test(v); }
function extraerManifiesto(txt: string): string | null {
  const m = (txt || '').trim().match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mpd)(?:\?[^\s"'<>]*)?/i);
  return m ? m[0] : null;
}
function cacheBust(url: string) { return `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`; }
function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
async function lockLandscape() {
  try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE); } catch (_) {}
}
async function lockPortrait() {
  try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════
   PLEX — PARSE FILENAME
═══════════════════════════════════════════════════════════ */
function esTituloEpisodioValido(t: string): boolean {
  if (!t || t.length < 2) return false;
  const letras = t.replace(/[0-9\s]/g, '');
  return letras.length >= 2;
}
function parsePlexEpisode(nombre: string): { showName: string; season: number; episode: number; episodeTitle?: string } | null {
  const patterns = [
    /^(.*?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,3})[.\s_-]*(.*?)\.(?:mp4|mkv|avi|mov|webm|m4v)$/i,
    /^(.*?)[.\s_-]+(\d{1,2})x(\d{1,3})[.\s_-]*(.*?)\.(?:mp4|mkv|avi|mov|webm|m4v)$/i,
    /^(.*?)[.\s_-]+[Tt](\d{1,2})[Ee](\d{1,3})[.\s_-]*(.*?)\.(?:mp4|mkv|avi|mov|webm|m4v)$/i,
  ];
  for (const pat of patterns) {
    const m = nombre.match(pat);
    if (m) {
      const showRaw  = m[1].replace(/[._]/g, ' ').trim();
      const sn       = parseInt(m[2], 10);
      const ep       = parseInt(m[3], 10);
      let rawTitle   = (m[4] || '').replace(/[._]/g, ' ').trim()
        .replace(/\b(1080p|720p|2160p|4k|hdr|web[-]?dl|bluray|brrip|hdtv|x264|x265|hevc|aac|dual|latino|castellano|subtitulado|proper|repack|internal|dubbed|subbed|español|ingles|cap(itulo)?s?|temporada)\b/gi, '')
        .replace(/\bS\d{1,2}(E\d{1,2})?\b/gi, '')
        .replace(/\b\d{3,4}p\b/gi, '')
        .replace(/\s{2,}/g, ' ').trim();
      const epTitle = esTituloEpisodioValido(rawTitle) ? rawTitle : undefined;
      return { showName: showRaw, season: sn, episode: ep, episodeTitle: epTitle };
    }
  }
  return null;
}
function limpiarNombreArchivo(nombre: string): { titulo: string; anio?: number } {
  let n = nombre.replace(/\.(mp4|mkv|avi|mov|webm|m4v)$/i, '');
  const matchAnio = n.match(/\b(19|20)\d{2}\b/);
  const anio = matchAnio ? parseInt(matchAnio[0], 10) : undefined;
  n = n.replace(/[._]/g, ' ').replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(1080p|720p|2160p|4k|hdr|web[-]?dl|bluray|brrip|hdtv|x264|x265|hevc|aac|dual|latino|castellano|subtitulado|temporada|cap(itulo)?s?|r480p|s\s?\d{1,2}|hd|full\s?hd|mic?rohd|proper|repack|internal|dubbed|subbed|español|ingles)\b/gi, ' ')
    .replace(/\bS\d{1,2}(E\d{1,2})?\b/gi, ' ')
    .replace(/\s{2,}/g, ' ').trim();
  return { titulo: n, anio };
}

/* ═══════════════════════════════════════════════════════════
   GOOGLE DRIVE HELPERS (con caché de sesión TMDB y MMKV)
═══════════════════════════════════════════════════════════ */
const tmdbSessionCache = new Map<string, any>();
async function buscarMetadataTMDB(titulo: string, anio: number | undefined, tipo: 'movie' | 'tv'): Promise<any | null> {
  const cacheKey = `${tipo}:${titulo}:${anio || ''}`;
  if (tmdbSessionCache.has(cacheKey)) return tmdbSessionCache.get(cacheKey);
  try {
    const ep  = tipo === 'movie' ? 'search/movie' : 'search/tv';
    const yr  = anio ? `&year=${anio}` : '';
    const res = await fetch(`https://api.themoviedb.org/3/${ep}?api_key=${TMDB_API_KEY}&language=es&query=${encodeURIComponent(titulo)}${yr}`);
    const d   = await res.json();
    const result = d.results?.length ? d.results[0] : null;
    tmdbSessionCache.set(cacheKey, result);
    return result;
  } catch { return null; }
}
async function buscarDetalleTemporada(tmdbId: string, season: number): Promise<any | null> {
  const cacheKey = `season:${tmdbId}:${season}`;
  if (tmdbSessionCache.has(cacheKey)) return tmdbSessionCache.get(cacheKey);
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}&language=es`);
    const data = await res.json();
    tmdbSessionCache.set(cacheKey, data);
    return data;
  } catch { return null; }
}
async function listarArchivosDrive(folderId: string): Promise<any[]> {
  let archivos: any[] = [], pageToken: string | undefined;
  do {
    const tp  = pageToken ? `&pageToken=${pageToken}` : '';
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime)&pageSize=1000&key=${GOOGLE_DRIVE_API_KEY}${tp}`;
    const res = await fetch(url);
    const d   = await res.json();
    if (d.files) archivos = archivos.concat(d.files);
    pageToken = d.nextPageToken;
  } while (pageToken);
  return archivos.filter(f => f.mimeType?.startsWith('video/'));
}
async function listarSubcarpetasDrive(folderId: string): Promise<any[]> {
  try {
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id,name)&key=${GOOGLE_DRIVE_API_KEY}`;
    const res = await fetch(url);
    const d   = await res.json();
    return d.files || [];
  } catch { return []; }
}
async function construirItemDrive(archivo: any, tipo: 'movie' | 'tv'): Promise<MediaItem> {
  const { titulo, anio } = limpiarNombreArchivo(archivo.name);
  const streamUrl = driveStreamUrl(archivo.id);
  const meta = await buscarMetadataTMDB(titulo, anio, tipo);
  if (meta) {
    return {
      id: `drive-${archivo.id}`,
      title: tipo === 'movie' ? meta.title : meta.name,
      poster: meta.poster_path ? `https://image.tmdb.org/t/p/w500${meta.poster_path}` : 'https://via.placeholder.com/500x750.png?text=Sin+Imagen',
      backdrop: meta.backdrop_path ? `https://image.tmdb.org/t/p/w780${meta.backdrop_path}` : undefined,
      year: tipo === 'movie' ? (meta.release_date ? new Date(meta.release_date).getFullYear() : anio) : (meta.first_air_date ? new Date(meta.first_air_date).getFullYear() : anio),
      rating: meta.vote_average ? meta.vote_average.toFixed(1) : '0.0',
      seasons: tipo === 'tv' ? meta.number_of_seasons : undefined,
      overview: meta.overview || 'Sin descripción disponible.',
      type: tipo, streamUrl, driveFileId: archivo.id,
    };
  }
  return {
    id: `drive-${archivo.id}`, title: titulo || archivo.name,
    poster: 'https://via.placeholder.com/500x750.png?text=Sin+Imagen',
    year: anio, rating: '0.0', overview: 'Sin descripción disponible.',
    type: tipo, streamUrl, custom: true, driveFileId: archivo.id,
  };
}
async function cargarCarpetaDrive(folderId: string, tipo: 'movie' | 'tv', cacheKey: string): Promise<MediaItem[]> {
  try {
    const raw = storage.getString(cacheKey);
    const cache = raw ? JSON.parse(raw) : {};
    const archivos = await listarArchivosDrive(folderId);
    const items: MediaItem[] = [];
    for (const a of archivos) {
      const ce = cache[a.id];
      if (ce && ce.modifiedTime === a.modifiedTime) {
        items.push(ce.item);
      } else {
        const item = await construirItemDrive(a, tipo);
        cache[a.id] = { modifiedTime: a.modifiedTime, item };
        items.push(item);
      }
    }
    storage.set(cacheKey, JSON.stringify(cache));
    return items;
  } catch (e) { console.warn('Drive error:', e); return []; }
}
async function cargarSeriesPlex(folderId: string, cacheKey: string): Promise<PlexShow[]> {
  try {
    const rawCache = storage.getString(cacheKey + '_plex');
    const cache    = rawCache ? JSON.parse(rawCache) : {};
    const showsMap: Record<string, { files: { archivo: any; season: number; episode: number; episodeTitle?: string }[]; tmdbMeta?: any; }> = {};

    const addFileToShow = (archivo: any, nombreCarpeta: string, season: number, episode: number, episodeTitle?: string) => {
      const parsed = parsePlexEpisode(archivo.name);
      const showNameFromFile = parsed?.showName || '';
      const finalShowName = showNameFromFile.length > 1 ? showNameFromFile : nombreCarpeta;
      const key = finalShowName.toLowerCase().replace(/\s+/g, '_');
      if (!showsMap[key]) showsMap[key] = { files: [] };
      const rawTitle = parsed?.episodeTitle || episodeTitle;
      const finalTitle = (rawTitle && esTituloEpisodioValido(rawTitle)) ? rawTitle : undefined;
      showsMap[key].files.push({ archivo, season: parsed?.season || season, episode: parsed?.episode || episode, episodeTitle: finalTitle });
    };

    const archivosRaiz = await listarArchivosDrive(folderId);
    for (const a of archivosRaiz) {
      const parsed = parsePlexEpisode(a.name);
      if (parsed && parsed.showName) addFileToShow(a, '', parsed.season, parsed.episode, parsed.episodeTitle);
    }

    const subcarpetas = await listarSubcarpetasDrive(folderId);
    for (const carpeta of subcarpetas) {
      const nombreCarpeta = carpeta.name.replace(/[._]/g, ' ').trim();
      const archivosShow = await listarArchivosDrive(carpeta.id);
      let epIdx = 1;
      for (const a of archivosShow) {
        const parsed = parsePlexEpisode(a.name);
        if (parsed) addFileToShow(a, nombreCarpeta, parsed.season, parsed.episode, parsed.episodeTitle);
        else addFileToShow(a, nombreCarpeta, 1, epIdx++);
      }
      const temporadas = await listarSubcarpetasDrive(carpeta.id);
      for (const temp of temporadas) {
        const seasonMatch = temp.name.match(/(\d+)/);
        const seasonNum   = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;
        const archivosTemp = await listarArchivosDrive(temp.id);
        let epIdxTemp = 1;
        for (const a of archivosTemp) {
          const parsed = parsePlexEpisode(a.name);
          if (parsed) addFileToShow(a, nombreCarpeta, parsed.season || seasonNum, parsed.episode, parsed.episodeTitle);
          else addFileToShow(a, nombreCarpeta, seasonNum, epIdxTemp++);
        }
      }
    }

    const shows: PlexShow[] = [];
    for (const [_key, data] of Object.entries(showsMap)) {
      if (!data.files.length) continue;
      const firstFile = data.files[0];
      const parsed0   = parsePlexEpisode(firstFile.archivo.name);
      const showName  = parsed0?.showName || limpiarNombreArchivo(firstFile.archivo.name).titulo || firstFile.archivo.name;
      let meta: any = cache[showName] || await buscarMetadataTMDB(showName, undefined, 'tv');
      if (meta) cache[showName] = meta;

      const seasonMap: Record<number, PlexEpisode[]> = {};
      for (const f of data.files) {
        if (!seasonMap[f.season]) seasonMap[f.season] = [];
        const streamUrl = driveStreamUrl(f.archivo.id);
        const epCode    = `${f.season}x${String(f.episode).padStart(2, '0')}`;
        seasonMap[f.season].push({
          id: `ep-${f.archivo.id}`, code: epCode,
          title: f.episodeTitle || `Episodio ${f.episode}`,
          streamUrl, driveFileId: f.archivo.id, fileName: f.archivo.name,
        });
      }

      if (meta?.id) {
        for (const [snStr, eps] of Object.entries(seasonMap)) {
          const snNum = parseInt(snStr, 10);
          const seasonData = await buscarDetalleTemporada(String(meta.id), snNum);
          if (seasonData?.episodes) {
            const epMap: Record<number, any> = {};
            seasonData.episodes.forEach((e: any) => { epMap[e.episode_number] = e; });
            eps.forEach(ep => {
              const epNum  = parseInt(ep.code.split('x')[1], 10);
              const tmdbEp = epMap[epNum];
              if (tmdbEp) {
                ep.title    = tmdbEp.name || ep.title;
                ep.overview = tmdbEp.overview;
                ep.airDate  = tmdbEp.air_date;
                ep.runtime  = tmdbEp.runtime;
                ep.poster   = tmdbEp.still_path ? `https://image.tmdb.org/t/p/w300${tmdbEp.still_path}` : undefined;
              }
            });
          }
        }
      }

      const seasons: PlexSeason[] = Object.entries(seasonMap)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([n, eps]) => ({ number: parseInt(n, 10), label: `Temporada ${n}`, episodes: eps.sort((a, b) => parseInt(a.code.split('x')[1], 10) - parseInt(b.code.split('x')[1], 10)) }));

      shows.push({
        id: `show-${_key}`,
        title:    meta ? (meta.name || meta.title || showName) : showName,
        poster:   meta?.poster_path ? `https://image.tmdb.org/t/p/w500${meta.poster_path}` : 'https://via.placeholder.com/500x750.png?text=Serie',
        backdrop: meta?.backdrop_path ? `https://image.tmdb.org/t/p/w780${meta.backdrop_path}` : undefined,
        year:     meta?.first_air_date ? new Date(meta.first_air_date).getFullYear() : undefined,
        rating:   meta?.vote_average ? meta.vote_average.toFixed(1) : undefined,
        overview: meta?.overview,
        seasons,
      });
    }
    storage.set(cacheKey + '_plex', JSON.stringify(cache));
    return shows.sort((a, b) => a.title.localeCompare(b.title));
  } catch (e) { console.warn('Plex error:', e); return []; }
}

/* ═══════════════════════════════════════════════════════════
   CONTINUAR VIENDO (MMKV)
═══════════════════════════════════════════════════════════ */
function saveContinueWatching(item: ContinueWatchingItem) {
  const raw = storage.getString('continueWatching');
  const list: ContinueWatchingItem[] = raw ? JSON.parse(raw) : [];
  const newList = [item, ...list.filter(i => i.id !== item.id)].slice(0, 20);
  storage.set('continueWatching', JSON.stringify(newList));
}
function getContinueWatching(): ContinueWatchingItem[] {
  const raw = storage.getString('continueWatching');
  return raw ? JSON.parse(raw) : [];
}

/* ═══════════════════════════════════════════════════════════
   REPRODUCTOR NATIVO (con keep-awake y save progress)
═══════════════════════════════════════════════════════════ */
export type ReproductorNativoHandle = { seekBy: (secs: number) => void; };

const ReproductorNativo = memo(forwardRef<ReproductorNativoHandle, {
  url: string; contentFit: 'contain' | 'fill'; isLive?: boolean;
  onError?: () => void; onStall?: () => void; showSeekControls?: boolean;
  onProgressUpdate?: (current: number, duration: number) => void;
  itemInfo?: ContinueWatchingItem;
}>(({ url, contentFit, isLive = false, onError, onStall, showSeekControls = false, onProgressUpdate, itemInfo }, ref) => {
  useKeepAwake();
  const [activeUrl, setActiveUrl] = useState(() => cacheBust(url));
  const player = useVideoPlayer(activeUrl, p => {
    p.loop = false;
    if (isLive) try { (p as any).seekToLiveEdge?.(); } catch (_) {}
    p.play();
  });

  const seekBy = useCallback((secs: number) => {
    try { player.currentTime = Math.max(0, (player.currentTime ?? 0) + secs); } catch (_) {}
  }, [player]);
  useImperativeHandle(ref, () => ({ seekBy }), [seekBy]);

  const stallTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPos      = useRef(0);
  const stallCount   = useRef(0);
  const replaceCount = useRef(0);
  const CHECK = 9000, MIN_DELTA = 0.8, STALL_THRESH = 3, MAX_REPLACE = 3;

  useEffect(() => {
    setActiveUrl(cacheBust(url));
    replaceCount.current = 0; stallCount.current = 0; lastPos.current = 0;
  }, [url]);

  useEffect(() => {
    if (!player || !onProgressUpdate) return;
    const iv = setInterval(() => {
      try { onProgressUpdate(player.currentTime ?? 0, (player as any).duration ?? 0); } catch (_) {}
    }, 500);
    return () => clearInterval(iv);
  }, [player, onProgressUpdate]);

  useEffect(() => {
    if (!player) return;
    if (stallTimer.current) clearInterval(stallTimer.current);
    stallTimer.current = setInterval(() => {
      try {
        const pos = player.currentTime ?? 0;
        if (Math.abs(pos - lastPos.current) < MIN_DELTA) {
          stallCount.current++;
          if (stallCount.current >= STALL_THRESH) {
            stallCount.current = 0;
            if (replaceCount.current < MAX_REPLACE) {
              replaceCount.current++;
              try { player.replace(cacheBust(url)); setTimeout(() => { try { if (isLive) (player as any).seekToLiveEdge?.(); player.play(); } catch (_) {} }, 500); } catch { try { player.play(); } catch (_) {} }
            } else {
              if (stallTimer.current) clearInterval(stallTimer.current);
              onStall?.(); onError?.();
            }
          }
        } else { stallCount.current = 0; replaceCount.current = 0; }
        lastPos.current = pos;
      } catch (_) {}
    }, CHECK);
    return () => { if (stallTimer.current) clearInterval(stallTimer.current); };
  }, [player, url]);

  useEffect(() => {
    if (!player) return;
    const s1 = player.addListener('statusChange', (p: any) => {
      if (p?.error) { console.error('Error reproductor nativo:', p.error); if (stallTimer.current) clearInterval(stallTimer.current); onError?.(); return; }
      if ((p?.status ?? p) === 'idle') { try { player.replace(cacheBust(url)); setTimeout(() => { try { player.play(); } catch (_) {} }, 400); } catch (_) {} }
    });
    const s2 = player.addListener('playingChange', (p: any) => {
      if (!(p?.isPlaying ?? p)) setTimeout(() => { try { if (!player.playing) player.play(); } catch (_) {} }, 6000);
    });
    return () => { s1.remove(); s2.remove(); };
  }, [player, url, onError]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView style={StyleSheet.absoluteFill} player={player} contentFit={contentFit} nativeControls={false} />
      {showSeekControls && (
        <View style={pl.seekOverlay} pointerEvents="box-none">
          <TouchableOpacity style={pl.seekBtn} onPress={() => seekBy(-10)}>
            <Ionicons name="play-back" size={22} color="#fff" />
            <Text style={pl.seekLabel}>10</Text>
          </TouchableOpacity>
          <TouchableOpacity style={pl.seekBtnPlay} onPress={() => { try { player.playing ? player.pause() : player.play(); } catch (_) {} }}>
            <Ionicons name="play" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={pl.seekBtn} onPress={() => seekBy(10)}>
            <Ionicons name="play-forward" size={22} color="#fff" />
            <Text style={pl.seekLabel}>10</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}));

/* ═══════════════════════════════════════════════════════════
   FULLSCREEN PLAYER
═══════════════════════════════════════════════════════════ */
interface FullscreenPlayerProps {
  url: string; isLive?: boolean; title?: string; subtitle?: string;
  onClose: () => void; primaryColor: string; onNext?: () => void; onPrev?: () => void;
  onError?: () => void; itemInfo?: ContinueWatchingItem;
}
const FullscreenPlayer = memo(({
  url, isLive = false, title, subtitle, onClose, primaryColor, onNext, onPrev, onError, itemInfo,
}: FullscreenPlayerProps) => {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [aspect, setAspect]       = useState<'contain' | 'fill'>('contain');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]   = useState(0);
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef    = useRef<ReproductorNativoHandle>(null);

  useEffect(() => { lockLandscape(); return () => { lockPortrait(); }; }, []);

  const showControls = () => {
    setControlsVisible(true);
    Animated.timing(controlsAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    resetHideTimer();
  };
  const resetHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setControlsVisible(false));
    }, 3500);
  };
  useEffect(() => { resetHideTimer(); return () => { if (hideTimer.current) clearTimeout(hideTimer.current); }; }, []);

  const handleProgress = useCallback((cur: number, dur: number) => {
    setCurrentTime(cur); setDuration(dur);
    if (itemInfo && dur > 0) {
      saveContinueWatching({ ...itemInfo, progress: cur, duration: dur });
    }
  }, [itemInfo]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSeek = (secs: number) => playerRef.current?.seekBy(secs);

  return (
    <Modal visible animationType="fade" statusBarTranslucent supportRequestedOrientations={['landscape']}>
      <View style={fs.root}>
        <StatusBar hidden />
        <TouchableWithoutFeedback onPress={showControls}>
          <View style={StyleSheet.absoluteFill}>
            <ReproductorNativo ref={playerRef} url={url} contentFit={aspect} isLive={isLive}
              showSeekControls={false} onError={onError} onProgressUpdate={handleProgress} itemInfo={itemInfo} />
          </View>
        </TouchableWithoutFeedback>
        <Animated.View style={[fs.overlay, { opacity: controlsAnim }]} pointerEvents={controlsVisible ? 'box-none' : 'none'}>
          <View style={fs.topBar}>
            <TouchableOpacity style={fs.closeBtn} onPress={onClose}><Ionicons name="chevron-down" size={24} color="#fff" /></TouchableOpacity>
            <View style={{ flex: 1, marginLeft: T.space.md }}>
              {title ? <Text style={fs.titleTxt} numberOfLines={1}>{title}</Text> : null}
              {subtitle ? <Text style={fs.subtitleTxt} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
            <View style={fs.topRight}>
              <TouchableOpacity style={fs.iconBtn} onPress={() => setAspect(a => a === 'contain' ? 'fill' : 'contain')}>
                <Ionicons name={aspect === 'contain' ? 'scan-outline' : 'contract-outline'} size={20} color="#fff" />
              </TouchableOpacity>
              {isLive && <View style={fs.liveBadge}><View style={fs.liveDot} /><Text style={fs.liveTxt}>EN VIVO</Text></View>}
            </View>
          </View>
          <View style={fs.centerRow} pointerEvents="box-none">
            {!isLive && onPrev && <TouchableOpacity style={fs.navBtn} onPress={onPrev}><Ionicons name="play-skip-back" size={28} color="#fff" /></TouchableOpacity>}
            {!isLive && <TouchableOpacity style={fs.seekBigBtn} onPress={() => handleSeek(-10)}><Ionicons name="play-back" size={26} color="#fff" /><Text style={fs.seekBigLabel}>10</Text></TouchableOpacity>}
            {!isLive && <TouchableOpacity style={fs.seekBigBtn} onPress={() => handleSeek(10)}><Ionicons name="play-forward" size={26} color="#fff" /><Text style={fs.seekBigLabel}>10</Text></TouchableOpacity>}
            {!isLive && onNext && <TouchableOpacity style={fs.navBtn} onPress={onNext}><Ionicons name="play-skip-forward" size={28} color="#fff" /></TouchableOpacity>}
          </View>
          {!isLive && duration > 0 && (
            <View style={fs.bottomBar}>
              <Text style={fs.timeTxt}>{formatTime(currentTime)}</Text>
              <View style={fs.progressTrack}>
                <View style={[fs.progressFill, { width: `${progressPct}%`, backgroundColor: primaryColor }]} />
                <View style={[fs.progressThumb, { left: `${progressPct}%`, backgroundColor: primaryColor }]} />
              </View>
              <Text style={fs.timeTxt}>{formatTime(duration)}</Text>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
});

/* ═══════════════════════════════════════════════════════════
   WEBVIEW INJECTION
═══════════════════════════════════════════════════════════ */
const INJECT_BEFORE = `(function(){if(window.__NX__)return;window.__NX__=true;function post(u){try{if(typeof u!=='string'||u.length<12)return;if(!/(\.m3u8|\.mpd)(\\?|#|$)/i.test(u))return;window.ReactNativeWebView.postMessage('FOUND_MANIFEST:'+u);}catch(e){}}try{var oO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{post(u);}catch(e){}return oO.apply(this,arguments)};}catch(e){}try{var oF=window.fetch;if(oF){window.fetch=function(i,n){try{var u=typeof i==='string'?i:(i&&i.url?i.url:'');post(u);}catch(e){}return oF.apply(this,arguments).then(function(r){try{if(r&&r.url)post(r.url);}catch(e){}return r;});};}}catch(e){}try{var ob=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeName==='VIDEO'){post(n.src||n.currentSrc||'');n.addEventListener('loadedmetadata',function(){post(n.currentSrc||'');});}if(n.nodeName==='IFRAME'){window.ReactNativeWebView.postMessage('IFRAME_SRC:'+n.src);}if(n.nodeName==='SOURCE'){post(n.src||'');}});});});ob.observe(document.documentElement||document.body,{childList:true,subtree:true});}catch(e){}})();true;`;
const INJECT_AFTER  = `(function(){function post(u){try{if(typeof u!=='string'||u.length<12)return;if(!/(\.m3u8|\.mpd)(\\?|#|$)/i.test(u))return;window.ReactNativeWebView.postMessage('FOUND_MANIFEST:'+u);}catch(e){}}function scan(){try{var h=document.documentElement.innerHTML||'';var m=h.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi);if(m)m.forEach(post);Array.from(document.getElementsByTagName('video')).forEach(function(v){try{v.play();}catch(e){}post(v.src||v.currentSrc||'');});var b=document.querySelectorAll('.play-button,.vjs-big-play-button,.jw-icon-playback,#play,.play-btn,[data-action="play"]');b.forEach(function(x){try{x.click();}catch(e){}});Array.from(document.getElementsByTagName('source')).forEach(function(s){post(s.getAttribute('src')||'');});}catch(e){}}scan();var iv=setInterval(scan,2000);setTimeout(function(){clearInterval(iv);window.ReactNativeWebView.postMessage('MANIFEST_TIMEOUT');},24000);})();true;`;

/* ═══════════════════════════════════════════════════════════
   SHIMMER
═══════════════════════════════════════════════════════════ */
const Shimmer = ({ w, h, style, borderRadius }: { w: number | string; h: number | string; style?: any; borderRadius?: number }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0, duration: 1000, useNativeDriver: true }),
    ]));
    loop.start(); return () => loop.stop();
  }, []);
  const tx = anim.interpolate({ inputRange: [0, 1], outputRange: [-200, 200] });
  return (
    <View style={[{ width: w, height: h, backgroundColor: T.color.surface, borderRadius: borderRadius ?? T.radius.md, overflow: 'hidden' }, style]}>
      <Animated.View style={{ width: '100%', height: '100%', backgroundColor: 'rgba(255,255,255,0.055)', transform: [{ translateX: tx }] }} />
    </View>
  );
};

/* ═══════════════════════════════════════════════════════════
   HOOK PERSISTENCIA (basado en MMKV)
═══════════════════════════════════════════════════════════ */
function usePersistedState<T>(key: string, init: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : init;
  });
  const setPersistedState = useCallback((value: T) => {
    setState(value);
    storage.set(key, JSON.stringify(value));
  }, [key]);
  return [state, setPersistedState];
}

/* ═══════════════════════════════════════════════════════════
   GLASS BADGE
═══════════════════════════════════════════════════════════ */
const GlassBadge = ({ label, color, icon }: { label: string; color?: string; icon?: string }) => (
  <View style={[gb.badge, { borderColor: color ? color + '44' : T.color.glassBorder }]}>
    {icon ? <Ionicons name={icon as any} size={10} color={color || T.color.textMuted} style={{ marginRight: 3 }} /> : null}
    <Text style={[gb.label, { color: color || T.color.textMuted }]}>{label}</Text>
  </View>
);
const gb = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.color.glassBackground, borderWidth: 1, borderRadius: T.radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  label: { fontSize: 10, fontWeight: T.font.bold, letterSpacing: 0.5 },
});

/* ═══════════════════════════════════════════════════════════
   MINI PLAYER BAR (estilo vidrio)
═══════════════════════════════════════════════════════════ */
interface MiniPlayerProps {
  title: string; subtitle?: string; poster?: string;
  primaryColor: string; onExpand: () => void; onClose: () => void; progress?: number;
}
const MiniPlayerBar = ({ title, subtitle, poster, primaryColor, onExpand, onClose, progress = 0 }: MiniPlayerProps) => (
  <Pressable style={mp.bar} onPress={onExpand} android_ripple={{ color: primaryColor + '22' }}>
    <View style={mp.progressLine} >
      <View style={[mp.progressFill, { width: `${progress * 100}%`, backgroundColor: primaryColor }]} />
    </View>
    {poster ? <Image source={{ uri: poster }} style={mp.poster} /> : <View style={[mp.poster, { backgroundColor: T.color.surfaceHigh, alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="play-circle" size={20} color={primaryColor} /></View>}
    <View style={{ flex: 1, marginLeft: T.space.sm }}>
      <Text style={mp.title} numberOfLines={1}>{title}</Text>
      {subtitle ? <Text style={mp.sub} numberOfLines={1}>{subtitle}</Text> : null}
    </View>
    <TouchableOpacity style={mp.expandBtn} onPress={onExpand}><Ionicons name="expand" size={18} color="#fff" /></TouchableOpacity>
    <TouchableOpacity style={mp.closeBtn} onPress={onClose}><Ionicons name="close" size={18} color={T.color.textMuted} /></TouchableOpacity>
  </Pressable>
);

/* ═══════════════════════════════════════════════════════════
   TV EN VIVO (corregido: sin doble stream en fullscreen)
═══════════════════════════════════════════════════════════ */
const LivePlayerSection = memo(({
  primaryColor, listaCanales, loadingChannels, refreshing, onRefresh,
  favorites, setFavorites,
}: {
  primaryColor: string; listaCanales: Canal[]; loadingChannels: boolean;
  refreshing: boolean; onRefresh: () => void;
  favorites: string[]; setFavorites: (v: string[]) => void;
}) => {
  const [canal,         setCanal]         = useState<Canal | null>(null);
  const [linkM3u8,      setLinkM3u8]      = useState<string | null>(null);
  const [cazando,       setCazando]       = useState(false);
  const [embedBuscando, setEmbedBuscando] = useState(false);
  const [embedWebView,  setEmbedWebView]  = useState(false);
  const [fullscreen,    setFullscreen]    = useState(false);
  const [aspect,        setAspect]        = useState<'contain' | 'fill'>('contain');
  const [busqueda,      setBusqueda]      = useState('');
  const [catActiva,     setCatActiva]     = useState('Todos');
  const [categorias,    setCategorias]    = useState<string[]>(['Todos']);
  const [recents,       setRecents]       = useState<Canal[]>([]);
  const [numeroMarcado, setNumeroMarcado] = useState('');
  const [errorCanal,    setErrorCanal]    = useState(false);

  const canalRef       = useRef<Canal | null>(null);
  const embedWebViewRef= useRef<WebView>(null);
  const webViewRef     = useRef<WebView>(null);
  const timerCaza      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerZap       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const embedRetry     = useRef(0);
  const inputRef       = useRef<TextInput>(null);
  const liveDot        = useRef(new Animated.Value(1)).current;
  const panRef         = useRef<any>(null);

  useEffect(() => { canalRef.current = canal; }, [canal]);

  useEffect(() => {
    const cats = new Set<string>(['Todos']);
    listaCanales.forEach(c => cats.add(c.category));
    if (favorites.length > 0) cats.add('Favoritos');
    setCategorias(Array.from(cats));
    if (!canal && listaCanales.length > 0) sintonizar(listaCanales[0]);
  }, [listaCanales]);

  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(liveDot, { toValue: 0.1, duration: 850, useNativeDriver: true }),
      Animated.timing(liveDot, { toValue: 1,   duration: 850, useNativeDriver: true }),
    ]));
    pulse.start(); return () => pulse.stop();
  }, []);

  const lastTapRef = useRef<number | null>(null);
  if (!panRef.current) {
    panRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, g) => {
        const now = Date.now();
        if (lastTapRef.current && now - lastTapRef.current < 280) { abrirFullscreen(); lastTapRef.current = null; return; }
        lastTapRef.current = now;
        if (Math.abs(g.dx) > 50 && Math.abs(g.dx) > Math.abs(g.dy)) {
          if (g.dx > 0) canalAnterior(); else canalSiguiente();
        }
      },
    });
  }

  const abrirFullscreen = () => {
    if (!linkM3u8 && !embedBuscando) return;
    setFullscreen(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const limpiarCaza = () => { if (timerCaza.current) { clearTimeout(timerCaza.current); timerCaza.current = null; } };

  const obtenerStreamEmbed = async (embedSlug: string): Promise<string | null> => {
    const embedUrl = `${EMBED_BASE}/${embedSlug}.html`;
    const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
    const directUrls = [
      { url: embedUrl, referer: `${EMBED_BASE}/` },
      { url: `https://regionales.saohgdasregions.fun/stream.php?canal=${embedSlug}&target=2`, referer: embedUrl },
      { url: `https://deportes.ksdjugfsddeports.com/stream.php?canal=${embedSlug}&target=2`, referer: embedUrl },
    ];
    const findM3u8 = (html: string) => html.match(/https?:\/\/[^\s"'<>]+?\.m3u8(?:\?[^\s"'<>]*)?/i)?.[0];

    for (const { url, referer } of directUrls) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': referer, 'Origin': 'https://embed.saohgdasregions.fun' } });
        const html = await res.text();
        const stream = findM3u8(html);
        if (stream) return stream;
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (iframeMatch) {
          const iframeSrc = iframeMatch[1].replace(/&amp;/g, '&');
          const iframeRes = await fetch(iframeSrc, { headers: { 'User-Agent': UA, 'Referer': url, 'Origin': 'https://embed.saohgdasregions.fun' } });
          const iframeHtml = await iframeRes.text();
          const iframeStream = findM3u8(iframeHtml);
          if (iframeStream) return iframeStream;
        }
      } catch (e) {}
    }
    return null;
  };

  const sintonizar = async (c: Canal) => {
    limpiarCaza();
    setLinkM3u8(null); setCanal(c); setEmbedBuscando(false); setEmbedWebView(false); setCazando(false);
    setRecents(prev => [c, ...prev.filter(x => x.id !== c.id)].slice(0, 8));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (c.embedSlug || c.needsWebView) {
      const slug = c.embedSlug || extractEmbedSlug(c.url) || '';
      embedRetry.current = 0;
      setEmbedBuscando(true);
      const stream = await obtenerStreamEmbed(slug);
      if (stream) { setLinkM3u8(stream); setEmbedBuscando(false); }
      else {
        setEmbedWebView(true);
        timerCaza.current = setTimeout(() => {
          setEmbedBuscando(false); setEmbedWebView(false); limpiarCaza();
          Alert.alert(c.name, 'Canal offline o no disponible.');
        }, 28000);
      }
      return;
    }
    if (esUrlManifiesto(c.url)) { setLinkM3u8(c.url); return; }
    setCazando(true);
    timerCaza.current = setTimeout(() => setCazando(false), 15000);
  };

  const reextraerEmbed = useCallback(async () => {
    const c = canalRef.current; if (!c) return;
    if (embedRetry.current >= 4) { setLinkM3u8(null); setEmbedBuscando(false); setEmbedWebView(false); return; }
    embedRetry.current++;
    const slug = c.embedSlug || extractEmbedSlug(c.url) || '';
    setLinkM3u8(null); setEmbedBuscando(true); setEmbedWebView(false);
    await new Promise(r => setTimeout(r, 1500));
    const stream = await obtenerStreamEmbed(slug);
    if (stream) { setLinkM3u8(stream); setEmbedBuscando(false); }
    else {
      setEmbedWebView(true);
      timerCaza.current = setTimeout(() => { setEmbedBuscando(false); setEmbedWebView(false); limpiarCaza(); }, 28000);
    }
  }, []);

  const onMsgEmbed = (e: WebViewMessageEvent) => {
    const data = String(e.nativeEvent.data || '').trim();
    if (data.startsWith('FOUND_MANIFEST:')) { setLinkM3u8(data.replace('FOUND_MANIFEST:', '')); setEmbedBuscando(false); setEmbedWebView(false); limpiarCaza(); return; }
    if (esUrlManifiesto(data)) { setLinkM3u8(data); setEmbedBuscando(false); setEmbedWebView(false); limpiarCaza(); return; }
    if (data === 'MANIFEST_TIMEOUT') { setEmbedBuscando(false); setEmbedWebView(false); limpiarCaza(); Alert.alert('Canal', 'No se pudo extraer el stream.'); }
  };

  const onMsgWebView = (e: WebViewMessageEvent) => {
    const m = extraerManifiesto(String(e.nativeEvent.data || ''));
    if (m) { setLinkM3u8(m); setCazando(false); limpiarCaza(); }
  };

  const canalSiguiente = () => {
    const lista = listaCanales; if (!canal || !lista.length) return;
    sintonizar(lista[(lista.findIndex(c => c.id === canal.id) + 1) % lista.length]);
  };
  const canalAnterior = () => {
    const lista = listaCanales; if (!canal || !lista.length) return;
    const idx = lista.findIndex(c => c.id === canal.id);
    sintonizar(lista[idx === 0 ? lista.length - 1 : idx - 1]);
  };

  const alMarcrarNumero = (txt: string) => {
    const n = txt.replace(/[^0-9]/g, ''); if (!n) return;
    setNumeroMarcado(n);
    if (timerZap.current) clearTimeout(timerZap.current);
    timerZap.current = setTimeout(() => {
      const found = listaCanales.find(c => c.numero === parseInt(n, 10));
      if (found) sintonizar(found);
      else { setErrorCanal(true); setTimeout(() => setErrorCanal(false), 1800); }
      setNumeroMarcado('');
    }, 1400);
  };

  const onPlayerError = useCallback(() => {
    if (canalRef.current?.embedSlug || canalRef.current?.needsWebView) { reextraerEmbed(); return; }
    setLinkM3u8(null); limpiarCaza();
    setTimeout(() => { if (canalRef.current) sintonizar(canalRef.current); }, 500);
  }, [reextraerEmbed]);

  const canalesFiltrados = listaCanales.filter(c => {
    const matchCat = catActiva === 'Todos' ? true : catActiva === 'Favoritos' ? favorites.includes(c.id) : c.category === catActiva;
    return matchCat && c.name.toLowerCase().includes(busqueda.toLowerCase());
  });

  const embedUrl = canal ? (canal.embedSlug ? `${EMBED_BASE}/${canal.embedSlug}.html` : canal.url) : '';

  return (
    <View style={{ flex: 1 }}>
      {fullscreen && linkM3u8 && (
        <FullscreenPlayer url={linkM3u8} isLive title={canal?.name} subtitle={canal?.nowPlaying}
          primaryColor={primaryColor} onClose={() => setFullscreen(false)} onError={onPlayerError} />
      )}
      <TextInput ref={inputRef} value={numeroMarcado} onChangeText={alMarcrarNumero} keyboardType="numeric" showSoftInputOnFocus={false} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />

      <View style={[lv.playerBox, { height: LIVE_PLAYER_H }]} {...panRef.current.panHandlers}>
        {!fullscreen && (
          <>
            {embedBuscando ? (
              <View style={lv.noSignal}><ActivityIndicator size="large" color={primaryColor} /><Text style={[lv.noSignalTxt, { marginTop: 10 }]}>Conectando a {canal?.name ?? 'canal'}…</Text></View>
            ) : linkM3u8 ? (
              <ReproductorNativo url={linkM3u8} contentFit={aspect} isLive onError={onPlayerError} onStall={reextraerEmbed} />
            ) : (
              <View style={lv.noSignal}><Ionicons name="tv-outline" size={50} color={T.color.textMuted} /><Text style={lv.noSignalTxt}>Sin señal</Text></View>
            )}
            <TouchableOpacity style={lv.navLeft}  onPress={canalAnterior}><Ionicons name="chevron-back"    size={26} color="#fff" /></TouchableOpacity>
            <TouchableOpacity style={lv.navRight} onPress={canalSiguiente}><Ionicons name="chevron-forward" size={26} color="#fff" /></TouchableOpacity>
            <View style={lv.topBar} pointerEvents="box-none">
              {canal && (
                <View style={lv.livePill}>
                  <Animated.View style={[lv.liveDot, { opacity: liveDot }]} />
                  <Text style={lv.liveTxt}>EN VIVO</Text>
                </View>
              )}
              <View style={lv.topBarRight}>
                <TouchableOpacity style={lv.iconBtn} onPress={() => setAspect(a => a === 'contain' ? 'fill' : 'contain')}><Ionicons name="scan-outline" size={18} color="#fff" /></TouchableOpacity>
                <TouchableOpacity style={lv.iconBtn} onPress={abrirFullscreen}><Ionicons name="expand-outline" size={18} color="#fff" /></TouchableOpacity>
              </View>
            </View>
            <View style={lv.bottomGradient} pointerEvents="none">
              {canal && (
                <View style={lv.channelInfoRow}>
                  <View style={[lv.numBadgeLarge, { backgroundColor: primaryColor }]}><Text style={lv.numLarge}>{canal.numero}</Text></View>
                  <View style={{ flex: 1, marginLeft: T.space.sm }}>
                    <Text style={lv.chName} numberOfLines={1}>{canal.name}</Text>
                    {canal.nowPlaying ? <Text style={lv.chNow} numberOfLines={1}>▶ {canal.nowPlaying}</Text> : null}
                  </View>
                  {canal.category ? <GlassBadge label={canal.category} color="rgba(255,255,255,0.5)" /> : null}
                </View>
              )}
            </View>
            <TouchableOpacity style={lv.tapHint} onPress={abrirFullscreen}><Ionicons name="expand" size={14} color="rgba(255,255,255,0.4)" /><Text style={lv.tapHintTxt}>Toca 2 veces para pantalla completa</Text></TouchableOpacity>
            {numeroMarcado !== '' && <View style={lv.osd}><Text style={[lv.osdTxt, { color: primaryColor }]}>{numeroMarcado}</Text></View>}
            {errorCanal && <View style={lv.osdError}><Text style={lv.osdErrTxt}>CANAL NO ENCONTRADO</Text></View>}
          </>
        )}
      </View>

      {recents.length > 0 && (
        <View style={lv.recentsSection}>
          <Text style={lv.recentsSectionLabel}>RECIENTES</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: T.space.lg, gap: T.space.sm }}>
            {recents.map(ch => (
              <TouchableOpacity key={ch.id} style={[lv.recentChip, canal?.id === ch.id && { backgroundColor: primaryColor, borderColor: primaryColor }]} onPress={() => sintonizar(ch)}>
                {ch.logo ? <Image source={{ uri: ch.logo }} style={lv.recentLogo} /> : <Ionicons name="tv" size={11} color={canal?.id === ch.id ? '#fff' : T.color.textMuted} />}
                <Text style={[lv.recentTxt, canal?.id === ch.id && { color: '#fff', fontWeight: T.font.bold }]} numberOfLines={1}>{ch.numero}. {ch.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      <View style={lv.searchRow}>
        <Ionicons name="search" size={16} color={T.color.textMuted} style={{ marginRight: T.space.sm }} />
        <TextInput style={lv.searchInput} placeholder="Buscar canal..." placeholderTextColor={T.color.textMuted} value={busqueda} onChangeText={setBusqueda} />
        {busqueda !== '' && <TouchableOpacity onPress={() => setBusqueda('')}><Ionicons name="close-circle" size={18} color={T.color.textMuted} /></TouchableOpacity>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={lv.catRow} contentContainerStyle={{ paddingHorizontal: T.space.lg, gap: T.space.sm }}>
        {categorias.map(cat => (
          <TouchableOpacity key={cat} onPress={() => { setCatActiva(cat); Haptics.selectionAsync(); }} style={[lv.catChip, catActiva === cat && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
            <Text style={[lv.catTxt, catActiva === cat && { color: '#fff', fontWeight: T.font.bold }]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {loadingChannels ? (
        <View style={{ paddingHorizontal: T.space.lg, gap: T.space.sm }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.md }}><Shimmer w={s(40)} h={s(28)} /><Shimmer w={s(160)} h={s(14)} /></View>
          ))}
        </View>
      ) : (
        <FlatList
          data={canalesFiltrados}
          keyExtractor={item => item.id}
          getItemLayout={(_, i) => ({ length: s(72), offset: s(72) * i, index: i })}
          contentContainerStyle={{ paddingHorizontal: T.space.lg, paddingBottom: 20, gap: T.space.xs }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primaryColor} />}
          renderItem={({ item }) => {
            const active = canal?.id === item.id;
            const fav    = favorites.includes(item.id);
            return (
              <TouchableOpacity
                style={[lv.channelRow, active && { borderColor: primaryColor, borderLeftWidth: 3, backgroundColor: T.color.surfaceElevated }]}
                onPress={() => sintonizar(item)} activeOpacity={0.78}>
                <View style={[lv.numBadge, { backgroundColor: active ? primaryColor : T.color.surfaceHigh }]}><Text style={[lv.numTxt, { color: active ? '#fff' : T.color.textSecondary }]}>{item.numero}</Text></View>
                <View style={{ flex: 1, marginLeft: T.space.md }}>
                  <Text style={[lv.rowName, active && { color: T.color.textPrimary, fontWeight: T.font.semibold }]} numberOfLines={1}>{item.name}</Text>
                  {item.nowPlaying ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <View style={[lv.nowDot, { backgroundColor: active ? primaryColor : T.color.textMuted }]} /><Text style={lv.rowNow} numberOfLines={1}>{item.nowPlaying}</Text>
                    </View>
                  ) : null}
                </View>
                {item.logo ? <Image source={{ uri: item.logo }} style={lv.logo} /> : <View style={lv.logoPlaceholder}><Ionicons name="tv" size={14} color={T.color.textMuted} /></View>}
                <TouchableOpacity onPress={() => setFavorites(fav ? favorites.filter(id => id !== item.id) : [...favorites, item.id])} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginLeft: T.space.sm }}>
                  <Ionicons name={fav ? 'star' : 'star-outline'} size={17} color={fav ? T.color.gold : T.color.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}
      {cazando && canal && !canal.needsWebView && !canal.embedSlug && (
        <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
          <WebView ref={webViewRef} source={{ uri: canal.url, headers: { 'User-Agent': 'Mozilla/5.0' } }}
            originWhitelist={['*']} javaScriptEnabled domStorageEnabled cacheEnabled={false}
            mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback mixedContentMode="always"
            injectedJavaScriptBeforeContentLoaded={INJECT_BEFORE} injectedJavaScript={INJECT_AFTER} onMessage={onMsgWebView} />
        </View>
      )}
      {embedWebView && canal && (canal.embedSlug || canal.needsWebView) && (
        <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
          <WebView ref={embedWebViewRef} source={{ uri: embedUrl }} originWhitelist={['*']} javaScriptEnabled domStorageEnabled
            mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback mixedContentMode="always"
            injectedJavaScriptBeforeContentLoaded={INJECT_BEFORE} injectedJavaScript={INJECT_AFTER} onMessage={onMsgEmbed} />
        </View>
      )}
    </View>
  );
});

/* ═══════════════════════════════════════════════════════════
   PELÍCULAS (con búsqueda, continuar viendo y mejor UI)
═══════════════════════════════════════════════════════════ */
const MoviesPlayerSection = memo(({
  primaryColor, driveItems, loadingDrive, onCargarDrive,
}: {
  primaryColor: string; driveItems: MediaItem[]; loadingDrive: boolean;
  onCargarDrive: (force?: boolean) => void;
}) => {
  const [vodUrl, setVodUrl] = useState<string | null>(null);
  const [vodItem, setVodItem] = useState<MediaItem | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [categoria, setCategoria] = useState<'popular' | 'top_rated' | 'drive' | 'custom'>('drive');
  const [tmdbItems, setTmdbItems] = useState<MediaItem[]>(MOVIES_FALLBACK);
  const [loadingTmdb, setLoadingTmdb] = useState(false);
  const [tmdbPage, setTmdbPage] = useState(1);
  const [customItems, setCustomItems] = usePersistedState<MediaItem[]>('customMovies', []);
  const [watchlist, setWatchlist] = usePersistedState<string[]>('watchlist_movie', []);
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addPoster, setAddPoster] = useState('');
  const [addStream, setAddStream] = useState('');
  const [addYear, setAddYear] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const continueWatching = getContinueWatching().filter(i => i.type === 'movie');

  useEffect(() => {
    if (categoria === 'drive' && driveItems.length === 0 && !loadingDrive) onCargarDrive();
  }, [categoria]);
  useEffect(() => { if (categoria === 'popular' || categoria === 'top_rated') fetchTmdb(categoria, 1); }, [categoria]);

  const fetchTmdb = async (cat: string, page: number) => {
    setLoadingTmdb(true);
    try {
      const res = await fetch(`https://api.themoviedb.org/3/movie/${cat}?api_key=${TMDB_API_KEY}&language=es&page=${page}`);
      const data = await res.json();
      const formatted: MediaItem[] = (data.results || []).map((m: any) => ({
        id: m.id.toString(), title: m.title,
        poster: `https://image.tmdb.org/t/p/w500${m.poster_path}`,
        backdrop: `https://image.tmdb.org/t/p/w780${m.backdrop_path}`,
        year: m.release_date ? new Date(m.release_date).getFullYear() : undefined,
        rating: m.vote_average?.toFixed(1) ?? '0.0', overview: m.overview, type: 'movie' as const,
      }));
      if (page === 1) setTmdbItems(formatted);
      else setTmdbItems(prev => [...prev, ...formatted]);
    } catch { if (page === 1) setTmdbItems(MOVIES_FALLBACK); }
    finally { setLoadingTmdb(false); }
  };

  const reproducir = (item: MediaItem) => {
    if (!item.streamUrl) { Alert.alert('Error', 'Este elemento no tiene URL de reproducción.'); return; }
    console.log('Reproduciendo película:', item.title, 'URL:', item.streamUrl);
    setVodUrl(item.streamUrl); setVodItem(item);
    setDetailOpen(false); setProgress(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFullscreen(true);
  };

  const cerrarVod = () => { setVodUrl(null); setVodItem(null); setFullscreen(false); setProgress(0); };

  const handleAddItem = () => {
    if (!addTitle.trim()) { Alert.alert('Error', 'Título obligatorio.'); return; }
    const item: MediaItem = {
      id: Date.now().toString(), title: addTitle.trim(),
      poster: addPoster.trim() || 'https://via.placeholder.com/500x750.png?text=Sin+Imagen',
      streamUrl: addStream.trim(), year: addYear ? parseInt(addYear) : new Date().getFullYear(),
      rating: '0.0', type: 'movie', custom: true,
    };
    setCustomItems([item, ...customItems]);
    setAddOpen(false); setAddTitle(''); setAddPoster(''); setAddStream(''); setAddYear('');
  };

  const datos = categoria === 'drive' ? driveItems.filter(i => i.title.toLowerCase().includes(busqueda.toLowerCase()))
    : categoria === 'custom' ? customItems.filter(i => i.title.toLowerCase().includes(busqueda.toLowerCase()))
    : tmdbItems.filter(i => i.title.toLowerCase().includes(busqueda.toLowerCase()));
  const cargando = categoria === 'drive' ? loadingDrive : loadingTmdb;

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: CARD_H + T.space.md,
    offset: (CARD_H + T.space.md) * Math.floor(index / MEDIA_COLS),
    index,
  }), []);

  const renderContinueItem = (item: ContinueWatchingItem) => (
    <TouchableOpacity key={item.id} style={cwa.card} onPress={() => {
      setVodUrl(item.streamUrl);
      setVodItem({ id: item.id, title: item.title, poster: item.poster, streamUrl: item.streamUrl } as MediaItem);
      setProgress(item.progress / item.duration);
      setFullscreen(true);
    }}>
      <Image source={{ uri: item.poster }} style={cwa.poster} />
      <Text style={cwa.title} numberOfLines={1}>{item.title}</Text>
      <View style={cwa.progressTrack}>
        <View style={[cwa.progressFill, { width: `${(item.progress / item.duration) * 100}%`, backgroundColor: primaryColor }]} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1 }}>
      {fullscreen && vodUrl && vodItem && (
        <FullscreenPlayer url={vodUrl} title={vodItem.title} subtitle={vodItem.year ? String(vodItem.year) : undefined}
          primaryColor={primaryColor} onClose={() => setFullscreen(false)} onError={cerrarVod}
          itemInfo={vodItem ? { id: vodItem.id, title: vodItem.title, poster: vodItem.poster, progress: 0, duration: 0, type: 'movie', streamUrl: vodItem.streamUrl! } : undefined} />
      )}
      {vodUrl && vodItem && !fullscreen && (
        <MiniPlayerBar title={vodItem.title} subtitle={vodItem.year ? String(vodItem.year) : undefined}
          poster={vodItem.poster} primaryColor={primaryColor} progress={progress}
          onExpand={() => setFullscreen(true)} onClose={cerrarVod} />
      )}

      {/* Continuar viendo */}
      {continueWatching.length > 0 && (
        <View style={cwa.section}>
          <Text style={cwa.sectionTitle}>CONTINUAR VIENDO</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cwa.scroll}>
            {continueWatching.slice(0, 8).map(renderContinueItem)}
          </ScrollView>
        </View>
      )}

      {/* Búsqueda */}
      <View style={lv.searchRow}>
        <Ionicons name="search" size={16} color={T.color.textMuted} style={{ marginRight: T.space.sm }} />
        <TextInput style={lv.searchInput} placeholder="Buscar película..." placeholderTextColor={T.color.textMuted} value={busqueda} onChangeText={setBusqueda} />
        {busqueda !== '' && <TouchableOpacity onPress={() => setBusqueda('')}><Ionicons name="close-circle" size={18} color={T.color.textMuted} /></TouchableOpacity>}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={lv.catRow} contentContainerStyle={{ paddingHorizontal: T.space.lg, gap: T.space.sm }}>
          {([
            { key: 'drive',     label: 'Mi Drive',        icon: 'cloud-outline'    },
            { key: 'popular',   label: 'Populares',       icon: 'flame-outline'    },
            { key: 'top_rated', label: 'Mejor Valoradas', icon: 'star-outline'     },
            { key: 'custom',    label: 'Mi Lista',        icon: 'bookmark-outline' },
          ] as const).map(({ key, label, icon }) => (
            <TouchableOpacity key={key} onPress={() => { setCategoria(key); setTmdbPage(1); }} style={[lv.catChip, categoria === key && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
              <Ionicons name={icon} size={12} color={categoria === key ? '#fff' : T.color.textMuted} style={{ marginRight: 4 }} />
              <Text style={[lv.catTxt, categoria === key && { color: '#fff', fontWeight: T.font.bold }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {categoria === 'custom' && (
          <TouchableOpacity style={[vd.addBtn, { backgroundColor: primaryColor }]} onPress={() => setAddOpen(true)}><Ionicons name="add" size={22} color="#fff" /></TouchableOpacity>
        )}
      </View>

      {cargando ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={primaryColor} /></View>
      ) : (
        <FlatList
          data={datos}
          keyExtractor={item => item.id}
          numColumns={MEDIA_COLS}
          getItemLayout={getItemLayout}
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          contentContainerStyle={{ paddingHorizontal: T.space.lg, paddingBottom: 24, paddingTop: T.space.sm }}
          columnWrapperStyle={MEDIA_COLS > 1 ? { gap: T.space.md, marginBottom: T.space.md } : undefined}
          refreshControl={categoria === 'drive' ? <RefreshControl refreshing={loadingDrive} onRefresh={() => onCargarDrive(true)} tintColor={primaryColor} /> : undefined}
          onEndReached={() => { if (categoria === 'popular' || categoria === 'top_rated') { const next = tmdbPage + 1; setTmdbPage(next); fetchTmdb(categoria, next); } }}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <Pressable style={vd.card} onPress={() => { setDetailItem(item); setDetailOpen(true); Haptics.selectionAsync(); }}>
              <Image source={{ uri: item.poster }} style={vd.poster} resizeMode="cover" />
              <View style={vd.posterGradient} />
              {vodItem?.id === item.id && <View style={[vd.playingBadge, { backgroundColor: primaryColor }]}><Ionicons name="play" size={10} color="#fff" /></View>}
              {item.custom && <View style={vd.customBadge}><Text style={vd.customBadgeTxt}>DRIVE</Text></View>}
              <View style={vd.cardBottom}>
                <Text style={vd.cardTitle} numberOfLines={2}>{item.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.xs, marginTop: 4 }}>
                  {item.year ? <Text style={vd.cardYear}>{item.year}</Text> : null}
                  {item.rating && item.rating !== '0.0' && <View style={[vd.ratingPill, { backgroundColor: primaryColor + '22' }]}><Text style={[vd.ratingTxt, { color: primaryColor }]}>⭐ {item.rating}</Text></View>}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      {/* Modal detalle (sin cambios) */}
      {detailItem && (
        <Modal visible={detailOpen} animationType="slide" transparent={false}>
          <View style={{ flex: 1, backgroundColor: T.color.bg }}>
            <StatusBar hidden />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
              {(detailItem.backdrop || detailItem.poster) && <Image source={{ uri: detailItem.backdrop ?? detailItem.poster }} style={vd.detailHero} resizeMode="cover" />}
              <View style={vd.detailGradient} />
              <TouchableOpacity style={vd.detailClose} onPress={() => setDetailOpen(false)}><Ionicons name="close-circle" size={36} color="#fff" /></TouchableOpacity>
              <View style={vd.detailBody}>
                <View style={{ flexDirection: 'row', gap: T.space.md, marginBottom: T.space.lg }}>
                  <Image source={{ uri: detailItem.poster }} style={vd.detailPoster} resizeMode="cover" />
                  <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                    <Text style={vd.detailTitle}>{detailItem.title}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space.xs, marginTop: T.space.sm }}>
                      {detailItem.rating && detailItem.rating !== '0.0' && <GlassBadge label={`⭐ ${detailItem.rating}`} color={primaryColor} />}
                      {detailItem.year && <GlassBadge label={String(detailItem.year)} />}
                      <GlassBadge label="PELÍCULA" icon="film-outline" />
                    </View>
                  </View>
                </View>
                {detailItem.overview ? <Text style={vd.detailOverview}>{detailItem.overview}</Text> : null}
                <View style={{ flexDirection: 'row', gap: T.space.sm, marginTop: T.space.lg }}>
                  {detailItem.streamUrl && (
                    <TouchableOpacity style={[vd.detailBtn, { backgroundColor: primaryColor, flex: 1 }]} onPress={() => reproducir(detailItem)}>
                      <Ionicons name="play" size={18} color="#fff" /><Text style={vd.detailBtnTxt}>Reproducir</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[vd.detailBtn, { backgroundColor: watchlist.includes(detailItem.id) ? primaryColor : T.color.surfaceElevated, flex: 1 }]}
                    onPress={() => setWatchlist(watchlist.includes(detailItem.id) ? watchlist.filter(id => id !== detailItem.id) : [...watchlist, detailItem.id])}>
                    <Ionicons name={watchlist.includes(detailItem.id) ? 'checkmark' : 'add'} size={18} color="#fff" />
                    <Text style={vd.detailBtnTxt}>{watchlist.includes(detailItem.id) ? 'En mi lista' : 'Mi lista'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </Modal>
      )}
    </View>
  );
});

/* ═══════════════════════════════════════════════════════════
   SERIES (con continuar viendo y sin recargas)
═══════════════════════════════════════════════════════════ */
const SeriesPlayerSection = memo(({
  primaryColor, plexShows, loadingPlex, onCargarPlex,
}: {
  primaryColor: string; plexShows: PlexShow[]; loadingPlex: boolean;
  onCargarPlex: (force?: boolean) => void;
}) => {
  const [vodUrl,     setVodUrl]     = useState<string | null>(null);
  const [vodEpisode, setVodEpisode] = useState<PlexEpisode | null>(null);
  const [vodShow,    setVodShow]    = useState<PlexShow | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [view, setView] = useState<'shows' | 'detail' | 'tmdb_popular' | 'tmdb_top'>('shows');
  const [selectedShow,  setSelectedShow]  = useState<PlexShow | null>(null);
  const [activeSeason,  setActiveSeason]  = useState<number>(1);
  const [tmdbItems,   setTmdbItems]   = useState<MediaItem[]>(SERIES_FALLBACK);
  const [loadingTmdb, setLoadingTmdb] = useState(false);
  const [tmdbPage,    setTmdbPage]    = useState(1);
  const [watchlist,   setWatchlist]   = usePersistedState<string[]>('watchlist_tv', []);
  const [busqueda,    setBusqueda]    = useState('');

  const continueWatching = getContinueWatching().filter(i => i.type === 'episode');

  const TAB_OPTIONS = [
    { key: 'shows',        label: 'Mi Drive',  icon: 'cloud-outline'  as const },
    { key: 'tmdb_popular', label: 'Populares', icon: 'flame-outline'  as const },
    { key: 'tmdb_top',     label: 'Top Rated', icon: 'trophy-outline' as const },
  ] as const;

  useEffect(() => {
    if (view === 'shows' && plexShows.length === 0 && !loadingPlex) onCargarPlex();
  }, [view]);
  useEffect(() => {
    if (view === 'tmdb_popular') fetchTmdb('popular', 1);
    if (view === 'tmdb_top')    fetchTmdb('top_rated', 1);
  }, [view]);

  const fetchTmdb = async (cat: string, page: number) => {
    setLoadingTmdb(true);
    try {
      const res  = await fetch(`https://api.themoviedb.org/3/tv/${cat}?api_key=${TMDB_API_KEY}&language=es&page=${page}`);
      const data = await res.json();
      const formatted: MediaItem[] = (data.results || []).map((m: any) => ({
        id: m.id.toString(), title: m.name,
        poster: `https://image.tmdb.org/t/p/w500${m.poster_path}`,
        backdrop: `https://image.tmdb.org/t/p/w780${m.backdrop_path}`,
        year: m.first_air_date ? new Date(m.first_air_date).getFullYear() : undefined,
        rating: m.vote_average?.toFixed(1) ?? '0.0', overview: m.overview, type: 'tv' as const,
      }));
      if (page === 1) setTmdbItems(formatted);
      else setTmdbItems(prev => [...prev, ...formatted]);
    } catch { if (page === 1) setTmdbItems(SERIES_FALLBACK); }
    finally { setLoadingTmdb(false); }
  };

  const getEpisodeList = (): PlexEpisode[] => {
    if (!selectedShow) return [];
    return selectedShow.seasons.flatMap(s => s.episodes);
  };
  const currentEpIndex = vodEpisode ? getEpisodeList().findIndex(e => e.id === vodEpisode.id) : -1;

  const reproducirEpisodio = (ep: PlexEpisode, show: PlexShow) => {
    if (!ep.streamUrl) { Alert.alert('Error', 'No se pudo obtener la URL de reproducción.'); return; }
    console.log('Reproduciendo episodio:', ep.title, 'URL:', ep.streamUrl);
    setVodUrl(ep.streamUrl); setVodEpisode(ep); setVodShow(show); setProgress(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFullscreen(true);
  };

  const episodioSiguiente = () => {
    const list = getEpisodeList();
    if (currentEpIndex < list.length - 1 && vodShow) reproducirEpisodio(list[currentEpIndex + 1], vodShow);
  };
  const episodioAnterior = () => {
    if (currentEpIndex > 0 && vodShow) reproducirEpisodio(getEpisodeList()[currentEpIndex - 1], vodShow);
  };
  const cerrarVod = () => { setVodUrl(null); setVodEpisode(null); setVodShow(null); setFullscreen(false); setProgress(0); };
  const abrirShow = (show: PlexShow) => {
    setSelectedShow(show);
    setActiveSeason(show.seasons[0]?.number ?? 1);
    setView('detail');
  };
  const showsFiltrados = plexShows.filter(s => s.title.toLowerCase().includes(busqueda.toLowerCase()));

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: CARD_H + T.space.md,
    offset: (CARD_H + T.space.md) * Math.floor(index / MEDIA_COLS),
    index,
  }), []);

  const renderContinueItem = (item: ContinueWatchingItem) => (
    <TouchableOpacity key={item.id} style={cwa.card} onPress={() => {
      const show = plexShows.find(s => s.id === item.showId);
      const ep = show?.seasons.flatMap(s => s.episodes).find(e => e.id === item.id);
      if (ep && show) {
        setVodUrl(ep.streamUrl);
        setVodEpisode(ep);
        setVodShow(show);
        setProgress(item.progress / item.duration);
        setFullscreen(true);
      }
    }}>
      <Image source={{ uri: item.poster }} style={cwa.poster} />
      <Text style={cwa.title} numberOfLines={1}>{item.showName || item.title}</Text>
      <Text style={cwa.subtitle}>{item.episodeCode}</Text>
      <View style={cwa.progressTrack}>
        <View style={[cwa.progressFill, { width: `${(item.progress / item.duration) * 100}%`, backgroundColor: primaryColor }]} />
      </View>
    </TouchableOpacity>
  );

  if (fullscreen && vodUrl && vodEpisode && vodShow) {
    return (
      <FullscreenPlayer url={vodUrl} title={vodShow.title} subtitle={`${vodEpisode.code} · ${vodEpisode.title}`}
        primaryColor={primaryColor} onClose={() => setFullscreen(false)}
        onNext={currentEpIndex < getEpisodeList().length - 1 ? episodioSiguiente : undefined}
        onPrev={currentEpIndex > 0 ? episodioAnterior : undefined}
        onError={cerrarVod}
        itemInfo={{
          id: vodEpisode.id, title: vodEpisode.title, poster: vodShow.poster,
          progress: 0, duration: 0, type: 'episode', streamUrl: vodEpisode.streamUrl,
          showId: vodShow.id, showName: vodShow.title, episodeCode: vodEpisode.code,
        }} />
    );
  }

  if (view === 'detail' && selectedShow) {
    const currentSeasonData = selectedShow.seasons.find(s => s.number === activeSeason);
    return (
      <View style={{ flex: 1 }}>
        {vodUrl && vodEpisode && !fullscreen && (
          <MiniPlayerBar title={vodShow?.title ?? ''} subtitle={`${vodEpisode.code} · ${vodEpisode.title}`}
            poster={vodShow?.poster} primaryColor={primaryColor} progress={progress}
            onExpand={() => setFullscreen(true)} onClose={cerrarVod} />
        )}
        <ScrollView style={{ flex: 1 }} stickyHeaderIndices={[1]}>
          <View style={px.heroWrap}>
            {selectedShow.backdrop || selectedShow.poster ? (
              <Image source={{ uri: selectedShow.backdrop ?? selectedShow.poster }} style={px.heroImage} resizeMode="cover" />
            ) : null}
            <View style={px.heroGrad} />
            <TouchableOpacity style={px.backBtn} onPress={() => setView('shows')}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
              <Text style={px.backTxt}>Series</Text>
            </TouchableOpacity>
            <View style={px.heroInfo}>
              <Image source={{ uri: selectedShow.poster }} style={px.heroPoster} resizeMode="cover" />
              <View style={{ flex: 1, paddingLeft: T.space.md }}>
                <Text style={px.heroTitle} numberOfLines={2}>{selectedShow.title}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space.xs, marginTop: T.space.sm }}>
                  {selectedShow.rating && <GlassBadge label={`⭐ ${selectedShow.rating}`} color={primaryColor} />}
                  {selectedShow.year   && <GlassBadge label={String(selectedShow.year)} />}
                  <GlassBadge label={`${selectedShow.seasons.length} temp.`} icon="layers-outline" color={primaryColor} />
                </View>
                {selectedShow.overview ? <Text style={px.heroOverview} numberOfLines={3}>{selectedShow.overview}</Text> : null}
              </View>
            </View>
          </View>
          <View style={px.seasonBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: T.space.lg, gap: T.space.sm }}>
              {selectedShow.seasons.map(s => (
                <TouchableOpacity key={s.number} onPress={() => { setActiveSeason(s.number); Haptics.selectionAsync(); }}
                  style={[px.seasonChip, activeSeason === s.number && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
                  <Ionicons name="layers-outline" size={12} color={activeSeason === s.number ? '#fff' : T.color.textMuted} style={{ marginRight: 4 }} />
                  <Text style={[px.seasonChipTxt, activeSeason === s.number && { color: '#fff', fontWeight: T.font.bold }]}>T{s.number}</Text>
                  <Text style={[px.seasonChipCount, activeSeason === s.number && { color: 'rgba(255,255,255,0.7)' }]}>{s.episodes.length} ep.</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          {currentSeasonData ? (
            <View style={{ paddingHorizontal: T.space.lg, paddingBottom: 40 }}>
              <Text style={px.episodesSectionLabel}>{currentSeasonData.label} — {currentSeasonData.episodes.length} episodios</Text>
              {currentSeasonData.episodes.map(ep => {
                const playing = vodEpisode?.id === ep.id;
                return (
                  <TouchableOpacity key={ep.id} style={[px.episodeRow, playing && { borderColor: primaryColor, backgroundColor: T.color.surfaceElevated }]}
                    onPress={() => reproducirEpisodio(ep, selectedShow)} activeOpacity={0.78}>
                    <View style={[px.epCodeBadge, { backgroundColor: playing ? primaryColor : T.color.surfaceHigh }]}>
                      {playing ? <Ionicons name="play" size={12} color="#fff" /> : <Text style={[px.epCode, { color: primaryColor }]}>{ep.code}</Text>}
                    </View>
                    <View style={px.epThumb}>
                      {ep.poster
                        ? <Image source={{ uri: ep.poster }} style={px.epThumbImg} resizeMode="cover" />
                        : <View style={[px.epThumbImg, { backgroundColor: T.color.surfaceHigh, alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="play-circle-outline" size={24} color={T.color.textMuted} /></View>
                      }
                      {playing && <View style={[px.epThumbPlay, { backgroundColor: primaryColor }]}><Ionicons name="play" size={10} color="#fff" /></View>}
                    </View>
                    <View style={{ flex: 1, marginLeft: T.space.sm }}>
                      <Text style={[px.epTitle, playing && { color: primaryColor }]} numberOfLines={1}>{ep.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm, marginTop: 3 }}>
                        {ep.airDate  && <Text style={px.epMeta}>{ep.airDate.slice(0, 7)}</Text>}
                        {ep.runtime  && <Text style={px.epMeta}>{ep.runtime} min</Text>}
                      </View>
                      {ep.overview ? <Text style={px.epOverview} numberOfLines={2}>{ep.overview}</Text> : null}
                    </View>
                    <TouchableOpacity style={[px.epPlayBtn, { backgroundColor: playing ? primaryColor : T.color.glassWhite, borderColor: playing ? primaryColor : T.color.glassBorder }]}
                      onPress={() => reproducirEpisodio(ep, selectedShow)}>
                      <Ionicons name="play" size={14} color={playing ? '#fff' : T.color.textSecondary} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (view === 'tmdb_popular' || view === 'tmdb_top') {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={lv.catRow} contentContainerStyle={{ paddingHorizontal: T.space.lg, gap: T.space.sm }}>
            {TAB_OPTIONS.map(({ key, label, icon }) => (
              <TouchableOpacity key={key} onPress={() => { setView(key); setTmdbPage(1); }} style={[lv.catChip, view === key && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
                <Ionicons name={icon} size={12} color={view === key ? '#fff' : T.color.textMuted} style={{ marginRight: 4 }} />
                <Text style={[lv.catTxt, view === key && { color: '#fff', fontWeight: T.font.bold }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        {loadingTmdb ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={primaryColor} /></View>
        ) : (
          <FlatList
            data={tmdbItems}
            keyExtractor={item => item.id}
            numColumns={MEDIA_COLS}
            getItemLayout={getItemLayout}
            windowSize={5}
            maxToRenderPerBatch={10}
            removeClippedSubviews
            contentContainerStyle={{ paddingHorizontal: T.space.lg, paddingBottom: 24, paddingTop: T.space.sm }}
            columnWrapperStyle={MEDIA_COLS > 1 ? { gap: T.space.md, marginBottom: T.space.md } : undefined}
            onEndReached={() => { const next = tmdbPage + 1; setTmdbPage(next); fetchTmdb(view === 'tmdb_popular' ? 'popular' : 'top_rated', next); }}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => (
              <Pressable style={vd.card} onPress={() => {}}>
                <Image source={{ uri: item.poster }} style={vd.poster} resizeMode="cover" />
                <View style={vd.posterGradient} />
                <View style={vd.cardBottom}>
                  <Text style={vd.cardTitle} numberOfLines={2}>{item.title}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.xs, marginTop: 4 }}>
                    {item.year ? <Text style={vd.cardYear}>{item.year}</Text> : null}
                    {item.rating && item.rating !== '0.0' && <View style={[vd.ratingPill, { backgroundColor: primaryColor + '22' }]}><Text style={[vd.ratingTxt, { color: primaryColor }]}>⭐ {item.rating}</Text></View>}
                  </View>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {vodUrl && vodEpisode && !fullscreen && (
        <MiniPlayerBar title={vodShow?.title ?? ''} subtitle={`${vodEpisode.code} · ${vodEpisode.title}`}
          poster={vodShow?.poster} primaryColor={primaryColor} progress={progress}
          onExpand={() => setFullscreen(true)} onClose={cerrarVod} />
      )}

      {/* Continuar viendo para episodios */}
      {continueWatching.length > 0 && (
        <View style={cwa.section}>
          <Text style={cwa.sectionTitle}>CONTINUAR VIENDO</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cwa.scroll}>
            {continueWatching.slice(0, 8).map(renderContinueItem)}
          </ScrollView>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={lv.catRow} contentContainerStyle={{ paddingHorizontal: T.space.lg, gap: T.space.sm }}>
          {TAB_OPTIONS.map(({ key, label, icon }) => (
            <TouchableOpacity key={key} onPress={() => setView(key)} style={[lv.catChip, view === key && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
              <Ionicons name={icon} size={12} color={view === key ? '#fff' : T.color.textMuted} style={{ marginRight: 4 }} />
              <Text style={[lv.catTxt, view === key && { color: '#fff', fontWeight: T.font.bold }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={[lv.searchRow, { marginBottom: T.space.sm }]}>
        <Ionicons name="search" size={16} color={T.color.textMuted} style={{ marginRight: T.space.sm }} />
        <TextInput style={lv.searchInput} placeholder="Buscar serie..." placeholderTextColor={T.color.textMuted} value={busqueda} onChangeText={setBusqueda} />
        {busqueda !== '' && <TouchableOpacity onPress={() => setBusqueda('')}><Ionicons name="close-circle" size={18} color={T.color.textMuted} /></TouchableOpacity>}
      </View>
      {loadingPlex ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: T.color.textMuted, marginTop: 12, fontSize: T.font.sm }}>Escaneando tu Drive…</Text>
        </View>
      ) : showsFiltrados.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: T.space.xl }}>
          <Ionicons name="tv-outline" size={56} color={T.color.textMuted} />
          <Text style={{ color: T.color.textPrimary, marginTop: 16, fontSize: T.font.md, fontWeight: T.font.bold, textAlign: 'center' }}>Sin series encontradas</Text>
          <TouchableOpacity style={[vd.addBtnSmall, { backgroundColor: primaryColor, marginTop: T.space.lg, paddingHorizontal: T.space.xl }]} onPress={() => onCargarPlex(true)}>
            <Text style={{ color: '#fff', fontWeight: T.font.bold }}>Reescanear Drive</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={showsFiltrados}
          keyExtractor={item => item.id}
          numColumns={MEDIA_COLS}
          getItemLayout={getItemLayout}
          windowSize={5}
          maxToRenderPerBatch={10}
          removeClippedSubviews
          contentContainerStyle={{ paddingHorizontal: T.space.lg, paddingBottom: 24, paddingTop: T.space.xs }}
          columnWrapperStyle={MEDIA_COLS > 1 ? { gap: T.space.md, marginBottom: T.space.md } : undefined}
          refreshControl={<RefreshControl refreshing={loadingPlex} onRefresh={() => onCargarPlex(true)} tintColor={primaryColor} />}
          renderItem={({ item: show }) => {
            const totalEps = show.seasons.reduce((acc, s) => acc + s.episodes.length, 0);
            const playing  = vodShow?.id === show.id;
            return (
              <Pressable style={[vd.card, playing && { borderColor: primaryColor }]} onPress={() => abrirShow(show)}>
                <Image source={{ uri: show.poster }} style={vd.poster} resizeMode="cover" />
                <View style={vd.posterGradient} />
                {playing && <View style={[vd.playingBadge, { backgroundColor: primaryColor }]}><Ionicons name="play" size={10} color="#fff" /></View>}
                <View style={px.showBadgeWrap}>
                  <View style={[px.showBadge, { backgroundColor: primaryColor }]}>
                    <Text style={px.showBadgeTxt}>{show.seasons.length}T</Text>
                  </View>
                </View>
                <View style={vd.cardBottom}>
                  <Text style={vd.cardTitle} numberOfLines={2}>{show.title}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.xs, marginTop: 4 }}>
                    {show.year ? <Text style={vd.cardYear}>{show.year}</Text> : null}
                    <Text style={vd.cardYear}>· {totalEps} ep.</Text>
                  </View>
                  {show.rating && show.rating !== '0.0' && <View style={[vd.ratingPill, { backgroundColor: primaryColor + '22', marginTop: 4 }]}><Text style={[vd.ratingTxt, { color: primaryColor }]}>⭐ {show.rating}</Text></View>}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
});

/* ═══════════════════════════════════════════════════════════
   AJUSTES
═══════════════════════════════════════════════════════════ */
const AjustesSection = ({ primaryColor, accentColor, setAccentColor, onRefreshChannels }: any) => {
  const [appId, setAppId] = useState('');
  useEffect(() => {
    const id = storage.getString('appId') || ('NXTV-' + Math.random().toString(36).substr(2, 6).toUpperCase());
    storage.set('appId', id);
    setAppId(id);
  }, []);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={aj.sectionTitle}>Personalización</Text>
      <View style={aj.card}>
        <Text style={aj.label}>Color de acento</Text>
        <View style={{ flexDirection: 'row', gap: T.space.sm, marginTop: T.space.md }}>
          {Object.entries(ACCENT_COLORS).map(([key, color]) => (
            <TouchableOpacity key={key} onPress={() => setAccentColor(key)} style={[aj.colorDot, { backgroundColor: color }, accentColor === key && aj.colorDotActive]}>
              {accentColor === key && <Ionicons name="checkmark" size={14} color="#fff" />}
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <Text style={aj.sectionTitle}>Canales</Text>
      <TouchableOpacity style={aj.card} onPress={onRefreshChannels}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={aj.label}>Actualizar lista M3U</Text>
          <Ionicons name="refresh" size={20} color={primaryColor} />
        </View>
      </TouchableOpacity>
      <Text style={aj.sectionTitle}>Reproducción</Text>
      <View style={aj.card}>
        <Text style={aj.label}>Pantalla completa automática</Text>
        <Text style={[aj.value, { marginTop: 4, fontSize: T.font.xs, lineHeight: 18 }]}>
          Al reproducir contenido, el reproductor rota automáticamente a landscape y ocupa toda la pantalla.
        </Text>
      </View>
      <Text style={aj.sectionTitle}>Streaming Drive</Text>
      <View style={aj.card}>
        <Text style={aj.label}>Método de reproducción</Text>
        <Text style={[aj.value, { marginTop: 4, fontSize: T.font.xs, lineHeight: 18 }]}>
          Los archivos de Google Drive se reproducen via API directa (alt=media) compatible con el reproductor nativo.
        </Text>
      </View>
      <Text style={aj.sectionTitle}>Información</Text>
      <View style={aj.card}>
        <Text style={aj.label}>Identificador de dispositivo</Text>
        <Text style={[aj.value, { color: primaryColor, marginTop: 6, fontSize: T.font.sm }]} selectable>{appId}</Text>
      </View>
      <View style={aj.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={aj.label}>Versión</Text>
          <Text style={aj.value}>5.1.0</Text>
        </View>
      </View>
      <View style={aj.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={aj.label}>Plataforma</Text>
          <Text style={aj.value}>{Platform.OS.toUpperCase()} {IS_TV ? '· TV' : IS_TABLET ? '· Tablet' : '· Móvil'}</Text>
        </View>
      </View>
    </ScrollView>
  );
};

/* ═══════════════════════════════════════════════════════════
   APP PRINCIPAL
═══════════════════════════════════════════════════════════ */
export default function App() {
  const [splash, setSplash] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [listaCanales, setListaCanales] = useState<Canal[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [favorites, setFavorites] = usePersistedState<string[]>('favorites', []);
  const [accentColor, setAccentColor] = usePersistedState<string>('accentColor', 'red');
  const [driveMovies, setDriveMovies] = useState<MediaItem[]>([]);
  const [loadingDriveMovies, setLoadingDriveMovies] = useState(false);
  const [plexShows, setPlexShows] = useState<PlexShow[]>([]);
  const [loadingPlex, setLoadingPlex] = useState(false);

  const driveMoviesLoaded = useRef(false);
  const plexLoaded = useRef(false);
  const primaryColor = ACCENT_COLORS[accentColor] || ACCENT_COLORS.red;
  const cargaEnCurso = useRef(false);

  useEffect(() => { lockPortrait(); }, []);

  const splashOp  = useRef(new Animated.Value(0)).current;
  const splashSc  = useRef(new Animated.Value(0.94)).current;
  const ringRot   = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0.85)).current;
  const progressA = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    StatusBar.setBarStyle('light-content');
    Animated.parallel([
      Animated.timing(splashOp, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(splashSc, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const rot  = Animated.loop(Animated.timing(ringRot, { toValue: 1, duration: 3800, easing: Easing.linear, useNativeDriver: true }));
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(glowPulse, { toValue: 1.12, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glowPulse, { toValue: 0.82, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    rot.start(); glow.start();
    Animated.timing(progressA, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(splashOp, { toValue: 0, duration: 320, useNativeDriver: true }),
        Animated.timing(splashSc, { toValue: 1.04, duration: 320, useNativeDriver: true }),
      ]).start(() => setSplash(false));
    }, 2700);
    return () => { clearTimeout(t); rot.stop(); glow.stop(); };
  }, []);

  const cargarListaM3U = useCallback(async () => {
    if (cargaEnCurso.current) return;
    cargaEnCurso.current = true;
    setLoadingChannels(true);
    for (let i = 0; i < 3; i++) {
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
            info.name     = parts[parts.length - 1].trim() || 'Canal';
            info.logo     = lim.match(/tvg-logo="([^"]+)"/i)?.[1] ?? '';
            info.category = lim.match(/group-title="([^"]+)"/i)?.[1] ?? 'General';
          } else if (lim.startsWith('http')) {
            let url = convertirMpdAHls(lim);
            const slug = extractEmbedSlug(url);
            const isEmbed = slug && (url.includes('streamtpday1') || url.includes('saohgdasregions'));
            parsed.push({
              id: String(3000 + idx), numero: idx++, name: info.name,
              logo: info.logo, category: info.category, url,
              ...(isEmbed ? { embedSlug: slug!, needsWebView: true } : {}),
            });
            info = { name: '', logo: '', category: 'General' };
          }
        });
        setListaCanales([...CANALES_MANUALES, ...parsed]);
        break;
      } catch {
        if (i === 2) setListaCanales(CANALES_MANUALES);
        await new Promise(r => setTimeout(r, 800));
      }
    }
    setLoadingChannels(false);
    cargaEnCurso.current = false;
  }, []);

  useEffect(() => { cargarListaM3U(); }, []);
  const onRefresh = useCallback(async () => { setRefreshing(true); await cargarListaM3U(); setRefreshing(false); }, [cargarListaM3U]);

  const cargarDriveMovies = useCallback(async (force = false) => {
    if (force) driveMoviesLoaded.current = false;
    if (loadingDriveMovies || driveMoviesLoaded.current) return;
    setLoadingDriveMovies(true);
    try {
      const items = await cargarCarpetaDrive(DRIVE_FOLDER_PELICULAS, 'movie', 'driveMoviesCache');
      setDriveMovies(items);
      driveMoviesLoaded.current = true;
    } finally { setLoadingDriveMovies(false); }
  }, [loadingDriveMovies]);

  const cargarPlex = useCallback(async (force = false) => {
    if (force) plexLoaded.current = false;
    if (loadingPlex || plexLoaded.current) return;
    setLoadingPlex(true);
    try {
      const shows = await cargarSeriesPlex(DRIVE_FOLDER_SERIES, 'driveSeriesCache');
      setPlexShows(shows);
      plexLoaded.current = true;
    } finally { setLoadingPlex(false); }
  }, [loadingPlex]);

  const tabOpacity = useRef(new Animated.Value(1)).current;
  const changeTab  = (i: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Animated.timing(tabOpacity, { toValue: 0, duration: 90, useNativeDriver: true }).start(() => {
      setActiveTab(i);
      Animated.timing(tabOpacity, { toValue: 1, duration: 90, useNativeDriver: true }).start();
    });
  };

  if (splash) {
    const spin          = ringRot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    const progressWidth = progressA.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
    return (
      <View style={sp.root}>
        <StatusBar hidden />
        <View style={sp.bgOrb1} /><View style={sp.bgOrb2} />
        <Animated.View style={[sp.center, { opacity: splashOp, transform: [{ scale: splashSc }] }]}>
          <Animated.View style={[sp.logoGlow, { transform: [{ scale: glowPulse }] }]} />
          <Animated.View style={[sp.ring, { transform: [{ rotate: spin }] }]}>
            <View style={sp.ringDot1} /><View style={sp.ringDot2} />
          </Animated.View>
          <View style={sp.logoCore}><Text style={sp.logoN}>N</Text></View>
          <Text style={sp.title}>NEXUS<Text style={sp.accent}>TV</Text></Text>
          <Text style={sp.sub}>STREAMING PREMIUM</Text>
          <View style={sp.track}><Animated.View style={[sp.fill, { width: progressWidth }]} /></View>
          <Text style={sp.loadTxt}>SINTONIZANDO CANALES</Text>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={main.container}>
      <StatusBar barStyle="light-content" backgroundColor={T.color.bg} />
      <View style={main.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
          <View style={[main.logoMark, { backgroundColor: primaryColor }]}>
            <Text style={main.logoMarkTxt}>N</Text>
          </View>
          <Text style={main.logo}>NEXUS<Text style={[main.logoAccent, { color: primaryColor }]}>TV</Text></Text>
        </View>
        <View style={main.headerRight}>
          <TouchableOpacity style={main.headerBtn}><Ionicons name="notifications-outline" size={20} color={T.color.textSecondary} /></TouchableOpacity>
          <TouchableOpacity style={main.headerBtn}>
            <View style={[main.avatar, { backgroundColor: primaryColor + 'CC' }]}><Text style={main.avatarTxt}>U</Text></View>
          </TouchableOpacity>
        </View>
      </View>

      <Animated.View style={[{ flex: 1 }, { opacity: tabOpacity }]}>
        {activeTab === 0 && (
          <LivePlayerSection primaryColor={primaryColor} listaCanales={listaCanales}
            loadingChannels={loadingChannels} refreshing={refreshing} onRefresh={onRefresh}
            favorites={favorites} setFavorites={setFavorites} />
        )}
        {activeTab === 1 && (
          <MoviesPlayerSection primaryColor={primaryColor}
            driveItems={driveMovies} loadingDrive={loadingDriveMovies} onCargarDrive={cargarDriveMovies} />
        )}
        {activeTab === 2 && (
          <SeriesPlayerSection primaryColor={primaryColor}
            plexShows={plexShows} loadingPlex={loadingPlex} onCargarPlex={cargarPlex} />
        )}
        {activeTab === 3 && (
          <AjustesSection primaryColor={primaryColor} accentColor={accentColor}
            setAccentColor={setAccentColor} onRefreshChannels={cargarListaM3U} />
        )}
      </Animated.View>

      <View style={main.tabBar}>
        {[
          { label: 'TV En Vivo', icon: 'tv-outline',       iconA: 'tv',       idx: 0 },
          { label: 'Películas',  icon: 'film-outline',     iconA: 'film',     idx: 1 },
          { label: 'Series',     icon: 'videocam-outline', iconA: 'videocam', idx: 2 },
          { label: 'Ajustes',    icon: 'settings-outline', iconA: 'settings', idx: 3 },
        ].map(tab => (
          <TouchableOpacity key={tab.idx} style={main.tabItem} onPress={() => changeTab(tab.idx)} activeOpacity={0.75}>
            {activeTab === tab.idx && <View style={[main.tabIndicator, { backgroundColor: primaryColor }]} />}
            <Ionicons name={activeTab === tab.idx ? tab.iconA : tab.icon as any} size={IS_TV ? 30 : 22} color={activeTab === tab.idx ? primaryColor : T.color.textMuted} />
            <Text style={[main.tabLabel, activeTab === tab.idx && { color: T.color.textPrimary, fontWeight: T.font.semibold }]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
   ESTILOS (completos y renovados)
═══════════════════════════════════════════════════════════ */
const fs = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: T.space.lg, paddingTop: T.space.lg, paddingBottom: T.space.md, backgroundColor: 'rgba(0,0,0,0.55)' },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  titleTxt: { color: '#fff', fontSize: T.font.md, fontWeight: T.font.bold },
  subtitleTxt: { color: 'rgba(255,255,255,0.6)', fontSize: T.font.sm, marginTop: 2 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,45,85,0.9)', borderRadius: T.radius.full, paddingHorizontal: 10, paddingVertical: 5, gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff' },
  liveTxt: { color: '#fff', fontSize: T.font.sm, fontWeight: T.font.black, letterSpacing: 1 },
  centerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: T.space.xl },
  navBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  seekBigBtn: { alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  seekBigLabel: { color: '#fff', fontSize: 11, fontWeight: T.font.black, marginTop: 2 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: T.space.lg, paddingBottom: T.space.lg, paddingTop: T.space.md, backgroundColor: 'rgba(0,0,0,0.55)', gap: T.space.sm },
  timeTxt: { color: '#fff', fontSize: T.font.sm, fontWeight: T.font.semibold, minWidth: 44, textAlign: 'center' },
  progressTrack: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'visible', position: 'relative' },
  progressFill: { height: '100%', borderRadius: 2 },
  progressThumb: { position: 'absolute', top: -6, marginLeft: -7, width: 14, height: 14, borderRadius: 7, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4 },
});

const mp = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.color.glassBackground, borderBottomWidth: 1, borderBottomColor: T.color.border, paddingHorizontal: T.space.md, paddingVertical: T.space.sm, position: 'relative', overflow: 'hidden', backdropFilter: 'blur(10px)' },
  progressLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.1)' },
  progressFill: { height: '100%' },
  poster: { width: 40, height: 40, borderRadius: T.radius.sm },
  title: { color: T.color.textPrimary, fontSize: T.font.sm, fontWeight: T.font.semibold },
  sub: { color: T.color.textMuted, fontSize: T.font.xs, marginTop: 2 },
  expandBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.color.surfaceHigh, alignItems: 'center', justifyContent: 'center', marginRight: T.space.xs },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});

const pl = StyleSheet.create({
  seekOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: T.space.sm, gap: T.space.xl, backgroundColor: 'rgba(0,0,0,0.4)' },
  seekBtn: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  seekLabel: { color: '#fff', fontSize: 10, fontWeight: T.font.black },
  seekBtnPlay: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
});

const lv = StyleSheet.create({
  playerBox: { width: '100%', backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  noSignal: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.color.surface },
  noSignalTxt: { color: T.color.textMuted, fontSize: T.font.sm, marginTop: 8 },
  navLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
  navRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: T.space.md, paddingTop: T.space.sm, paddingBottom: T.space.sm },
  topBarRight: { flexDirection: 'row', gap: T.space.sm, marginLeft: 'auto' },
  livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,45,85,0.90)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: T.radius.full, gap: 5, shadowColor: '#FF2D55', shadowOpacity: 0.5, shadowRadius: 6, elevation: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveTxt: { color: '#fff', fontSize: T.font.xs, fontWeight: T.font.black, letterSpacing: 1 },
  iconBtn: { width: s(32), height: s(32), borderRadius: T.radius.sm, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  bottomGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: T.space.md, paddingBottom: T.space.md, paddingTop: 48, backgroundColor: 'rgba(0,0,0,0.6)' },
  channelInfoRow: { flexDirection: 'row', alignItems: 'center' },
  numBadgeLarge: { width: 38, height: 28, borderRadius: T.radius.sm, alignItems: 'center', justifyContent: 'center', marginRight: T.space.sm },
  numLarge: { color: '#fff', fontSize: T.font.sm, fontWeight: T.font.black },
  chName: { color: '#fff', fontSize: T.font.md, fontWeight: T.font.bold },
  chNow: { color: 'rgba(255,255,255,0.55)', fontSize: T.font.sm, marginTop: 2 },
  tapHint: { position: 'absolute', bottom: T.space.sm, right: T.space.md, flexDirection: 'row', alignItems: 'center', gap: 4 },
  tapHintTxt: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
  osd: { position: 'absolute', top: '30%', left: '50%', transform: [{ translateX: -30 }], backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: T.radius.lg, paddingHorizontal: T.space.lg, paddingVertical: T.space.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  osdTxt: { fontSize: T.font.xxl, fontWeight: T.font.black },
  osdError: { position: 'absolute', top: '40%', left: 20, right: 20, backgroundColor: 'rgba(229,9,20,0.9)', borderRadius: T.radius.lg, padding: T.space.md, alignItems: 'center' },
  osdErrTxt: { color: '#fff', fontWeight: T.font.bold, letterSpacing: 1 },
  recentsSection: { paddingTop: T.space.sm },
  recentsSectionLabel: { color: T.color.textMuted, fontSize: 10, fontWeight: T.font.bold, letterSpacing: 1.5, marginLeft: T.space.lg, marginBottom: T.space.xs },
  recentChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: T.color.surfaceElevated, borderRadius: T.radius.full, borderWidth: 1, borderColor: T.color.glassBorder, paddingHorizontal: T.space.md, paddingVertical: T.space.xs },
  recentLogo: { width: 14, height: 14, borderRadius: 2 },
  recentTxt: { color: T.color.textSecondary, fontSize: T.font.sm, maxWidth: 90 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: T.space.lg, marginTop: T.space.sm, marginBottom: T.space.xs, backgroundColor: T.color.surfaceElevated, borderRadius: T.radius.lg, paddingHorizontal: T.space.md, height: s(40), borderWidth: 1, borderColor: T.color.glassBorder },
  searchInput: { flex: 1, color: T.color.textPrimary, fontSize: T.font.sm },
  catRow: { maxHeight: 44, marginVertical: T.space.xs },
  catChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.color.surfaceElevated, borderRadius: T.radius.full, paddingHorizontal: T.space.md, paddingVertical: T.space.xs, borderWidth: 1, borderColor: T.color.glassBorder, height: 32, justifyContent: 'center' },
  catTxt: { color: T.color.textSecondary, fontSize: T.font.sm },
  channelRow: { flexDirection: 'row', alignItems: 'center', height: s(70), backgroundColor: T.color.surface, borderRadius: T.radius.lg, paddingHorizontal: T.space.md, borderLeftWidth: 3, borderLeftColor: 'transparent', borderWidth: 1, borderColor: T.color.border },
  numBadge: { width: s(38), height: s(26), borderRadius: T.radius.sm, alignItems: 'center', justifyContent: 'center' },
  numTxt: { fontSize: T.font.sm, fontWeight: T.font.bold },
  rowName: { color: T.color.textSecondary, fontSize: T.font.sm },
  rowNow: { color: T.color.textMuted, fontSize: T.font.xs },
  nowDot: { width: 5, height: 5, borderRadius: 2.5 },
  logo: { width: s(36), height: s(24), resizeMode: 'contain', marginLeft: T.space.sm },
  logoPlaceholder: { width: s(36), height: s(24), backgroundColor: T.color.surfaceHigh, borderRadius: T.radius.sm, alignItems: 'center', justifyContent: 'center', marginLeft: T.space.sm },
});

const vd = StyleSheet.create({
  addBtn: { width: 36, height: 36, borderRadius: T.radius.full, alignItems: 'center', justifyContent: 'center', marginRight: T.space.lg },
  addForm: { marginHorizontal: T.space.lg, marginBottom: T.space.sm, backgroundColor: T.color.surfaceElevated, borderRadius: T.radius.lg, padding: T.space.md, borderWidth: 1, borderColor: T.color.glassBorder },
  addFormTitle: { color: T.color.textPrimary, fontSize: T.font.md, fontWeight: T.font.bold, marginBottom: T.space.sm },
  addInput: { backgroundColor: T.color.surface, color: T.color.textPrimary, borderRadius: T.radius.md, paddingHorizontal: T.space.md, height: s(42), marginBottom: T.space.sm, fontSize: T.font.sm, borderWidth: 1, borderColor: T.color.border },
  addBtnSmall: { borderRadius: T.radius.md, paddingVertical: T.space.sm, alignItems: 'center', justifyContent: 'center' },
  card: { width: CARD_W, borderRadius: T.radius.xl, overflow: 'hidden', backgroundColor: T.color.surfaceElevated, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.50, shadowRadius: 16, elevation: 12, borderWidth: 1, borderColor: T.color.border },
  poster: { width: '100%', aspectRatio: 2 / 3, backgroundColor: T.color.surfaceHigh },
  posterGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', backgroundColor: 'transparent' },
  cardBottom: { padding: T.space.sm, paddingBottom: T.space.md },
  cardTitle: { color: T.color.textPrimary, fontSize: T.font.sm, fontWeight: T.font.semibold, lineHeight: 17 },
  cardYear: { color: T.color.textMuted, fontSize: 11 },
  ratingPill: { borderRadius: T.radius.full, paddingHorizontal: T.space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  ratingTxt: { fontSize: T.font.xs, fontWeight: T.font.bold },
  playingBadge: { position: 'absolute', top: T.space.sm, left: T.space.sm, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4 },
  customBadge: { position: 'absolute', top: T.space.sm, right: T.space.sm, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: T.radius.sm, paddingHorizontal: T.space.xs, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  customBadgeTxt: { color: '#fff', fontSize: 9, fontWeight: T.font.black, letterSpacing: 0.5 },
  detailHero: { width: '100%', height: H * 0.3 },
  detailGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: H * 0.3, backgroundColor: 'rgba(7,7,15,0.4)' },
  detailClose: { position: 'absolute', top: T.space.lg, right: T.space.lg },
  detailBody: { padding: T.space.lg },
  detailPoster: { width: s(100), height: s(150), borderRadius: T.radius.lg, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 12 },
  detailTitle: { color: T.color.textPrimary, fontSize: T.font.xl, fontWeight: T.font.bold, lineHeight: 28 },
  detailOverview: { color: T.color.textSecondary, fontSize: T.font.sm, lineHeight: 22, marginTop: T.space.sm },
  detailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: T.space.sm, borderRadius: T.radius.lg, paddingVertical: T.space.md },
  detailBtnTxt: { color: '#fff', fontWeight: T.font.bold, fontSize: T.font.sm },
});

const px = StyleSheet.create({
  heroWrap: { position: 'relative' },
  heroImage: { width: '100%', height: 240 },
  heroGrad: { position: 'absolute', inset: 0, bottom: 0, top: 0, left: 0, right: 0, backgroundColor: 'rgba(7,7,15,0.65)' },
  backBtn: { position: 'absolute', top: T.space.lg, left: T.space.lg, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: T.radius.full, paddingHorizontal: T.space.md, paddingVertical: T.space.xs, borderWidth: 1, borderColor: T.color.glassBorder },
  backTxt: { color: '#fff', fontSize: T.font.sm, fontWeight: T.font.semibold },
  heroInfo: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-end', padding: T.space.lg },
  heroPoster: { width: s(74), height: s(110), borderRadius: T.radius.md, shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  heroTitle: { color: '#fff', fontSize: T.font.lg, fontWeight: T.font.black, lineHeight: 26 },
  heroOverview: { color: 'rgba(255,255,255,0.60)', fontSize: T.font.xs, lineHeight: 18, marginTop: T.space.sm },
  seasonBar: { backgroundColor: T.color.surface, paddingVertical: T.space.sm, borderBottomWidth: 1, borderBottomColor: T.color.border },
  seasonChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.color.surfaceElevated, borderRadius: T.radius.full, borderWidth: 1, borderColor: T.color.glassBorder, paddingHorizontal: 12, paddingVertical: 6, gap: 3 },
  seasonChipTxt: { color: T.color.textSecondary, fontSize: T.font.sm, fontWeight: T.font.semibold },
  seasonChipCount: { color: T.color.textMuted, fontSize: 11 },
  episodesSectionLabel: { color: T.color.textMuted, fontSize: 11, fontWeight: T.font.bold, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: T.space.lg, marginBottom: T.space.md },
  episodeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.color.surface, borderRadius: T.radius.lg, borderWidth: 1, borderColor: T.color.border, padding: T.space.sm, marginBottom: T.space.sm },
  epCodeBadge: { width: 46, height: 32, borderRadius: T.radius.md, alignItems: 'center', justifyContent: 'center', marginRight: T.space.sm },
  epCode: { fontSize: 11, fontWeight: T.font.black, letterSpacing: 0.5 },
  epThumb: { position: 'relative' },
  epThumbImg: { width: s(90), height: s(52), borderRadius: T.radius.md, overflow: 'hidden' },
  epThumbPlay: { position: 'absolute', bottom: 4, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  epTitle: { color: T.color.textPrimary, fontSize: T.font.sm, fontWeight: T.font.semibold },
  epMeta: { color: T.color.textMuted, fontSize: 11 },
  epOverview: { color: T.color.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  epPlayBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginLeft: T.space.sm },
  showBadgeWrap: { position: 'absolute', top: T.space.sm, right: T.space.sm },
  showBadge: { borderRadius: T.radius.md, paddingHorizontal: 6, paddingVertical: 3, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4 },
  showBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: T.font.black, letterSpacing: 0.5 },
});

const aj = StyleSheet.create({
  sectionTitle: { color: T.color.textMuted, fontSize: T.font.xs, fontWeight: T.font.bold, letterSpacing: 1.5, textTransform: 'uppercase', marginLeft: T.space.lg, marginTop: T.space.lg, marginBottom: T.space.sm },
  card: { marginHorizontal: T.space.lg, backgroundColor: T.color.surfaceElevated, borderRadius: T.radius.lg, padding: T.space.md, marginBottom: T.space.sm, borderWidth: 1, borderColor: T.color.border },
  label: { color: T.color.textSecondary, fontSize: T.font.sm },
  value: { color: T.color.textMuted, fontSize: T.font.sm },
  colorDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  colorDotActive: { borderWidth: 3, borderColor: '#fff', shadowColor: '#fff', shadowOpacity: 0.3, shadowRadius: 6 },
});

const main = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.color.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: T.space.lg, paddingTop: Platform.OS === 'ios' ? 52 : 14, paddingBottom: T.space.sm, backgroundColor: T.color.bg, borderBottomWidth: 1, borderBottomColor: T.color.border },
  logoMark: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  logoMarkTxt: { color: '#fff', fontSize: 14, fontWeight: T.font.black, fontStyle: 'italic' },
  logo: { color: '#fff', fontSize: T.font.xl, fontWeight: T.font.black, letterSpacing: -0.5 },
  logoAccent: { fontWeight: T.font.black },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  headerBtn: { padding: T.space.xs },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  avatarTxt: { color: '#fff', fontSize: T.font.sm, fontWeight: T.font.bold },
  tabBar: { flexDirection: 'row', backgroundColor: T.color.surface, borderTopWidth: 1, borderTopColor: T.color.border, paddingBottom: Platform.OS === 'ios' ? 20 : 6, paddingTop: 6 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', paddingTop: 6 },
  tabIndicator: { position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: 1 },
  tabLabel: { color: T.color.textMuted, fontSize: T.font.xs, marginTop: 3, fontWeight: T.font.medium },
});

const sp = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07070F', alignItems: 'center', justifyContent: 'center' },
  bgOrb1: { position: 'absolute', width: 340, height: 340, borderRadius: 170, backgroundColor: 'rgba(229,9,20,0.06)', top: -60, left: -80 },
  bgOrb2: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(108,99,255,0.05)', bottom: -40, right: -60 },
  center: { alignItems: 'center' },
  logoGlow: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(229,9,20,0.14)' },
  ring: { width: 110, height: 110, borderRadius: 55, borderWidth: 1.5, borderColor: 'rgba(229,9,20,0.4)', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  ringDot1: { position: 'absolute', top: 6, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E50914' },
  ringDot2: { position: 'absolute', bottom: 6, right: 6, width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(229,9,20,0.5)' },
  logoCore: { width: 80, height: 80, borderRadius: 20, backgroundColor: T.color.surface, borderWidth: 1, borderColor: 'rgba(229,9,20,0.3)', alignItems: 'center', justifyContent: 'center' },
  logoN: { color: '#E50914', fontSize: 42, fontWeight: '900', fontStyle: 'italic' },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: 4, marginTop: 24 },
  accent: { color: '#E50914' },
  sub: { color: 'rgba(255,255,255,0.3)', fontSize: 11, letterSpacing: 4, fontWeight: '600', marginTop: 6, marginBottom: 28 },
  track: { width: 180, height: 2, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#E50914', borderRadius: 1 },
  loadTxt: { color: 'rgba(255,255,255,0.25)', fontSize: 10, letterSpacing: 2.5, marginTop: 12 },
});

// Estilos para la sección "Continuar viendo"
const cwa = StyleSheet.create({
  section: { marginBottom: T.space.sm },
  sectionTitle: { color: T.color.textMuted, fontSize: 10, fontWeight: T.font.bold, letterSpacing: 1.5, marginLeft: T.space.lg, marginBottom: T.space.xs, marginTop: T.space.sm },
  scroll: { paddingHorizontal: T.space.lg, gap: T.space.sm },
  card: { width: 120, backgroundColor: T.color.surfaceElevated, borderRadius: T.radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: T.color.border, marginRight: T.space.sm },
  poster: { width: '100%', height: 80, backgroundColor: T.color.surfaceHigh },
  title: { color: T.color.textPrimary, fontSize: T.font.xs, fontWeight: T.font.semibold, marginHorizontal: T.space.sm, marginTop: T.space.xs, marginBottom: 2 },
  subtitle: { color: T.color.textMuted, fontSize: 10, marginHorizontal: T.space.sm, marginBottom: 4 },
  progressTrack: { height: 2, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: T.space.sm, marginBottom: T.space.xs, borderRadius: 1 },
  progressFill: { height: '100%', borderRadius: 1 },
});
