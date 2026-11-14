import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Ear, Radio, GitMerge, Brain, Siren, ShieldOff, WifiOff, Filter, MapPin, Crosshair } from "lucide-react";
import { ScrollText } from "@/components/ui/text-scroll-animation";
import { scrollToId } from "@/lib/smooth-scroll";

/** Scroll-linked entrance: rises, tilts flat and fades in as it climbs the viewport. */
function Reveal({ children, i = 0, className, role }: { children: ReactNode; i?: number; className?: string; role?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 100%", "start 62%"] });
  const a = Math.min(i * 0.12, 0.45);
  const y = useTransform(scrollYProgress, [a, a + 0.55], [70, 0]);
  const rotateX = useTransform(scrollYProgress, [a, a + 0.55], [16, 0]);
  const opacity = useTransform(scrollYProgress, [a, a + 0.25], [0, 1]);
  if (reduced) return <div ref={ref} role={role} className={className}>{children}</div>;
  return (
    <motion.div ref={ref} role={role} style={{ y, rotateX, opacity, transformPerspective: 900 }} className={className}>
      {children}
    </motion.div>
  );
}

function Title({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();
  const done = useMotionValue(1);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 95%", "start 55%"] });
  return (
    <h2 ref={ref} className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
      <ScrollText text={text} progress={reduced ? done : scrollYProgress} spread={30} />
    </h2>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="bg-[#030509]/45 px-5 py-28">
      <div className="mx-auto max-w-6xl">
        <Title text={title} />
        {intro && <Reveal className="mt-5 max-w-2xl text-[#b3c0cf]"><p>{intro}</p></Reveal>}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

const CARD = "border border-[#8b99ab]/25 bg-[#101a26]/80 backdrop-blur-sm";

const STEPS = [
  { Icon: Ear, t: "Listen", d: "4 INMP441 mics per post, on an upright board, pick up the propeller hum." },
  { Icon: Radio, t: "Detect and find direction", d: "An ESP32-S3 finds the harmonic comb and the bearing using GCC-PHAT." },
  { Icon: GitMerge, t: "Fuse", d: "The laptop crosses both posts' bearings for position and altitude." },
  { Icon: Brain, t: "Classify", d: "A CNN on log-mel features confirms drone versus tractor, wind or speech." },
  { Icon: Siren, t: "Alert and point", d: "The dashboard raises an alarm and a pan-tilt LED pointer turns to the drone." },
];
const STACK = [
  ["Hardware", ["2 × ESP32-S3", "8 × INMP441 I2S MEMS mics", "MG996R pan-tilt with a high-power LED"]],
  ["Firmware", ["C++ on Arduino / ESP-IDF", "FFT harmonic-comb detector", "GCC-PHAT and SRP-PHAT direction finding"]],
  ["Laptop", ["Python triangulation", "1D-CNN on log-mel features", "Web dashboard over Web Serial, no internet"]],
] as const;
const FEATURES = [
  { Icon: ShieldOff, t: "Passive", d: "Listens only and transmits nothing." },
  { Icon: WifiOff, t: "Offline", d: "All processing on the posts and one laptop, no cloud." },
  { Icon: Filter, t: "Clutter rejection", d: "Harmonic comb, pitch-stability checks and a CNN filter out wind, claps, speech, generators and tractors." },
  { Icon: MapPin, t: "Position", d: "Direction on the chip, 3D position and altitude from two posts." },
  { Icon: Crosshair, t: "Action", d: "Live dashboard alert and a pan-tilt LED pointer." },
];
const IMPACT = [
  ["Expected impact", "Early warning of a crossing, with the drone's direction and approximate position, so patrols reach drop points sooner. A low-cost layer that tells the few radar and jammer vehicles where to go."],
  ["Beneficiaries", "BSF and Punjab Police anti-narcotics teams on the western border, and the border communities harmed by the drug supply. Later: prisons, airports, power plants and large events that face rogue drones."],
  ["Scalability", "Every post is identical, built from off-the-shelf parts and works on its own. Coverage grows by adding posts along the fence, linked over LoRa or ESP-NOW to a sector base station."],
];
const ROADMAP = [
  ["Now", "Two-post prototype, firmware and dashboard. Detector and direction maths tested in simulation and on public drone recordings."],
  ["Next", "Record real drones and local clutter, train the CNN, measure range and accuracy outdoors."],
  ["Then", "Weatherproof solar posts on a LoRa mesh, and a field pilot with BSF / Punjab Police through iDEX."],
];

function Closing() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const done = useMotionValue(1);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 90%", "start 15%"] });
  return (
    <footer id="end" ref={ref} className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <p className="font-display text-[clamp(2.6rem,10vw,7rem)] font-bold tracking-tight">
        <ScrollText text="THANK YOU." progress={reduced ? done : scrollYProgress} spread={60} />
      </p>
      <p className="mt-4 text-sm text-[#b3c0cf]">ShabdaVedh · Colossus 3.0 idea submission</p>
      <button onClick={() => scrollToId("top")} className="mt-10 border border-[#8b99ab]/50 bg-[#0a1220]/40 px-6 py-3 backdrop-blur-sm hover:border-[#2dd4e6] hover:text-[#2dd4e6]">Back to top</button>
    </footer>
  );
}

export default function Content() {
  return (
    <>
      <Section id="how" title="From propeller hum to a pointed LED" intro="An operator sets two posts on tripods 30–100 m apart and claps once to calibrate. When a drone approaches, the dashboard goes from ACQUIRING to DRONE LOCKED with a beep, plots its track and altitude, and the LED pointer swings toward it.">
        <div role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(({ Icon, t, d }, i) => (
            <Reveal key={t} i={i} role="listitem" className={`${CARD} p-6`}>
              <span className="font-mono text-xs text-[#7fa07a]">Step {i + 1}</span>
              <Icon className="my-4 h-8 w-8 text-[#2dd4e6]" strokeWidth={1.25} />
              <h3 className="text-lg font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-[#b3c0cf]">{d}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section id="stack" title="Off-the-shelf parts, one laptop">
        <div role="list" className="grid gap-6 md:grid-cols-3">
          {STACK.map(([h, items], i) => (
            <Reveal key={h} i={i} role="listitem" className={`${CARD} p-6`}>
              <h3 className="text-xl font-semibold text-[#2dd4e6]">{h}</h3>
              <ul className="mt-4 space-y-2 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section id="different" title="Cheap, dense and passive">
        <div className="grid gap-12 lg:grid-cols-2">
          <div role="list" className="space-y-6">
            {FEATURES.map(({ Icon, t, d }, i) => (
              <Reveal key={t} i={i} role="listitem" className="flex gap-4">
                <Icon className="mt-1 h-6 w-6 shrink-0 text-[#7fa07a]" strokeWidth={1.5} />
                <div><h3 className="font-semibold">{t}</h3><p className="text-sm text-[#b3c0cf]">{d}</p></div>
              </Reveal>
            ))}
          </div>
          <div className="space-y-8">
            <Reveal className={`${CARD} p-6`}>
              <h3 className="font-semibold text-[#d4a24c]">Existing approach</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#b3c0cf]">Radar, RF scanners and EO/IR cameras (Punjab's Baaz Akh vehicles, DRDO's D4) work well but cost crores each, so only a handful watch a 553 km border. RF detection depends on the drone's radio link, and jammers only work in range.</p>
            </Reveal>
            <Reveal i={1} className={`${CARD} border-[#2dd4e6]/50 p-6`}>
              <h3 className="font-semibold text-[#2dd4e6]">Our innovation</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#b3c0cf]">Ukraine has scaled acoustic detection to about 10,000 sensors at roughly $400–500 each; we bring it to India with off-the-shelf parts and an on-chip detector. Our recordings start the drone-sound library that iDEX DRISHTI Challenge 38 (BEL) asks for.</p>
            </Reveal>
          </div>
        </div>
      </Section>

      <Section id="impact" title="Early warning, sooner patrols">
        <div role="list" className="grid gap-6 md:grid-cols-3">
          {IMPACT.map(([h, d], i) => (
            <Reveal key={h} i={i} role="listitem" className="border-l-2 border-[#7fa07a] bg-[#0a1220]/55 py-2 pl-5 pr-3 backdrop-blur-sm">
              <h3 className="text-lg font-semibold">{h}</h3><p className="mt-2 text-sm leading-relaxed text-[#b3c0cf]">{d}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section id="roadmap" title="Implementation roadmap">
        <div role="list" className="grid gap-6 md:grid-cols-3">
          {ROADMAP.map(([h, d], i) => (
            <Reveal key={h} i={i} role="listitem" className={`${CARD} ${i === 0 ? "border-[#2dd4e6]/60" : ""} p-6`}>
              <h3 className="font-mono text-sm text-[#d4a24c]">{h}</h3><p className="mt-3 text-sm leading-relaxed">{d}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Closing />
    </>
  );
}