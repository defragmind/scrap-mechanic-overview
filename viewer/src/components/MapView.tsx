import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import L from "leaflet";
import type { Manifest, Marker, Cell, CellInfo } from "../lib/types";
import { cellInfo, pxPerCellAtMax } from "../lib/cells";

export interface MapViewHandle {
  flyToCell: (cellX: number, cellY: number, zoom?: number) => void;
}

interface Props {
  manifest: Manifest;
  cellGrid: Map<number, Map<number, Cell>> | null;
  markers: Marker[];
  showPoiLabels: boolean;
  onCellClick: (info: CellInfo, latlng: L.LatLng) => void;
  onMarkerClick: (m: Marker) => void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(
  { manifest, cellGrid, markers, showPoiLabels, onCellClick, onMarkerClick },
  ref
) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const poiLayer = useRef<L.LayerGroup | null>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);

  // keep latest callbacks without re-running the init effect
  const cb = useRef({ onCellClick, onMarkerClick });
  cb.current = { onCellClick, onMarkerClick };

  // --- init map once manifest is available ---
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const { fullW, fullH, maxZoom, bounds } = manifest;
    const map = L.map(elRef.current, {
      crs: L.CRS.Simple,
      minZoom: 0,
      maxZoom: maxZoom + 1,
      zoomSnap: 1,
      wheelPxPerZoomLevel: 120,
      attributionControl: true,
    });
    mapRef.current = map;

    const southWest = map.unproject([0, fullH], maxZoom);
    const northEast = map.unproject([fullW, 0], maxZoom);
    const mapBounds = L.latLngBounds(southWest, northEast);

    L.tileLayer("/tiles/{z}/{x}/{y}.webp", {
      tileSize: manifest.tileSize ?? 256,
      noWrap: true,
      bounds: mapBounds,
      minNativeZoom: 0,
      maxNativeZoom: maxZoom,
      // load tiles during pans (not only after) and keep more off-screen —
      // kills the torn/repeated-columns look while panning
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 6,
      attribution:
        '<a target="_blank" href="https://github.com/the1killer/sm_overview">sm_overview</a> · React viewer',
    }).addTo(map);

    map.setMaxBounds(mapBounds.pad(0.2));
    map.fitBounds(mapBounds);

    markerLayer.current = L.layerGroup().addTo(map);
    poiLayer.current = L.layerGroup().addTo(map);

    const ppc = pxPerCellAtMax(manifest);
    const cellFromLatLng = (latlng: L.LatLng) => {
      const p = map.project(latlng, maxZoom);
      const cellX = Math.floor(p.x / ppc) + bounds.xMin;
      const cellY = bounds.yMax - Math.floor(p.y / ppc);
      return { cellX, cellY };
    };

    map.on("click", (e: L.LeafletMouseEvent) => {
      const { cellX, cellY } = cellFromLatLng(e.latlng);
      const cell = cellGridRef.current?.get(cellX)?.get(cellY);
      if (!cell) return;
      const info = cellInfo(cell);
      cb.current.onCellClick(info, e.latlng);
      if (clickMarkerRef.current) clickMarkerRef.current.remove();
      clickMarkerRef.current = L.marker(e.latlng, { icon: clickIcon }).addTo(map);
      clickMarkerRef.current.bindPopup(popupHtml(info)).openPopup();
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  // cellGrid in a ref so the click handler always sees the latest
  const cellGridRef = useRef(cellGrid);
  cellGridRef.current = cellGrid;

  // --- render user markers ---
  useEffect(() => {
    const lg = markerLayer.current;
    if (!lg) return;
    lg.clearLayers();
    const map = mapRef.current!;
    const { bounds, maxZoom } = manifest;
    const ppc = pxPerCellAtMax(manifest);
    for (const m of markers) {
      const px = (m.cellX - bounds.xMin + 0.5) * ppc;
      const py = (bounds.yMax - m.cellY + 0.5) * ppc;
      const latlng = map.unproject([px, py], maxZoom);
      const icon = L.divIcon({
        className: "user-marker",
        html: `<span class="um-dot" style="background:${esc(m.color)}"></span><span class="um-label">${esc(m.label || "marker")}</span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const mk = L.marker(latlng, { icon });
      mk.on("click", () => cb.current.onMarkerClick(m));
      lg.addLayer(mk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, manifest]);

  // --- render POI labels ---
  useEffect(() => {
    const lg = poiLayer.current;
    if (!lg) return;
    lg.clearLayers();
    if (!showPoiLabels) return;
    const map = mapRef.current!;
    const { bounds, maxZoom } = manifest;
    const ppc = pxPerCellAtMax(manifest);
    for (const p of manifest.pois) {
      const cx = p.x + p.size / 2 - 0.5;
      const cy = p.y + p.size / 2 - 0.5;
      const px = (cx - bounds.xMin) * ppc;
      const py = (bounds.yMax - cy) * ppc;
      const latlng = map.unproject([px, py], maxZoom);
      const icon = L.divIcon({
        className: "poi-label",
        html: `<span>${esc(poiShort(p.name))}</span>`,
      });
      L.marker(latlng, { icon }).addTo(lg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPoiLabels, manifest]);

  useImperativeHandle(ref, () => ({
    flyToCell: (cellX, cellY, zoom) => {
      const map = mapRef.current;
      if (!map) return;
      const { bounds, maxZoom } = manifest;
      const ppc = pxPerCellAtMax(manifest);
      const px = (cellX - bounds.xMin + 0.5) * ppc;
      const py = (bounds.yMax - cellY + 0.5) * ppc;
      const latlng = map.unproject([px, py], maxZoom);
      map.flyToBounds(L.latLngBounds([latlng]), { maxZoom: zoom ?? maxZoom, duration: 0.6 });
      map.panTo(latlng, { animate: true });
    },
  }));

  return <div id="map" ref={elRef} />;
});

const clickIcon = L.divIcon({ className: "click-marker", html: '<span class="cm-ring"></span>', iconSize: [20, 20], iconAnchor: [10, 10] });

function popupHtml(info: CellInfo): string {
  const type = info.type === "NONE" ? "NONE (Road/Cliff)" : info.type;
  return `<div class="cell-popup">
    <div><b>Cell ${info.cellX}, ${info.cellY}</b></div>
    <div>Type: ${esc(type)}</div>
    <div>TileID: ${info.tileid}</div>
    <div>Rotation: ${info.rotation}</div>
    ${info.poi ? `<div>POI: ${esc(info.poi)}</div>` : ""}
    <div class="popup-hint">Use the sidebar to add a marker here.</div>
  </div>`;
}

function poiShort(name: string): string {
  return name.replace(/^POI_/, "").replace(/_(XL|LARGE|MEDIUM|SMALL)$/, "").replace(/_/g, " ");
}
