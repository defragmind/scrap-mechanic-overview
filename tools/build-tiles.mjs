#!/usr/bin/env bun
/*
 * build-tiles.mjs — pre-render the Scrap Mechanic world map into a {z}/{x}/{y}.webp
 * tile pyramid, consumed by the React/Leaflet viewer.
 *
 * Pipeline (memory-bounded, band-based):
 *   1. Read cells.json + the source tile images.
 *   2. For each horizontal band of cell rows (default 6):
 *        a. color base (1px/cell) nearest-upscaled to PPC px/cell
 *        b. composite the band's rotated tile images, road segments and
 *           POI overlays (POIs crossing band borders are cropped per band)
 *        c. slice the band into 256px {maxZoom} tiles directly
 *   3. Build every lower zoom level by 2× downsampling the four child tiles
 *      of each parent (classic pyramid reduction) — no full-world buffer
 *      is ever held in memory, so PPC 512 ("full res", matching the ~500px
 *      source tile art) builds fine on a 16–32 GB machine.
 *
 * North is up: cell (x,y) with y increasing northward is drawn higher (smaller pixel row).
 *
 * Usage:  bun tools/build-tiles.mjs [path/to/cells.json] [--ppc 512] [--band 6]
 * Defaults: cells = viewer/public/data/cells.json, ppc = 512 (full res), band = 6
 */
import sharp from "sharp";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "fs";
import { dirname, join, resolve as pathResolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(__dirname, "..");
const VIEWER_PUBLIC = join(REPO, "viewer", "public");
const IMG_DIR = join(VIEWER_PUBLIC, "img");
const TILES_SRC = join(IMG_DIR, "tiles");
const OUT_TILES = join(VIEWER_PUBLIC, "tiles");

// --- config from args ---
const argCells = process.argv.slice(2).find(a => !a.startsWith("--"));
const numOpt = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? parseInt(process.argv[i + 1], 10) : dflt;
};
const CELLS_JSON = argCells || join(VIEWER_PUBLIC, "data", "cells.json");
const PPC = numOpt("--ppc", 512);
const BAND = Math.max(1, numOpt("--band", 6));
const TS = 512; // output tile size (512 = 4× fewer requests while panning than 256)

// --- terrain types + colors (matches legacy/style.css) ---
// Terrain type nibble (flags bits 12-15), 1.0 semantics: bit 3 = water,
// low 3 bits = base terrain type.
const TAGS = ["NONE","MEADOW","FOREST","DESERT","FIELD","BURNTFOREST","AUTUMNFOREST","MOUNTAIN"];
const COLOR = {
  NONE:[0,255,143], MEADOW:[0,232,93], FOREST:[0,188,27], DESERT:[255,222,147],
  FIELD:[164,224,126], BURNTFOREST:[158,138,92], AUTUMNFOREST:[242,187,7],
  MOUNTAIN:[141,191,172], LAKE:[0,186,242],
};
// rotation value -> clockwise degrees (matches legacy CSS rot-N classes)
const ROT = { 0:0, 1:270, 2:180, 3:90 };
const ctype = f => (Math.floor(f) & 0xf000) >> 12;
const terrainColor = f => { const n = ctype(f); return (n & 8) ? COLOR.LAKE : (COLOR[TAGS[n & 7]] || COLOR.NONE); };

// road flags
const RN=0x0200, RS=0x0800, RE_=0x0100, RW=0x0400, MASKR=0x0f00;
function roads(f){ const r=Math.floor(f)&MASKR; let s=""; if(r&RN)s+="N"; if(r&RS)s+="S"; if(r&RE_)s+="E"; if(r&RW)s+="W"; return s; }

