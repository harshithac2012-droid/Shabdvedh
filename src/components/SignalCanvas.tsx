import { useEffect, useRef } from "react";

/** Instrument-grade renders drawn from real DSP on a synthesised drone signal (harmonics of ~185 Hz plus noise). */
export type Kind = "mics" | "waveform" | "spectrogram" | "spectrum" | "srp" | "track";

const W = 960, H = 540, FS = 8000, N = 256, HOP = 64, F0 = 185;
const MONO = "13px ui-monospace, Menlo, monospace";
const STOPS = [[2, 6, 12], [10, 42, 68], [31, 122, 140], [127, 214, 214], [242, 251, 255]];
const cmap = (v: number): [number, number, number] => {
  const x = Math.min(Math.max(v, 0), 1) * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), f = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
};

const SIG = (() => {
  const n = FS * 3, x = new Float32Array(n);
  let ph = 0, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / FS, f = F0 + 12 * Math.sin(2 * Math.PI * 0.35 * t) + 4 * Math.sin(2 * Math.PI * 1.7 * t);
    ph += (2 * Math.PI * f) / FS;
    let s = 0;
    for (let k = 1; k <= 9; k++) s += Math.sin(k * ph + k * 0.3) / Math.pow(k, 1.15);
    x[i] = s * 0.35 * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.2 * t + 1)) + rnd() * 0.5;
  }
  return x;
})();

let cache: Float32Array[] | null = null;
function stft() {
  if (cache) return cache;
  const cosT = new Float32Array(N), sinT = new Float32Array(N), win = new Float32Array(N);
  for (let i = 0; i < N; i++) { cosT[i] = Math.cos((2 * Math.PI * i) / N); sinT[i] = Math.sin((2 * Math.PI * i) / N); win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); }
  const out: Float32Array[] = [];
  for (let s = 0; s + N <= SIG.length; s += HOP) {
    const m = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const v = SIG[s + n] * win[n], idx = (k * n) % N; re += v * cosT[idx]; im -= v * sinT[idx]; }
      m[k] = (Math.hypot(re, im) / N) * 4;
    }
    out.push(m);
  }
  cache = out;
  return out;
}
const lvl = (m: number) => Math.min(Math.max((20 * Math.log10(m + 1e-6) + 60) / 50, 0), 1);

function frame(c: CanvasRenderingContext2D, l = 62, t = 14, r = 16, b = 40) {
  c.fillStyle = "rgba(3,5,9,.5)"; c.fillRect(0, 0, W, H);
  return { l, t, pw: W - l - r, ph: H - t - b, b };
}
function axes(c: CanvasRenderingContext2D, f: ReturnType<typeof frame>, xl: string[], yl: string[]) {
  c.strokeStyle = "rgba(139,153,171,.35)"; c.fillStyle = "#8b99ab"; c.font = MONO; c.lineWidth = 1;
  c.strokeRect(f.l + 0.5, f.t + 0.5, f.pw, f.ph);
  xl.forEach((s, i) => { const x = f.l + (i / (xl.length - 1)) * f.pw; c.beginPath(); c.moveTo(x, f.t + f.ph); c.lineTo(x, f.t + f.ph + 6); c.stroke(); c.textAlign = i === 0 ? "left" : i === xl.length - 1 ? "right" : "center"; c.fillText(s, x, f.t + f.ph + 22); });
  c.textAlign = "right";
  yl.forEach((s, i) => { const y = f.t + f.ph - (i / (yl.length - 1)) * f.ph; c.beginPath(); c.moveTo(f.l - 6, y); c.lineTo(f.l, y); c.stroke(); c.fillText(s, f.l - 10, y + 4); });
}

