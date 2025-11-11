"use client";

import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Download, RefreshCw, Play, Pause, RotateCcw } from "lucide-react";
import { ToolHeader } from "../../components/ToolHeader";
import { ClipboardViewer, ClipboardButton, saveToClipboard } from "../../components/ClipboardViewer";
import { Cropper } from "../../components/CropperWithMenu";

type Vec2 = { x: number; y: number };

type Triangle = {
  a: Vec2;
  b: Vec2;
  c: Vec2;
  depth: number;
  mean?: number;
  variance?: number;
};

// ========== UI Components ==========

const Panel: React.FC<React.PropsWithChildren<{ title?: string; right?: React.ReactNode }>> = ({ title, right, children }) => (
  <div className="rounded-2xl bg-neutral-900/40 border border-neutral-800 backdrop-blur p-4 md:p-6 shadow-xl">
    {(title || right) && (
      <div className="flex items-center justify-between mb-3">
        {title ? <h3 className="text-lg md:text-xl font-semibold tracking-tight text-neutral-100">{title}</h3> : <div />}
        {right}
      </div>
    )}
    {children}
  </div>
);

const Slider: React.FC<{ label: string; min: number; max: number; step: number; value: number; onChange: (v:number)=>void }> = ({ label, min, max, step, value, onChange }) => (
  <div className="space-y-0.5">
    <label className="text-xs text-neutral-300">{label}</label>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e)=>onChange(parseFloat(e.target.value))} className="w-full accent-teal-400" />
  </div>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v:boolean)=>void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-2 text-xs">
    <span className="text-neutral-300">{label}</span>
    <button onClick={()=>onChange(!checked)} className={`w-10 h-6 rounded-full border transition relative ${checked?"bg-teal-500/30 border-teal-400":"bg-neutral-800 border-neutral-700"}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition ${checked?"translate-x-4 bg-teal-400":"bg-neutral-500"}`}></span>
    </button>
  </label>
);

// ========== Geometry Helpers ==========

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function len2(p: Vec2, q: Vec2) {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2) {
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
  if (ab >= bc && ab >= ca) return [a, b, c] as const;
  if (bc >= ab && bc >= ca) return [b, c, a] as const;
  return [c, a, b] as const;
}

function midpoint(p: Vec2, q: Vec2): Vec2 {
  return { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5 };
}

// ========== Image Processing ==========

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
  let M2 = 0;

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

// ========== Main Component ==========

