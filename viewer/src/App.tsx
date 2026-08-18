import { useEffect, useMemo, useRef, useState } from "react";
import type { Manifest, Cell, CellInfo } from "./lib/types";
import { MapView, type MapViewHandle } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import { buildCellGrid, cellType } from "./lib/cells";
import { useMarkers } from "./lib/markers";

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CellInfo | null>(null);
  const [showPoiLabels, setShowPoiLabels] = useState(true);
  const mapRef = useRef<MapViewHandle>(null);
  const { markers, addMarker, removeMarker, updateMarker } = useMarkers(manifest?.seed ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/tiles/manifest.json", { cache: "no-cache" });
        if (!res.ok) throw new Error(`manifest.json not found (HTTP ${res.status}). Run \`bun tools/build-tiles.mjs\` first.`);
        setManifest(await res.json());
        const cr = await fetch("/data/cells.json", { cache: "no-cache" });
        if (cr.ok) setCells(await cr.json());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const cellGrid = useMemo(() => (cells ? buildCellGrid(cells) : null), [cells]);

  const { typeCounts, poiAgg } = useMemo(() => {
    const tc: Record<string, number> = {};
    const pa: Record<string, number> = {};
    if (cells) {
      for (const c of cells) {
        const t = cellType(c.flags);
        tc[t] = (tc[t] ?? 0) + 1;
      }
    }
    if (manifest) {
      for (const p of manifest.pois) pa[p.name] = (pa[p.name] ?? 0) + 1;
    }
    return { typeCounts: tc, poiAgg: pa };
  }, [cells, manifest]);

  if (error) {
    return <div className="center-msg"><h2>Couldn’t load the map</h2><p>{error}</p></div>;
  }
  if (!manifest) {
    return <div className="center-msg"><div className="spinner" /><p>Loading map…</p></div>;
  }

  const pois = Object.entries(poiAgg).map(([name, count]) => ({ name, count }));

  return (
    <>
      <MapView
        ref={mapRef}
        manifest={manifest}
        cellGrid={cellGrid}
        markers={markers}
        showPoiLabels={showPoiLabels}
        onCellClick={(info) => setSelected(info)}
        onMarkerClick={() => { /* could focus row */ }}
      />
      <Sidebar
        manifest={manifest}
        typeCounts={typeCounts}
        totalCells={cells?.length ?? 0}
        pois={pois}
        markers={markers}
        selected={selected}
        showPoiLabels={showPoiLabels}
        onTogglePoiLabels={setShowPoiLabels}
        onAddMarker={(label, color) => {
          if (!selected) return;
          addMarker({ cellX: selected.cellX, cellY: selected.cellY, label, color });
        }}
        onRemoveMarker={removeMarker}
        onUpdateMarker={updateMarker}
        onFlyToCell={(cx, cy) => mapRef.current?.flyToCell(cx, cy)}
      />
    </>
  );
}
