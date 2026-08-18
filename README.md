# Scrap Mechanic Overview

Turn your **Scrap Mechanic** Survival world into a fast, interactive, zoomable map — with persistent markers, cell inspection, and a full POI roster.

This is a modernized, automated fork of [**sm_overview**](https://github.com/the1killer/sm_overview) by **The1Killer**. It adds a **1.0.x-compatible export** (the original is broken on newer game versions), a **pre-rendered tile pipeline** for instant pan/zoom, and a **React + Leaflet viewer** with markers.

```
Scrap Mechanic v1.0.x  ·  Windows or Linux/Proton  ·  ~86k tiles  ·  instant pan/zoom
```

---

## What you get

- **Buttery-smooth map** — pan and zoom are instant at any zoom level, with full detail everywhere. No re-rendering on pan.
- **Click any cell** — see its coordinates, terrain type, tile ID, rotation, and POI. Coordinates match the in-game `/cell` chat command.
- **Persistent markers** — drop labeled, color-coded pins anywhere; they're saved in your browser and survive refreshes.
- **POI browser** — every hideout, warehouse, mechanic station, silo district, camp, and more, listed and labeled on the map.
- **Terrain breakdown** — live count of each biome type across your world.

### Why this is fast

The original viewer created **~16,000 DOM nodes** (one per world cell, each with its own image) and rebuilt them on every pan and zoom — sluggish, and blurry when zoomed out.

This viewer **pre-renders the entire map once** into a standard `{z}/{x}/{y}` tile pyramid, then displays it with Leaflet's native `L.tileLayer`. That's GPU-composited, only paints what's on screen, and only downloads the few tiles in the viewport — so the 132 MB pyramid is never loaded wholesale.

---

## Quick start

> Already patched and exported? Just run `bash tools/serve.sh` and open http://localhost:8080.

```bash
git clone https://github.com/defragmind/scrap-mechanic-overview
cd scrap-mechanic-overview
```

1. **Patch the game** (two files, one-time) — see [Setup → Patch the game](#2-patch-the-game).
2. **Export your world** — load your Survival save, quit, then:
   ```bash
   python3 tools/extract_cells.py
   ```
3. **Build + view** — this installs deps, renders the full-res tile pyramid (~5 min, once per world), and starts the dev server:
   ```bash
   bash tools/serve.sh
   ```
   Open **http://localhost:8080**.

---

## Requirements

- Scrap Mechanic (Survival) on Steam — Windows, or Linux via Proton
- [Bun](https://bun.sh) — runs the viewer and the tile builder
- Python 3 — extraction and patching
- ~4 GB free RAM for the one-time full-res tile build
- A modern browser

---

## Setup

### 1. Back up your save (!!)

You'll be editing game script files, so back up first.

- **Windows:** `%appdata%\Axolot Games\Scrap Mechanic\UserData\`
- **Linux/Proton:** `…/steamapps/compatdata/387990/pfx/drive_c/users/steamuser/AppData/Roaming/Axolot Games/Scrap Mechanic/UserData/` (1.0 moved saves from `AppData/Local` to `AppData/Roaming`)

Also back up the two game files in step 2 (or use Steam's *Verify Integrity of Game Files* to restore them later).

### 2. Patch the game

Game script root:

- **Windows:** `C:\Program Files (x86)\Steam\steamapps\common\Scrap Mechanic\Survival\Scripts\terrain\`
- **Linux/Proton:** `~/.local/share/Steam/steamapps/common/Scrap Mechanic/Survival/Scripts/terrain/`

**Automated (Linux/Proton):**

```bash
bash tools/apply-patch.sh          # patch; --revert restores originals; re-run after every game update
```

It backs up the pristine files, replaces `overworld/tile_database.lua`, and injects the export block into `terrain_overworld.lua`'s `Load()` (idempotent).

**Manual:**

**(a)** Replace `overworld/tile_database.lua` with [`game-patches/tile_database.lua`](game-patches/tile_database.lua).
This adds a `GetLegacyID` lookup (by **Arkanorian**) that the exporter needs to resolve tile images — everything else in the file is stock 1.0.

**(b)** Open `terrain_overworld.lua`, find the `Load()` function. Inside the `if sm.terrainData.exists() then` block, paste the contents of [`game-patches/export_block.lua`](game-patches/export_block.lua) **immediately after** `CreateCellDataStorage()` and **before** `return true`.

The export block runs once per session, is wrapped in `pcall()`, and logs any error — so it can't break your game's load. **Game updates overwrite these files**, so re-apply after updates (`bash tools/apply-patch.sh` again) or verify game files to remove the patches entirely.

### 3. Export your world

Launch Scrap Mechanic, **load your Survival save**, let the world finish loading, then quit. The export block writes your cell data to the newest game log once, automatically. Then:

```bash
python3 tools/extract_cells.py
# → writes viewer/public/data/cells.json (your seed + every cell)
```

> **Can't find the log?** Pass it explicitly, or set `STEAM_COMMON` to your `steamapps/common` path. Logs live at `…/Scrap Mechanic/Logs/game-*.log`.

### 4. Build + run

```bash
bash tools/serve.sh
```

This installs deps, renders the tile pyramid, and starts the dev server. Open **http://localhost:8080**.

`serve.sh` only rebuilds the pyramid when `cells.json` is newer than the last build, so subsequent runs are instant until you export new data. Force a rebuild anytime with:

```bash
bun tools/build-tiles.mjs [path/to/cells.json] [--ppc 512] [--band 6]
```

---

## Using the map

| Action | How |
|---|---|
| **Pan / zoom** | Drag / scroll. Instant at every zoom level. |
| **Inspect a cell** | Click it → see type, tile ID, rotation, POI in the sidebar. |
| **Add a marker** | Click a cell → *Selected* tab → name it, pick a color, **Add marker**. |
| **Manage markers** | *Markers* tab → click to fly, edit the label, or delete. Saved to `localStorage`. |
| **Browse POIs** | *POIs* tab lists every point of interest; toggle labels on the map from the *Selected* tab. |

> The cell coordinates shown on click match the in-game `/cell x y z` command, so you can navigate straight to a spot.

---

## How it works

**Export — the 0.6.6+ workaround, updated for 1.0.** Scrap Mechanic 0.6.6 blocked `sm.json.save` to arbitrary paths (`'$SURVIVAL_DATA/cells.json' is not located in the same content id as the caller`). The export block instead serializes cells with `sm.json.writeJsonString()` and writes them to the game log via `sm.log.info()`, between `START COPYING` / `STOP COPYING` markers. `extract_cells.py` finds the markers, strips the log-line prefixes (handles both the 0.7 single-tag and the 1.0 `[Main:360] [Default]` double-tag formats), and parses the JSON. Tiles that only exist in 0.7/1.0 (no legacy id) export as `-1` and render as their terrain color.

**Pre-render — `build-tiles.mjs`.** Builds a 1-px-per-cell terrain-color base per horizontal band, nearest-neighbor upscales it to full resolution (**512 px/cell by default — the native resolution of the tile art**), then composites every cell's rotated tile image, road segments, and POI overlays for that band in a **single Sharp pass**, slicing the band straight into max-zoom tiles. Lower zoom levels are classic pyramid reduction (each parent is a 2× downscale of its four children), so the full-resolution world is never held in memory — a 512px/cell build peaks at ~2.5 GB RAM. North is up.

**Viewer.** React 18 + Vite + TypeScript. Vanilla Leaflet with `L.CRS.Simple` displays the pre-rendered pyramid via `L.tileLayer`; cell ↔ lat/lng is derived from the pyramid geometry. Markers persist in `localStorage`.

---

## Project layout

```
scrap-mechanic-overview/
├── game-patches/
│   ├── tile_database.lua      # replace game's overworld/tile_database.lua
│   └── export_block.lua       # paste into game's terrain_overworld.lua
├── tools/
│   ├── apply-patch.sh         # install/remove the game patches (idempotent)
│   ├── extract_cells.py       # game log → viewer/public/data/cells.json
│   ├── build-tiles.mjs        # cells.json + img → tile pyramid (Sharp)
│   └── serve.sh               # one command: deps + build(if needed) + dev server
├── viewer/                    # React + Vite + TS + Leaflet app
│   ├── public/img/            # terrain tile + POI source images
│   ├── public/data/cells.json # sample data (yours overwrites this)
│   ├── public/tiles/          # generated pyramid (gitignored)
│   └── src/
└── legacy/                    # the original vanilla viewer, kept for reference
```

---

## Troubleshooting

<details>
<summary><b>Some cells are flat color, not textured</b></summary>

This is **expected** and matches upstream. Only ~300 specific tile variants have hand-authored images; the rest render as flat biome colors. A typical world is 73% lake (which is color-only), so large blue areas are normal. DESERT, AUTUMNFOREST, and FIELD biomes are fully textured.
</details>

<details>
<summary><b>Map shows "Couldn't load the map" / blank after a rebuild</b></summary>

If you rebuild tiles while the dev server is running and get `Unexpected token '<'`, the dev server has a stale handle on the `tiles/` directory. Restart it:

```bash
systemctl --user restart sm_overview_react.service   # if running via systemd
# or just Ctrl+C and re-run: bash tools/serve.sh
```

(The builder now preserves the directory inode, so this shouldn't recur — but a restart always fixes it.)
</details>

<details>
<summary><b>Tiles look soft at maximum zoom</b></summary>

The default build is already full resolution (512 px/cell — matching the ~500px source tile art). You can still trade RAM/disk for supersampling: `bun tools/build-tiles.mjs --ppc 1024`, or build lighter/faster with `--ppc 256`. Band size is tunable with `--band N` (rows per band; smaller = less RAM).
</details>

<details>
<summary><b>Export wrote nothing to the log</b></summary>

The block runs once per session. If you've already loaded the save in this session, fully quit and relaunch the game, then load the save again. Check the game log for `START COPYING` / `STOP COPYING` markers.
</details>

---

## Credits & license

Derivative of [**sm_overview**](https://github.com/the1killer/sm_overview) by **The1Killer**, including: the cell/POI/road parsing logic, the full tile and POI image set (`viewer/public/img/`), the `tile_database.lua` modification (by **Arkanorian**, adds `GetLegacyID`), and the cell-export concept. The original vanilla viewer is preserved in [`legacy/`](legacy) for reference.

**Added here:** the 0.6.6+ log-based export block (with `pcall` error handling, 1.0-compatible), the automated `extract_cells.py` log parser, the idempotent `apply-patch.sh` game patcher, the Sharp pre-render tile-pyramid builder (full-res 512px/cell, band-based), and the React/Leaflet viewer with persistent markers.

Released under [**CC BY-NC-SA 4.0**](https://creativecommons.org/licenses/by-nc-sa/4.0/) — the same license as upstream (see [LICENSE](LICENSE)): free for non-commercial use with attribution; derivatives must use the same license.

*Scrap Mechanic is property of Axolot Games AB. This project is unaffiliated.*
