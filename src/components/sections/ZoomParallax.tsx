import { useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform } from "framer-motion";
import SignalCanvas, { type Kind } from "@/components/SignalCanvas";

/** Optional real photograph under the instrument render. Hidden until the file exists in /public/images. */
function Photo({ src }: { src: string }) {
  const [ok, setOk] = useState(false);
  return (
    <img
      src={src} alt="" aria-hidden onLoad={() => setOk(true)} onError={() => setOk(false)}
      className="absolute inset-0 h-full w-full object-cover mix-blend-luminosity transition-opacity duration-700"
      style={{ opacity: ok ? 0.5 : 0 }}
    />
  );
}

/** Feathered edges so each tile dissolves into the particle background instead of sitting on it as a box. */
const FEATHER = "radial-gradient(ellipse 72% 72% at 50% 50%, #000 52%, transparent 100%)";

export default function ZoomParallax() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const idle = useMotionValue(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = reduced ? idle : scrollYProgress;
  const s4 = useTransform(p, [0, 1], [1, 4]);
  const s5 = useTransform(p, [0, 1], [1, 5]);
  const s6 = useTransform(p, [0, 1], [1, 6]);
  const s8 = useTransform(p, [0, 1], [1, 8]);
  const s9 = useTransform(p, [0, 1], [1, 9]);

  const tiles: { s: typeof s4; box: string; kind: Kind; label: string; photo: string; fmax?: number }[] = [
    { s: s4, box: "h-[25vh] w-[25vw]", kind: "mics", label: "MIC ARRAY · 4 × INMP441", photo: "night-fence.jpg" },
    { s: s5, box: "-top-[30vh] left-[5vw] h-[30vh] w-[35vw]", kind: "waveform", label: "RAW AUDIO · 400 ms", photo: "drone-sky.jpg" },
    { s: s6, box: "-top-[10vh] -left-[25vw] h-[45vh] w-[20vw]", kind: "srp", label: "SRP-PHAT BEARING", photo: "aerial-farmland.jpg" },
    { s: s5, box: "left-[27.5vw] h-[25vh] w-[25vw]", kind: "spectrum", label: "HARMONIC COMB", photo: "drone-sky.jpg" },
    { s: s6, box: "top-[27.5vh] left-[5vw] h-[25vh] w-[20vw]", kind: "track", label: "TWO-POST TRACK", photo: "aerial-farmland.jpg" },
    { s: s8, box: "top-[27.5vh] -left-[22.5vw] h-[25vh] w-[30vw]", kind: "spectrogram", label: "SPECTROGRAM · 0–4 kHz", photo: "night-fence.jpg" },
    { s: s9, box: "top-[22.5vh] left-[25vw] h-[15vh] w-[15vw]", kind: "spectrogram", label: "0–1.2 kHz", photo: "drone-sky.jpg", fmax: 1200 },
  ];

  return (
    <section id="zoom" ref={ref} aria-label="Sensor data zoom" style={{ height: reduced ? "100vh" : "300vh" }} className="relative">
      <div className="sticky top-0 h-screen overflow-hidden">
        {tiles.map(({ s, box, kind, label, photo, fmax }, i) => (
          <motion.div key={i} style={{ scale: s }} className="absolute top-0 flex h-full w-full items-center justify-center">
            <div className={`relative ${box}`} style={{ maskImage: FEATHER, WebkitMaskImage: FEATHER }}>
              <Photo src={`/images/${photo}`} />
              <SignalCanvas kind={kind} fmax={fmax} className="relative h-full w-full object-cover mix-blend-screen" />
              <span className="absolute left-2 top-1 font-mono text-[7px] text-[#8b99ab] sm:text-[10px]">{label}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}