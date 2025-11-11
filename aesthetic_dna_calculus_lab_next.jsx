// Aesthetic DNA — Calculus Lab
// Tech stack: Next.js (App Router), TypeScript, TailwindCSS, Framer Motion (optional)
// Files are concatenated in this single document. Create them in your project with these paths.

// ------------------------------------------------------------
// File: app/calculus/page.tsx
// ------------------------------------------------------------
"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  computeGradients,
  computeLaplacian,
  computeStructureTensor,
  normalize01,
  gaussianBlur,
  percentile,
  zscoreField,
} from "@/lib/metrics";
import {
  composeAttentionalPotential,
  computeAttentionCenter,
  findSourcesSinks,
  greatestAestheticTension,
} from "@/lib/attention";
import {
  drawBaseImage,
  drawHeatmap,
  drawArrows,
  drawGlyphs,
  drawCrosshair,
  toImageData,
} from "@/lib/draw";

const DEFAULT_IMAGE = undefined; // optional: provide a default demo image URL

export default function CalculusLabPage() {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Controls
  const [sigma, setSigma] = useState(1.5);
  const [topPercent, setTopPercent] = useState(10);
  const [multiscale, setMultiscale] = useState(true);
  const [zPos, setZPos] = useState(1.5);
  const [zNeg, setZNeg] = useState(-1.5);
  const [nmsR, setNmsR] = useState(7);
  const [maxMarkers, setMaxMarkers] = useState(50);
  const [w1, setW1] = useState(0.5); // edges
  const [w2, setW2] = useState(0.2); // LoG+
  const [w3, setW3] = useState(0.2); // corners
  const [w4, setW4] = useState(0.1); // color contrast (placeholder)
  const [w5, setW5] = useState(0.1); // homogeneity penalty
  const [showEdges, setShowEdges] = useState(true);
  const [showStream, setShowStream] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showSourcesSinks, setShowSourcesSinks] = useState(true);
  const [showCenter, setShowCenter] = useState(true);
  const [showTension, setShowTension] = useState(true);

  // Load default image (optional)
  useEffect(() => {
    if (!DEFAULT_IMAGE) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImgEl(img);
    img.src = DEFAULT_IMAGE;
  }, []);

  // Prepare ImageData when an image element exists
  useEffect(() => {
    if (!imgEl) return;
    const W = imgEl.naturalWidth;
    const H = imgEl.naturalHeight;
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(imgEl, 0, 0);
    const id = ctx.getImageData(0, 0, W, H);
    setImageData(id);
  }, [imgEl]);

  const metrics = useMemo(() => {
    if (!imageData) return null;
    const { width: W, height: H } = imageData;

    // Core gradients
    const { Ix, Iy, mag, theta } = computeGradients(imageData, sigma);

    // LoG (positive only for feature cores)
    const lap = computeLaplacian(imageData, sigma);
    const logPos = new Float32Array(W * H);
    for (let i = 0; i < lap.length; i++) logPos[i] = Math.max(0, lap[i]);

    // Corners (fast Harris-like via structure tensor eigen gap)
    const tensor = computeStructureTensor(Ix, Iy, W, H, sigma);
    const corner = tensor.corner; // 0..1

    // Local homogeneity proxy = 1 - local variance (we'll reuse blurred |∇I| as anti-homogeneity)
    const gradSmooth = gaussianBlur(mag, W, H, sigma);
    const homogeneity = new Float32Array(W * H);
    const gnorm = normalize01(gradSmooth);
    for (let i = 0; i < homogeneity.length; i++) homogeneity[i] = 1 - gnorm[i];

    // Placeholder color contrast: use gradient magnitude (luminance proxy). In future, compute Lab ΔE.
    const colorContrast = normalize01(mag);

    // Attention potential φ (0..1)
    const phi = composeAttentionalPotential(
      {
        grad: normalize01(mag),
        logPos: normalize01(logPos),
        corners: normalize01(corner),
        colorContrast: normalize01(colorContrast),
        homogeneity: normalize01(homogeneity),
      },
      { w1, w2, w3, w4, w5 }
    );

    return { W, H, mag, theta, Ix, Iy, lap, logPos, corner, homogeneity, colorContrast, phi };
  }, [imageData, sigma, w1, w2, w3, w4, w5]);

  // Derived: flow, center, sources/sinks, tension
  const overlays = useMemo(() => {
    if (!metrics) return null;
    const { W, H, mag, corner, phi } = metrics;

    const center = computeAttentionCenter(phi, W, H, { topPercent, multiscale });
    const ss = findSourcesSinks(phi, W, H, { zPos, zNeg, nmsRadius: nmsR, maxPoints: maxMarkers });
    const tension = greatestAestheticTension(mag, corner, phi, W, H, { w1: 0.5, w2: 0.3, w3: 0.2, nmsRadius: nmsR });

    return { center, ss, tension };
  }, [metrics, topPercent, multiscale, zPos, zNeg, nmsR, maxMarkers]);

  // Render
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs || !metrics) return;
    const ctx = cvs.getContext("2d")!;
    const { W, H, mag, phi } = metrics;
    cvs.width = W; cvs.height = H;

    // Base image
    drawBaseImage(ctx, imageData!);

    // Overlays
    if (showEdges) {
      drawHeatmap(ctx, normalize01(mag), W, H, { alpha: 0.35, legend: "Edges" });
    }
    if (showHotspots) {
      // Hotspot = top p% of φ
      const thr = percentile(phi, 100 - topPercent);
      const mask = new Float32Array(W * H);
      for (let i = 0; i < phi.length; i++) mask[i] = phi[i] >= thr ? phi[i] : 0;
      drawHeatmap(ctx, mask, W, H, { alpha: 0.4, legend: "Attention hotspots" });
    }

    if (overlays) {
      if (showCenter) drawCrosshair(ctx, overlays.center.x, overlays.center.y, { ringRadius: Math.max(6, overlays.center.radius), color: "#F5C84B" });
      if (showSourcesSinks) {
        drawGlyphs(ctx, overlays.ss.sources, { color: "#00B3B3", shape: "triangleUp" });
        drawGlyphs(ctx, overlays.ss.sinks, { color: "#FF4D9A", shape: "triangleDown" });
      }
      if (showTension) {
        drawGlyphs(ctx, [{ x: overlays.tension.x, y: overlays.tension.y, z: overlays.tension.tau }], { color: "#FF3333", shape: "bolt" });
      }
    }
  }, [metrics, overlays, imageData, showEdges, showHotspots, showCenter, showSourcesSinks, showTension, topPercent]);

  const onUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <a href="/" className="font-semibold tracking-wide text-neutral-200">aeDNA</a>
          <nav className="flex items-center gap-3 text-sm text-neutral-400">
            <a className="rounded-xl bg-neutral-800 px-3 py-1.5 text-neutral-50">Differential Calculus</a>
            <a href="/thermodynamics" className="rounded-xl px-3 py-1.5 hover:bg-neutral-800">Thermodynamics</a>
            <a href="/chemistry" className="rounded-xl px-3 py-1.5 hover:bg-neutral-800">Chemistry</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[330px_1fr]">
        {/* Controls */}
        <section className="space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-lg">
          <h2 className="text-lg font-semibold">Controls</h2>
          <div className="space-y-3">
            <label className="block text-sm text-neutral-300">Upload Image
              <input type="file" accept="image/*" className="mt-1 block w-full text-sm"
                     onChange={(e) => e.target.files && onUpload(e.target.files[0])} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <Slider label="Smoothing σ" value={sigma} setValue={setSigma} min={0.8} max={3.0} step={0.1} />
              <Slider label="Top % (hotspots)" value={topPercent} setValue={setTopPercent} min={2} max={20} step={1} />
              <Toggle label="Multiscale center" checked={multiscale} setChecked={setMultiscale} />
              <Slider label="NMS radius" value={nmsR} setValue={setNmsR} min={3} max={15} step={1} />
            </div>

            <h3 className="mt-4 text-sm font-semibold text-neutral-300">Attention Weights</h3>
            <div className="grid grid-cols-2 gap-3">
              <Slider label="w₁ Edges" value={w1} setValue={setW1} min={0} max={1} step={0.05} />
              <Slider label="w₂ LoG+" value={w2} setValue={setW2} min={0} max={1} step={0.05} />
              <Slider label="w₃ Corners" value={w3} setValue={setW3} min={0} max={1} step={0.05} />
              <Slider label="w₄ Color" value={w4} setValue={setW4} min={0} max={1} step={0.05} />
              <Slider label="w₅ Homo (−)" value={w5} setValue={setW5} min={0} max={1} step={0.05} />
            </div>

            <h3 className="mt-4 text-sm font-semibold text-neutral-300">Overlays</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Check label="Edges heat" checked={showEdges} setChecked={setShowEdges} />
              <Check label="Hotspots" checked={showHotspots} setChecked={setShowHotspots} />
              <Check label="Center" checked={showCenter} setChecked={setShowCenter} />
              <Check label="Sources/Sinks" checked={showSourcesSinks} setChecked={setShowSourcesSinks} />
              <Check label="Tension point" checked={showTension} setChecked={setShowTension} />
            </div>
          </div>
        </section>

        {/* Canvas */}
        <section className="relative rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Canvas</h2>
            {metrics && (
              <span className="text-xs text-neutral-400">{metrics.W}×{metrics.H}</span>
            )}
          </div>
          <div className="relative w-full overflow-auto rounded-xl">
            <canvas ref={canvasRef} className="mx-auto block max-h-[78vh]" />
          </div>
        </section>
      </main>
    </div>
  );
}

