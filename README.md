# japan-bridge-lineage

A globe-view map of which elevation source fills each pixel of Japan's
terrain — the standalone showcase for the **lineage** layer produced by
[`mapterhorn-japan-bridge`](https://github.com/hfu/mapterhorn-japan-bridge).

**Live**: https://hfu.github.io/japan-bridge-lineage/

## What this shows

`mapterhorn-japan-bridge` merges seven GSI (国土地理院) DEM product tiers
plus a Copernicus GLO-30 fallback into one national elevation archive,
pixel by pixel, always preferring the higher-accuracy source where more
than one tier covers a cell (1m DEM1A first, down to GLO-30 last — see
the parent repo's `DECISIONS.md` D18/D20 for the full merge logic). The
**lineage** archive records, per pixel, *which* of those seven tiers
actually won — a single-channel category byte, 0 (1m) through 6 (sea/
GLO-30 fallback), served as its own PMTiles archive
(`mapterhorn-japan-bridge-lineage.pmtiles`) alongside the elevation data.

This app renders that category data as a translucent color overlay on
top of a full 3D basemap (hillshade, terrain exaggeration, globe
projection) so the *pattern* of source coverage — where Japan has
airborne-laser 1m detail versus where it still falls back to coarser
surveys or Copernicus — becomes something you can see and fly around,
not just a number in a pixel.

| Color | Tier |
|---|---|
| 🟦 blue | 1m (DEM1A, airborne laser) |
| 🟩 green | 5m A (DEM5A, laser) |
| 🟩 pale green | 5m B (DEM5B, photogrammetry) |
| 🟩 pale green/cream | 5m C (DEM5C, photogrammetry) |
| 🟧 orange | 10m A (DEM10A) |
| 🟧 tan | 10m B (DEM10B) |
| ⬜ grey | Sea / Copernicus GLO-30 fallback |

Toggle the overlay off from the legend panel to see the plain hillshade
underneath.

## How it's built

A single-page [Vite](https://vitejs.dev/) + TypeScript app, no framework,
built on [MapLibre GL JS](https://maplibre.org/). `src/main.ts` is the
entire app (~190 lines) — everything of substance is documented inline
there as comments, but the two decisions worth knowing before touching
this code:

- **Pinned to `maplibre-gl@5.24.0`**, not the v6 series this project
  otherwise wanted. v6.7.0 has a real, reproducible bug where any
  `raster-dem` source — this app's own lineage tiles, and even the
  public AWS `elevation-tiles-prod` terrarium demo tiles — never
  finishes loading (`load` never fires, no error thrown, no worker
  spawned) with byte-identical code that works immediately under
  v5.24.0. Plain `raster` sources and an empty style both load fine
  under v6, isolating the bug to `raster-dem` specifically. Re-test
  before ever bumping this pin.
- **The color layer is a repurposed `color-relief` decode.** MapLibre
  can only pair a `raster-dem` source with a `hillshade` or
  `color-relief` layer, and `color-relief`'s spec-documented
  `encoding: 'custom'` path — the *correct* way to decode an arbitrary
  byte layout — is validator-accepted but never actually rendered by
  MapLibre's own renderer (confirmed through 5.24.0). So this app
  instead declares `encoding: 'terrarium'` (elevation = `R*256 + G +
  B/256 - 32768`) and feeds it a category byte with `G=B=0`, which
  lands each tier a clean 256 units apart in the decoded "elevation"
  space — then builds a `color-relief-color` interpolation with two
  stops per tier (253 units apart) for a hard-edged, non-blended color
  band per category, and clamps the nodata byte (255) to transparent
  past the last real tier.

The basemap style itself (bvmap vector layers, terrain, hillshade) is
fetched live from `mapterhorn-japan-bridge`'s own published
`style.json` (CORS-enabled) rather than duplicated here, so this app
always matches the parent project's current basemap. The lineage tiles
come from `stars.optgeo.org`'s TileJSON endpoint (not a hardcoded XYZ
template), so MapLibre picks up the archive's real min/max zoom
automatically as the parent pipeline's low-zoom floor changes.

## Development

```bash
npm install
npm run dev       # vite dev server
npm run build      # tsc + vite build, writes to docs/
npm run preview    # serve the docs/ build locally
```

## Deployment

GitHub Pages serves this site directly from the `docs/` folder on
`main` (legacy build, no Actions workflow) — so publishing a change is
just `npm run build` followed by committing the resulting `docs/`
output alongside the source change, same commit or a follow-up one.

## Relationship to the rest of the bridge

| Repo | Role |
|---|---|
| [`hfu/mapterhorn-japan-bridge`](https://github.com/hfu/mapterhorn-japan-bridge) | Docs home + elevation viewer; publishes both the elevation and lineage PMTiles archives this app reads |
| [`hfu/mapterhorn`](https://github.com/hfu/mapterhorn) | The actual GeoTIFF→PMTiles pipeline (fork of [`mapterhorn/mapterhorn`](https://github.com/mapterhorn/mapterhorn)) that computes lineage and writes the archive this app visualizes |
| **`hfu/japan-bridge-lineage`** (this repo) | Standalone showcase — no pipeline code, no processing, just this map |

`mapterhorn-japan-bridge` is itself an interim bridge, meant to be
retired once upstream Mapterhorn's own Japan source catches up with
current GSI survey data — at which point this showcase's data source
would move with it.

## License

Code in this repo is released under CC0 1.0 — public domain, no rights
reserved, matching `mapterhorn-japan-bridge`'s own viewer code. This
does not extend to the GSI-derived elevation/lineage data itself, which
carries its own Survey Act (測量法) attribution requirements — see the
parent repo's README for the current approval number and full
attribution text.