// valid tile set + special start-area tiles (port of legacy getTileURL)
const legacyJS = join(REPO, "legacy", "assets", "js", "sm_overview_map.js");
let validTiles = new Set();
try {
  const src = readFileSync(legacyJS, "utf8");
  validTiles = new Set([...src.match(/var tiles = \[([\s\S]*?)\];/)[1].matchAll(/\d+/g)].map(x => +x[0]));
} catch { console.warn("warn: couldn't parse legacy tile list; image cells will be skipped"); }
const START = {
  "-37,-39":"start_crashsite_-37_-39.jpg","-37,-40":"start_crashsite_-37_-40.jpg",
  "-36,-40":"start_crashsite_-36_-40.jpg","-36,-41":"start_crashsite_-36_-41.jpg",
};
const UUID_IMG_DIR = join(IMG_DIR, "uuid"); // 1.0 tiles without legacy art (game preview PNGs)
function tileImgLegacy(id, x, y){
  if (id === -1 || id === undefined || id === null) return null; // 1.0 tile without legacy id
  const st = START[`${x},${y}`];
  if (st) return join(IMG_DIR, st);     // start_crashsite_-3x_-4x live in img/ root, not img/tiles/
  if (validTiles.has(id)) return join(TILES_SRC, `${id}.jpg`);
  return null;
}

// --- POIs (port of legacy cellparser POIS + sm_overview_map POI_SIZES/getPoiUrl) ---
const POIS = {
  101:"POI_CRASHSITE_AREA",102:"POI_HIDEOUT_XL",103:"POI_SILODISTRICT_XL",104:"POI_RUINCITY_XL",
  105:"POI_CRASHEDSHIP_LARGE",106:"POI_CAMP_LARGE",107:"POI_CAPSULESCRAPYARD_MEDIUM",108:"POI_LABYRINTH_MEDIUM",
  109:"POI_MECHANICSTATION_MEDIUM",110:"POI_PACKINGSTATIONVEG_MEDIUM",111:"POI_PACKINGSTATIONFRUIT_MEDIUM",
  112:"POI_WAREHOUSE2_LARGE",113:"POI_WAREHOUSE3_LARGE",114:"POI_WAREHOUSE4_LARGE",
  501:"POI_BURNTFOREST_FARMBOTSCRAPYARD_LARGE",115:"POI_ROAD",116:"POI_CAMP",117:"POI_RUIN",118:"POI_RANDOM",
  201:"POI_FOREST_CAMP",202:"POI_FOREST_RUIN",203:"POI_FOREST_RANDOM",301:"POI_DESERT_RANDOM",
  119:"POI_FARMINGPATCH",401:"POI_FIELD_RUIN",402:"POI_FIELD_RANDOM",502:"POI_BURNTFOREST_CAMP",
  503:"POI_BURNTFOREST_RUIN",504:"POI_BURNTFOREST_RANDOM",601:"POI_AUTUMNFOREST_CAMP",602:"POI_AUTUMNFOREST_RUIN",
  603:"POI_AUTUMNFOREST_RANDOM",801:"POI_LAKE_RANDOM",120:"POI_RUIN_MEDIUM",121:"POI_CHEMLAKE_MEDIUM",
  122:"POI_BUILDAREA_MEDIUM",204:"POI_FOREST_RUIN_MEDIUM",802:"POI_LAKE_UNDERWATER_MEDIUM",
};
const POI_SIZES = {
  POI_CRASHSITE_AREA:2, POI_BUILDAREA_MEDIUM:2, POI_MECHANICSTATION_MEDIUM:2, POI_LABYRINTH_MEDIUM:2,
  POI_CHEMLAKE_MEDIUM:2, POI_RUIN_MEDIUM:2, POI_FOREST_RUIN_MEDIUM:2, POI_CAPSULESCRAPYARD_MEDIUM:2,
  POI_PACKINGSTATIONVEG_MEDIUM:2, POI_PACKINGSTATIONFRUIT_MEDIUM:2, POI_LAKE_UNDERWATER_MEDIUM:2,
  POI_CAMP_LARGE:4, POI_CRASHEDSHIP_LARGE:4, POI_BURNTFOREST_FARMBOTSCRAPYARD_LARGE:4,
  POI_WAREHOUSE2_LARGE:4, POI_WAREHOUSE3_LARGE:4, POI_WAREHOUSE4_LARGE:4,
  POI_HIDEOUT_XL:8, POI_RUINCITY_XL:8, POI_SILODISTRICT_XL:8,
};
function getPoiType(id){ const t = Math.floor(id / 100); return t < 10000 ? (POIS[t] || null) : null; }
function getPoiUrl(poiType, tileid, x, y){
  const img = f => join(IMG_DIR, f);
  switch (poiType){
    case "POI_MECHANICSTATION_MEDIUM": return img("mechanic_station.jpg");
    case "POI_HIDEOUT_XL": return img("hideout.jpg");
    case "POI_CAMP_LARGE": return img("camp_large.jpg");
    case "POI_WAREHOUSE4_LARGE": return img("warehouse4.jpg");
    case "POI_WAREHOUSE3_LARGE": return img("warehouse3_large.jpg");
    case "POI_WAREHOUSE2_LARGE": return img("warehouse2.jpg");
    case "POI_SILODISTRICT_XL": return img("silodistrict.jpg");
    case "POI_RUINCITY_XL": return img("scrapcity.jpg");
    case "POI_PACKINGSTATIONVEG_MEDIUM": return img("packing_veg.jpg");
    case "POI_PACKINGSTATIONFRUIT_MEDIUM": return img("packing_fruit.jpg");
    case "POI_CHEMLAKE_MEDIUM":
      if (tileid === 12103) return img("chemlake_medium_3.jpg");
      if (tileid === 12102) return img("chemlake_medium_2.jpg");
      return img("chemlake_medium_1.jpg");
    case "POI_RUIN_MEDIUM": return img(tileid === 12003 ? "ruin_medium_3.jpg" : "ruin_medium_4.jpg");
    case "POI_FOREST_RUIN_MEDIUM": return img(tileid === 20402 ? "forest_ruin_medium_2.jpg" : "forest_ruin_medium_1.jpg");
    case "POI_LAKE_UNDERWATER_MEDIUM":
      if (tileid === 80203) return img("underwater_med_3.jpg");
      if (tileid === 80204 || tileid === 80202) return img("underwater_med_4.jpg");
      return null;
    case "POI_CRASHSITE_AREA":
      if (tileid === 10103) return img("start_crashsite3.jpg");
      if (tileid === 10102) return img("start_crashsite2.jpg");
      if (tileid === 10101 && x === -38 && y === -42) return img("start_crashsite1.jpg");
      return null;
    case "POI_CAPSULESCRAPYARD_MEDIUM": return img("capsule_scrapyard.jpg");
    case "POI_BURNTFOREST_FARMBOTSCRAPYARD_LARGE": return img("burntforest_farmbot_scrapyard.jpg");
    case "POI_CRASHEDSHIP_LARGE": return img("crashed_ship.jpg");
    case "POI_LABYRINTH_MEDIUM": return img("labyrinth.jpg");
    case "POI_BUILDAREA_MEDIUM": return img("buildarea.jpg");
    default: return null;
  }
}

