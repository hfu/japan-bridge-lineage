import {
  Map as MapLibreMap,
  NavigationControl,
  GlobeControl,
  type ErrorEvent,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

// Pinned to v5.24.0, not the v6 series this project otherwise wanted
// (matches mapterhorn-monitor's own pin, DECISIONS.md D2/D27, though for a
// different original reason there): v6.7.0 has a real, reproducible bug
// where any raster-dem source (our own lineage/mapterhorn tiles, and the
// public AWS elevation-tiles-prod terrarium demo tiles alike) never
// finishes loading -- isStyleLoaded()/'load' never fire, no error is
// thrown, and `new Worker(...)` is never even called, with byte-identical
// application code that works immediately under v5.24.0. Plain `raster`
// sources and an empty style both load fine under v6, isolating the bug
// to raster-dem specifically. Globe projection still works under v5, so
// nothing else needed to change.

// The production mapterhorn-japan-bridge viewer's own style: full basemap
// (bvmap vector layers), terrain, and hillshade already wired up.
// Confirmed CORS-enabled (access-control-allow-origin: *) so it's
// fetchable from this different origin.
const STYLE_URL = 'https://hfu.github.io/mapterhorn-japan-bridge/style.json';

// martin's own TileJSON endpoint (not an XYZ template) -- lets maplibre
// pick up the archive's real minzoom/maxzoom automatically, so both
// overzoom (past 16) and the new low-zoom floor (4, since D146) work with
// no extra config on this end.
const LINEAGE_TILEJSON_URL = 'https://stars.optgeo.org/mapterhorn-japan-bridge-lineage';

// Global tier -> (source, resolution), same classification as
// hfu-mapterhorn/pipelines/lineage_inspect.py's own diagnostic PALETTE and
// mapterhorn-monitor's dashboard instrument, using that same softened
// palette (a public-facing page reads better with muted colors sitting
// on top of real hillshade than the diagnostic tool's loud ones).
const TIERS: { value: number; color: [number, number, number]; label: string }[] = [
  { value: 0, color: [96, 133, 205], label: '1m (DEM1A, jpnational1)' },
  { value: 1, color: [111, 163, 104], label: '5m A (DEM5A)' },
  { value: 2, color: [150, 189, 128], label: '5m B (DEM5B)' },
  { value: 3, color: [199, 219, 176], label: '5m C (DEM5C)' },
  { value: 4, color: [199, 149, 92], label: '10m A (DEM10A)' },
  { value: 5, color: [223, 190, 148], label: '10m B (DEM10B)' },
  { value: 6, color: [163, 163, 158], label: 'Sea (GLO-30 fallback)' },
];

// The lineage PNG/WebP's R channel carries the raw category byte (0-6, or
// 255 for nodata); G/B are always 0. A raster-dem source can only pair
// with a 'hillshade' or 'color-relief' layer, and color-relief-color
// takes an `['interpolate', ['linear'], ['elevation'], stop, color, ...]`
// expression reading whatever the source's own `encoding` decodes.
//
// encoding:'custom' is the spec-documented way to decode an arbitrary
// channel combination, and validator-accepted -- but maplibre-gl's actual
// renderer (confirmed through 5.24.0, still true as of the 6.x used here)
// never draws a single pixel through it. encoding:'terrarium' (elevation =
// R*256 + G + B/256 - 32768) does render, so this repurposes that decode
// formula on the category bytes instead: each byte lands exactly 256
// apart (since G=B=0 always), and `interpolate` only blends linearly, so
// each tier gets two stops 253 apart sharing one color for a hard edge
// (leaving a 3-unit blend margin per 256-wide band, imperceptible at tile
// resolution). nodata (byte 255) decodes to +32512, far outside the real
// tiers' span, so a final stop right after the last tier clamps it (and
// anything else stray) to transparent.
const TERRARIUM_OFFSET = -32768;
function terrariumValueForByte(byte: number): number {
  return byte * 256 + TERRARIUM_OFFSET;
}
function buildColorReliefExpression(): unknown[] {
  const expr: unknown[] = ['interpolate', ['linear'], ['elevation']];
  for (const tier of TIERS) {
    const color = `rgb(${tier.color.join(',')})`;
    const start = terrariumValueForByte(tier.value);
    expr.push(start, color, start + 253, color);
  }
  expr.push(terrariumValueForByte(TIERS.length), 'rgba(0,0,0,0)');
  return expr;
}

function buildLegend(): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML =
    '<div class="legend-header">' +
    '<h1>Elevation source lineage</h1>' +
    '<button type="button" class="legend-collapse" aria-expanded="true" aria-label="Collapse panel">&minus;</button>' +
    '</div>' +
    '<div class="legend-body">' +
    '<p>Which source fills each pixel of Japan’s terrain.</p>' +
    TIERS.map(
      (tier) =>
        `<div class="legend-row"><span class="swatch" style="background:rgb(${tier.color.join(',')})"></span>${tier.label}</div>`,
    ).join('') +
    '<label class="toggle"><input type="checkbox" id="lineage-toggle" checked />Show lineage overlay</label>' +
    '<p class="credit">mapterhorn-japan-bridge &middot; <a href="https://github.com/hfu/mapterhorn-japan-bridge" target="_blank" rel="noopener">source</a></p>' +
    '</div>';

  const collapseButton = legend.querySelector('.legend-collapse') as HTMLButtonElement;
  collapseButton.addEventListener('click', () => {
    const collapsed = legend.classList.toggle('collapsed');
    collapseButton.textContent = collapsed ? '+' : '−';
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    collapseButton.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
  });

  return legend;
}