function Slider({ label, value, setValue, min, max, step }:{label:string; value:number; setValue:(v:number)=>void; min:number; max:number; step:number;}){
  return (
    <label className="block text-sm">
      <span className="text-neutral-300">{label}: <span className="tabular-nums text-neutral-200">{value.toFixed(2)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e)=>setValue(parseFloat(e.target.value))}
             className="mt-1 w-full accent-fuchsia-400"/>
    </label>
  );
}
function Toggle({label, checked, setChecked}:{label:string; checked:boolean; setChecked:(v:boolean)=>void;}){
  return (
    <label className="flex items-center justify-between text-sm text-neutral-300">
      {label}
      <input type="checkbox" checked={checked} onChange={(e)=>setChecked(e.target.checked)} className="accent-teal-400"/>
    </label>
  );
}
function Check({label, checked, setChecked}:{label:string; checked:boolean; setChecked:(v:boolean)=>void;}){
  return (
    <label className="flex items-center gap-2 text-neutral-300">
      <input type="checkbox" checked={checked} onChange={(e)=>setChecked(e.target.checked)} className="accent-sky-400"/>
      <span className="text-sm">{label}</span>
    </label>
  );
}

// ------------------------------------------------------------
// File: lib/metrics.ts
// ------------------------------------------------------------
export type Field = Float32Array; // row-major, length=W*H

