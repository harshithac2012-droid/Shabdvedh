import { useEffect } from "react";
import Lenis from "lenis";

// One Lenis instance for the landing page. Skipped when the user prefers reduced motion.
let lenis: Lenis | null = null;

export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const l = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis = l;
    let raf = 0;
    const loop = (t: number) => { l.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); l.destroy(); if (lenis === l) lenis = null; };
  }, []);
}

export function scrollToId(id: string) {
  const el = id === "top" ? document.body : document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(id === "top" ? 0 : el, { offset: 0 });
  else if (id === "top") window.scrollTo({ top: 0, behavior: "smooth" });
  else el.scrollIntoView({ behavior: "smooth" });
}
