#!/usr/bin/env python3
"""Extract a Scrap Mechanic 1.0.x Survival world's cell data DIRECTLY from the
save file — no game patching, no game launch.

How it works
------------
1.0 stores the overworld terrain data (g_cellData) inside the save's SQLite
`ScriptData` table: a container blob (uuid + key echo + flags) wrapping an
LZ4-compressed binary Lua pickle ("LUA\\0\\0\\0\\x01"). This tool decodes that
pickle, maps each cell's tile uuid to a legacy tile id (via the game's own
script tables + .tile headers), and writes viewer/public/data/cells.json —
the same format tools/extract_cells.py produced from game logs, plus a `u`
field (tile uuid, no dashes) so the builder can use the game's tile preview
PNGs for tiles that have no legacy map image.

Usage:
    python3 tools/extract_from_save.py                     # newest Survival save
    python3 tools/extract_from_save.py path/to/World.db
    python3 tools/extract_from_save.py --all               # list saves only

Requires: python3 + the `lz4` package (pip install lz4 / uv run --with lz4).
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import struct
import sys
import uuid as uuid_mod

try:
    import lz4.block
except ImportError:
    sys.exit("The `lz4` package is required:  pip install lz4   (or run via: uv run --with lz4 python3 tools/extract_from_save.py)")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_ROOT, "viewer", "public", "data", "cells.json")

TERRAIN_UID = "61aa13d7-e715-4153-a269-4d338c0c5bd4"  # engine's overworld cellData storage id


def save_dirs():
    home = os.path.expanduser("~")
    out = []
    # Linux/Proton
    for steam in (os.path.join(home, ".local/share/Steam"),
                  os.path.join(home, ".steam/steam"),
                  os.path.join(home, ".var/app/com.valvesoftware.Steam/data/Steam")):
        out.append(os.path.join(steam, "steamapps", "compatdata", "387990", "pfx",
                                "drive_c", "users", "steamuser", "AppData",
                                "Roaming", "Axolot Games", "Scrap Mechanic", "User"))
    # Windows
    if os.environ.get("APPDATA"):
        out.append(os.path.join(os.environ["APPDATA"], "Axolot Games", "Scrap Mechanic", "User"))
    return out


def list_saves():
    saves = []
    for d in save_dirs():
        for f in glob.glob(os.path.join(d, "*", "Save", "Survival", "*.db")):
            saves.append(f)
    return sorted(saves, key=os.path.getmtime)


def find_game_dir():
    home = os.path.expanduser("~")
    for c in (os.path.join(home, ".local/share/Steam/steamapps/common"),
              os.path.join(home, ".steam/steam/steamapps/common"),
              os.path.join(home, ".var/app/com.valvesoftware.Steam/data/Steam/steamapps/common"),
              "C:\\Program Files (x86)\\Steam\\steamapps\\common"):
        if os.path.isdir(os.path.join(c, "Scrap Mechanic")):
            return os.path.join(c, "Scrap Mechanic")
    return None


# ----------------------------------------------------------------------------
# Binary Lua pickle parser ("LUA\0\0\0\1" stream)
# Tags: 01 Nil, 02 Bool(1 bit), 03 Float32, 04 String, 05 Table, 06 Int32,
#       07 Int16, 08 Int8, 09 Json, 0x0b Float64, 0x64 Userdata.
# Tables: int32 count + 1-bit isArray (+ int32 offset in array mode).
# The stream is BIT-packed: values are read at arbitrary bit offsets;
# byte-array payloads (strings/json) realign to the next byte boundary.
# ----------------------------------------------------------------------------

class BitStream:
    def __init__(self, data):
        self.d = data + b"\x00\x00"  # pad: the last value can read up to 7 bits past the end
        self.i = 0  # bit index

    def _nbytes(self, count):
        mem_off = self.i >> 3
        off = self.i & 7
        result = 0
        self.i += count * 8
        if off == 0:
            for k in range(count):
                result |= (self.d[mem_off + k] & 0xff) << ((count - k - 1) << 3)
            return result
        for k in range(count):
            a = ((self.d[mem_off + k] & 0xff) << off) & 0xff
            b = (self.d[mem_off + k + 1] & 0xff) >> (8 - off)
            result |= ((a | b) & 0xff) << ((count - k - 1) << 3)
        return result

    def read_int(self):
        v = self._nbytes(4)
        return v - (1 << 32) if v >= (1 << 31) else v

    def read_byte(self):
        return self._nbytes(1)

    def read_bool(self):
        v = self.d[self.i >> 3] & 0xff
        r = (v & (0x80 >> (self.i & 7))) != 0
        self.i += 1
        return r

    def read_bytes(self, length):
        self.i += 7 - ((self.i - 1) & 7)  # align to byte boundary
        start = self.i >> 3
        out = self.d[start:start + length]
        if len(out) != length:
            raise EOFError("string past end")
        self.i += length * 8
        return out


def _value(s):
    tag = s.read_byte()
    if tag == 0x01:
        return None
    if tag == 0x02:
        return s.read_bool()
    if tag == 0x03:
        return struct.unpack(">f", bytes(s._nbytes(1) for _ in range(4)))[0]
    if tag == 0x04:
        return s.read_bytes(s.read_int()).decode("utf-8", "replace")
    if tag == 0x05:
        count = s.read_int()
        if count < 0 or count > 1 << 22:
            raise ValueError(f"implausible table count {count}")
        is_array = s.read_bool()
        out = {}
        if is_array:
            offset = s.read_int()
            for i in range(count):
                out[offset + i] = _value(s)
        else:
            for _ in range(count):
                k = _value(s)
                out[k if not isinstance(k, (dict, list)) else str(k)] = _value(s)
        return out
    if tag == 0x06:
        return s.read_int()
    if tag == 0x07:
        v = s._nbytes(2)
        return v - 65536 if v >= 32768 else v
    if tag == 0x08:
        b = s.read_byte()
        return b - 256 if b > 127 else b
    if tag == 0x09:
        return s.read_bytes(s.read_int()).decode("utf-8", "replace")
    if tag == 0x0b:  # float64 (terrain elevations)
        return struct.unpack(">d", bytes(s._nbytes(1) for _ in range(8)))[0]
    if tag == 0x64:  # userdata: u16 zero + u16 typeId + payload
        s._nbytes(2)
        tid = s._nbytes(2)
        size = {0x2711: 16, 0x2712: 16, 0x2713: 12, 0x2714: 16, 0x2715: 4}.get(tid, 16)
        payload = bytes(s._nbytes(1) for _ in range(size))
        if tid == 0x2711:
            return uuid_mod.UUID(bytes=payload[::-1])  # uuids stored byte-reversed
        return ("userdata", tid, payload.hex())
    if tag == 0x65:
        return ("userdata65",)
    raise ValueError(f"unknown lua tag {tag:#x} at bit {s.i} (byte {s.i//8})")


def parse_lua_pickle(data):
    s = BitStream(data)
    if s.read_bytes(3) != b"LUA" or s.read_int() != 1:
        raise ValueError("not a LUA v1 pickle")
    return _value(s)


def read_terrain_blob(save_path):
    con = sqlite3.connect(f"file:{save_path}?mode=ro&immutable=1", uri=True)
    try:
        rows = con.execute(
            "SELECT uid, key, data FROM ScriptData "
            "WHERE key = X'01000000' AND length(data) > 50000").fetchall()
    finally:
        con.close()
    for uid, key, data in rows:
        if uid.hex() == TERRAIN_UID.replace("-", ""):
            return data
    if rows:
        return rows[0][2]
    raise SystemExit(f"No terrain data found in {save_path} (is this a Survival save from 1.0+?)")


def decode_container(blob):
    """Container: uuid(16) + 00 + keylen(1) + key + u16 + 5B + LZ4 block."""
    kl = blob[17]
    stream = blob[18 + kl + 2 + 5:]
    return lz4.block.decompress(stream, uncompressed_size=1 << 22)


# ----------------------------------------------------------------------------
# uuid -> legacy tile id, from the game's own registration tables
# ----------------------------------------------------------------------------

def build_legacy_map(game_dir):
    tiles_dir = os.path.join(game_dir, "Survival", "Terrain", "Tiles")
    scripts_dir = os.path.join(game_dir, "Survival", "Scripts", "terrain", "overworld")
    name_to_uuid = {}
    for root, _, files in os.walk(tiles_dir):
        for f in files:
            if f.endswith(".tile"):
                with open(os.path.join(root, f), "rb") as fh:
                    h = fh.read(24)
                if h[:4] == b"TILE":
                    name_to_uuid[f] = h[8:24]
    legacy = {}
    for lua in glob.glob(os.path.join(scripts_dir, "*.lua")):
        src = open(lua, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r'AddTile\(\s*(\d+)\s*,\s*"(\$[^"]+)"', src):
            u = name_to_uuid.get(os.path.basename(m.group(2)))
            if u:
                legacy[u] = int(m.group(1))
    # poi.lua: addPoiTileLegacy( POI_TYPE, index, path ) -> legacy id = type*100 + index
    poi_types = {}
    ptf = os.path.join(scripts_dir, "poi_types.lua")
    if os.path.exists(ptf):
        for m in re.finditer(r'^(POI_[A-Z_]+)\s*=\s*(\d+)', open(ptf).read(), re.M):
            poi_types[m.group(1)] = int(m.group(2))
    poif = os.path.join(scripts_dir, "poi.lua")
    if os.path.exists(poif):
        src = open(poif, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r'addPoiTileLegacy\(\s*(POI_[A-Z_]+)\s*,\s*(\d+)\s*,\s*"(\$[^"]+)"', src):
            u = name_to_uuid.get(os.path.basename(m.group(3)))
            if u and m.group(1) in poi_types:
                legacy[u] = poi_types[m.group(1)] * 100 + int(m.group(2))
    return legacy


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("save", nargs="?", help="path to a Survival save .db (default: newest)")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"output path (default: {DEFAULT_OUT})")
    ap.add_argument("--all", action="store_true", help="list available saves and exit")
    ap.add_argument("--png-out", default=None, help="copy used tile preview PNGs here (default: viewer/public/img/uuid)")
    args = ap.parse_args()

    if args.all:
        saves = list_saves()
        if not saves:
            print("No Survival saves found.")
        for s in saves:
            print(f"  {os.path.getmtime(s):.0f}  {s}")
        return

    save_path = args.save
    if not save_path:
        saves = list_saves()
        if not saves:
            sys.exit("Could not find any Survival save automatically.\n"
                     "List what's visible with:  python3 tools/extract_from_save.py --all\n"
                     "or pass a path explicitly.")
        save_path = saves[-1]
    if not os.path.exists(save_path):
        sys.exit(f"Save not found: {save_path}")

    game_dir = find_game_dir()
    if not game_dir:
        sys.exit("Could not find the Scrap Mechanic install (needed for tile id mapping).")
    print(f"Save:     {save_path}")
    print(f"Game dir: {game_dir}")

    # upstream image set (which legacy ids have hand-authored map art)
    legacy_js = os.path.join(REPO_ROOT, "legacy", "assets", "js", "sm_overview_map.js")
    valid_legacy = set()
    if os.path.exists(legacy_js):
        m = re.search(r"var tiles = \[([\s\S]*?)\];", open(legacy_js).read())
        if m:
            valid_legacy = set(int(x) for x in re.findall(r"\d+", m.group(1)))

    cell_data = parse_lua_pickle(decode_container(read_terrain_blob(save_path)))
    legacy = build_legacy_map(game_dir)

    bounds = cell_data["bounds"]
    uid = cell_data["uid"]
    used_uuids = {}
    cells = []
    for y in sorted(uid):
        row = uid[y]
        for x in sorted(row):
            cell_uuid = row[x]
            lid = legacy.get(cell_uuid.bytes, -1)
            uhex = cell_uuid.hex
            if lid == -1 or lid not in valid_legacy:
                used_uuids[uhex] = True
            cells.append({"x": x, "y": y, "tileid": lid, "u": uhex,
                          "flags": cell_data["flags"][y][x],
                          "rotation": cell_data["rotation"][y][x]})
    if not cells:
        sys.exit("Terrain data decoded but empty?!")
    cells[0]["bounds"] = bounds
    cells[0]["seed"] = cell_data.get("seed")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(cells, f)

    # copy preview PNGs for tiles that have no legacy map art (named WITH dashes)
    png_out = args.png_out or os.path.join(REPO_ROOT, "viewer", "public", "img", "uuid")
    copied = 0
    if used_uuids:
        os.makedirs(png_out, exist_ok=True)
        tiles_root = os.path.join(game_dir, "Survival", "Terrain", "Tiles")
        for uhex in used_uuids:
            dashed = str(uuid_mod.UUID(uhex))
            dst = os.path.join(png_out, f"{uhex}.png")
            if os.path.exists(dst):
                continue
            src = None
            for root, _, files in os.walk(tiles_root):
                if f"{dashed}.png" in files:
                    src = os.path.join(root, f"{dashed}.png")
                    break
            if src:
                import shutil
                shutil.copyfile(src, dst)
                copied += 1

    n_img = sum(1 for c in cells if c["tileid"] != -1)
    print(f"\n  Extracted and wrote: {args.out}")
    print(f"  cells:    {len(cells)}")
    print(f"  seed:     {cells[0].get('seed')}")
    print(f"  bounds x: [{bounds['xMin']}, {bounds['xMax']}]")
    print(f"  bounds y: [{bounds['yMin']}, {bounds['yMax']}]")
    print(f"  legacy-id cells: {n_img}   new-tile cells (uuid png): {len(cells)-n_img}")
    print(f"  preview PNGs copied: {copied}")
    print("\nNext: rebuild tiles + view the map:")
    print("  bun tools/build-tiles.mjs")
    print("  bash tools/serve.sh")


if __name__ == "__main__":
    main()
