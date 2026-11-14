import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AudioWaveform, BellRing, Brain, Crosshair, Ear, WifiOff } from "lucide-react";
import { ParticleWave } from "@/components/ui/particle-wave";
import { DroneLocator3D } from "@/components/ui/drone-locator-3d";
import {
  DEFAULT_DRONE, DEFAULT_POSTS, flight, readingsFor, solveFix,
  type Mode, type Posts, type Vec3, type DroneFix,
} from "@/lib/triangulate";
import { useShabdaVedh, BASELINE_M, fmt, pct, sendCmd } from "@/lib/useShabdaVedh";

const STAGES = [
  { icon: Ear, t: "LISTEN", d: "Each post captures sound with four INMP441 microphones on an ESP32-S3." },
  { icon: AudioWaveform, t: "ANALYSE", d: "The post looks for the steady harmonic comb that propellers produce." },
  { icon: Brain, t: "IDENTIFY", d: "A CNN on log-mel features separates drones from wind, speech and engines." },
  { icon: Crosshair, t: "LOCATE", d: "Post A gives the direction (θ). Post B gives elevation. Together they fix the position." },
  { icon: BellRing, t: "ALERT", d: "θ, elevation and distance reach the operator dashboard." },
];

function Reveal({ children, i = 0 }: { children: ReactNode; i?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => e.isIntersecting && (setOn(true), o.disconnect()), { threshold: 0.2 });
    o.observe(ref.current!);
    return () => o.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: `${i * 90}ms` }}
      className={`transition-all duration-700 motion-reduce:transition-none ${on ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
      {children}
    </div>
  );
}

const Row = ({ k, v, u }: { k: string; v: string; u?: string }) => (
  <div className="flex items-baseline justify-between border-b border-[#22408f]/30 py-2">
    <span className="font-mono text-xs text-[#8b99ab]">{k}</span>
    <span className="font-mono text-2xl text-[#2dd4e6]">
      {v}
      {u && v !== "nil" && !v.endsWith(u.trim()) && <span className="ml-1 text-xs text-[#8b99ab]">{u}</span>}
    </span>
  </div>
);

const Slider = ({ label, v, min, max, on }: { label: string; v: number; min: number; max: number; on: (n: number) => void }) => (
  <label className="mt-3 block font-mono text-[11px] text-[#8b99ab]">
    <div className="flex justify-between"><span>{label}</span><span className="text-[#c3cedb]">{Math.round(v)} m</span></div>
    <input type="range" min={min} max={max} value={v} onChange={(e) => on(+e.target.value)} className="mt-1 w-full accent-[#2dd4e6]" />
  </label>
);

export default function HowItWorks() {
  const [mode, setMode] = useState<Mode>("simulation");
  const [posts, setPosts] = useState<Posts>(DEFAULT_POSTS);
  const [drone, setDrone] = useState<Vec3>(DEFAULT_DRONE);
  const [auto, setAuto] = useState(false);
  const sim = mode === "simulation";

  // ParticleWave reads the `dark` class from <html>; without it the canvas turns white.
  useEffect(() => {
    const had = document.documentElement.classList.contains("dark");
    document.documentElement.classList.add("dark");
    return () => { if (!had) document.documentElement.classList.remove("dark"); };
  }, []);

  // optional automatic flight (simulation only)
  const postsRef = useRef(posts); postsRef.current = posts;
  useEffect(() => {
    if (!auto || !sim) return;
    const t0 = performance.now();
    const id = setInterval(() => setDrone(flight((performance.now() - t0) / 1000, postsRef.current)), 100);
    return () => clearInterval(id);
  }, [auto, sim]);

  // Hook for live ShabdaVedh stream
  const { connected, a, b, fix: liveFix, confA, confB } = useShabdaVedh();
  const [lastCmdStatus, setLastCmdStatus] = useState<string | null>(null);
  const handleCmd = async (cmd: string) => {
    setLastCmdStatus(`Sending "${cmd}"...`);
    const ok = await sendCmd(cmd);
    setLastCmdStatus(ok ? `Sent "${cmd}"` : `Failed to send "${cmd}"`);
    setTimeout(() => setLastCmdStatus(null), 3000);
  };

  const simReadings = useMemo(() => readingsFor(drone, posts), [drone, posts]);
  const simFix = useMemo(() => solveFix(simReadings, posts), [simReadings, posts]);

  // Live geometry: Post A at [0, 0], Post B at [-BASELINE_M, 0]
  const livePosts: Posts = useMemo(() => ({ a: [0, 0], b: [-BASELINE_M, 0] }), []);
  const activePosts = sim ? posts : livePosts;

  // Live drone fix for arcs in DroneLocator3D
  const liveDroneFix: DroneFix | null = useMemo(() => {
    if (!liveFix) return null;
    return {
      // Posts face North, post B is to the West: "+az toward B" is anticlockwise, so compass = -az.
      thetaDeg: ((-Math.atan2(liveFix.y, liveFix.x) * 180 / Math.PI) % 360 + 360) % 360,
      elevationDeg: Math.atan2(liveFix.z, liveFix.ground) * 180 / Math.PI,
      distanceM: liveFix.range,
      groundRangeM: liveFix.ground,
      altitudeM: liveFix.z,
      x: -liveFix.y,
      y: liveFix.x,
      z: liveFix.z,
    };
  }, [liveFix, a]);

  const fix = sim ? simFix : liveDroneFix;

  // In live mode, mapping is (-fix.y, fix.z, -fix.x). When fix is null, target is null (drone hidden)
  const liveTarget = useMemo<Vec3 | null>(() => {
    if (!liveFix) return null;
    return { x: -liveFix.y, y: liveFix.x, z: liveFix.z };
  }, [liveFix]);

  const target = sim ? drone : liveTarget;

  const sep = Math.hypot(activePosts.b[0] - activePosts.a[0], activePosts.b[1] - activePosts.a[1]);
  const setSep = (d: number) => setPosts((p) => {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy) || 1;
    return { ...p, b: [p.a[0] + (dx / L) * d, p.a[1] + (dy / L) * d] };
  });
  const movePost = (w: "a" | "b", x: number, y: number) => setPosts((p) => {
    const n = { ...p, [w]: [x, y] } as Posts;
    return Math.hypot(n.a[0] - n.b[0], n.a[1] - n.b[1]) < 10 ? p : n; // keep the posts at least 10 m apart
  });
  const reset = () => { setPosts(DEFAULT_POSTS); setDrone(DEFAULT_DRONE); setAuto(false); };
  const f = (n: number | undefined, d = 1) => (n === undefined ? "--" : n.toFixed(d));

  return (
    <div className="dark relative min-h-screen bg-black text-[#c3cedb]">
      {/* Background: black with a navy glow rising from the bottom */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-black">
        <div className="absolute inset-0 opacity-40"><ParticleWave /></div>
        <div className="absolute inset-0" style={{ background: "radial-gradient(90% 70% at 50% 100%, rgba(10,25,70,.8), transparent 70%), radial-gradient(120% 90% at 50% 40%, transparent 45%, rgba(0,0,0,.8))" }} />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-24 pt-8">
        <Link to="/" className="inline-flex items-center gap-2 font-mono text-sm text-[#2dd4e6] hover:text-white">
          <ArrowLeft size={14} /> SHABDAVEDH
        </Link>

        <header className="py-20">
          <p className="font-mono text-xs tracking-[0.2em] text-[#2dd4e6]">HOW IT WORKS</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-bold leading-tight md:text-7xl">From sound to a position in the sky.</h1>
          <p className="mt-5 max-w-xl text-[#c3cedb]">Two listening posts hear the drone, measure angles, and the computer turns those angles into a direction, an elevation and a distance.</p>
        </header>

        <div className="grid gap-4 md:grid-cols-5">
          {STAGES.map((s, i) => (
            <Reveal key={s.t} i={i}>
              <div className="h-full border border-[#22408f]/40 bg-[#050b1f]/75 p-5 backdrop-blur-sm transition hover:-translate-y-1 hover:border-[#2dd4e6]">
                <s.icon className="text-[#2dd4e6]" size={22} />
                <p className="mt-4 font-mono text-xs text-[#8b99ab]">0{i + 1}</p>
                <h3 className="text-lg font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm text-[#8b99ab]">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <section className="mt-28">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.2em] text-[#2dd4e6]">3D LOCATOR</p>
            <h2 className="mt-2 text-3xl font-bold md:text-5xl">Two posts. One position.</h2>
          </Reveal>
          <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1fr_340px]">
            <div>
              <DroneLocator3D
                target={target} fix={fix} posts={activePosts} simulated={sim} editable={sim}
                onMovePost={movePost} onMoveTarget={(v) => { setAuto(false); setDrone(v); }}
                className="h-[68vh] min-h-[420px]"
              />
              {sim && (
                <div className="mt-4 border border-[#22408f]/40 bg-[#050b1f]/75 p-5 backdrop-blur-sm">
                  <p className="font-mono text-[11px] tracking-widest text-[#2dd4e6]">SIMULATION CONTROLS</p>
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    <Slider label="Drone · East" v={drone.x} min={-250} max={250} on={(n) => { setAuto(false); setDrone((d) => ({ ...d, x: n })); }} />
                    <Slider label="Drone · North" v={drone.y} min={-100} max={300} on={(n) => { setAuto(false); setDrone((d) => ({ ...d, y: n })); }} />
                    <Slider label="Drone · Altitude" v={drone.z} min={0} max={150} on={(n) => { setAuto(false); setDrone((d) => ({ ...d, z: n })); }} />
                    <Slider label="Distance between posts" v={sep} min={10} max={150} on={setSep} />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => setAuto((a) => !a)}
                      className={`border px-4 py-2 font-mono text-xs ${auto ? "border-[#2dd4e6] bg-[#2dd4e6] text-black" : "border-[#22408f]/40 text-[#8b99ab] hover:text-white"}`}>
                      AUTO FLIGHT {auto ? "ON" : "OFF"}
                    </button>
                    <button onClick={reset} className="border border-[#22408f]/40 px-4 py-2 font-mono text-xs text-[#8b99ab] hover:text-white">RESET</button>
                  </div>
                </div>
              )}
            </div>

            <aside className="border border-[#22408f]/40 bg-[#050b1f]/75 p-5 backdrop-blur-sm">
              <div className="flex gap-1">
                {(["simulation", "live"] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 border px-3 py-2 font-mono text-xs uppercase ${mode === m ? "border-[#2dd4e6] bg-[#2dd4e6] text-black" : "border-[#22408f]/40 text-[#8b99ab] hover:text-white"}`}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between font-mono text-[11px]">
                {sim ? (
                  <span className="text-[#8b99ab]">SIMULATION · drag in 3D view or sliders</span>
                ) : connected ? (
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                    </span>
                    LIVE · SSE Stream (port 8000)
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-300">
                    <WifiOff size={12} />
                    Waiting for bridge (localhost:8000)
                  </span>
                )}
              </div>

              <div className="mt-4">
                <Row
                  k="θ  AZIMUTH (POST A)"
                  v={sim ? f(simFix?.thetaDeg) : fmt(a?.az, 1, "°")}
                  u={sim ? "°" : undefined}
                />
                <Row
                  k="ELEVATION"
                  v={sim ? f(simFix?.elevationDeg) : fmt(a?.el, 1, "°")}
                  u={sim ? "°" : undefined}
                />
                <Row
                  k="DISTANCE"
                  v={sim ? f(simFix?.distanceM, 0) : fmt(liveFix?.range, 2, " m")}
                  u={sim ? "m" : undefined}
                />
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs text-[#8b99ab]">
                  <span>Ground range<br /><b className="text-[#c3cedb]">{sim ? `${f(simFix?.groundRangeM, 0)} m` : fmt(liveFix?.ground, 2, " m")}</b></span>
                  <span>Altitude<br /><b className="text-[#c3cedb]">{sim ? `${f(simFix?.altitudeM, 0)} m` : fmt(liveFix?.z, 2, " m")}</b></span>
                </div>
                {!sim && (
                  <div className="mt-2 font-mono text-[11px] text-[#8b99ab]">
                    Ray miss: <span className="text-[#2dd4e6]">{fmt(liveFix?.miss, 3, " m")}</span>
                  </div>
                )}
              </div>

              <div className="mt-5 border-t border-[#22408f]/30 pt-3 font-mono text-[11px] leading-relaxed text-[#8b99ab]">
                RAW READINGS<br />
                {sim ? (
                  <>
                    A · azimuth {f(simReadings?.directionPost.azimuthDeg)}°<br />
                    B · azimuth {f(simReadings?.elevationPost.azimuthDeg)}° · elevation {f(simReadings?.elevationPost.elevationDeg)}°<br />
                    Baseline A–B {sep.toFixed(0)} m
                  </>
                ) : (
                  <>
                    A · azimuth {fmt(a?.az, 1, "°")} · conf <span className={(confA ?? 0) >= 0.75 ? "text-emerald-400" : "text-amber-400"}>{pct(confA)}</span> {!a && <span className="text-amber-400">({(confA ?? 0) < 0.75 ? "<75%" : "silent"})</span>}<br />
                    B · azimuth {fmt(b?.az, 1, "°")} · elevation {fmt(b?.el, 1, "°")} · conf <span className={(confB ?? 0) >= 0.75 ? "text-emerald-400" : "text-amber-400"}>{pct(confB)}</span> {!b && <span className="text-amber-400">({(confB ?? 0) < 0.75 ? "<75%" : "silent"})</span>}<br />
                    Baseline A–B {BASELINE_M * 100} cm
                  </>
                )}
              </div>

              {!sim && (
                <div className="mt-4 border-t border-[#22408f]/30 pt-3 font-mono text-[11px]">
                  <p className="mb-2 text-[#2dd4e6]">POST CONTROLS & TEST</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => handleCmd("y")}
                      className="border border-[#22408f]/50 bg-[#050b1f] px-2 py-1 text-[10px] text-[#c3cedb] transition hover:border-[#2dd4e6] hover:text-[#2dd4e6]"
                    >
                      CLAP TEST ON (y)
                    </button>
                    <button
                      onClick={() => handleCmd("n")}
                      className="border border-[#22408f]/50 bg-[#050b1f] px-2 py-1 text-[10px] text-[#c3cedb] transition hover:border-[#2dd4e6] hover:text-[#2dd4e6]"
                    >
                      CLAP TEST OFF (n)
                    </button>
                    <button
                      onClick={() => handleCmd("A c")}
                      className="border border-[#22408f]/50 bg-[#050b1f] px-2 py-1 text-[10px] text-[#c3cedb] transition hover:border-[#2dd4e6] hover:text-[#2dd4e6]"
                    >
                      CALIBRATE A (c)
                    </button>
                    <button
                      onClick={() => handleCmd("B c")}
                      className="border border-[#22408f]/50 bg-[#050b1f] px-2 py-1 text-[10px] text-[#c3cedb] transition hover:border-[#2dd4e6] hover:text-[#2dd4e6]"
                    >
                      CALIBRATE B (c)
                    </button>
                    <button
                      onClick={() => handleCmd("+")}
                      className="border border-[#22408f]/50 bg-[#050b1f] px-2 py-1 text-[10px] text-[#c3cedb] transition hover:border-[#2dd4e6] hover:text-[#2dd4e6]"
                    >
                      GAIN UP (+)
                    </button>
                    <button
                      onClick={() => handleCmd("-")}
                      className="border border-[#22408f]/50 bg-[#050b1f] px-2 py-1 text-[10px] text-[#c3cedb] transition hover:border-[#2dd4e6] hover:text-[#2dd4e6]"
                    >
                      GAIN DOWN (-)
                    </button>
                  </div>
                  {lastCmdStatus && (
                    <p className="mt-2 text-[10px] text-[#2dd4e6]">{lastCmdStatus}</p>
                  )}
                </div>
              )}

              {sim && !simFix && <p className="mt-3 font-mono text-[11px] text-amber-300">Bearings do not cross in front of both posts. No fix.</p>}
              {!sim && !liveFix && <p className="mt-3 font-mono text-[11px] text-amber-300">Waiting for 75%+ confidence on both posts. Showing nil.</p>}
              {!sim && !connected && (
                <div className="mt-3 rounded border border-amber-500/30 bg-amber-950/20 p-2 font-mono text-[10px] text-amber-200">
                  <span className="font-semibold text-amber-300">To start live tracking:</span><br />
                  1. Run <code className="text-white">python bridge.py</code><br />
                  2. If hardware is offline, run <code className="text-white">python sim.py</code>
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className="mt-28 grid gap-4 md:grid-cols-3">
          {[
            ["HARDWARE", "Two ESP32-S3 posts stream UDP angle packets on port 5005.", "UDP 5005 Active"],
            ["BACKEND BRIDGE", `bridge.py with 75% rule & ${BASELINE_M * 100} cm baseline.`, !sim && connected ? "LIVE STREAM ACTIVE" : "READY (Run bridge.py)"],
            ["DASHBOARD", "Real-time 3D triangulation, 100ms throttle & 600ms hold.", "ONLINE"]
          ].map(([t, d, s], i) => (
            <Reveal key={t} i={i}>
              <div className="border border-[#22408f]/40 bg-[#050b1f]/75 p-5 backdrop-blur-sm">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-[#8b99ab]">{d}</p>
                <p className={`mt-3 font-mono text-xs ${s.includes("Run") ? "text-amber-300" : "text-[#2dd4e6]"}`}>{s}</p>
              </div>
            </Reveal>
          ))}
        </section>
      </div>
    </div>
  );
}