export function toGrayscale(image: ImageData): Field {
  const { data, width: W, height: H } = image;
  const out = new Float32Array(W * H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    out[j] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return out;
}

export function computeGradients(image: ImageData, sigma = 1.0) {
  const gray = toGrayscale(image);
  const { width: W, height: H } = image;
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);

  // Simple central differences with Gaussian pre-blur
  const g = gaussianBlur(gray, W, H, sigma);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      gx[i] = (g[i + 1] - g[i - 1]) * 0.5;
      gy[i] = (g[i + W] - g[i - W]) * 0.5;
    }
  }
  const mag = new Float32Array(W * H);
  const theta = new Float32Array(W * H);
  for (let i = 0; i < mag.length; i++) {
    mag[i] = Math.hypot(gx[i] || 0, gy[i] || 0);
    theta[i] = Math.atan2(gy[i] || 0, gx[i] || 0);
  }
  return { Ix: gx, Iy: gy, mag, theta };
}

export function computeLaplacian(image: ImageData, sigma = 1.0): Field {
  const gray = toGrayscale(image);
  const { width: W, height: H } = image;
  const g = gaussianBlur(gray, W, H, sigma);
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      out[i] = -4 * g[i] + g[i - 1] + g[i + 1] + g[i - W] + g[i + W];
    }
  }
  return out;
}

