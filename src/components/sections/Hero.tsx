import { useRef } from "react";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";
import KineticGrid from "@/components/ui/kinetic-grid";
import { scrollToId } from "@/lib/smooth-scroll";
import { useNavigate } from "react-router-dom";
import { AntiMetalButton } from "@/components/ui/anti-metal-button";

export default function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0vh", reduced ? "0vh" : "-18vh"]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, reduced ? 1 : 0]);
  const navigate = useNavigate();
  return (
    <section id="top" ref={ref} className="relative flex min-h-screen items-center px-5 pt-14">
      {/* KineticGrid draws on a viewport-fixed canvas. clip-path confines it to the hero, and it is unmounted once the hero scrolls away. */}
      {reduced || !inView ? (
        <div className="absolute inset-0 bg-[#161618]" />
      ) : (
        <KineticGrid className="absolute inset-0 min-h-0 [clip-path:inset(0)]" />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-56 bg-gradient-to-b from-transparent to-[#030509]" />

      <motion.div style={{ y, opacity }} className="relative z-10 mx-auto w-full max-w-6xl">
        <p className="mb-5 font-mono text-xs text-[#7fa07a]">Colossus 3.0 idea submission · passive, offline, low cost</p>
        <h1 className="max-w-4xl text-[clamp(2.6rem,9vw,6.5rem)] font-bold leading-[0.98] tracking-tight">
          A border that<br />listens for drones.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-[#c3cedb]">
          Two cheap microphone posts hear the propeller hum, work out the bearing on-chip, and cross their bearings to place the drone on a map. Nothing is transmitted and nothing goes to the cloud.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-5">
          <AntiMetalButton
            label="See how it hears"
            accentFrom="#2dd4e6"
            accentTo="#0ea5e9"
            dotColor="#04121e"
            size="lg"
            className="h-14 w-64 text-base"
            onClick={() => navigate("/how-it-works")}
          />
          <AntiMetalButton
            label="Read the workflow"
            accentFrom="#2dd4e6"
            accentTo="#06b6d4"
            dotColor="#04121e"
            size="lg"
            className="h-14 w-64 text-base"
            onClick={() => scrollToId("how")}
          />
        </div>
      </motion.div>
    </section>
  );
}