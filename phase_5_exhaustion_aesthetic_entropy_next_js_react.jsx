"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { Upload, RotateCcw, Save, Maximize2, X, Play, Pause } from "lucide-react";

/**
 * Phase 5: Exhaustion Curve & Aesthetic Entropy Lab
 * -------------------------------------------------
 * What this page adds beyond Phase 4:
 * 1) True adaptive layout (image + field controls lock to viewport; never overflows)
 * 2) Image upload + drag/drop; optional live downscale for speed
 * 3) Metrics panel:
 *    - Shannon entropy (0–8 bits) over grayscale histogram
 *    - Chromatic entropy (mean of per-channel entropies)
 *    - Local variance index (texture) via fast 3x3 variance
 *    - Edge density via Sobel magnitude
 *    - Simple "Aesthetic Entropy" = weighted composite you can tune live
 * 4) Exhaustion curve recorder: tracks metrics across transformation steps
 * 5) Simple transforms to probe exhaustion: blur, pixel sort %, color quantization
 * 6) Comparison mode (A vs B) and CSV export of the exhaustion trace
 * 7) Fullscreen lightbox for outputs
 *
 * Drop this file at: app/phase-5/page.tsx
 * Ensure shadcn/ui is installed and that '@/components/ui/*' paths are valid in your setup.
 */

// ---------- Utility: Canvas helpers ----------
function drawImageToCanvas(img: HTMLImageElement, canvas: HTMLCanvasElement, maxW = 1024, maxH = 1024) {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = fitContain(img.naturalWidth, img.naturalHeight, maxW, maxH);
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);
}

function fitContain(w: number, h: number, maxW: number, maxH: number) {
  const r = Math.min(maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

function toGrayscale(px: Uint8ClampedArray) {
  const out = new Float32Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    out[j] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

function shannonEntropy(arr: Float32Array | number[], bins = 256) {
  const hist = new Float32Array(bins);
  const n = arr.length;
  const inv = (bins - 1) / 255;
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(bins - 1, Math.round((arr[i] as number) * inv)))]++;
  let H = 0;
  for (let i = 0; i < bins; i++) {
    if (hist[i] > 0) {
      const p = hist[i] / n;
      H -= p * Math.log2(p);
    }
  }
  return H; // bits
}

function perChannelEntropies(pixels: Uint8ClampedArray, bins = 256) {
  const rHist = new Float32Array(bins);
  const gHist = new Float32Array(bins);
  const bHist = new Float32Array(bins);
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    rHist[pixels[i]]++;
    gHist[pixels[i + 1]]++;
    bHist[pixels[i + 2]]++;
  }
  const ent = (hist: Float32Array) => {
    let H = 0;
    for (let i = 0; i < bins; i++) if (hist[i] > 0) { const p = hist[i] / n; H -= p * Math.log2(p); }
    return H;
  };
  return { r: ent(rHist), g: ent(gHist), b: ent(bHist) };
}

function localVarianceIndex(gray: Float32Array, w: number, h: number) {
  let acc = 0, cnt = 0;
  const idx = (x: number, y: number) => y * w + x;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const cx = idx(x, y);
      let mean = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) mean += gray[idx(x + i, y + j)];
      mean /= 9;
      let v = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const d = gray[idx(x + i, y + j)] - mean;
          v += d * d;
        }
      v /= 9;
      acc += v;
      cnt++;
    }
  }
  return acc / Math.max(1, cnt);
}

function sobelEdgeDensity(gray: Float32Array, w: number, h: number) {
  const Gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const Gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  let sum = 0;
  let cnt = 0;
  const idx = (x: number, y: number) => y * w + x;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sx = 0, sy = 0, k = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++, k++) {
          const v = gray[idx(x + i, y + j)];
          sx += v * Gx[k];
          sy += v * Gy[k];
        }
      const m = Math.hypot(sx, sy);
      sum += m;
      cnt++;
    }
  }
  return sum / Math.max(1, cnt); // mean gradient magnitude
}

// Simple transforms to probe exhaustion
function quantize(canvas: HTMLCanvasElement, levels: number) {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const step = 255 / Math.max(1, levels - 1);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.round(img.data[i] / step) * step;
    img.data[i + 1] = Math.round(img.data[i + 1] / step) * step;
    img.data[i + 2] = Math.round(img.data[i + 2] / step) * step;
  }
  ctx.putImageData(img, 0, 0);
}