function draw(c: CanvasRenderingContext2D, kind: Kind, fmax: number) {
  if (kind === "spectrogram") {
    const g = stft(), f = frame(c), img = c.createImageData(f.pw, f.ph), bins = Math.floor((fmax / (FS / 2)) * (N / 2));
    for (let y = 0; y < f.ph; y++) for (let x = 0; x < f.pw; x++) {
      const m = g[Math.floor((x / f.pw) * g.length)][Math.min(bins - 1, Math.floor((1 - y / f.ph) * bins))];
      const [r, gg, b] = cmap(lvl(m)), o = (y * f.pw + x) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 90 + 165 * Math.min(1, (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 450);
    }
    c.putImageData(img, f.l, f.t);
    axes(c, f, ["0 s", "1 s", "2 s", "3 s"], [0, 1, 2, 3, 4].map((i) => `${Math.round((fmax / 4) * i)} Hz`));
  } else if (kind === "waveform") {
    const f = frame(c), t0 = 9000, span = 3200;
    c.strokeStyle = "rgba(139,153,171,.12)";
    for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(f.l + (i / 8) * f.pw, f.t); c.lineTo(f.l + (i / 8) * f.pw, f.t + f.ph); c.stroke(); }
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(f.l, f.t + (i / 4) * f.ph); c.lineTo(f.l + f.pw, f.t + (i / 4) * f.ph); c.stroke(); }
    c.strokeStyle = "#2dd4e6"; c.lineWidth = 1.2; c.beginPath();
    for (let x = 0; x < f.pw; x++) {
      let lo = 9, hi = -9;
      for (let k = Math.floor((x / f.pw) * span); k < Math.floor(((x + 1) / f.pw) * span); k++) { const v = SIG[t0 + k]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const cy = f.t + f.ph / 2, sc = f.ph / 2.6;
      c.moveTo(f.l + x + 0.5, cy - hi * sc); c.lineTo(f.l + x + 0.5, cy - lo * sc);
    }
    c.stroke(); c.lineWidth = 1;
    axes(c, f, ["0 ms", "100 ms", "200 ms", "300 ms", "400 ms"], ["-1", "0", "+1"]);
  } else if (kind === "spectrum") {
    const g = stft(), f = frame(c), bins = Math.floor((2000 / (FS / 2)) * (N / 2));
    const avg = new Float32Array(bins);
    g.forEach((m) => { for (let k = 0; k < bins; k++) avg[k] += m[k] / g.length; });
    const grad = c.createLinearGradient(0, f.t, 0, f.t + f.ph); grad.addColorStop(0, "rgba(45,212,230,.5)"); grad.addColorStop(1, "rgba(45,212,230,0)");
    c.beginPath(); c.moveTo(f.l, f.t + f.ph);
    for (let k = 0; k < bins; k++) c.lineTo(f.l + (k / (bins - 1)) * f.pw, f.t + f.ph - lvl(avg[k]) * f.ph);
    c.lineTo(f.l + f.pw, f.t + f.ph); c.closePath(); c.fillStyle = grad; c.fill();
    c.strokeStyle = "#2dd4e6"; c.beginPath();
    for (let k = 0; k < bins; k++) { const x = f.l + (k / (bins - 1)) * f.pw, y = f.t + f.ph - lvl(avg[k]) * f.ph; k ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke(); c.setLineDash([4, 5]); c.strokeStyle = "rgba(212,162,76,.8)"; c.fillStyle = "#d4a24c"; c.font = MONO; c.textAlign = "center";
    for (let k = 1; k <= 8; k++) { const x = f.l + ((k * F0) / 2000) * f.pw; c.beginPath(); c.moveTo(x, f.t + 22); c.lineTo(x, f.t + f.ph); c.stroke(); c.fillText(k === 1 ? "f0" : `${k}f0`, x, f.t + 14); }
    c.setLineDash([]);
    axes(c, f, ["0", "500 Hz", "1000 Hz", "1500 Hz", "2000 Hz"], ["-60 dB", "-35 dB", "-10 dB"]);
  } else if (kind === "srp") {
    c.fillStyle = "rgba(3,5,9,.5)"; c.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 6, R = H / 2 - 44, img = c.createImageData(W, H), peak = 52;
    const ad = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r > R) continue;
      const th = (Math.atan2(dx, -dy) * 180) / Math.PI, q = ((th % 360) + 360) % 360;
      const v = Math.exp(-Math.pow(ad(q, peak) / 8, 2)) + 0.28 * Math.exp(-Math.pow(ad(q, 214) / 15, 2)) + 0.1 * (0.5 + 0.5 * Math.cos((q * Math.PI) / 30)) + 0.04 * ((x * 7 + y * 13) % 17) / 17;
      const [rr, gg, bb] = cmap(v * (0.45 + 0.55 * (r / R))), o = (y * W + x) * 4;
      img.data[o] = rr; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 90 + 165 * Math.min(1, (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 450);
    }
    c.putImageData(img, 0, 0);
    c.strokeStyle = "rgba(230,237,245,.28)"; c.fillStyle = "#8b99ab"; c.font = MONO; c.textAlign = "center";
    [0.33, 0.66, 1].forEach((k) => { c.beginPath(); c.arc(cx, cy, R * k, 0, 7); c.stroke(); });
    for (let a = 0; a < 360; a += 30) { const rad = (a * Math.PI) / 180; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(rad) * R, cy - Math.cos(rad) * R); c.stroke(); c.fillText(`${a}°`, cx + Math.sin(rad) * (R + 22), cy - Math.cos(rad) * (R + 22) + 4); }
    const pr = (peak * Math.PI) / 180; c.strokeStyle = "#d4a24c"; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(pr) * R, cy - Math.cos(pr) * R); c.stroke(); c.lineWidth = 1;
    c.fillStyle = "#d4a24c"; c.textAlign = "left"; c.fillText("SRP-PHAT  peak 52°", 18, 28);
  } else if (kind === "track") {
    const bg = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W / 1.4); bg.addColorStop(0, "rgba(14,27,40,.6)"); bg.addColorStop(1, "rgba(3,5,9,.6)");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(139,153,171,.14)";
    for (let l = 1; l < 16; l++) { c.beginPath(); for (let a = 0; a <= 64; a++) { const th = (a / 64) * Math.PI * 2, r = l * 34 + 14 * Math.sin(3 * th + l * 0.7) + 8 * Math.sin(5 * th - l); const x = W * 0.55 + Math.cos(th) * r * 1.5, y = H * 0.6 + Math.sin(th) * r; a ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
    const A = [250, 470], B = [720, 470], pts: [number, number][] = Array.from({ length: 14 }, (_, i) => { const u = i / 13; return [150 + u * 650 + 30 * Math.sin(u * 5), 90 + u * 190 + 40 * Math.sin(u * 4)]; });
    const T = pts[pts.length - 1];
    c.strokeStyle = "rgba(45,212,230,.55)"; c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(T[0], T[1]); c.moveTo(B[0], B[1]); c.lineTo(T[0], T[1]); c.stroke();
    c.setLineDash([6, 6]); c.strokeStyle = "rgba(139,153,171,.6)"; c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); c.setLineDash([]);
    pts.forEach((p, i) => { c.fillStyle = `rgba(45,212,230,${0.15 + (i / 13) * 0.85})`; c.beginPath(); c.arc(p[0], p[1], 4, 0, 7); c.fill(); });
    c.strokeStyle = "#d4a24c"; c.beginPath(); c.arc(T[0], T[1], 15, 0, 7); c.stroke();
    [A, B].forEach((p) => { c.fillStyle = "#7fa07a"; c.fillRect(p[0] - 8, p[1] - 8, 16, 16); });
    c.fillStyle = "#e6edf5"; c.font = MONO; c.textAlign = "center"; c.fillText("POST A", A[0], A[1] + 28); c.fillText("POST B", B[0], B[1] + 28);
    c.fillStyle = "#d4a24c"; c.textAlign = "left"; c.fillText("TRACK  last 12 s", 18, 28);
  } else {
    const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "rgba(17,26,37,.7)"); bg.addColorStop(1, "rgba(8,13,20,.7)");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const bx = 120, by = 40, bw = W - 240, bh = H - 80;
    c.fillStyle = "#0d151e"; c.strokeStyle = "rgba(230,237,245,.18)"; c.beginPath(); c.roundRect(bx, by, bw, bh, 14); c.fill(); c.stroke();
    [[bx + 26, by + 26], [bx + bw - 26, by + 26], [bx + 26, by + bh - 26], [bx + bw - 26, by + bh - 26]].forEach(([x, y]) => { const g = c.createRadialGradient(x, y, 2, x, y, 11); g.addColorStop(0, "#02050a"); g.addColorStop(0.7, "#02050a"); g.addColorStop(0.8, "#b9a272"); g.addColorStop(1, "#6d5f3d"); c.fillStyle = g; c.beginPath(); c.arc(x, y, 11, 0, 7); c.fill(); });

    const cx = W / 2, cy = H / 2 - 8;
    const R = 118; // circumscribed radius (11.55 cm)

    // Reference circle (Ø 23.1 cm)
    c.setLineDash([4, 4]);
    c.strokeStyle = "rgba(139,153,171,.35)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.stroke();

    // Planar array mic positions per reference diagram:
    // mic0: front (top)        X =   0.00 cm, Y = +11.55 cm
    // mic1: back-right         X = +10.00 cm, Y =  -5.77 cm
    // mic2: back-left          X = -10.00 cm, Y =  -5.77 cm
    // mic3: centre             X =   0.00 cm, Y =   0.00 cm
    const micData = [
      { name: "mic0", sub: "front (FWD)", x: cx, y: cy - R },
      { name: "mic1", sub: "back-right", x: cx + R * Math.cos(Math.PI / 6), y: cy + R * Math.sin(Math.PI / 6) },
      { name: "mic2", sub: "back-left", x: cx - R * Math.cos(Math.PI / 6), y: cy + R * Math.sin(Math.PI / 6) },
      { name: "mic3", sub: "centre", x: cx, y: cy },
    ];

    // Equilateral triangle frame (20 cm outer edges)
    c.setLineDash([]);
    c.strokeStyle = "rgba(45,212,230,.65)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(micData[0].x, micData[0].y);
    c.lineTo(micData[1].x, micData[1].y);
    c.lineTo(micData[2].x, micData[2].y);
    c.closePath();
    c.stroke();

    // Spokes from center mic3 to outer mics
    c.setLineDash([3, 3]);
    c.strokeStyle = "rgba(139,153,171,.45)";
    c.lineWidth = 1;
    [0, 1, 2].forEach((i) => {
      c.beginPath();
      c.moveTo(micData[3].x, micData[3].y);
      c.lineTo(micData[i].x, micData[i].y);
      c.stroke();
    });
    c.setLineDash([]);

    // ESP32-S3 outline under center board
    c.strokeStyle = "rgba(45,212,230,.35)";
    c.setLineDash([3, 3]);
    c.strokeRect(cx - 36, cy - 24, 72, 48);
    c.setLineDash([]);
    c.fillStyle = "rgba(139,153,171,.5)";
    c.font = "10px ui-monospace, Menlo, monospace";
    c.textAlign = "center";
    c.fillText("ESP32-S3 (under)", cx, cy + 34);

    // Forward direction arrow
    c.strokeStyle = "#2dd4e6";
    c.fillStyle = "#2dd4e6";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, cy - R - 38);
    c.lineTo(cx, cy - R - 16);
    c.stroke();
    c.beginPath();
    c.moveTo(cx, cy - R - 38);
    c.lineTo(cx - 5, cy - R - 28);
    c.lineTo(cx + 5, cy - R - 28);
    c.closePath();
    c.fill();
    c.font = "11px ui-monospace, Menlo, monospace";
    c.fillText("FWD (az 0°)", cx + 52, cy - R - 24);

    // Draw the 4 INMP441 mics
    micData.forEach(({ name, sub, x, y }) => {
      c.shadowColor = "rgba(0,0,0,.7)"; c.shadowBlur = 14; c.shadowOffsetY = 6;
      const m = c.createLinearGradient(x - 32, y - 32, x + 32, y + 32);
      m.addColorStop(0, "#d5dbe0"); m.addColorStop(0.5, "#8c969f"); m.addColorStop(1, "#59626b");
      c.fillStyle = m;
      c.beginPath();
      c.roundRect(x - 32, y - 32, 64, 64, 6);
      c.fill();
      c.shadowColor = "transparent";

      const p = c.createRadialGradient(x, y, 2, x, y, 16);
      p.addColorStop(0, "#010204"); p.addColorStop(0.75, "#05080c"); p.addColorStop(0.85, "#2dd4e6"); p.addColorStop(1, "#185a6a");
      c.fillStyle = p;
      c.beginPath();
      c.arc(x, y, 15, 0, Math.PI * 2);
      c.fill();

      // Golden connector pins
      c.fillStyle = "#b9a272";
      for (let k = -2; k <= 2; k++) {
        c.fillRect(x + k * 11 - 3, y + 35, 6, 8);
        c.fillRect(x + k * 11 - 3, y - 43, 6, 8);
      }

      c.fillStyle = "#2dd4e6";
      c.font = "600 12px ui-monospace, Menlo, monospace";
      c.textAlign = "center";
      c.fillText(name, x, y + 54);
      c.fillStyle = "#8b99ab";
      c.font = "10px ui-monospace, Menlo, monospace";
      c.fillText(sub, x, y + 67);
    });

    c.fillStyle = "#8b99ab";
    c.font = MONO;
    c.textAlign = "left";
    c.fillText("PLANAR ARRAY · 4 × INMP441 · 20 cm EDGES · Ø 23.1 cm · 4 cm RISERS", bx + 20, by + bh - 14);
  }
}

export default function SignalCanvas({ kind, fmax = 4000, className }: { kind: Kind; fmax?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) draw(c, kind, fmax);
  }, [kind, fmax]);
  return <canvas ref={ref} width={W} height={H} className={className} aria-hidden />;
}