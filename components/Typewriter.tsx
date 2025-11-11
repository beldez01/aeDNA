"use client";
import { useEffect, useState } from "react";

export function Typewriter({ text, speed = 55, className = "" }: { text: string; speed?: number; className?: string; }) {
  const [output, setOutput] = useState("");
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      setOutput((prev) => prev + text.charAt(i));
      i++;
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return (
    <span className={`font-mono text-sm text-neutral-400 ${className}`}>
      {output}
      <span className="animate-pulse">▍</span>
    </span>
  );
}