function fastBoxBlur(canvas: HTMLCanvasElement, r: number) {
  if (r <= 0) return;
  const ctx = canvas.getContext("2d")!;
  let img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // naive separable blur for simplicity (small r recommended)
  const w = canvas.width, h = canvas.height;
  const tmp = new Uint8ClampedArray(img.data.length);
  const kernelSize = r * 2 + 1;

  // horizontal
  for (let y = 0; y < h; y++) {
    let rs = 0, gs = 0, bs = 0, as = 0;
    for (let x = -r; x <= r; x++) {
      const xi = Math.max(0, Math.min(w - 1, x));
      const idx = (y * w + xi) * 4;
      rs += img.data[idx];
      gs += img.data[idx + 1];
      bs += img.data[idx + 2];
      as += img.data[idx + 3];
    }
    for (let x = 0; x < w; x++) {
      const out = (y * w + x) * 4;
      tmp[out] = rs / kernelSize;
      tmp[out + 1] = gs / kernelSize;
      tmp[out + 2] = bs / kernelSize;
      tmp[out + 3] = as / kernelSize;
      // slide
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r + 1);
      let i0 = (y * w + x0) * 4;
      let i1 = (y * w + x1) * 4;
      rs += img.data[i1] - img.data[i0];
      gs += img.data[i1 + 1] - img.data[i0 + 1];
      bs += img.data[i1 + 2] - img.data[i0 + 2];
      as += img.data[i1 + 3] - img.data[i0 + 3];
    }
  }
  // vertical
  const out = img.data;
  for (let x = 0; x < w; x++) {
    let rs = 0, gs = 0, bs = 0, as = 0;
    for (let y = -r; y <= r; y++) {
      const yi = Math.max(0, Math.min(h - 1, y));
      const idx = (yi * w + x) * 4;
      rs += tmp[idx];
      gs += tmp[idx + 1];
      bs += tmp[idx + 2];
      as += tmp[idx + 3];
    }
    for (let y = 0; y < h; y++) {
      const o = (y * w + x) * 4;
      out[o] = rs / kernelSize;
      out[o + 1] = gs / kernelSize;
      out[o + 2] = bs / kernelSize;
      out[o + 3] = as / kernelSize;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r + 1);
      let i0 = (y0 * w + x) * 4;
      let i1 = (y1 * w + x) * 4;
      rs += tmp[i1] - tmp[i0];
      gs += tmp[i1 + 1] - tmp[i0 + 1];
      bs += tmp[i1 + 2] - tmp[i0 + 2];
      as += tmp[i1 + 3] - tmp[i0 + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
}

function pixelSort(canvas: HTMLCanvasElement, ratio: number) {
  // Extremely simple pseudo pixel-sort: randomly permute a ratio of rows
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const rows = Math.max(1, Math.round(h * ratio));
  for (let y = 0; y < rows; y++) {
    const row = img.data.slice(y * w * 4, (y + 1) * w * 4);
    // sort by brightness
    const tuples: number[][] = [];
    for (let x = 0; x < w; x++) {
      const i = x * 4;
      const r = row[i], g = row[i + 1], b = row[i + 2];
      const br = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      tuples.push([br, row[i], row[i + 1], row[i + 2], row[i + 3]]);
    }
    tuples.sort((a, b) => a[0] - b[0]);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = tuples[x];
      img.data[i] = t[1];
      img.data[i + 1] = t[2];
      img.data[i + 2] = t[3];
      img.data[i + 3] = t[4];
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- CSV helper ----------
function toCSV(rows: Array<Record<string, number | string>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows
    .map((r) => headers.map((h) => r[h]).join(","))
    .join("\n");
  return headers.join(",") + "\n" + body;
}

// ---------- Main component ----------
export default function Phase5() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgUrlB, setImgUrlB] = useState<string | null>(null);
  const [downscale, setDownscale] = useState(768);
  const [quantLevels, setQuantLevels] = useState(16);
  const [blurRadius, setBlurRadius] = useState(2);
  const [sortRatio, setSortRatio] = useState(0.15);
  const [autoRecord, setAutoRecord] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [stepDelay, setStepDelay] = useState(400);
  const [weights, setWeights] = useState({ gray: 0.4, chroma: 0.2, texture: 0.2, edges: 0.2 });
  const [trace, setTrace] = useState<Array<Record<string, number | string>>>([]);
  const [frame, setFrame] = useState(0);
  const [fullscreenSrc, setFullscreenSrc] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenImgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Adaptive canvas size based on container
  const [containerSize, setContainerSize] = useState({ w: 800, h: 520 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setContainerSize({ w: Math.floor(cr.width), h: Math.floor(Math.max(360, cr.height - 160)) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load image to canvas
  useEffect(() => {
    const img = hiddenImgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !imgUrl) return;
    img.onload = () => {
      drawImageToCanvas(img, canvas, downscale, downscale);
      if (autoRecord) measureAndRecord("init");
    };
    img.src = imgUrl;
  }, [imgUrl, downscale]);

  function handleFile(file: File, which: "A" | "B" = "A") {
    const url = URL.createObjectURL(file);
    if (which === "A") setImgUrl(url);
    else setImgUrlB(url);
  }

  function measureAndRecord(stepLabel: string) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { width: w, height: h } = canvas;
    const img = ctx.getImageData(0, 0, w, h);
    const gray = toGrayscale(img.data);
    const Hgray = shannonEntropy(gray);
    const { r, g, b } = perChannelEntropies(img.data);
    const Hchroma = (r + g + b) / 3;
    const lvar = localVarianceIndex(gray, w, h);
    const edges = sobelEdgeDensity(gray, w, h);
    const aesthetic =
      weights.gray * (Hgray / 8) +
      weights.chroma * (Hchroma / 8) +
      weights.texture * norm01(lvar) +
      weights.edges * norm01(edges);

    const row = {
      step: trace.length,
      label: stepLabel,
      Hgray: +Hgray.toFixed(3),
      Hchroma: +Hchroma.toFixed(3),
      texture: +lvar.toFixed(3),
      edges: +edges.toFixed(3),
      aesthetic: +aesthetic.toFixed(3),
    } as Record<string, number | string>;
    setTrace((t) => [...t, row]);
  }

  function norm01(x: number) {
    // Cheap stabilizer for visualization; adapts to running min/max
    const values = trace.length ? trace.map((r) => Number(r.texture)).concat(x) : [x, x + 1e-9];
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max === min ? 0 : (x - min) / (max - min);
  }

  function applyStep() {
    const c = canvasRef.current!;
    quantize(c, quantLevels);
    fastBoxBlur(c, blurRadius);
    pixelSort(c, sortRatio);
    if (autoRecord) measureAndRecord(`q${quantLevels}-b${blurRadius}-s${Math.round(sortRatio * 100)}%`);
    setFrame((f) => f + 1);
  }

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => applyStep(), Math.max(60, stepDelay));
    return () => clearInterval(id);
  }, [playing, quantLevels, blurRadius, sortRatio, stepDelay, autoRecord]);

  function resetCanvas() {
    const img = hiddenImgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !imgUrl) return;
    drawImageToCanvas(img, canvas, downscale, downscale);
    setTrace([]);
    setFrame(0);
    if (autoRecord) measureAndRecord("reset");
  }

  function exportCSV() {
    const csv = toCSV(trace);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `phase5_exhaustion_trace.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const comparisonReady = imgUrl && imgUrlB;

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-white">
      {/* Top header shared pattern */}
      <header className="sticky top-0 z-40 border-b border-white/10 backdrop-blur bg-black/40">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" className="text-xl font-bold tracking-widest" onClick={() => (window.location.href = "/")}>aeDNA</Button>
            <span className="text-white/50">/</span>
            <span className="text-sm uppercase tracking-wider">Phase 5 – Exhaustion & Aesthetic Entropy</span>
          </div>
          <nav className="hidden md:flex items-center gap-3 text-sm">
            <a href="/phase-3c" className="hover:text-white/90 text-white/60">3C</a>
            <a href="/phase-3d" className="hover:text-white/90 text-white/60">3D</a>
            <a href="/phase-4" className="hover:text-white/90 text-white/60">4</a>
            <span className="text-white">5</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 grid lg:grid-cols-[1.2fr_0.8fr] gap-4 items-start">
        {/* Left: Output & controls top-aligned side-by-side */}
        <div ref={containerRef} className="w-full">
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Output Image & Field Settings</CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setFullscreenSrc(canvasRef.current?.toDataURL() || null)}>
                  <Maximize2 className="h-4 w-4 mr-1"/> Fullscreen
                </Button>
                <Button size="sm" variant="outline" onClick={resetCanvas}><RotateCcw className="h-4 w-4 mr-1"/> Reset</Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Image + controls side-by-side on xl, stacked on small */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/50">
                  <canvas
                    ref={canvasRef}
                    className="block w-full h-auto"
                    style={{ maxHeight: containerSize.h }}
                    width={containerSize.w}
                    height={containerSize.h}
                  />
                  {!imgUrl && (
                    <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
                      Upload an image to begin
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <Label className="text-white/70">Upload (A)</Label>
                    <Uploader onFile={(f) => handleFile(f, "A")} />
                    <Label className="text-white/70">Optional Comparison (B)</Label>
                    <Uploader onFile={(f) => handleFile(f, "B")} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <LabeledSlider label={`Downscale: ${downscale}px`} min={256} max={1536} step={64} value={downscale} onChange={setDownscale} />
                    <LabeledSlider label={`Quantization levels: ${quantLevels}`} min={2} max={64} step={1} value={quantLevels} onChange={setQuantLevels} />
                    <LabeledSlider label={`Blur radius: ${blurRadius}`} min={0} max={8} step={1} value={blurRadius} onChange={setBlurRadius} />
                    <LabeledSlider label={`Pixel sort rows: ${(sortRatio*100).toFixed(0)}%`} min={0} max={1} step={0.01} value={sortRatio} onChange={setSortRatio} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <ToggleRow label="Auto-record" checked={autoRecord} onCheckedChange={setAutoRecord} />
                    <div className="flex items-center gap-3">
                      <Button size="sm" onClick={applyStep}><Play className="h-4 w-4 mr-1"/> Step</Button>
                      <Button size="sm" variant={playing ? "destructive" : "default"} onClick={() => setPlaying(!playing)}>
                        {playing ? (<><Pause className="h-4 w-4 mr-1"/> Pause</>) : (<><Play className="h-4 w-4 mr-1"/> Auto</>)}
                      </Button>
                    </div>
                    <LabeledSlider label={`Auto step delay: ${stepDelay}ms`} min={60} max={2000} step={20} value={stepDelay} onChange={setStepDelay} />
                    <Button variant="outline" size="sm" onClick={exportCSV}><Save className="h-4 w-4 mr-1"/> Export CSV</Button>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-white/70">Aesthetic Entropy Weights</div>
                    <WeightRow label="Grayscale H" value={weights.gray} onChange={(v) => setWeights({ ...weights, gray: v })} />
                    <WeightRow label="Chromatic H" value={weights.chroma} onChange={(v) => setWeights({ ...weights, chroma: v })} />
                    <WeightRow label="Texture (var)" value={weights.texture} onChange={(v) => setWeights({ ...weights, texture: v })} />
                    <WeightRow label="Edges (Sobel)" value={weights.edges} onChange={(v) => setWeights({ ...weights, edges: v })} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Metrics & Exhaustion curve */}
        <div className="space-y-4">
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">Live Metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <MetricReadout canvasRef={canvasRef} trace={trace} />
              {comparisonReady && (
                <div className="text-xs text-white/60">Tip: toggle between A and B by loading B into the left canvas via Reset & Upload, then re-run steps to compare traces.</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">Exhaustion Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trace} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="step" stroke="#aaa" tick={{ fill: "#aaa" }} />
                    <YAxis stroke="#aaa" tick={{ fill: "#aaa" }} />
                    <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
                    <Line type="monotone" dataKey="aesthetic" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="Hgray" dot={false} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="Hchroma" dot={false} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="edges" dot={false} strokeWidth={1} />
                    <Line type="monotone" dataKey="texture" dot={false} strokeWidth={1} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">How it works</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-white/80 space-y-3">
              <p><strong>Shannon entropy</strong> is computed over a 256-bin histogram of the grayscale image (8-bit), yielding 0–8 bits. For color, we average per-channel entropies.</p>
              <p><strong>Local variance index</strong> estimates texture by averaging 3×3 neighborhood variance; higher values ≈ more micro-contrast.</p>
              <p><strong>Edge density</strong> uses Sobel gradients to estimate mean gradient magnitude—our proxy for edge richness.</p>
              <p><strong>Aesthetic Entropy</strong> combines the four via tunable weights, normalizing non-bit metrics by a running min/max for stability. Use the weights to match your aesthetic theory.</p>
              <p><strong>Exhaustion curve</strong> records metrics after each transform step (quantize → blur → pixel-sort). As images are simplified or scrambled, curves typically rise then decay—your quantitative window into creative exhaustion.</p>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Hidden loader */}
      <img ref={hiddenImgRef} alt="hidden-loader" className="hidden" />

      {fullscreenSrc && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setFullscreenSrc(null)}>
          <Button variant="ghost" className="absolute top-4 right-4" onClick={() => setFullscreenSrc(null)}>
            <X className="h-5 w-5"/>
          </Button>
          <img src={fullscreenSrc} alt="fullscreen" className="max-w-full max-h-full rounded-xl border border-white/10" />
        </div>
      )}
    </div>
  );
}

// ---------- Subcomponents ----------
function Uploader({ onFile }: { onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
      className={`rounded-xl border ${dragOver ? 'border-white/60' : 'border-white/10'} bg-black/40 p-3 flex items-center justify-between gap-3`}
    >
      <div className="flex items-center gap-3 text-white/70 text-sm">
        <Upload className="h-4 w-4"/> Drag & drop or
        <Button size="sm" onClick={() => inputRef.current?.click()}>Browse</Button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
        if (e.target.files && e.target.files[0]) onFile(e.target.files[0]);
      }} />
    </div>
  );
}

function LabeledSlider({ label, min, max, step, value, onChange }:{ label:string; min:number; max:number; step:number; value:number; onChange:(v:number)=>void }){
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="space-y-1">
      <div className="text-xs text-white/70">{label}</div>
      <Slider value={[v]} min={min} max={max} step={step} onValueChange={(arr)=> setV(arr[0])} onValueCommit={(arr)=> onChange(arr[0])} />
    </div>
  );
}

function ToggleRow({ label, checked, onCheckedChange }:{ label:string; checked:boolean; onCheckedChange:(b:boolean)=>void }){
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2">
      <span className="text-sm text-white/80">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function WeightRow({ label, value, onChange }:{ label:string; value:number; onChange:(v:number)=>void }){
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs text-white/70">{label}</div>
      <div className="flex-1"><Slider min={0} max={1} step={0.01} value={[value]} onValueChange={(a)=> onChange(a[0])} /></div>
      <div className="w-12 text-right text-xs text-white/60">{value.toFixed(2)}</div>
    </div>
  );
}

function MetricReadout({ canvasRef, trace }:{ canvasRef: React.RefObject<HTMLCanvasElement>; trace: Array<Record<string, number | string>> }){
  const [metrics, setMetrics] = useState({ Hgray: 0, Hchroma: 0, texture: 0, edges: 0, aesthetic: 0 });

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    try {
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const gray = toGrayscale(img.data);
      const Hgray = shannonEntropy(gray);
      const { r, g, b } = perChannelEntropies(img.data);
      const Hchroma = (r + g + b) / 3;
      const texture = localVarianceIndex(gray, c.width, c.height);
      const edges = sobelEdgeDensity(gray, c.width, c.height);
      setMetrics({ Hgray, Hchroma, texture, edges, aesthetic: trace.length ? Number(trace[trace.length - 1].aesthetic) : 0 });
    } catch {}
  }, [canvasRef?.current, trace]);

  return (
    <div className="grid grid-cols-2 gap-3">
      <MetricBox label="Grayscale entropy (bits)" value={metrics.Hgray} />
      <MetricBox label="Chromatic entropy (bits)" value={metrics.Hchroma} />
      <MetricBox label="Texture (local var)" value={metrics.texture} />
      <MetricBox label="Edges (mean grad)" value={metrics.edges} />
      <MetricBox label="Aesthetic Entropy" value={metrics.aesthetic} highlight />
    </div>
  );
}

function MetricBox({ label, value, highlight }:{ label:string; value:number; highlight?:boolean }){
  return (
    <div className={`rounded-xl border ${highlight ? 'border-white/60' : 'border-white/10'} bg-black/40 p-3`}>
      <div className="text-xs text-white/60">{label}</div>
      <div className="text-xl font-semibold">{Number.isFinite(value) ? value.toFixed(3) : "—"}</div>
    </div>
  );
}
