import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";
import { useSmoothScroll } from "@/lib/smooth-scroll";
import ParticleDrift from "@/components/ui/particle-drift";
import Nav from "@/components/Nav";
import Hero from "@/components/sections/Hero";
import ZoomParallax from "@/components/sections/ZoomParallax";
import ScrollSequence from "@/components/sections/ScrollSequence";
import Content from "@/components/sections/Content";
import HowItWorks from "@/pages/HowItWorks";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Landing() {
  useSmoothScroll();
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <>
      {/* Page-wide background: ParticleDrift. The hero sits above it with its own KineticGrid. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-[#030509]">
        {!reduced && <ParticleDrift className="h-full w-full" />}
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 40%, transparent 45%, rgba(2,4,8,.7))" }} />
      </div>
      <motion.div aria-hidden style={{ scaleX: bar }} className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-[#2dd4e6]" />
      <main className="relative z-10">
        <Nav />
        <Hero />
        <ZoomParallax />
        <ScrollSequence />
        <Content />
      </main>
    </>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
      </Routes>
    </>
  );
}