// --- POI anchors, resolved once for the whole build ---
function resolvePois(cells, b){
  const pois = [];
  const found = new Set();
  for (const c of cells){
    const poiType = getPoiType(c.tileid);
    if (!poiType) continue;
    const S = POI_SIZES[poiType];
    if (S === undefined) continue;
    const key = `${c.x},${c.y}`;
    if (found.has(key)) continue; // already covered by an earlier anchor
    const url = getPoiUrl(poiType, c.tileid, c.x, c.y);
    // mark this POI's cells as found (so we don't double-render)
    for (let ix = 0; ix < S; ix++) for (let iy = 0; iy < S; iy++) found.add(`${c.x+ix},${c.y+iy}`);
    if (!url || !existsSync(url)) continue;
    pois.push({ x: c.x, y: c.y, name: poiType, size: S, rotation: c.rotation, url });
  }
  return pois;
}

// --- concurrency pool ---
async function pool(items, worker, concurrency = 8){
  let i = 0, done = 0;
  const total = items.length;
  async function run(){
    while (i < total) {
      const idx = i++;
      await worker(items[idx], idx);
      done++;
      if (done % 500 === 0 || done === total) process.stdout.write(`\r    ${done}/${total} tiles`);
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, total)}, run));
  process.stdout.write("\n");
}

// Prepare one composite layer buffer for a cell image (rotate + resize to PPC²).
// Cached: worlds reuse the same ~470 source images thousands of times over.
const layerCache = new Map();
async function cellLayer(path, rotation){
  const deg = ROT[rotation] ?? 0;
  const key = `${path}|${deg}`;
  let buf = layerCache.get(key);
  if (buf === undefined) {
    buf = await sharp(path).rotate(deg).resize(PPC, PPC, { fit:"fill" }).toBuffer();
    layerCache.set(key, buf);
  }
  return buf;
}

