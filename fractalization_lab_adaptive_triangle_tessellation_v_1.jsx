import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

// ————————————————————————————————————————————
// Fractalization Lab – Adaptive Triangle Tessellation (v1)
// Single-file React component. TailwindCSS assumed. No external deps beyond framer-motion.
// Drop into your app (e.g., /app/fractal/page.tsx in Next.js) and export default.
// ————————————————————————————————————————————

type Vec2 = { x: number; y: number };

type Triangle = {
  a: Vec2;
  b: Vec2;
  c: Vec2;
  depth: number;
  mean?: number; // mean gradient magnitude within triangle
  variance?: number; // variance of gradient magnitude within triangle
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function len2(p: Vec2, q: Vec2) {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function area2(a: Vec2, b: Vec2, c: Vec2) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2) {
  // Barycentric sign test
  const s1 = c.y - a.y;
  const s2 = c.x - a.x;
  const s3 = b.y - a.y;
  const s4 = p.y - a.y;
  const w1 = (a.x * s1 + s4 * s2 - p.x * s1) / (s3 * s2 - (b.x - a.x) * s1);
  const w2 = (s4 - w1 * s3) / s1;
  const w3 = 1 - w1 - w2;
  return w1 >= 0 && w2 >= 0 && w3 >= 0 && w1 <= 1 && w2 <= 1 && w3 <= 1;
}

function longestEdge(a: Vec2, b: Vec2, c: Vec2) {
  const ab = len2(a, b);
  const bc = len2(b, c);
  const ca = len2(c, a);
  if (ab >= bc && ab >= ca) return [a, b, c] as const; // split AB
  if (bc >= ab && bc >= ca) return [b, c, a] as const; // split BC
  return [c, a, b] as const; // split CA
}

function midpoint(p: Vec2, q: Vec2): Vec2 {
  return { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5 };
}

// Compute grayscale + Sobel gradient magnitude map
function computeGradMag(img: HTMLImageElement, maxW: number, maxH: number) {
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  const w = Math.floor(img.naturalWidth * scale);
  const h = Math.floor(img.naturalHeight * scale);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, w, h);
  const { data } = g.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // perceptual luma
    const r = data[i];
    const gch = data[i + 1];
    const b = data[i + 2];
    gray[j] = 0.2126 * r + 0.7152 * gch + 0.0722 * b;
  }

  const grad = new Float32Array(w * h);
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  let maxVal = 1e-6;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let gx = 0;
      let gy = 0;
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const v = gray[(y + ky) * w + (x + kx)];
          gx += v * sobelX[k];
          gy += v * sobelY[k];
          k++;
        }
      }
      const mag = Math.hypot(gx, gy);
      grad[y * w + x] = mag;
      if (mag > maxVal) maxVal = mag;
    }
  }
  // Normalize to 0..1
  for (let i = 0; i < grad.length; i++) grad[i] /= maxVal;
  return { w, h, grad };
}

function sampleTriStats(
  tri: Triangle,
  grad: Float32Array,
  w: number,
  h: number,
  sampleStep: number
) {
  const minX = Math.max(0, Math.floor(Math.min(tri.a.x, tri.b.x, tri.c.x)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(tri.a.x, tri.b.x, tri.c.x)));
  const minY = Math.max(0, Math.floor(Math.min(tri.a.y, tri.b.y, tri.c.y)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(tri.a.y, tri.b.y, tri.c.y)));

  let count = 0;
  let mean = 0;
  let M2 = 0; // Welford running variance

  for (let yy = minY; yy <= maxY; yy += sampleStep) {
    for (let xx = minX; xx <= maxX; xx += sampleStep) {
      const p = { x: xx + 0.5, y: yy + 0.5 };
      if (pointInTri(p, tri.a, tri.b, tri.c)) {
        const val = grad[yy * w + xx];
        count++;
        const delta = val - mean;
        mean += delta / count;
        const delta2 = val - mean;
        M2 += delta * delta2;
      }
    }
  }
  const variance = count > 1 ? M2 / (count - 1) : 0;
  return { mean: count ? mean : 0, variance, samples: count };
}

// ————————————————————————————————————————————
// Component
// ————————————————————————————————————————————

