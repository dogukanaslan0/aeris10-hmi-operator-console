/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : PPI Geographic Basemap Layer (MapLibre GL)
 * ============================================================================
 *
 * A dark vector basemap rendered *behind* the PPI radar overlay. The map is
 * centred on the radar's GPS position and zoomed so its visible radius matches
 * the radar range scale — range rings then line up with real ground distance.
 *
 * The map is non-interactive on purpose: the radar overlay (sweep, rings,
 * targets) is anchored to the canvas centre, so the basemap must stay locked
 * to the same centre. Pan/zoom is driven only by GPS + range-scale changes.
 *
 * Tiles: CARTO "dark-matter" GL style — free, no API token. Requires an
 * internet connection (online tile provider). For a fully offline deployment,
 * swap `MAP_STYLE_URL` for a self-hosted style + local tiles.
 */

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useSystemStore } from '../../stores/systemStore';

const MAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const CANVAS_MARGIN_PX = 32;

// Web-Mercator metres-per-pixel at zoom 0, equator.
const EQUATOR_M_PER_PX_Z0 = 156543.03392;

export interface PPIMapLayerProps {
  visible: boolean;
}

export function PPIMapLayer(props: PPIMapLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef<boolean>(false);

  const gpsLat = useSystemStore((s) => s.current?.gps_lat ?? 41.0082);
  const gpsLon = useSystemStore((s) => s.current?.gps_lon ?? 28.9784);
  const rangeScale = useSystemStore((s) => s.radarRangeScale);

  // ── Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || mapRef.current !== null) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: el,
        style: MAP_STYLE_URL,
        center: [gpsLon, gpsLat],
        zoom: zoomForRange(rangeScale, gpsLat, Math.min(el.clientWidth, el.clientHeight)),
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        // No bearing/pitch — top-down tactical view aligned with the PPI.
        pitch: 0,
        bearing: 0,
      });
    } catch (err) {
      console.error('[PPIMapLayer] MapLibre init failed:', err);
      return;
    }
    mapRef.current = map;
    map.on('load', () => {
      readyRef.current = true;
    });
    map.on('error', (e: { error?: { message?: string } }) => {
      // Tile fetch errors (offline) are non-fatal — the radar overlay still
      // works; the map simply shows the empty dark canvas.
      console.warn('[PPIMapLayer] map error (tiles unreachable?):', e.error?.message ?? e);
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Re-centre + re-zoom on GPS / range change ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (map === null || el === null) return;
    map.jumpTo({
      center: [gpsLon, gpsLat],
      zoom: zoomForRange(rangeScale, gpsLat, Math.min(el.clientWidth, el.clientHeight)),
    });
  }, [gpsLat, gpsLon, rangeScale]);

  // ── Keep MapLibre sized to the container ──────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    const map = mapRef.current;
    if (el === null || map === null) return;
    const ro = new ResizeObserver(() => {
      map.resize();
      // Re-derive zoom for the new container size (use the limiting dimension)
      map.setZoom(zoomForRange(rangeScale, gpsLat, Math.min(el.clientWidth, el.clientHeight)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [rangeScale, gpsLat]);

  // When the layer becomes visible after being hidden, MapLibre may have
  // mis-measured its (then-zero-size) container — force a resize.
  useEffect(() => {
    if (!props.visible) return;
    const map = mapRef.current;
    if (map === null) return;
    const id = window.setTimeout(() => map.resize(), 60);
    return () => window.clearTimeout(id);
  }, [props.visible]);

  return (
    <div
      ref={containerRef}
      className="ppi-map-layer"
      data-visible={props.visible || undefined}
      aria-hidden
    />
  );
}

/**
 * Zoom level whose visible radius covers exactly `rangeM` ground metres at the
 * given latitude. The radius uses the container's *smaller* dimension to match
 * the PPI worker's `maxR = min(w,h)/2 - MARGIN`, so the outermost range ring
 * lines up with the same ground distance on the basemap in any aspect ratio.
 */
function zoomForRange(rangeM: number, lat: number, containerMinPx: number): number {
  const maxRadiusPx = Math.max(40, containerMinPx / 2 - CANVAS_MARGIN_PX);
  const targetMetersPerPixel = rangeM / maxRadiusPx;
  const z =
    Math.log2(
      (EQUATOR_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / targetMetersPerPixel,
    );
  return Math.max(1, Math.min(20, z));
}