async function main() {
  const app = document.getElementById('app')!;
  app.appendChild(buildLegend());

  const mapDiv = document.createElement('div');
  mapDiv.id = 'map';
  app.appendChild(mapDiv);

  const style = (await fetch(STYLE_URL).then((r) => r.json())) as StyleSpecification;

  // Globe projection is a style-level property in MapLibre's spec, not a
  // Map constructor option -- set it directly on the fetched style.
  style.projection = { type: 'globe' };

  style.sources.lineage = {
    type: 'raster-dem',
    url: LINEAGE_TILEJSON_URL,
    tileSize: 512,
    encoding: 'terrarium',
  };

  const lineageLayer: LayerSpecification = {
    id: 'lineage',
    type: 'color-relief',
    source: 'lineage',
    paint: {
      'color-relief-color': buildColorReliefExpression() as never,
      'color-relief-opacity': 0.55,
    },
  };
  // Stack above every basemap fill/line layer (water, land-use, buildings,
  // roads) but below labels -- inserting right before the first symbol
  // layer lands exactly there, since bvmap's own style already orders
  // every fill/line layer before its first label (mapterhorn-monitor's
  // dashboard instrument hit and fixed the same placement bug first).
  const firstSymbolIndex = style.layers.findIndex((layer) => layer.type === 'symbol');
  if (firstSymbolIndex === -1) {
    style.layers.push(lineageLayer);
  } else {
    style.layers.splice(firstSymbolIndex, 0, lineageLayer);
  }

  // Hidenori's chosen initial view (Hokkaido, hash format
  // zoom/lat/lng/bearing/pitch): 8.74/43.2348/141.5173/-144.3/60
  const INITIAL_VIEW = {
    center: [141.5173, 43.2348] as [number, number],
    zoom: 8.74,
    bearing: -144.3,
    pitch: 60,
  };

  const map = new MapLibreMap({
    container: mapDiv,
    style,
    ...INITIAL_VIEW,
    localIdeographFontFamily: 'sans-serif',
  });

  map.addControl(new NavigationControl(), 'top-right');
  map.addControl(new GlobeControl(), 'top-right');
  map.on('error', (event: ErrorEvent) => console.error('[japan-bridge-lineage] map error', event.error));
  map.on('load', () => {
    map.setTerrain({ source: 'mapterhorn', exaggeration: 1 });
  });

  const toggle = document.getElementById('lineage-toggle') as HTMLInputElement;
  toggle.addEventListener('change', () => {
    map.setLayoutProperty('lineage', 'visibility', toggle.checked ? 'visible' : 'none');
  });
}

main();