export default function FractalizationLab() {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [showImage, setShowImage] = useState(true);
  const [wireframe, setWireframe] = useState(true);
  const [fillAlpha, setFillAlpha] = useState(0.35);
  const [threshold, setThreshold] = useState(0.010); // variance threshold
  const [maxDepth, setMaxDepth] = useState(8);
  const [minEdge, setMinEdge] = useState(6);
  const [batch, setBatch] = useState(250);
  const [sampleStep, setSampleStep] = useState(2);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ refined: 0, total: 0 });

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const underlayRef = useRef<HTMLCanvasElement | null>(null);

  const [gradData, setGradData] = useState<{ w: number; h: number; grad: Float32Array } | null>(null);

  // Load image into hidden <img>
  useEffect(() => {
    if (!imgSrc) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgSrc;
    img.onload = () => {
      imgRef.current = img;
      const computed = computeGradMag(img, 1200, 900);
      setGradData(computed);
      // Draw underlay (normalized gradient as image) for optional view
      const u = underlayRef.current!;
      u.width = computed.w;
      u.height = computed.h;
      const ug = u.getContext("2d")!;
      const id = ug.createImageData(computed.w, computed.h);
      for (let i = 0; i < computed.grad.length; i++) {
        const v = Math.floor(computed.grad[i] * 255);
        id.data[i * 4 + 0] = v;
        id.data[i * 4 + 1] = v;
        id.data[i * 4 + 2] = v;
        id.data[i * 4 + 3] = 255;
      }
      ug.putImageData(id, 0, 0);
      // reset run
      resetTessellation(computed.w, computed.h);
    };
  }, [imgSrc]);

  // Tessellation state
  const triQueue = useRef<Triangle[]>([]);
  const triFinal = useRef<Triangle[]>([]);
  const rafRef = useRef<number | null>(null);

  function resetTessellation(w: number, h: number) {
    triQueue.current = [];
    triFinal.current = [];
    // Cover canvas with two big triangles
    const A = { x: 0, y: 0 };
    const B = { x: w, y: 0 };
    const C = { x: w, y: h };
    const D = { x: 0, y: h };
    triQueue.current.push({ a: A, b: B, c: C, depth: 0 });
    triQueue.current.push({ a: A, b: C, c: D, depth: 0 });
    setProgress({ refined: 0, total: triQueue.current.length });
    const cv = canvasRef.current!;
    cv.width = w;
    cv.height = h;
    drawAll();
  }

  function refineOne(tri: Triangle, grad: Float32Array, w: number, h: number): Triangle[] | null {
    // Stop if too small or too deep
    const e1 = len2(tri.a, tri.b);
    const e2 = len2(tri.b, tri.c);
    const e3 = len2(tri.c, tri.a);
    const smallest = Math.min(e1, e2, e3);
    if (smallest <= minEdge || tri.depth >= maxDepth) return null;

    const stats = sampleTriStats(tri, grad, w, h, sampleStep);
    tri.mean = stats.mean;
    tri.variance = stats.variance;

    if (stats.variance < threshold) return null; // keep as final (smooth region)

    // Subdivide by longest-edge bisection
    const [p, q, r] = longestEdge(tri.a, tri.b, tri.c);
    const m = midpoint(p, q);
    const t1: Triangle = { a: m, b: q, c: r, depth: tri.depth + 1 };
    const t2: Triangle = { a: p, b: m, c: r, depth: tri.depth + 1 };
    return [t1, t2];
  }

  function step() {
    if (!gradData) return;
    const { w, h, grad } = gradData;
    let processed = 0;

    while (processed < batch && triQueue.current.length > 0) {
      const tri = triQueue.current.shift()!;
      const kids = refineOne(tri, grad, w, h);
      if (kids && kids.length) {
        triQueue.current.push(...kids);
      } else {
        triFinal.current.push(tri);
      }
      processed++;
    }

    setProgress({ refined: triFinal.current.length, total: triQueue.current.length + triFinal.current.length });
    drawAll();

    if (triQueue.current.length === 0) {
      setIsRunning(false);
      rafRef.current && cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(step);
  }

  function drawAll() {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);

    // Image underlay
    if (showImage && underlayRef.current) {
      ctx.drawImage(underlayRef.current, 0, 0);
    }

    // Draw final triangles
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (const tri of triFinal.current) {
      const m = tri.mean ?? 0;
      const alpha = fillAlpha;
      if (!wireframe && alpha > 0) {
        const shade = Math.floor((1 - clamp(m, 0, 1)) * 255);
        ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(tri.a.x, tri.a.y);
        ctx.lineTo(tri.b.x, tri.b.y);
        ctx.lineTo(tri.c.x, tri.c.y);
        ctx.closePath();
        ctx.fill();
      }
      if (wireframe) {
        const w = 0.75 + (tri.depth * 0.15);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(tri.a.x, tri.a.y);
        ctx.lineTo(tri.b.x, tri.b.y);
        ctx.lineTo(tri.c.x, tri.c.y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Draw queued triangles (optional subtle preview)
    if (wireframe) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 0.5;
      for (const tri of triQueue.current) {
        ctx.beginPath();
        ctx.moveTo(tri.a.x, tri.a.y);
        ctx.lineTo(tri.b.x, tri.b.y);
        ctx.lineTo(tri.c.x, tri.c.y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function start() {
    if (!gradData) return;
    if (isRunning) return;
    setIsRunning(true);
    rafRef.current = requestAnimationFrame(step);
  }

  function pause() {
    if (!isRunning) return;
    setIsRunning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function restart() {
    pause();
    if (!gradData) return;
    resetTessellation(gradData.w, gradData.h);
    start();
  }

  // Handle file input
  const onFile = (f: File) => {
    const url = URL.createObjectURL(f);
    setImgSrc(url);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-black/70 backdrop-blur border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="font-black tracking-widest text-lg">aeDNA</div>
            <div className="opacity-60">Fractalization Lab</div>
          </div>
          <div className="text-sm opacity-60">Adaptive Triangle Tessellation · v1</div>
        </div>
      </header>

      {/* Controls */}
      <div className="max-w-7xl mx-auto px-4 py-4 grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-white"
                checked={showImage}
                onChange={(e) => setShowImage(e.target.checked)}
              />
              Show gradient underlay
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-white"
                checked={wireframe}
                onChange={(e) => setWireframe(e.target.checked)}
              />
              Wireframe
            </label>
            <label className="flex items-center gap-2 text-sm">
              Fill α
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={fillAlpha}
                onChange={(e) => setFillAlpha(parseFloat(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm col-span-2">
              Variance threshold
              <input
                type="range"
                min={0.001}
                max={0.05}
                step={0.001}
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
              />
              <span className="tabular-nums">{threshold.toFixed(3)}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              Max depth
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={maxDepth}
                onChange={(e) => setMaxDepth(parseInt(e.target.value))}
              />
              <span className="tabular-nums">{maxDepth}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              Min edge
              <input
                type="range"
                min={2}
                max={20}
                step={1}
                value={minEdge}
                onChange={(e) => setMinEdge(parseInt(e.target.value))}
              />
              <span className="tabular-nums">{minEdge}px</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              Batch/frame
              <input
                type="range"
                min={10}
                max={1000}
                step={10}
                value={batch}
                onChange={(e) => setBatch(parseInt(e.target.value))}
              />
              <span className="tabular-nums">{batch}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              Sample step
              <input
                type="range"
                min={1}
                max={6}
                step={1}
                value={sampleStep}
                onChange={(e) => setSampleStep(parseInt(e.target.value))}
              />
              <span className="tabular-nums">{sampleStep}px</span>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="px-3 py-1.5 rounded-2xl bg-white text-black text-sm font-semibold hover:bg-white/90"
              onClick={start}
              disabled={isRunning || !gradData}
            >
              ▶ Run
            </button>
            <button
              className="px-3 py-1.5 rounded-2xl border border-white/20 text-sm hover:bg-white/10"
              onClick={pause}
              disabled={!isRunning}
            >
              ❚❚ Pause
            </button>
            <button
              className="px-3 py-1.5 rounded-2xl border border-white/20 text-sm hover:bg-white/10"
              onClick={restart}
              disabled={!gradData}
            >
              ⟳ Restart
            </button>
            <label className="ml-auto text-sm flex items-center gap-2 cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
              <span className="px-3 py-1.5 rounded-2xl border border-white/20 hover:bg-white/10">Upload image</span>
            </label>
          </div>
          <div className="mt-2 text-xs opacity-70">
            Refined: <span className="tabular-nums">{progress.refined}</span> · Total: {" "}
            <span className="tabular-nums">{progress.total}</span>
          </div>
        </div>
        <div className="md:col-span-1 p-3 rounded-2xl border border-white/10 bg-white/5">
          <div className="text-sm font-semibold mb-2">How it works</div>
          <ul className="text-xs space-y-2 opacity-80 list-disc pl-4">
            <li>Sobel gradient magnitude (0..1) is computed from the uploaded image.</li>
            <li>Start with two triangles covering the entire image.</li>
            <li>For each triangle, we sample gradient values inside; if variance exceeds the threshold, we split along the longest edge.</li>
            <li>Refinement runs in batches per animation frame for a live "filling out" effect.</li>
            <li>Wireframe shows mesh; fill shades triangles by mean gradient.</li>
          </ul>
          <div className="mt-3 text-xs opacity-70">
            Tip: lower threshold / higher max depth → denser mesh in complex regions; increase sample step to speed up.
          </div>
        </div>
      </div>

      {/* Stage */}
      <div className="max-w-7xl mx-auto px-4 pb-10">
        <div className="relative w-full overflow-auto rounded-2xl border border-white/10 bg-white/5">
          <canvas ref={canvasRef} className="block w-full h-auto" />
          {/* Hidden underlay canvas holding gradient visualization */}
          <canvas ref={underlayRef} className="hidden" />
        </div>
        {!imgSrc && (
          <div className="text-center text-sm opacity-60 py-6">
            Upload an image to begin. A gradient preview will appear under the tessellation.
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="pb-10 text-center text-xs opacity-50">Fractalization Lab · Adaptive Triangle Tessellation · © aeDNA</footer>
    </div>
  );
}
