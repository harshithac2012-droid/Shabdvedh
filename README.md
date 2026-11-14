# ShabdaVedh website
npm install
npm run dev      # http://localhost:5173
npm run build

Page order: Hero → Zoom Parallax → Scroll Sequence (3 stages) → How it works → Stack → Why us → Impact → Roadmap → Thank you.
One Lenis instance lives in src/lib/smooth-scroll.ts (skipped when prefers-reduced-motion is on).
If you already have a Zoom Parallax, replace src/components/sections/ZoomParallax.tsx with yours.
