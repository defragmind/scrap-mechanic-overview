import { useEffect, useState, useCallback } from "react";
import type { Marker } from "./types";

// v1 was a single global key — markers from one world bled onto another.
// v2 scopes storage by world seed; on first contact with a different seed the
// old markers are archived (not deleted) under sm_overview_markers_oldworld.
const KEY_V1 = "sm_overview_markers_v1";
const keyV2 = (seed: number) => `sm_overview_markers_v2:${seed}`;
const KEY_ARCHIVE = "sm_overview_markers_oldworld";

function readList(key: string): Marker[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch { /* ignore */ }
  return null;
}

export function useMarkers(seed: number | null) {
  const [markers, setMarkers] = useState<Marker[]>([]);

  useEffect(() => {
    if (seed == null) return;
    const stored = readList(keyV2(seed));
    if (stored) { setMarkers(stored); return; }
    // no markers for THIS world yet — archive any v1 leftovers once, then start clean
    if (readList(KEY_V1)) {
      try {
        const raw = localStorage.getItem(KEY_V1);
        if (raw && !localStorage.getItem(KEY_ARCHIVE)) localStorage.setItem(KEY_ARCHIVE, raw);
        localStorage.removeItem(KEY_V1);
      } catch { /* ignore */ }
    }
    setMarkers([]);
  }, [seed]);

  useEffect(() => {
    if (seed == null) return;
    try { localStorage.setItem(keyV2(seed), JSON.stringify(markers)); } catch { /* ignore */ }
  }, [markers, seed]);

  const addMarker = useCallback((m: Omit<Marker, "id" | "createdAt">) => {
    const full: Marker = { ...m, id: crypto.randomUUID(), createdAt: Date.now() };
    setMarkers(prev => [...prev, full]);
    return full;
  }, []);

  const updateMarker = useCallback((id: string, patch: Partial<Marker>) => {
    setMarkers(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const removeMarker = useCallback((id: string) => {
    setMarkers(prev => prev.filter(m => m.id !== id));
  }, []);

  return { markers, addMarker, updateMarker, removeMarker };
}