// Rotated full-size buffer for a multi-cell tile (S×S cells square). Cached per
// (path, rotation, side); bands then extract their vertical slice cheaply.
const bigCache = new Map();
async function bigTileBuffer(url, rotation, side){
  const deg = ROT[rotation] ?? 0;
  const key = `${url}|${deg}|${side}`;
  let buf = bigCache.get(key);
  if (buf === undefined) {
    buf = await sharp(url).rotate(deg).resize(side, side, { fit:"fill" }).toBuffer();
    bigCache.set(key, buf);
  }
  return buf;
}

// Road segment rectangles for a cell, in absolute full-map pixel coords
function roadRects(f, left, top){
  const rects = [];
  const rd = roads(f);
  if (!rd) return rects;
  const hw = Math.max(2, Math.round(PPC * 0.04));
  const mid = Math.round(PPC / 2);
  for (const dir of rd){
    if (dir === "N")      rects.push({ left: left+mid-hw, top,            width: hw*2, height: mid });
    else if (dir === "S") rects.push({ left: left+mid-hw, top: top+mid,   width: hw*2, height: mid });
    else if (dir === "E") rects.push({ left: left+mid,   top: top+mid-hw, width: mid,  height: hw*2 });
    else                  rects.push({ left,            top: top+mid-hw, width: mid,  height: hw*2 });
  }
  return rects;
}

// Vertical intersection of [pxTop, pxTop+pxH) with band pixel range [bandTop, bandBottom)
function vCrop(pxTop, pxH, bandTop, bandBottom){
  const top = Math.max(pxTop, bandTop);
  const bottom = Math.min(pxTop + pxH, bandBottom);
  return top < bottom ? { extractTop: top - pxTop, compTop: top, height: bottom - top } : null;
}

