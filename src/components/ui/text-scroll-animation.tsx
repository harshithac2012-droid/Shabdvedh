"use client";

import { motion, useTransform, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";

/** Deterministic pseudo-random in [-1, 1] so SSR and client agree (no hydration mismatch). */
const seeded = (i: number, k: number) => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

interface CharProps {
  char: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
  spread: number;
}

/** One character. Position, 3D rotation, depth and opacity are all driven by scroll progress. */
function Char({ char, index, total, progress, spread }: CharProps) {
  const start = (index / total) * 0.25;
  const range = [start, start + 0.5];

  const x = useTransform(progress, range, [`${seeded(index, 1) * spread}vw`, "0vw"]);
  const y = useTransform(progress, range, [`${seeded(index, 2) * spread * 0.6}vh`, "0vh"]);
  const rotateX = useTransform(progress, range, [seeded(index, 3) * 75, 0]);
  const rotateY = useTransform(progress, range, [seeded(index, 4) * 75, 0]);
  const scale = useTransform(progress, range, [0.45 + Math.abs(seeded(index, 5)) * 0.4, 1]);
  const opacity = useTransform(progress, [start, start + 0.15], [0, 1]);

  return (
    <motion.span
      aria-hidden
      className="inline-block will-change-transform"
      style={{ x, y, rotateX, rotateY, scale, opacity, transformStyle: "preserve-3d" }}
    >
      {char}
    </motion.span>
  );
}

export interface ScrollTextProps {
  text: string;
  /** 0 → 1. Characters are scattered at 0 and fully assembled by ~0.75. */
  progress: MotionValue<number>;
  /** Scatter distance in vw at progress 0. */
  spread?: number;
  className?: string;
}

/** Character-by-character scroll assembly. The accessible text is exposed once via sr-only. */
export function ScrollText({ text, progress, spread = 60, className }: ScrollTextProps) {
  const words = text.split(" ");
  const total = text.replace(/ /g, "").length;
  let index = 0;

  return (
    <span className={cn("block [perspective:900px]", className)}>
      <span className="sr-only">{text}</span>
      {words.map((word, w) => (
        <span key={w} className="mr-[0.28em] inline-block whitespace-nowrap last:mr-0" aria-hidden>
          {word.split("").map((c) => {
            const i = index++;
            return <Char key={i} char={c} index={i} total={total} progress={progress} spread={spread} />;
          })}
        </span>
      ))}
    </span>
  );
}
