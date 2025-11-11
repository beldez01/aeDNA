"use client";


import { Logo } from "../components/Logo";
import { PhaseDropdown } from "../components/PhaseDropdown";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-black">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.08), transparent 70%)" }} />
      </div>

      {/* Center content */}
      <section className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col items-center justify-center px-1 text-center">
        <motion.div
          className="group inline-flex flex-col items-center gap-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <Logo size={480} />
          <div className="-mt-4">
            <PhaseDropdown triggerClassName="!bg-transparent !border-none hover:!bg-transparent cursor-pointer" />
          </div>

          {/* Fallback hint for touch devices */}
          <p className="mt-2 text-xs text-neutral-500 md:hidden">Tap to explore phases</p>
        </motion.div>
      </section>
    </main>
  );
}
