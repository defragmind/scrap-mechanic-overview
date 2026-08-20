#!/usr/bin/env python3
"""Extract Scrap Mechanic 1.0's shipped world definitions (the Drilling Thunder
underground + growlab interiors) into renderable JSON + PNG maps.

The game ships fixed world layouts as Terrain/Worlds/*.world (JSON with
cellData / cornerData / portalData / zoneData). The overworld mine system is
8 depths deep (Mining Hub -> Onboarding -> Station1 -> Drill1 -> Scrapyard ->
Drill2 -> Station2 -> Boss Lobby); structural depths are these fixed maps,
drill depths are procedurally cave-generated per seed at runtime (their .world
files are just 2x2 empty seeds).

This tool:
  1. Parses every .world file -> viewer/public/data/worlds/<name>.json
  2. Renders each fixed map to viewer/public/mines/<name>.png using the game's
     own tile preview PNGs (dark cave background, portal markers)

Usage: uv run --with lz4 python3 tools/extract_underground.py
"""
import json, os, re, glob, sys
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.expanduser("~/.local/share/Steam/steamapps/common/Scrap Mechanic")
WORLDS_DIR = os.path.join(GAME, "Survival", "Terrain", "Worlds")
TILES_DIR = os.path.join(GAME, "Survival", "Terrain", "Tiles")
OUT_JSON = os.path.join(REPO, "viewer", "public", "data", "worlds")
OUT_PNG = os.path.join(REPO, "viewer", "public", "mines")

# basename -> (uuid hex, size in cells) from .tile headers + filename footprint
def build_tile_index():
    idx = {}
    for root, _, files in os.walk(TILES_DIR):
        for f in files:
            if f.endswith(".tile"):
                with open(os.path.join(root, f), "rb") as fh:
                    h = fh.read(24)
                if h[:4] != b"TILE":
                    continue
                import uuid as U
                uhex = U.UUID(bytes=h[8:24]).hex
                m = re.search(r"_(\d+)_\d{2}\.tile$", f)
                s = max(1, int(m.group(1)) // 64) if m else 1
                idx[f] = (uhex, s if s in (1, 2, 4, 8, 16) else 1)
    return idx

def find_preview_png(uhex):
    import uuid as U
    dashed = str(U.UUID(uhex))
    for root, _, files in os.walk(TILES_DIR):
        if f"{dashed}.png" in files:
            return os.path.join(root, f"{dashed}.png")
    return None

PPC = 24  # px per cell for these small maps

# Quest markers per depth, parsed from terrain_underground.lua's DEPTH_QUEST_MARKERS
QUEST_MARKERS = {}
def load_quest_markers():
    src = open(os.path.join(GAME, "Survival", "Scripts", "terrain", "terrain_underground.lua"), encoding="utf-8", errors="replace").read()
    block = src.split("DEPTH_QUEST_MARKERS = {")[1].split("\n}\n")[0]
    depth = None
    for line in block.splitlines():
        m = re.match(r"\s*\[(\d+)\]", line)
        if m:
            depth = int(m.group(1)); QUEST_MARKERS.setdefault(depth, []); continue
        m = re.search(r'name = "([^"]+)".*?pos = sm\.vec3\.new\(\s*([\d.\-]+),\s*([\d.\-]+),\s*([\d.\-]+)', line)
        if m and depth is not None:
            QUEST_MARKERS[depth].append({
                "name": m.group(1),
                "x": float(m.group(2)), "y": float(m.group(3)), "z": float(m.group(4)),
            })

def draw_quest_markers(img, dr, x0, y1, depth):
    for q in QUEST_MARKERS.get(depth, []):
        cx, cy = q["x"] / 64.0, q["y"] / 64.0
        px, py = (cx - x0) * PPC, (y1 - cy) * PPC
        dr.ellipse([px - 5, py - 5, px + 5, py + 5], outline=(255, 60, 60), width=2)
        dr.line([px - 8, py, px + 8, py], fill=(255, 60, 60))
        dr.line([px, py - 8, px, py + 8], fill=(255, 60, 60))
        dr.text((px + 8, py - 6), q["name"].split(".")[-1], fill=(255, 200, 200))

def render_world(w, tile_index, out_path):
    cells = w["cellData"]
    xs = [c["x"] for c in cells]; ys = [c["y"] for c in cells]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    W, H = x1 - x0 + 1, y1 - y0 + 1
    img = Image.new("RGB", (W * PPC, H * PPC), (28, 24, 20))  # cave dark
    dr = ImageDraw.Draw(img)
    art_cache = {}
    for c in cells:
        path = c.get("path", "")
        if not path:
            continue
        base = os.path.basename(path)
        if base not in tile_index:
            continue
        uhex, s = tile_index[base]
        png = find_preview_png(uhex)
        if not png:
            continue
        key = (uhex, s)
        if key not in art_cache:
            art_cache[key] = Image.open(png).convert("RGB").resize((s * PPC, s * PPC))
        full = art_cache[key]
        ox, oy = min(c.get("offsetX", 0), s - 1), min(c.get("offsetY", 0), s - 1)
        sl = full.crop((ox * PPC, oy * PPC, ox * PPC + PPC, oy * PPC + PPC))
        rot = {0: 0, 1: 270, 2: 180, 3: 90}.get(c.get("rotation", 0), 0)
        sl = sl.rotate(-rot)
        px, py = (c["x"] - x0) * PPC, (y1 - c["y"]) * PPC
        img.paste(sl, (px, py))
    # portals
    for p in w.get("portalData", []):
        cx, cy = p.get("x", 0), p.get("y", 0)
        px, py = (cx - x0 + 0.5) * PPC, (y1 - cy + 0.5) * PPC
        dr.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(0, 255, 120))
    draw_quest_markers(img, dr, x0, y1, w.get("_depth", 0))
    img.save(out_path)
    return len(art_cache)

