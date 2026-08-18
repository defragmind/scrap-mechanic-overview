#!/usr/bin/env bash
# apply-patch.sh — install the sm_overview game patches into a Scrap Mechanic
# install (1.0.x). Idempotent: safe to re-run after every game update.
#
# Usage:
#   bash tools/apply-patch.sh              # auto-find the game, patch it
#   bash tools/apply-patch.sh --revert     # restore original files from backup
#   STEAM_COMMON=/path/to/steamapps/common bash tools/apply-patch.sh
#
# What it does:
#   1. Backs up the two files it touches into Survival/Scripts/terrain/.sm_overview-backup/
#      (only the pristine copies — backups are never overwritten by re-runs)
#   2. Replaces overworld/tile_database.lua with game-patches/tile_database.lua
#      (adds GetLegacyID; everything else identical to the stock file)
#   3. Injects game-patches/export_block.lua into terrain_overworld.lua's Load(),
#      right after CreateCellDataStorage(), before return true
#
# To fully uninstall: --revert here, or Steam "Verify integrity of game files".
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE=patch
[[ "${1:-}" == "--revert" ]] && MODE=revert

# --- locate the game ---
GAME_DIR="${STEAM_COMMON:-}"
if [[ -z "$GAME_DIR" ]]; then
    for c in \
        "$HOME/.local/share/Steam/steamapps/common" \
        "$HOME/.steam/steam/steamapps/common" \
        "$HOME/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/common"; do
        if [[ -d "$c/Scrap Mechanic" ]]; then GAME_DIR="$c"; break; fi
    done
fi
if [[ -z "$GAME_DIR" || ! -d "$GAME_DIR/Scrap Mechanic" ]]; then
    echo "ERROR: could not find 'Scrap Mechanic' under any known steamapps/common." >&2
    echo "Set STEAM_COMMON explicitly, e.g.:" >&2
    echo "  STEAM_COMMON=/path/to/steamapps/common bash tools/apply-patch.sh" >&2
    exit 1
fi
TERRAIN="$GAME_DIR/Scrap Mechanic/Survival/Scripts/terrain"
BACKUP="$TERRAIN/.sm_overview-backup"
MARKER="sm_overview export"

echo "Game dir: $GAME_DIR/Scrap Mechanic"

do_revert() {
    for f in "overworld/tile_database.lua" "terrain_overworld.lua"; do
        if [[ -f "$BACKUP/$(basename "$f")" ]]; then
            cp "$BACKUP/$(basename "$f")" "$TERRAIN/$f"
            echo "reverted: $f"
        else
            echo "no backup for $f (nothing to revert)" >&2
        fi
    done
}

if [[ "$MODE" == revert ]]; then do_revert; exit 0; fi

# --- sanity: the 1.0 Load() anchor must exist ---
OVERWORLD="$TERRAIN/terrain_overworld.lua"
if ! grep -q "CreateCellDataStorage()" "$OVERWORLD"; then
    echo "ERROR: 'CreateCellDataStorage()' not found in terrain_overworld.lua." >&2
    echo "This patch targets Scrap Mechanic 1.0.x — is the game updated?" >&2
    exit 1
fi

# --- 1. backups (pristine copies only) ---
mkdir -p "$BACKUP"
for f in "overworld/tile_database.lua" "terrain_overworld.lua"; do
    if [[ ! -f "$BACKUP/$(basename "$f")" ]]; then
        if grep -q "$MARKER" "$TERRAIN/$f" 2>/dev/null; then
            echo "ERROR: $f is already patched but has no pristine backup." >&2
            echo "Run Steam 'Verify integrity of game files' first, then re-run." >&2
            exit 1
        fi
        cp "$TERRAIN/$f" "$BACKUP/$(basename "$f")"
    fi
done

# --- 2. tile_database.lua (straight replace) ---
cp "$REPO/game-patches/tile_database.lua" "$TERRAIN/overworld/tile_database.lua"
echo "patched:  overworld/tile_database.lua (GetLegacyID added)"

# --- 3. terrain_overworld.lua (inject once) ---
if grep -q "$MARKER" "$OVERWORLD"; then
    echo "skipped:  terrain_overworld.lua already contains the export block"
else
    BLOCK="$REPO/game-patches/export_block.lua"
    # inject right after the Load()-internal CreateCellDataStorage() call
    python3 - "$OVERWORLD" "$BLOCK" <<'EOF'
import sys, re
target, block_path = sys.argv[1], sys.argv[2]
src = open(target, encoding="utf-8").read()
block = open(block_path, encoding="utf-8").read()

# find Load() ... its CreateCellDataStorage() ... the following 'return true'
m = re.search(r"\nfunction Load\(\)", src)
if not m:
    sys.exit("ERROR: Load() not found in terrain_overworld.lua")
load_src = src[m.start():]
anchor = re.search(r"\n(\t+)CreateCellDataStorage\(\)\n", load_src)
if not anchor:
    sys.exit("ERROR: CreateCellDataStorage() call not found inside Load()")
end = load_src.index("return true", anchor.end())
inject_at = m.start() + end
out = src[:inject_at] + block.rstrip("\n") + "\n\n" + src[inject_at:]
open(target, "w", encoding="utf-8").write(out)
print("injected export block into Load()")
EOF
    echo "patched:  terrain_overworld.lua (export block injected into Load())"
fi

echo
echo "Done. Next:"
echo "  1. Launch Scrap Mechanic, LOAD your Survival save, wait for it to finish, quit"
echo "  2. python3 tools/extract_cells.py"
echo "  3. bash tools/serve.sh   →  http://localhost:8080"