export function computeStructureTensor(Ix: Field, Iy: Field, W: number, H: number, sigma = 1.0) {
  const Ixx = new Float32Array(W * H);
  const Iyy = new Float32Array(W * H);
  const Ixy = new Float32Array(W * H);
  for (let i = 0; i < Ixx.length; i++) {
    const ix = Ix[i] || 0, iy = Iy[i] || 0;
    Ixx[i] = ix * ix; Iyy[i] = iy * iy; Ixy[i] = ix * iy;
  }
  const Jxx = gaussianBlur(Ixx, W, H, sigma);
  const Jyy = gaussianBlur(Iyy, W, H, sigma);
  const Jxy = gaussianBlur(Ixy, W, H, sigma);

  const coherence = new Float32Array(W * H);
  const corner = new Float32Array(W * H);
  const theta = new Float32Array(W * H);

  for (let i = 0; i < coherence.length; i++) {
    const a = Jxx[i], b = Jxy[i], c = Jxy[i], d = Jyy[i];
    const tr = a + d;
    const det = a * d - b * c;
    const disc = Math.max(0, tr * tr - 4 * det);
    const l1 = 0.5 * (tr + Math.sqrt(disc));
    const l2 = 0.5 * (tr - Math.sqrt(disc));
    coherence[i] = (l1 + l2) > 1e-6 ? (l1 - l2) / (l1 + l2) : 0;
    corner[i] = l1; // monotone with cornerness; normalize later
    theta[i] = 0.5 * Math.atan2(2 * b, a - d);
  }
  // Normalize corner to 0..1
  const cornerN = normalize01(corner);
  return { coherence, corner: cornerN, theta };
}

export function gaussianBlur(src: Field, W: number, H: number, sigma: number): Field {
  if (sigma <= 0) return src.slice() as Field;
  const r = Math.max(1, Math.round(sigma * 3));
  const kernel: number[] = [];
  const s2 = sigma * sigma;
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * s2)); kernel.push(v); sum += v; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  // Horizontal
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(W - 1, Math.max(0, x + k));
        acc += src[y * W + xx] * kernel[k + r];
      }
      tmp[y * W + x] = acc;
    }
  }
  // Vertical
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(H - 1, Math.max(0, y + k));
        acc += tmp[yy * W + x] * kernel[k + r];
      }
      out[y * W + x] = acc;
    }
  }
  return out;
}

export function normalize01(src: Field): Field {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < src.length; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const out = new Float32Array(src.length);
  const den = mx - mn > 1e-9 ? (mx - mn) : 1;
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - mn) / den;
  return out;
}

export function percentile(src: Field, p: number) {
  const arr = Array.from(src);
  arr.sort((a, b) => a - b);
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)));
  return arr[idx];
}

export function zscoreField(src: Field): Field {
  let mean = 0; for (let i = 0; i < src.length; i++) mean += src[i];
  mean /= src.length;
  let v = 0; for (let i = 0; i < src.length; i++) { const d = src[i] - mean; v += d * d; }
  const sd = Math.sqrt(v / Math.max(1, src.length - 1)) || 1;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - mean) / sd;
  return out;
}

// ------------------------------------------------------------
// File: lib/attention.ts
// ------------------------------------------------------------
import type { Field } from "./metrics";
import { gaussianBlur, normalize01, percentile, zscoreField } from "./metrics";

export function composeAttentionalPotential(
  inputs: { grad: Field; logPos: Field; corners: Field; colorContrast: Field; homogeneity: Field },
  weights: { w1: number; w2: number; w3: number; w4: number; w5: number }
): Field {
  const { grad, logPos, corners, colorContrast, homogeneity } = inputs;
  const { w1, w2, w3, w4, w5 } = weights;
  const N = grad.length;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = w1 * grad[i] + w2 * logPos[i] + w3 * corners[i] + w4 * colorContrast[i] - w5 * homogeneity[i];
  }
  return normalize01(out);
}

function gradient(field: Field, W: number, H: number) {
  const gx = new Float32Array(W * H); const gy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      gx[i] = (field[i + 1] - field[i - 1]) * 0.5;
      gy[i] = (field[i + W] - field[i - W]) * 0.5;
    }
  }
  return { gx, gy };
}