export default function FractalizationLab() {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showImage, setShowImage] = useState(true);
  const [wireframe, setWireframe] = useState(true);
  const [fillAlpha, setFillAlpha] = useState(0.35);
  const [threshold, setThreshold] = useState(0.010);
  const [maxDepth, setMaxDepth] = useState(8);
  const [minEdge, setMinEdge] = useState(6);
  const [batch, setBatch] = useState(250);
  const [sampleStep, setSampleStep] = useState(2);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ refined: 0, total: 0 });
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
  const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
  const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showCropMenu, setShowCropMenu] = useState(false);
  const cropMenuRef = useRef<HTMLDivElement>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const underlayRef = useRef<HTMLCanvasElement | null>(null);
  const [gradData, setGradData] = useState<{ w: number; h: number; grad: Float32Array } | null>(null);

  const triQueue = useRef<Triangle[]>([]);
  const triFinal = useRef<Triangle[]>([]);
  const rafRef = useRef<number | null>(null);

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    setImgPreview(url);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleClipboardImage(record: any) {
    const url = URL.createObjectURL(record.blob);
    setImgSrc(url);
    setImgPreview(url);
    setClipboardOpen(false);
  }

  // Cropping handlers
  const handleCrop = (type: "square" | "circle" | "custom") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setOutputDataURL(canvas.toDataURL("image/png"));
    setCropMode(type);
    setShowCropMenu(false);
  };

  const onCrop = (result: { blob: Blob; dataUrl: string; width: number; height: number }) => {
    setCroppedResult({ blob: result.blob, dataUrl: result.dataUrl });
    setCropMode(null);
  };

  const exportToStudio = async () => {
    if (!croppedResult) return;
    try {
      await saveToClipboard(croppedResult.blob, `fractalization_cropped_${Date.now()}.png`);
      alert("✓ Saved to Studio clipboard!");
      setCroppedResult(null);
    } catch (err) {
      console.error("Clipboard error:", err);
      alert("Failed to save to clipboard");
    }
  };

  // Close crop menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (cropMenuRef.current && !cropMenuRef.current.contains(event.target as Node)) {
        setShowCropMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!imgSrc) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgSrc;
    img.onload = () => {
      imgRef.current = img;
      const computed = computeGradMag(img, 640, 640);
      setGradData(computed);
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
      resetTessellation(computed.w, computed.h);
    };
  }, [imgSrc]);

  function resetTessellation(w: number, h: number) {
    triQueue.current = [];
    triFinal.current = [];
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
    const e1 = len2(tri.a, tri.b);
    const e2 = len2(tri.b, tri.c);
    const e3 = len2(tri.c, tri.a);
    const smallest = Math.min(e1, e2, e3);
    if (smallest <= minEdge || tri.depth >= maxDepth) return null;

    const stats = sampleTriStats(tri, grad, w, h, sampleStep);
    tri.mean = stats.mean;
    tri.variance = stats.variance;

    if (stats.variance < threshold) return null;

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

    if (showImage && underlayRef.current) {
      ctx.drawImage(underlayRef.current, 0, 0);
    }

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
    if (!gradData || isRunning) return;
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
  }

  function exportPNG() {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "fractalization.png";
    a.click();
  }

  function reset() {
    setShowImage(true);
    setWireframe(true);
    setFillAlpha(0.35);
    setThreshold(0.010);
    setMaxDepth(8);
    setMinEdge(6);
    setBatch(250);
    setSampleStep(2);
  }

  return (
    <div className="min-h-screen w-full bg-[#0D0D0F] text-neutral-200">
      <ToolHeader />
      <div className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Fractalization Lab</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Controls */}
          <div className="space-y-6">
            <Panel title="Source & Settings" right={<button onClick={reset} className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"><RefreshCw className="h-3.5 w-3.5"/>Reset</button>}>
              <div className="space-y-3">
                {/* Image upload + Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={onDrop}
                      className={`group relative rounded-lg border overflow-hidden transition ${
                        isDragging ? "border-dashed border-teal-400" : "border-neutral-800"
                      }`}
                      style={{minHeight: '120px'}}
                    >
                      {imgPreview ? (
                        <img src={imgPreview} alt="preview" className="w-full h-full object-cover" style={{minHeight: '120px'}} />
                      ) : (
                        <div className="grid place-items-center bg-black/30 p-3" style={{minHeight: '120px'}}>
                          <div className="text-center">
                            <div className="text-xs text-neutral-400 mb-2">Drag & drop or upload</div>
                            <div className="text-[10px] text-neutral-500 mb-2">PNG / JPG</div>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setClipboardOpen(true);
                              }}
                              className="text-[11px] text-teal-400 hover:text-teal-300 underline"
                            >
                              Choose from Clipboard
                            </button>
                          </div>
                        </div>
                      )}
                      <label className="absolute inset-0 cursor-pointer" style={{ pointerEvents: imgPreview ? 'auto' : 'none' }}>
                        <input type="file" accept="image/*" onChange={onFile} className="hidden" />
                      </label>
                      {imgPreview && (
                        <div className="absolute bottom-1.5 right-1.5">
                          <label className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-black/70 border border-neutral-700 cursor-pointer hover:bg-black/80">
                            <ImagePlus className="h-3 w-3"/>
                            <input type="file" accept="image/*" onChange={onFile} className="hidden" />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Display toggles */}
                  <div className="space-y-2">
                    <div className="text-xs text-neutral-300 mb-1">Display</div>
                    <Toggle label="Gradient underlay" checked={showImage} onChange={setShowImage} />
                    <Toggle label="Wireframe" checked={wireframe} onChange={setWireframe} />
                  </div>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Tessellation params */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Slider label={`Threshold (${threshold.toFixed(3)})`} min={0.001} max={0.05} step={0.001} value={threshold} onChange={setThreshold} />
                  <Slider label={`Max depth (${maxDepth})`} min={1} max={10} step={1} value={maxDepth} onChange={setMaxDepth} />
                  <Slider label={`Min edge (${minEdge}px)`} min={2} max={20} step={1} value={minEdge} onChange={setMinEdge} />
                  <Slider label={`Batch (${batch})`} min={10} max={1000} step={10} value={batch} onChange={setBatch} />
                  <Slider label={`Sample step (${sampleStep})`} min={1} max={6} step={1} value={sampleStep} onChange={setSampleStep} />
                  <Slider label={`Fill α (${fillAlpha.toFixed(2)})`} min={0} max={1} step={0.05} value={fillAlpha} onChange={setFillAlpha} />
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={start}
                    disabled={isRunning || !gradData}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-teal-500/20 border border-teal-400/50 hover:bg-teal-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="h-3.5 w-3.5" /> Run
                  </button>
                  <button
                    onClick={pause}
                    disabled={!isRunning}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-red-900/30 border border-red-700 hover:bg-red-900/40 disabled:opacity-50"
                  >
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </button>
                  <button
                    onClick={restart}
                    disabled={!gradData}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restart
                  </button>
                  <button
                    onClick={() => setClipboardOpen(true)}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    title="Open Clipboard"
                  >
                    📋
                  </button>
                </div>

                {/* Progress */}
                <div className="text-xs text-neutral-500">
                  Refined: <span className="tabular-nums text-neutral-300">{progress.refined}</span> · Total: <span className="tabular-nums text-neutral-300">{progress.total}</span>
                </div>
              </div>
            </Panel>
          </div>

          {/* Right: Output */}
          <div className="space-y-6">
            <Panel title="Output" right={
              <div className="flex gap-2">
                {imgSrc && !cropMode && (
                  <div className="relative" ref={cropMenuRef}>
                    <button
                      onClick={() => setShowCropMenu(!showCropMenu)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    >
                      ✂️ Crop
                    </button>
                    {showCropMenu && (
                      <div className="absolute top-full right-0 mt-1 w-32 rounded-lg border border-neutral-800 bg-neutral-900/95 backdrop-blur shadow-2xl z-50 overflow-hidden">
                        <button onClick={() => handleCrop("square")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Square</button>
                        <button onClick={() => handleCrop("circle")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Circle</button>
                        <button onClick={() => handleCrop("custom")} className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 transition">Custom</button>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={exportPNG} className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"><Download className="h-3.5 w-3.5"/>PNG</button>
              </div>
            }>
              <div className="relative">
                {cropMode && outputDataURL ? (
                  <div className="relative w-full h-full">
                    <button
                      onClick={() => setCropMode(null)}
                      className="absolute top-2 right-2 z-10 px-3 py-1 rounded-lg bg-red-800/90 hover:bg-red-700 border border-red-700 text-xs"
                    >
                      Cancel
                    </button>
                    <Cropper
                      src={outputDataURL}
                      mode={cropMode}
                      onCrop={onCrop}
                    />
                  </div>
                ) : (
                  <>
                    <canvas ref={canvasRef} className="w-full rounded-xl border border-neutral-800 bg-black/40 select-none" style={{maxWidth: '100%', height: 'auto'}} />
                    {!imgSrc && (
                      <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm rounded-xl border border-neutral-800 bg-black/40" style={{minHeight: '300px'}}>
                        Upload an image to begin
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="mt-3 p-3 rounded-xl border border-neutral-800 bg-black/30">
                <div className="text-xs font-medium text-neutral-300 mb-2">How it works</div>
                <ul className="text-xs space-y-1 text-neutral-400 list-disc pl-4">
                  <li>Computes Sobel gradient magnitude</li>
                  <li>Starts with 2 triangles covering image</li>
                  <li>Splits triangles with high gradient variance</li>
                  <li>Uses longest-edge bisection</li>
                  <li>Adaptive density: dense mesh in complex regions</li>
                </ul>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* Hidden canvases */}
      <canvas ref={underlayRef} className="hidden" />

      {/* Export Dialog */}
      {croppedResult && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setCroppedResult(null)}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">Export Cropped Image</h3>
            <img src={croppedResult.dataUrl} alt="cropped" className="w-full h-auto rounded-xl border border-neutral-800 mb-4" />
            <div className="flex gap-3">
              <button
                onClick={exportToStudio}
                className="flex-1 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 text-sm"
              >
                📋 Export to Studio
              </button>
              <button
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = croppedResult.dataUrl;
                  a.download = `fractalization_cropped_${Date.now()}.png`;
                  a.click();
                  setCroppedResult(null);
                }}
                className="flex-1 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
              >
                💾 Download
              </button>
              <button
                onClick={() => setCroppedResult(null)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clipboard Viewer */}
      <ClipboardViewer 
        isOpen={clipboardOpen} 
        onClose={() => setClipboardOpen(false)}
        onImageSelect={handleClipboardImage}
      />
      
      {/* Clipboard Button */}
      <ClipboardButton onClick={() => setClipboardOpen(true)} />
    </div>
  );
}