// --- main ---
async function main(){
  const tStart = Date.now();
  if (!existsSync(CELLS_JSON)) { console.error("cells.json not found:", CELLS_JSON); process.exit(1); }
  const cells = JSON.parse(readFileSync(CELLS_JSON, "utf8"));
  const b = cells[0].bounds;
  const W = (b.xMax - b.xMin + 1) | 0;
  const H = (b.yMax - b.yMin + 1) | 0;
  const seed = cells[0].seed;
  const fullW = W * PPC, fullH = H * PPC;
  // pixel coords (north-up): x -> right, y -> up
  const px = x => (x - b.xMin) * PPC;
  const py = y => (b.yMax - y) * PPC;
  console.log(`world: ${W}x${H} cells, seed ${seed}, PPC=${PPC} (full res), band=${BAND} rows`);
  console.log(`full image ${fullW}x${fullH} (${(fullW*fullH/1e6).toFixed(0)}MP) — rendered in bands, never held whole`);

  // index cells by grid for band access
  const grid = new Map(); // y -> Map(x -> cell)
  for (const c of cells){ 
    if (!grid.has(c.y)) grid.set(c.y, new Map());
    grid.get(c.y).set(c.x, c);
  }
  const pois = resolvePois(cells, b);
  console.log(`  ${pois.length} POI overlays resolved`);

  // 0. prepare output dir (preserve the directory inode — see README troubleshooting)
  if (existsSync(OUT_TILES)) {
    for (const entry of readdirSync(OUT_TILES)) rmSync(join(OUT_TILES, entry), { recursive:true, force:true });
  } else {
    mkdirSync(OUT_TILES, { recursive:true });
  }

  const maxZoom = Math.max(0, Math.ceil(Math.log2(Math.max(fullW, fullH) / TS)));
  const zTilesX = Math.ceil(fullW / TS), zTilesY = Math.ceil(fullH / TS);
  console.log(`pyramid zoom levels 0..${maxZoom} (max: ${zTilesX}x${zTilesY} tiles)`);

  // 1. render maxZoom in bands of BAND cell rows
  console.log(`rendering max zoom z${maxZoom} in bands…`);
  let nImg = 0, nRoad = 0, nBig = 0;
  const nBands = Math.ceil(H / BAND);
  for (let band = 0; band < nBands; band++){
    const tBand = Date.now();
    const yCellTop = b.yMax - band * BAND;                       // northmost cell row (y)
    const rows = Math.min(BAND, H - band * BAND);                // cell rows in this band
    const bandTop = band * BAND * PPC;                           // px row of band top (north edge)
    const bandH = rows * PPC;
    const bandBottom = bandTop + bandH;

    // 1a. color base: W x rows px, nearest-upscaled
    const colorBuf = Buffer.alloc(W * rows * 4);
    for (let r = 0; r < rows; r++){
      const y = yCellTop - r;
      const row = grid.get(y);
      for (let cx = 0; cx < W; cx++){
        const x = b.xMin + cx;
        const c = row?.get(x);
        const t = c ? ctype(c.flags) : 8; // LAKE outside generated data
        const col = c ? terrainColor(c.flags) : COLOR.LAKE;
        const i = (r * W + cx) * 4;
        colorBuf[i]=col[0]; colorBuf[i+1]=col[1]; colorBuf[i+2]=col[2]; colorBuf[i+3]=255;
      }
    }

    // 1b. layers: cell images + roads + POI overlay crops
    const layers = [];
    for (let r = 0; r < rows; r++){
      const y = yCellTop - r;
      const row = grid.get(y);
      if (!row) continue;
      for (let cx = 0; cx < W; cx++){
        const x = b.xMin + cx;
        const c = row.get(x);
        if (!c) continue;
        const legacyPath = tileImgLegacy(c.tileid, x, y);
        const left = px(x), top_ = py(y) - bandTop; // band-relative top
        if (legacyPath && existsSync(legacyPath)){
          layers.push({ input: await cellLayer(legacyPath, c.rotation), left, top: top_ });
          nImg++;
        } else if (c.u && c.s && c.s > 1){
          // multi-cell tile without legacy art: the game's preview PNG, drawn ONCE
          // at the placement anchor (offsets 0,0) spanning s×s cells — never per cell
          if (!(c.ox) && !(c.oy)){
            const png = join(UUID_IMG_DIR, `${c.u}.png`);
            if (existsSync(png)){
              const S = c.s, side = S * PPC;
              const cr = vCrop(py(c.y + S - 1), side, bandTop, bandBottom);
              if (cr){
                const full = await bigTileBuffer(png, c.rotation, side);
                const cropBuf = await sharp(full).extract({ left:0, top:cr.extractTop, width:side, height:cr.height }).toBuffer();
                layers.push({ input: cropBuf, left: px(c.x), top: cr.compTop - bandTop });
                nImg++;
                nBig++;
              }
            }
          }
          // covered cells of this placement (ox/oy ≠ 0) draw nothing — the anchor covers them
        } else {
          const png = c.u ? join(UUID_IMG_DIR, `${c.u}.png`) : null;
          if (png && existsSync(png)){
            layers.push({ input: await cellLayer(png, c.rotation), left, top: top_ });
            nImg++;
          } else {
            for (const rct of roadRects(c.flags, left, py(y))){
              const cr = vCrop(rct.top, rct.height, bandTop, bandBottom);
              if (!cr) continue;
              const rb = await sharp({ create:{ width:rct.width, height:cr.height, channels:4,
                background:{ r:120, g:120, b:120, alpha:1 } } }).png().toBuffer();
              layers.push({ input: rb, left: rct.left, top: cr.compTop - bandTop });
              nRoad++;
            }
          }
        }
      }
    }
    // POI overlays (span multiple cells; crop to band)
    for (const poi of pois){
      const S = poi.size;
      const pxLeft = px(poi.x);
      const pxTop = py(poi.y + S - 1);            // north edge; anchor (x,y) is the SW corner
      const side = S * PPC;
      const cr = vCrop(pxTop, side, bandTop, bandBottom);
      if (!cr) continue;
      const full = await bigTileBuffer(poi.url, poi.rotation, side);
      const cropBuf = await sharp(full).extract({ left:0, top:cr.extractTop, width:side, height:cr.height }).toBuffer();
      layers.push({ input: cropBuf, left: pxLeft, top: cr.compTop - bandTop });
    }

    // 1c. composite the band and slice it into maxZoom tiles
    let pipeline = sharp(colorBuf, { raw:{ width:W, height:rows, channels:4 }, limitInputPixels:false })
      .resize(fullW, bandH, { kernel:"nearest" });
    if (layers.length) pipeline = pipeline.composite(layers);
    const bandRaw = await pipeline.raw().toBuffer();

    const tilesInBand = Math.ceil(bandH / TS);
    const tasks = [];
    for (let tr = 0; tr < tilesInBand; tr++) for (let tc = 0; tc < zTilesX; tc++) tasks.push({ tr, tc });
    await pool(tasks, async ({ tr, tc }) => {
      const out = Buffer.alloc(TS * TS * 4);
      const x0 = tc * TS, y0 = tr * TS; // y0 relative to band top
      const inside = (x0 + TS <= fullW) && (y0 + TS <= bandH);
      if (inside){
        for (let r = 0; r < TS; r++){
          const si = ((y0 + r) * fullW + x0) * 4;
          bandRaw.copy(out, r * TS * 4, si, si + TS * 4);
        }
      } else {
        // edge tile: clamp per pixel so padding mirrors the edge seamlessly
        for (let r = 0; r < TS; r++){
          const sy = Math.min(bandH - 1, y0 + r);
          for (let c = 0; c < TS; c++){
            const sx = Math.min(fullW - 1, x0 + c);
            const si = (sy * fullW + sx) * 4;
            bandRaw.copy(out, (r * TS + c) * 4, si, si + 4);
          }
        }
      }
      const globalTy = Math.floor(bandTop / TS) + tr;
      const dir = join(OUT_TILES, String(maxZoom), String(tc));
      mkdirSync(dir, { recursive:true });
      await sharp(out, { raw:{ width:TS, height:TS, channels:4 } })
        .webp({ quality: 85 }).toFile(join(dir, `${globalTy}.webp`));
    }, 12);

    process.stdout.write(`  band ${band+1}/${nBands}: ${rows} rows, ${layers.length} layers, ${((Date.now()-tBand)/1000).toFixed(1)}s\n`);
  }
  console.log(`  ${nImg} cell images + ${nRoad} road segments composited`);

  // 2. lower zooms: parent = 2× downscale of its four children
  console.log("building lower zoom levels…");
  for (let z = maxZoom - 1; z >= 0; z--){
    const pzX = Math.ceil((fullW / 2 ** (maxZoom - z)) / TS);
    const pzY = Math.ceil((fullH / 2 ** (maxZoom - z)) / TS);
    const tasks = [];
    for (let ty = 0; ty < pzY; ty++) for (let tx = 0; tx < pzX; tx++) tasks.push({ tx, ty });
    await pool(tasks, async ({ tx, ty }) => {
      const half = TS / 2;
      const comps = [];
      // clamp child coords to the existing grid (edge padding mirrors edge pixels)
      const czX = Math.ceil((fullW / 2 ** (maxZoom - z - 1)) / TS);
      const czY = Math.ceil((fullH / 2 ** (maxZoom - z - 1)) / TS);
      for (let dy = 0; dy < 2; dy++){
        for (let dx = 0; dx < 2; dx++){
          const cx = Math.min(2*tx + dx, czX - 1);
          const cy = Math.min(2*ty + dy, czY - 1);
          const childPath = join(OUT_TILES, String(z+1), String(cx), `${cy}.webp`);
          if (!existsSync(childPath)) continue;
          const buf = await sharp(childPath).resize(half, half, { kernel:"lanczos3" }).toBuffer();
          comps.push({ input: buf, left: dx*half, top: dy*half });
        }
      }
      const canvas = sharp({ create:{ width:TS, height:TS, channels:4, background:{ r:0, g:0, b:0, alpha:1 } } });
      const dir = join(OUT_TILES, String(z), String(tx));
      mkdirSync(dir, { recursive:true });
      await canvas.composite(comps).webp({ quality: 85 }).toFile(join(dir, `${ty}.webp`));
    }, 12);
    console.log(`  z${z}: ${pzX}x${pzY} tiles`);
  }

  // 3. manifest
  const manifest = {
    seed, bounds: b, cellsW: W, cellsH: H, ppc: PPC,
    fullW, fullH, maxZoom,
    tilesXAtMax: Math.ceil(fullW / TS), tilesYAtMax: Math.ceil(fullH / TS),
    tileSize: TS, pois, generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT_TILES, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n✓ done in ${((Date.now()-tStart)/1000).toFixed(1)}s — ${OUT_TILES}`);
  console.log(`  manifest.json: maxZoom=${maxZoom}, ${fullW}x${fullH}px (${PPC}px/cell)`);
}

main().catch(e => { console.error("build failed:", e); process.exit(1); });
