import { useEffect, useRef, useState } from "react";

// Live data from the two ESP32 posts, through bridge.py (UDP 5005 -> SSE on localhost:8000).
// The Vite dev server proxies /events, /latest and /cmd to the bridge (vite.config.ts).

export const BASELINE_M = 0.8;   // post B is 0.80 m from post A (centre mic to centre mic)
export const CONF_MIN = 0.75;    // a post below this confidence is ignored
const HOLD_MS = 600;             // keep the last fix this long, so the 3D view does not flicker
const THROTTLE_MS = 100;         // at most 10 React updates a second
const SILENT_MS = 1000;          // a post not heard for this long is shown as silent

export interface PostPacket {
  post: "A" | "B";
  st?: string;          // LOCKED / TEST_LOCK / ACQUIRING / CLUTTER / IDLE
  az: number;           // bearing (deg): 0 = straight out of the box, + = toward post B
  el: number;           // elevation (deg)
  conf: number | null;  // 0..1
  good: boolean;        // locked and conf >= 75 %
  p?: number;           // drone probability
  [k: string]: unknown;
}

export interface LiveFix {
  range: number;   // m from post A
  x: number;       // m straight out of the boxes
  y: number;       // m toward post B
  z: number;       // m up
  miss: number;    // m between the two bearing lines (small = posts agree)
  ground: number;  // horizontal distance from post A
}

export const fmt = (v: number | null | undefined, d = 1, unit = "") =>
  v === null || v === undefined || !Number.isFinite(v) ? "nil" : `${v.toFixed(d)}${unit}`;
export const pct = (c: number | null | undefined) =>
  c === null || c === undefined || !Number.isFinite(c) ? "nil" : `${Math.round(c * 100)}%`;

export async function sendCmd(cmd: string): Promise<boolean> {
  try {
    const r = await fetch("/cmd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd }) });
    return r.ok;
  } catch {
    return false;
  }
}

export function useShabdaVedh() {
  const [state, setState] = useState<{
    connected: boolean; a: PostPacket | null; b: PostPacket | null;
    fix: LiveFix | null; confA: number | null; confB: number | null;
  }>({ connected: false, a: null, b: null, fix: null, confA: null, confB: null });

  const live = useRef({
    a: null as PostPacket | null, b: null as PostPacket | null,
    rxA: 0, rxB: 0, fix: null as LiveFix | null, fixAt: 0, connected: false,
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | undefined;
    const open = () => {
      es = new EventSource("/events");
      es.onopen = () => { live.current.connected = true; };
      es.onerror = () => {
        live.current.connected = false;
        es?.close();
        retry = window.setTimeout(open, 1500);   // bridge not running yet: keep trying
      };
      es.onmessage = (e) => {
        let m: { type?: string; post?: string; packet?: PostPacket; fix?: Omit<LiveFix, "ground"> | null };
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type !== "update" || !m.packet) return;
        const L = live.current, now = performance.now();
        L.connected = true;
        if (m.post === "A") { L.a = m.packet; L.rxA = now; } else if (m.post === "B") { L.b = m.packet; L.rxB = now; }
        if (m.fix) { L.fix = { ...m.fix, ground: Math.hypot(m.fix.x, m.fix.y) }; L.fixAt = now; }
      };
    };
    open();

    const tick = window.setInterval(() => {
      const L = live.current, now = performance.now();
      const aLive = L.a && now - L.rxA < SILENT_MS ? L.a : null;
      const bLive = L.b && now - L.rxB < SILENT_MS ? L.b : null;
      setState({
        connected: L.connected,
        a: aLive && aLive.good ? aLive : null,      // null = below 75 % or silent
        b: bLive && bLive.good ? bLive : null,
        confA: aLive ? aLive.conf : null,
        confB: bLive ? bLive.conf : null,
        fix: L.fix && now - L.fixAt < HOLD_MS ? L.fix : null,
      });
    }, THROTTLE_MS);

    return () => { es?.close(); window.clearTimeout(retry); window.clearInterval(tick); };
  }, []);

  return state;
}
