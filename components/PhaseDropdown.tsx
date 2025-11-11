"use client";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

export type Phase = { label: string; href: string; }; 

const PHASES: Phase[] = [
  { label: "Studio", href: "/clipboard" },
  { label: "Charge Field", href: "/charge-field" },
  { label: "Stereogram Lab", href: "/stereogram" },
  { label: "Differentials", href: "/differentials" },
  { label: "Fractalization", href: "/fractalization" },
  { label: "Genome Recombiner", href: "/genome-recombiner" },
  { label: "Entropy & Exhaustion", href: "/entropy-complexity" },
  { label: "Multi-Scale Complexity & Topology", href: "/multi-scale" },
];

export function PhaseDropdown({ triggerClassName = "" }: { triggerClassName?: string; }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex justify-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        className={`font-mono text-sm text-neutral-400 ${triggerClassName}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        enter aesthetic genome
        <span className="animate-pulse">▍</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="absolute top-full left-0 mt-2 w-72 overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-950/95 shadow-2xl backdrop-blur-xl"
            role="menu"
          >
            <ul className="divide-y divide-neutral-800/70">
              {PHASES.map((p) => (
                <li key={p.href}>
                  <Link
                    className="block px-4 py-3 text-sm text-neutral-200 hover:bg-white/5"
                    href={p.href}
                  >
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { PHASES };

