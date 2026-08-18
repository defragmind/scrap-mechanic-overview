# Scrap Mechanic Overview

Turn your **Scrap Mechanic** Survival world into a fast, interactive, zoomable map — with persistent markers, cell inspection, and a full POI roster.

This is a modernized, automated fork of [**sm_overview**](https://github.com/the1killer/sm_overview) by **The1Killer**. As of Scrap Mechanic **1.0**, the map is generated **directly from your save file** — no game patching, no game launch — at **full resolution (512 px/cell)** with **every cell textured** (legacy tile art + the game's own tile previews for new 1.0 tiles).

```
Scrap Mechanic v1.0.x  ·  Windows or Linux/Proton  ·  ~86k tiles  ·  instant pan/zoom
```

---

## What you get

- **Buttery-smooth map** — pan and zoom are instant at any zoom level, with full detail everywhere. No re-rendering on pan.
- **Every cell textured** — 1.0 tiles without legacy map art fall back to the game's own tile preview renders; no flat color patches (except open ocean, which is honestly just blue).
- **Click any cell** — see its coordinates, terrain type, tile ID, rotation, and POI. Coordinates match the in-game `/cell` chat command.
- **Persistent markers** — drop labeled, color-coded pins anywhere; they're saved in your browser and survive refreshes.
- **POI browser** — every hideout, warehouse, mechanic station, silo district, camp, and more, listed and labeled on the map.
- **Terrain breakdown** — live count of each biome type across your world.

### Why this is fast

The original viewer created **~16,000 DOM nodes** (one per world cell, each with its own image) and rebuilt them on every pan and zoom — sluggish, and blurry when zoomed out.

This viewer **pre-renders the entire map once** into a standard `{z}/{x}/{y}` tile pyramid, then displays it with Leaflet's native `L.tileLayer`. That's GPU-composited, only paints what's on screen, and only downloads the few tiles in the viewport — so the 132 MB pyramid is never loaded wholesale.

---

## Quick start

> Already have cells.json + tiles built? Just run `bash tools/serve.sh` and open http://localhost:8080.

```bash
git clone https://github.com/defragmind/scrap-mechanic-overview
cd scrap-mechanic-overview
```

1. **Extract straight from your save** (the game doesn't need to be running):
   ```bash
   python3 tools/extract_from_save.py        # newest Survival save
   python3 tools/extract_from_save.py --all  # or list saves and pick one
   ```
   Needs the `lz4` package (`pip install lz4`, or run it as `uv run --with lz4 python3 tools/extract_from_save.py`).
2. **Build + view** — installs deps, renders the full-res tile pyramid (~5–12 min, once per world), starts the dev server:
   ```bash
   bash tools/serve.sh
   ```
   Open **http://localhost:8080**.

---

## Requirements

- A Scrap Mechanic 1.0.x Survival save (Windows or Linux/Proton — the save is read directly)
- The Scrap Mechanic install (for tile-id mapping and preview art; found automatically)
- [Bun](https://bun.sh) — runs the viewer and the tile builder
- Python 3 + the `lz4` package — save extraction only
- ~4 GB free RAM for the one-time full-res tile build
- A modern browser

---

## Setup

No game modification is needed — the extractor reads the save file read-only. Saves live at `%appdata%\Axolot Games\Scrap Mechanic\User\<you>\Save\Survival\` (or the Proton compatdata equivalent on Linux); `python3 tools/extract_from_save.py --all` lists what it can find. Re-run the extractor any time to refresh the map.

### Legacy flow (pre-1.0 saves, 0.6.x–0.7.x)

On 1.0 the old game-patch export no longer fires (1.0 loads existing worlds engine-side, without running the terrain scripts) — that's why the save reader above is now the primary path. For older saves on older game versions the original flow still works. **Back up your save first**, then:

#### Patch the game

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

#### Export your world

Launch Scrap Mechanic, **load your Survival save**, let the world finish loading, then quit. The export block writes your cell data to the newest game log once, automatically. Then:

```bash
python3 tools/extract_cells.py
# → writes viewer/public/data/cells.json (your seed + every cell)
```

> **Can't find the log?** Pass it explicitly, or set `STEAM_COMMON` to your `steamapps/common` path. Logs live at `…/Scrap Mechanic/Logs/game-*.log`.

#### Build + run

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

**Export — read straight from the save (1.0).** Scrap Mechanic stores the overworld cell data inside the save's SQLite `ScriptData` table: an LZ4-compressed, bit-packed binary Lua pickle (the `LUA\0\0\0\x01` stream format). `extract_from_save.py` decodes it — tags for nil/bool/float32/string/table/int8–32/float64/userdata-uuids, array-mode tables, all at arbitrary bit offsets — and maps each cell's tile uuid to a legacy tile id via the game's own registration scripts (`AddTile( legacyId, path )` in `overworld/*.lua`, resolved against `.tile` file headers). The output is the same `cells.json` the old log-export produced, plus each cell's tile uuid so the builder can fall back to the game's tile preview PNGs for tiles that have no legacy map art. Your world, 100% textured, without ever launching the game. (Format reverse-engineered here; Kariaro's ScrapMechanicReader provided the initial tag grammar.)

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
│   ├── extract_from_save.py   # 1.0: save .db → cells.json (no game launch)
│   ├── apply-patch.sh         # legacy: install/remove the game patches
│   ├── extract_cells.py       # legacy: game log → cells.json (pre-1.0)
│   ├── build-tiles.mjs        # cells.json + img → tile pyramid (Sharp)
│   └── serve.sh               # one command: deps + build(if needed) + dev server
├── viewer/                    # React + Vite + TS + Leaflet app
│   ├── public/img/            # terrain tile + POI source images
│   ├── public/img/uuid/       # game tile-preview PNGs (1.0 fallback art, generated)
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

**Added here:** the 1.0 save-file reader (`extract_from_save.py` — LZ4 + binary-Lua-pickle decoder reverse-engineered from the save format, informed by Kariaro's ScrapMechanicReader), the Sharp pre-render tile-pyramid builder (full-res 512px/cell, band-based, layer-cached), and the React/Leaflet viewer with persistent markers.

Released under [**CC BY-NC-SA 4.0**](https://creativecommons.org/licenses/by-nc-sa/4.0/) — the same license as upstream (see [LICENSE](LICENSE)): free for non-commercial use with attribution; derivatives must use the same license.

*Scrap Mechanic is property of Axolot Games AB. This project is unaffiliated.*
