"use client";

import React, { useMemo } from "react";

interface AtlasProps {
  atlas: {
    tiles: {
      name: string;
      heat: Float32Array;
      w: number;
      h: number;
    }[];
  };
}

export default function Atlas({ atlas }: AtlasProps) {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {atlas.tiles.map((t, i) => (
        <AtlasTile key={i} name={t.name} heat={t.heat} w={t.w} h={t.h} />
      ))}
    </div>
  );
}

function AtlasTile({ name, heat, w, h }: { name: string; heat: Float32Array; w: number; h: number }) {
  const dataUrl = useMemo(() => heatToDataURL(heat, w, h), [heat, w, h]);
  
  return (
    <div className="rounded-xl border border-neutral-800 bg-black/40 p-3">
      <div className="text-xs text-neutral-400 mb-2">{name}</div>
      <img src={dataUrl} alt={name} className="w-full h-auto rounded-md" />
    </div>
  );
}

function heatToDataURL(heat: Float32Array, w: number, h: number) {
  if (typeof document === 'undefined') return "";
  
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < heat.length; i++) {
    const v = heat[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const rng = max - min || 1;
  
  for (let i = 0; i < heat.length; i++) {
    const v = (heat[i] - min) / rng;
    const j = i * 4;
    const [r, g, b] = turbo(v);
    img.data[j] = r;
    img.data[j + 1] = g;
    img.data[j + 2] = b;
    img.data[j + 3] = 255;
  }
  
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function turbo(x: number): [number, number, number] {
  const r = Math.min(255, Math.max(0, 255 * (1.0 - 1.5 * (x - 0.5) ** 2)));
  const g = Math.min(255, Math.max(0, 255 * (1.2 - 4.0 * (x - 0.5) ** 2)));
  const b = Math.min(255, Math.max(0, 255 * (1.0 - 1.5 * (x - 0.5) ** 2)));
  return [r, g, b];
}