DEPTH_OF_WORLD = {  # .world name -> depth number ( UndergroundLevels order )
    "undergroundworld_mininghub": 1, "undergroundworld_onboarding": 2,
    "undergroundworld_station_01": 3, "undergroundworld_drill_01": 4,
    "undergroundworld_scrapyard": 5, "undergroundworld_drill_02": 6,
    "undergroundworld_station_02": 7, "undergroundworld_final_boss_lobby": 8,
}

def main():
    os.makedirs(OUT_JSON, exist_ok=True)
    os.makedirs(OUT_PNG, exist_ok=True)
    tile_index = build_tile_index()
    load_quest_markers()
    print(f"tile index: {len(tile_index)} tiles | quest markers: { {k: len(v) for k, v in QUEST_MARKERS.items() if v} }")
    report = []
    for wf in sorted(glob.glob(os.path.join(WORLDS_DIR, "*.world"))):
        name = os.path.basename(wf)[:-6]
        w = json.load(open(wf))
        w["_depth"] = DEPTH_OF_WORLD.get(name, 0)
        json.dump(w, open(os.path.join(OUT_JSON, f"{name}.json"), "w"))
        cells = w.get("cellData", [])
        filled = [c for c in cells if c.get("path")]
        png_path = os.path.join(OUT_PNG, f"{name}.png")
        arts = render_world(w, tile_index, png_path) if filled else 0
        xs = [c["x"] for c in cells]; ys = [c["y"] for c in cells]
        report.append((name, len(cells), len(filled),
                       f"x[{min(xs)}..{max(xs)}] y[{min(ys)}..{max(ys)}]",
                       len(w.get("portalData", [])), len(w.get("zoneData", [])), arts))
        print(f"  {name}: {len(cells)} cells ({len(filled)} tiled), "
              f"{len(w.get('portalData', []))} portals -> {os.path.basename(png_path)}")
    print(f"\nJSON: {OUT_JSON}\nPNG:  {OUT_PNG}  (view via http://localhost:8080/mines/<name>.png)")

if __name__ == "__main__":
    main()