function divergence(gx: Field, gy: Field, W: number, H: number): Field {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const ddx = (gx[i + 1] - gx[i - 1]) * 0.5;
      const ddy = (gy[i + W] - gy[i - W]) * 0.5;
      out[i] = ddx + ddy; // ∇·F
    }
  }
  return out;
}

export function computeAttentionCenter(
  phi: Field, W: number, H: number,
  opts: { topPercent?: number; multiscale?: boolean } = {}
): { x: number; y: number; radius: number } {
  const { topPercent = 10, multiscale = true } = opts;
  const scales = multiscale ? [1, 2, 4] : [1];
  const pts: { x: number; y: number }[] = [];
  for (const s of scales) {
    const phis = s > 1 ? gaussianBlur(phi, W, H, s) : phi;
    const thr = percentile(phis, 100 - topPercent);
    let sx = 0, sy = 0, sw = 0;
    for (let i = 0; i < phis.length; i++) {
      const v = phis[i]; if (v < thr) continue;
      const x = i % W, y = Math.floor(i / W);
      sx += v * x; sy += v * y; sw += v;
    }
    if (sw > 0) pts.push({ x: sx / sw, y: sy / sw });
  }
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length || W / 2;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length || H / 2;
  const r = Math.sqrt(
    pts.reduce((a, p) => a + (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy), 0) / Math.max(1, pts.length)
  );
  return { x: cx, y: cy, radius: r };
}

export function findSourcesSinks(
  phi: Field, W: number, H: number,
  opts: { zPos?: number; zNeg?: number; nmsRadius?: number; maxPoints?: number } = {}
): { sources: { x: number; y: number; z: number }[]; sinks: { x: number; y: number; z: number }[] } {
  const { zPos = 1.5, zNeg = -1.5, nmsRadius = 7, maxPoints = 50 } = opts;
  const { gx, gy } = gradient(phi, W, H);
  const div = divergence(gx, gy, W, H);
  const z = zscoreField(div);

  function pick(extreme: "max" | "min", zthr: number) {
    const pts: { x: number; y: number; z: number }[] = [];
    const r = 1;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x; const v = z[i];
        if (extreme === "max" && v < zthr) continue;
        if (extreme === "min" && v > zthr) continue;
        let isExt = true;
        for (let yy = -r; yy <= r; yy++) {
          for (let xx = -r; xx <= r; xx++) {
            if (xx === 0 && yy === 0) continue;
            const j = (y + yy) * W + (x + xx);
            if (extreme === "max" && z[j] > v) { isExt = false; break; }
            if (extreme === "min" && z[j] < v) { isExt = false; break; }
          }
          if (!isExt) break;
        }
        if (isExt) pts.push({ x, y, z: v });
      }
    }
    // NMS by radius
    pts.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const kept: { x: number; y: number; z: number }[] = [];
    for (const p of pts) {
      if (kept.length >= maxPoints) break;
      if (!kept.some(q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < nmsRadius * nmsRadius)) kept.push(p);
    }
    return kept;
  }

  return { sources: pick("max", zPos), sinks: pick("min", zNeg) };
}

export function greatestAestheticTension(
  gradMag: Field, corner: Field, phi: Field, W: number, H: number,
  opts: { w1?: number; w2?: number; w3?: number; nmsRadius?: number } = {}
): { x: number; y: number; tau: number } {
  const { w1 = 0.5, w2 = 0.3, w3 = 0.2, nmsRadius = 7 } = opts;
  const { gx, gy } = gradient(phi, W, H);
  const gphi = new Float32Array(W * H);
  for (let i = 0; i < gphi.length; i++) gphi[i] = Math.hypot(gx[i] || 0, gy[i] || 0);

  const e = normalize01(gradMag);
  const k = normalize01(corner);
  const g = normalize01(gphi);

  const tau = new Float32Array(W * H);
  let bestI = 0;
  for (let i = 0; i < tau.length; i++) { tau[i] = w1 * e[i] + w2 * k[i] + w3 * g[i]; if (tau[i] > tau[bestI]) bestI = i; }

  // Optional local refinement: ensure peak isolation by checking local neighborhood
  const bx = bestI % W, by = Math.floor(bestI / W);
  return { x: bx, y: by, tau: tau[bestI] };
}

