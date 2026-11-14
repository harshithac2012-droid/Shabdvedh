"use client";

import { useRef, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { AudioWaveform, Mic, ScanSearch } from "lucide-react";
import { ScrollText } from "@/components/ui/text-scroll-animation";

/* Palette: navy #0a1220, charcoal #141b26, cyan #2dd4e6, tactical green #7fa07a, amber #d4a24c, text #e6edf5 / #8b99ab */

const GRID: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(139,153,171,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(139,153,171,.07) 1px,transparent 1px)",
  backgroundSize: "48px 48px",
};

/** A tall scroll track with one sticky viewport. Reduced motion: no pinning, final state shown. */
function Stage({
  tag,
  title,
  children,
  tall = "260vh",
}: {
  tag: string;
  title: string;
  tall?: string;
  children: (p: MotionValue<number>) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const done = useMotionValue(1);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = reduced ? done : scrollYProgress;
  const bar = useTransform(p, [0, 1], [0, 1]);

  return (
    <div ref={ref} style={{ height: reduced ? "auto" : tall }} className="relative">
      <div
        style={GRID}
        className={`${reduced ? "min-h-screen py-24" : "sticky top-0 h-screen"} flex flex-col overflow-hidden text-[#e6edf5]`}
      >
        <div className="flex items-center justify-between px-5 pt-6 font-mono text-[11px] tracking-wider text-[#8b99ab] sm:px-10">
          <span>{title}</span>
          <span className="text-[#2dd4e6]">{tag}</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 sm:px-10">{children(p)}</div>
        <div className="mx-5 mb-6 h-px bg-[#8b99ab]/20 sm:mx-10">
          <motion.div style={{ scaleX: bar }} className="h-px origin-left bg-[#2dd4e6]" />
        </div>
      </div>
    </div>
  );
}

/** Element that travels in from an offset (vw/vh) with a slight 3D turn. */
function FlyIn({
  p,
  from,
  at = 0,
  className,
  children,
}: {
  p: MotionValue<number>;
  from: [number, number];
  at?: number;
  className?: string;
  children: ReactNode;
}) {
  const r = [at, at + 0.5];
  const x = useTransform(p, r, [`${from[0]}vw`, "0vw"]);
  const y = useTransform(p, r, [`${from[1]}vh`, "0vh"]);
  const rotateY = useTransform(p, r, [from[0] > 0 ? -40 : 40, 0]);
  const opacity = useTransform(p, [at, at + 0.2], [0, 1]);
  return (
    <motion.div style={{ x, y, rotateY, opacity }} className={className}>
      {children}
    </motion.div>
  );
}

/* ---------- Stage 1 ---------- */
function Statement({ p }: { p: MotionValue<number> }) {
  return (
    <h2 className="max-w-5xl text-center text-[clamp(2.1rem,7.5vw,5.5rem)] font-semibold leading-[1.05] tracking-tight [text-wrap:balance]">
      <ScrollText text="WE DON'T SEE THE THREAT. WE HEAR IT." progress={p} spread={70} />
    </h2>
  );
}

/* ---------- Stage 2 ---------- */
const STEPS = [
  { word: "LISTEN.", Icon: Mic, from: [-60, 10] as [number, number], at: 0, spec: "4 MEMS mics per post pick up the propeller hum" },
  { word: "ANALYSE.", Icon: AudioWaveform, from: [0, 60] as [number, number], at: 0.12, spec: "Harmonic-comb detector and GCC-PHAT bearing on the chip" },
  { word: "IDENTIFY.", Icon: ScanSearch, from: [60, 10] as [number, number], at: 0.24, spec: "CNN on log-mel features: drone, not tractor or wind" },
];

function Acoustic({ p }: { p: MotionValue<number> }) {
  return (
    <div className="grid w-full max-w-5xl gap-4 [perspective:1000px] sm:grid-cols-3 sm:gap-6">
      {STEPS.map(({ word, Icon, from, at, spec }, i) => (
        <FlyIn key={word} p={p} from={from} at={at}>
          <div
            className={`relative flex items-center gap-4 border bg-[#141b26]/90 p-4 sm:flex-col sm:items-start sm:gap-6 sm:p-6 ${
              i === 1 ? "border-[#7fa07a]/50" : "border-[#8b99ab]/25"
            }`}
          >
            <span className="absolute -left-px -top-px h-3 w-3 border-l border-t border-[#2dd4e6]" />
            <span className="absolute -bottom-px -right-px h-3 w-3 border-b border-r border-[#2dd4e6]" />
            <Icon className="h-9 w-9 shrink-0 text-[#2dd4e6] sm:h-12 sm:w-12" strokeWidth={1.25} />
            <div>
              <div className="text-xl font-semibold tracking-tight sm:text-3xl">
                <ScrollText text={word} progress={p} spread={25} />
              </div>
              <p className="mt-1 text-[13px] leading-snug text-[#8b99ab] sm:mt-3 sm:text-sm">{spec}</p>
            </div>
          </div>
        </FlyIn>
      ))}
    </div>
  );
}

/* ---------- Stage 3 ---------- */
const A = { x: 70, y: 215 };
const B = { x: 330, y: 215 };
const T = { x: 215, y: 62 };

function Localise({ p }: { p: MotionValue<number> }) {
  const postA = useTransform(p, [0, 0.35], [-120, 0]);
  const postB = useTransform(p, [0, 0.35], [120, 0]);
  const postOpacity = useTransform(p, [0, 0.2], [0, 1]);
  const lineLen = useTransform(p, [0.35, 0.75], [0, 1]);
  const target = useTransform(p, [0.7, 0.9], [0, 1]);
  const baseline = useTransform(p, [0.25, 0.4], [0, 1]);

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
      <h2 className="text-center text-[clamp(1.8rem,6vw,4rem)] font-semibold leading-tight tracking-tight">
        <ScrollText text="FROM SOUND TO LOCATION." progress={p} spread={50} />
      </h2>
      <svg viewBox="0 0 400 250" role="img" aria-label="Two listening posts draw bearing lines that intersect at an aerial target on a 2D plane" className="w-full border border-[#8b99ab]/20 bg-[#0d1522]">
        <g stroke="#8b99ab" strokeOpacity=".12">
          {[50, 100, 150, 200].map((v) => (
            <g key={v}><line x1={v * 2} y1="0" x2={v * 2} y2="250" /><line x1="0" y1={v} x2="400" y2={v} /></g>
          ))}
        </g>
        <motion.line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#8b99ab" strokeDasharray="4 4" style={{ opacity: baseline }} />
        <motion.text x="200" y="233" textAnchor="middle" fontSize="9" fill="#8b99ab" style={{ opacity: baseline }}>baseline 30–100 m</motion.text>

        <motion.path d={`M${A.x} ${A.y} L${T.x} ${T.y}`} stroke="#2dd4e6" strokeWidth="1.5" fill="none" style={{ pathLength: lineLen }} />
        <motion.path d={`M${B.x} ${B.y} L${T.x} ${T.y}`} stroke="#2dd4e6" strokeWidth="1.5" fill="none" style={{ pathLength: lineLen }} />

        {[{ P: A, m: postA, n: "POST A" }, { P: B, m: postB, n: "POST B" }].map(({ P, m, n }) => (
          <motion.g key={n} style={{ x: m, opacity: postOpacity }}>
            <rect x={P.x - 7} y={P.y - 7} width="14" height="14" fill="#141b26" stroke="#7fa07a" strokeWidth="1.5" />
            <circle cx={P.x} cy={P.y} r="2.5" fill="#7fa07a" />
            <text x={P.x} y={P.y + 22} textAnchor="middle" fontSize="9" fill="#e6edf5">{n}</text>
          </motion.g>
        ))}

        <motion.g style={{ opacity: target, scale: target, transformOrigin: `${T.x}px ${T.y}px` }}>
          <circle cx={T.x} cy={T.y} r="14" fill="none" stroke="#d4a24c" strokeWidth="1" />
          <circle cx={T.x} cy={T.y} r="3.5" fill="#d4a24c" />
          <text x={T.x + 20} y={T.y + 3} fontSize="9" fill="#d4a24c">TARGET (2D FIX)</text>
        </motion.g>
      </svg>
      <p className="max-w-xl text-center text-sm text-[#8b99ab]">
        Each post measures a bearing. Where the two bearings cross is the estimated position on the ground plane.
      </p>
    </div>
  );
}

/** Drop this after the Zoom Parallax section. It uses native scroll, so it works with an existing Lenis instance. */
export default function ScrollSequence() {
  return (
    <section id="sequence" aria-label="How ShabdaVedh hears a drone">
      <Stage tag="STAGE 1 / 3" title="SHABDAVEDH  //  PASSIVE ACOUSTIC DETECTION" tall="240vh">
        {(p) => <Statement p={p} />}
      </Stage>
      <Stage tag="STAGE 2 / 3" title="SIGNAL CHAIN" tall="280vh">
        {(p) => <Acoustic p={p} />}
      </Stage>
      <Stage tag="STAGE 3 / 3" title="TWO-POST LOCALISATION" tall="300vh">
        {(p) => <Localise p={p} />}
      </Stage>
    </section>
  );
}
