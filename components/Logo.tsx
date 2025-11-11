"use client";
import { motion } from "framer-motion";

export function Logo({ size = 160, compact = false, className = "" }: { size?: number; compact?: boolean; className?: string; }) {
  // Brand: "æDNA" — geometric, minimal, elegant with ash symbol
  return (
    <motion.div
      aria-label="æDNA logo"
      className={`select-none ${className}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      style={{ 
        fontSize: compact ? size * 0.3125 : size * 0.25,
        fontFamily: compact ? 'serif' : 'Georgia, Palatino, "Palatino Linotype", "Times New Roman", serif',
        letterSpacing: compact ? '0.05em' : '0.06em'
      }}
    >
      <div className="inline-flex items-baseline gap-0.5">
        <span className="font-bold leading-none bg-clip-text text-transparent bg-gradient-to-r from-white via-neutral-200 to-neutral-400">
          æ
        </span>
        <span className="uppercase font-light tracking-[0.25em] text-neutral-300">DNA</span>
      </div>
    </motion.div>
  );
}