// ------------------------------------------------------------
// File: lib/draw.ts
// ------------------------------------------------------------
export function toImageData(field: Float32Array, W: number, H: number) {
  const img = new ImageData(W, H);
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(field[i] * 255)));
    img.data[4 * i + 0] = v; img.data[4 * i + 1] = v; img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255;
  }
  return img;
}

export function drawBaseImage(ctx: CanvasRenderingContext2D, imageData: ImageData) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.putImageData(imageData, 0, 0);
}

// Simple heatmap (grayscale with alpha). For colored maps, replace with a colormap.
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  field: Float32Array,
  W: number,
  H: number,
  opts: { alpha?: number; legend?: string } = {}
) {
  const { alpha = 0.35 } = opts;
  const img = ctx.createImageData(W, H);
  // Turbo-like minimal colormap mapping 0..1 → RGB (approx)
  function turbo(u: number) {
    const r = Math.min(1, Math.max(0, 1.7 * u - 0.3));
    const g = Math.min(1, Math.max(0, 1.7 * (1 - Math.abs(u - 0.5) * 2)));
    const b = Math.min(1, Math.max(0, 1.7 * (1 - u) - 0.3));
    return [r * 255, g * 255, b * 255];
  }
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(1, field[i]));
    const [r, g, b] = turbo(v);
    img.data[4 * i + 0] = r;
    img.data[4 * i + 1] = g;
    img.data[4 * i + 2] = b;
    img.data[4 * i + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(img, 0, 0);
}

export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts: { ringRadius?: number; color?: string } = {}
) {
  const { ringRadius = 10, color = "#F5C84B" } = opts;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - ringRadius - 4, y); ctx.lineTo(x + ringRadius + 4, y);
  ctx.moveTo(x, y - ringRadius - 4); ctx.lineTo(x, y + ringRadius + 4);
  ctx.stroke();
  ctx.restore();
}

export function drawGlyphs(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number; z?: number }[],
  opts: { color?: string; shape?: "triangleUp" | "triangleDown" | "bolt" } = {}
) {
  const { color = "#00B3B3", shape = "triangleUp" } = opts;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  for (const p of pts) {
    const size = Math.max(6, Math.min(16, 6 + (p.z ? Math.abs(p.z) * 3 : 0)));
    if (shape === "triangleUp") {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - size);
      ctx.lineTo(p.x - size * 0.8, p.y + size * 0.6);
      ctx.lineTo(p.x + size * 0.8, p.y + size * 0.6);
      ctx.closePath(); ctx.fill();
    } else if (shape === "triangleDown") {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + size);
      ctx.lineTo(p.x - size * 0.8, p.y - size * 0.6);
      ctx.lineTo(p.x + size * 0.8, p.y - size * 0.6);
      ctx.closePath(); ctx.fill();
    } else if (shape === "bolt") {
      ctx.beginPath();
      ctx.moveTo(p.x - size * 0.2, p.y - size);
      ctx.lineTo(p.x + size * 0.15, p.y - size * 0.15);
      ctx.lineTo(p.x - size * 0.1, p.y - size * 0.15);
      ctx.lineTo(p.x + size * 0.2, p.y + size);
      ctx.lineTo(p.x - size * 0.15, p.y + size * 0.15);
      ctx.lineTo(p.x + size * 0.1, p.y + size * 0.15);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

export function drawArrows(
  ctx: CanvasRenderingContext2D,
  field: { ux: Float32Array; uy: Float32Array },
  W: number, H: number,
  opts: { stride?: number; scale?: number; color?: string } = {}
) {
  const { stride = 16, scale = 12, color = "#9AE6B4" } = opts;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
  for (let y = stride; y < H - stride; y += stride) {
    for (let x = stride; x < W - stride; x += stride) {
      const i = y * W + x;
      const ux = field.ux[i] || 0, uy = field.uy[i] || 0;
      const ex = x + ux * scale, ey = y + uy * scale;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
      // head
      const ang = Math.atan2(ey - y, ex - x);
      const ah = 3; const aw = 2.5;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ah * Math.cos(ang - 0.3), ey - ah * Math.sin(ang - 0.3));
      ctx.lineTo(ex - ah * Math.cos(ang + 0.3), ey - ah * Math.sin(ang + 0.3));
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
