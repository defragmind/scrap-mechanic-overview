#!/usr/bin/env python3
"""
Extract Scrap Mechanic world cell data from a game log into the viewer's
cells.json.

The game's terrain_overworld.lua export block (see ../game-patches/export_block.lua)
writes the world's cell data to the game log between these markers:

    --- START COPYING AFTER THIS LINE FOR CELLS.JSON ---
    <minified json line(s), each prefixed by a log header>
    --- STOP COPYING BEFORE THIS LINE FOR CELLS.JSON ---

This script finds the markers in the newest game log, strips the log prefixes,
joins and validates the JSON, and writes it to the viewer.

Usage:
    python3 tools/extract_cells.py                 # auto-find newest log
    python3 tools/extract_cells.py path/to/game.log  # use a specific log
    python3 tools/extract_cells.py --log a.log --out b.json
"""
import argparse
import glob
import json
import os
import re
import sys

START = "START COPYING AFTER THIS LINE FOR CELLS.JSON"
STOP = "STOP COPYING BEFORE THIS LINE FOR CELLS.JSON"
# Handles both log formats:
#   0.7.x:  "01:23:45 (f/s) [Default] msg"
#   1.0.x:  "01:23:45 (f/s) [Main:360] [Default] msg"
# Bracket groups are channel/thread tags like [Lua], [Default], [Main:360],
# [UnnamedThread:952] — constrained to word(\u200b:words)? so the regex can't
# swallow into the JSON payload itself (which starts with `[{"bounds"...`).
PREFIX = re.compile(r"^\d{2}:\d{2}:\d{2} \([\d/]+\) (?:\[[A-Za-z]+(?::[A-Za-z0-9]+)?\] ?)+")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_ROOT, "viewer", "public", "data", "cells.json")


def candidate_log_dirs():
    """Common 'Scrap Mechanic/Logs' locations across Linux/Proton and Windows."""
    home = os.path.expanduser("~")
    dirs = []
    # Linux native / Proton Steam libraries
    for steam in [
        os.path.join(home, ".local", "share", "Steam"),
        os.path.join(home, ".steam", "steam"),
        os.path.join(home, ".var", "app", "com.valvesoftware.Steam"),  # Flatpak
    ]:
        dirs.append(os.path.join(steam, "steamapps", "common", "Scrap Mechanic", "Logs"))
    # Explicit override
    if os.environ.get("STEAM_COMMON"):
        dirs.append(os.path.join(os.environ["STEAM_COMMON"], "Scrap Mechanic", "Logs"))
    # Windows-style (when run from Windows); rely on env if present
    if os.environ.get("PROGRAMFILES(X86)"):
        dirs.append(os.path.join(
            os.environ["PROGRAMFILES(X86)"],
            "Steam", "steamapps", "common", "Scrap Mechanic", "Logs"))
    return dirs


def newest_log(explicit=None):
    if explicit:
        if not os.path.exists(explicit):
            sys.exit(f"Log not found: {explicit}")
        return explicit
    for d in candidate_log_dirs():
        logs = sorted(glob.glob(os.path.join(d, "game-*.log")),
                      key=os.path.getmtime)
        if logs:
            return logs[-1]
    sys.exit(
        "Could not find a Scrap Mechanic log automatically.\n"
        "Pass the log path explicitly, e.g.:\n"
        "  python3 tools/extract_cells.py "
        "'.../Steam/steamapps/common/Scrap Mechanic/Logs/game-XXXX.log'\n"
        "You can also set STEAM_COMMON to your steamapps/common directory.")


def extract(log_path):
    with open(log_path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    inside = False
    chunks = []
    start_idx = stop_idx = None
    for i, line in enumerate(lines):
        if START in line:
            inside = True
            start_idx = i
            continue
        if STOP in line:
            inside = False
            stop_idx = i
            break
        if inside:
            chunks.append(PREFIX.sub("", line).rstrip("\n"))

    if start_idx is None:
        sys.exit("No START marker found in this log. Make sure you:\n"
                 "  1. Patched the game files (game-patches/)\n"
                 "  2. Launched the game and LOADED your Survival save\n"
                 "The export runs once while the world loads.")
    if stop_idx is None:
        sys.exit("START marker found but no STOP marker — the export was "
                 "interrupted. Re-load the save.")

    raw = "".join(chunks).strip()
    if not raw:
        sys.exit("Markers found but no JSON between them.")

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        dbg = log_path + ".cells.raw.txt"
        with open(dbg, "w") as f:
            f.write(raw)
        sys.exit(f"JSON parse failed: {e}\nRaw text written to {dbg}\n"
                 "This usually means the log line got truncated/wrapped; "
                 "grab the JSON from the START..STOP lines manually.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("log", nargs="?", help="path to a specific game log")
    ap.add_argument("--log", dest="log_opt", help="path to a specific game log")
    ap.add_argument("--out", default=DEFAULT_OUT,
                    help=f"output path (default: {DEFAULT_OUT})")
    args = ap.parse_args()

    log_path = newest_log(args.log_opt or args.log)
    print(f"Reading log: {log_path}")
    data = extract(log_path)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(data, f)

    first = data[0] if data else {}
    bounds = first.get("bounds", {})
    print("\n  Extracted and wrote:", args.out)
    print(f"  cells:    {len(data)}")
    print(f"  seed:     {first.get('seed')}")
    print(f"  bounds x: [{bounds.get('xMin')}, {bounds.get('xMax')}]")
    print(f"  bounds y: [{bounds.get('yMin')}, {bounds.get('yMax')}]")
    print("\nNext: rebuild tiles + view the map:")
    print("  bun tools/build-tiles.mjs   # regenerate the tile pyramid from this data")
    print("  bash tools/serve.sh         # then open http://localhost:8080")


if __name__ == "__main__":
    main()
