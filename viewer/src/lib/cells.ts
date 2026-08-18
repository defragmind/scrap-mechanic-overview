import type { Cell, Manifest, CellInfo } from "./types";

export const TAGS = ["NONE","MEADOW","FOREST","DESERT","FIELD","BURNTFOREST","AUTUMNFOREST","MOUNTAIN","LAKE"];

const POIS: Record<number, string> = {
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

export const cellType = (flags: number): string => {
  // 1.0 semantics: bit 3 of the type nibble = water, low 3 bits = base terrain
  const nib = (Math.floor(flags) & 0xf000) >> 12;
  return (nib & 8) ? "LAKE" : (TAGS[nib & 7] ?? "NONE");
};
const poiType = (tileid: number): string | undefined => {
  const t = Math.floor(tileid / 100);
  return t < 10000 ? POIS[t] : undefined;
};

export function cellInfo(c: Cell): CellInfo {
  return {
    cellX: c.x,
    cellY: c.y,
    type: cellType(c.flags),
    tileid: c.tileid,
    rotation: c.rotation,
    poi: poiType(c.tileid),
  };
}

/** Build a cell grid keyed [x][y] for O(1) click lookups. */
export function buildCellGrid(cells: Cell[]): Map<number, Map<number, Cell>> {
  const g = new Map<number, Map<number, Cell>>();
  for (const c of cells) {
    let col = g.get(c.x);
    if (!col) { col = new Map(); g.set(c.x, col); }
    col.set(c.y, c);
  }
  return g;
}

/** Pixels-per-cell at the pyramid's max zoom (== manifest.ppc). */
export const pxPerCellAtMax = (m: Manifest) => m.fullW / m.cellsW;

/** Friendly label for a POI type id, e.g. "Mechanic Station". */
export function poiDisplayName(name: string): string {
  return name
    .replace(/^POI_/, "")
    .replace(/_(XL|LARGE|MEDIUM|SMALL)$/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}
