import { useState } from "react";
import { Menu, X } from "lucide-react";
import { scrollToId } from "@/lib/smooth-scroll";

const LINKS = [
  ["sequence", "Concept"], ["how", "How it works"], ["stack", "Stack"], ["different", "Why us"], ["impact", "Impact"], ["roadmap", "Roadmap"],
] as const;

export default function Nav() {
  const [open, setOpen] = useState(false);
  const go = (id: string) => { setOpen(false); scrollToId(id); };
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#8b99ab]/15 bg-[#0a1220]/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5" aria-label="Main">
        <button onClick={() => scrollToId("top")} className="font-display text-lg font-semibold tracking-wide">ShabdaVedh</button>
        <ul className="hidden gap-7 text-sm text-[#8b99ab] md:flex">
          {LINKS.map(([id, label]) => (
            <li key={id}><button onClick={() => go(id)} className="transition-colors hover:text-[#2dd4e6]">{label}</button></li>
          ))}
        </ul>
        <button className="md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle menu">
          {open ? <X /> : <Menu />}
        </button>
      </nav>
      {open && (
        <ul className="border-t border-[#8b99ab]/15 bg-[#0a1220] px-5 py-3 md:hidden">
          {LINKS.map(([id, label]) => (
            <li key={id}><button onClick={() => go(id)} className="w-full py-3 text-left text-[#e6edf5]">{label}</button></li>
          ))}
        </ul>
      )}
    </header>
  );
}
