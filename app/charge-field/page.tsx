// app/charge-field/page.tsx
// Multi-Scale Aesthetic Charge Field

"use client";

import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Download } from "lucide-react";
import { ToolHeader } from "../../components/ToolHeader";
import { usePageState } from "../../lib/usePageState";
import { Cropper } from "../../components/CropperWithMenu";
import { ClipboardViewer, ClipboardButton, saveToClipboard } from "../../components/ClipboardViewer";

// ========== Utilities ==========

function clamp01(x: number) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function normalize01(arr: Float32Array): Float32Array {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) { 
    const v = arr[i]; 
    if (v < lo) lo = v; 
    if (v > hi) hi = v; 
  }
  const d = hi - lo || 1e-6;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - lo) / d;
  return out;
}

function rgbToLuma(data: Uint8ClampedArray): Float32Array {
  const n = (data.length / 4) | 0;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = data[j] / 255, g = data[j + 1] / 255, b = data[j + 2] / 255;
    out[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return out;
}

function blur3x3(src: Float32Array, W: number, H: number): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);

  // Horizontal
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const a = src[row + Math.max(0, x - 1)];
      const b = src[row + x] * 2.0;
      const c = src[row + Math.min(W - 1, x + 1)];
      tmp[row + x] = (a + b + c) * 0.25;
    }
  }
  // Vertical
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i0 = Math.max(0, y - 1) * W + x;
      const i1 = y * W + x;
      const i2 = Math.min(H - 1, y + 1) * W + x;
      const a = tmp[i0];
      const b = tmp[i1] * 2.0;
      const c = tmp[i2];
      out[i1] = (a + b + c) * 0.25;
    }
  }
  return out;
}

function blur3x3Iter(src: Float32Array, W: number, H: number, iters: number): Float32Array {
  let cur = src;
  for (let i = 0; i < iters; i++) cur = blur3x3(cur, W, H);
  return cur === src ? src.slice() : cur;
}

function downsampleBilinear(src: Float32Array, W: number, H: number, W2: number, H2: number): Float32Array {
  const out = new Float32Array(W2 * H2);
  const xScale = (W - 1) / Math.max(1, (W2 - 1));
  const yScale = (H - 1) / Math.max(1, (H2 - 1));
  let idx = 0;
  for (let y2 = 0; y2 < H2; y2++) {
    const y = y2 * yScale;
    const y0 = Math.floor(y), y1 = Math.min(H - 1, y0 + 1);
    const wy = y - y0;
    for (let x2 = 0; x2 < W2; x2++, idx++) {
      const x = x2 * xScale;
      const x0 = Math.floor(x), x1 = Math.min(W - 1, x0 + 1);
      const wx = x - x0;
      const i00 = y0 * W + x0, i01 = y0 * W + x1, i10 = y1 * W + x0, i11 = y1 * W + x1;
      const v = (1 - wy) * ((1 - wx) * src[i00] + wx * src[i01]) + wy * ((1 - wx) * src[i10] + wx * src[i11]);
      out[idx] = v;
    }
  }
  return out;
}

function upsampleBilinear(src: Float32Array, W: number, H: number, W2: number, H2: number): Float32Array {
  return downsampleBilinear(src, W, H, W2, H2);
}

function axpy(dst: Float32Array, src: Float32Array, a: number = 1) {
  for (let i = 0; i < dst.length; i++) dst[i] += a * src[i];
}

// ========== Multi-scale Components ==========

function buildPyramid(L: Float32Array, W: number, H: number, levels: number) {
  const pyr: { data: Float32Array; W: number; H: number }[] = [{ data: L, W, H }];
  for (let k = 1; k < levels; k++) {
    const { data, W: w, H: h } = pyr[k - 1];
    const w2 = Math.max(1, (w / 2) | 0), h2 = Math.max(1, (h / 2) | 0);
    const d2 = downsampleBilinear(data, w, h, w2, h2);
    pyr.push({ data: d2, W: w2, H: h2 });
  }
  return pyr;
}

function localBandpass3x3(img: Float32Array, W: number, H: number): Float32Array {
  const blur = blur3x3(img, W, H);
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = Math.abs(img[i] - blur[i]);
  return normalize01(out);
}

function multiScaleContrast(L: Float32Array, W: number, H: number, levels: number, alphas: number[]): Float32Array {
  const pyr = buildPyramid(L, W, H, levels);
  let acc = new Float32Array(W * H);
  for (let k = 0; k < pyr.length; k++) {
    const { data, W: w, H: h } = pyr[k];
    const band = localBandpass3x3(data, w, h);
    const up = upsampleBilinear(band, w, h, W, H);
    axpy(acc, up, alphas[k] || 1.0);
  }
  return normalize01(acc);
}

function globalLuminancePull(L: Float32Array): Float32Array {
  const sorted = Array.from(L).sort((a, b) => a - b);
  const med = sorted[(sorted.length / 2) | 0];
  const out = new Float32Array(L.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.abs(L[i] - med);
  return normalize01(out);
}

function lowFreqSalience(L: Float32Array, W: number, H: number): Float32Array {
  const w2 = Math.max(1, (W / 16) | 0), h2 = Math.max(1, (H / 16) | 0);
  const small = downsampleBilinear(L, W, H, w2, h2);
  const b1 = blur3x3Iter(small, w2, h2, 1);
  const b2 = blur3x3Iter(small, w2, h2, 3);
  const dog = new Float32Array(w2 * h2);
  for (let i = 0; i < dog.length; i++) dog[i] = Math.abs(b1[i] - b2[i]);
  const up = upsampleBilinear(normalize01(dog), w2, h2, W, H);
  return normalize01(up);
}

function aestheticCharge(L: Float32Array, W: number, H: number, params: any): Float32Array {
  const { levels = 4, alpha = [0.6, 0.9, 1.2, 1.4], beta = 0.6, gamma = 0.5, squash = 1.2 } = params || {};
  const ms = multiScaleContrast(L, W, H, levels, alpha);
  const gl = globalLuminancePull(L);
  const lf = lowFreqSalience(L, W, H);
  const out = new Float32Array(L.length);
  for (let i = 0; i < out.length; i++) {
    const v = ms[i] + beta * gl[i] + gamma * lf[i];
    out[i] = Math.tanh(squash * v);
  }
  return normalize01(out);
}

function guidedSmooth(signal: Float32Array, guide: Float32Array, W: number, H: number, strength: number, iters: number): Float32Array {
  let cur = signal;
  for (let t = 0; t < iters; t++) {
    const blur = blur3x3(cur, W, H);
    const out = new Float32Array(cur.length);
    const gx = new Float32Array(cur.length), gy = new Float32Array(cur.length);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        gx[i] = (guide[i + 1] - guide[i - 1]) * 0.5;
        gy[i] = (guide[i + W] - guide[i - W]) * 0.5;
      }
    }
    for (let i = 0; i < out.length; i++) {
      const grad = Math.min(1, Math.hypot(gx[i], gy[i]) * 4.0);
      const k = strength * (1.0 - grad);
      out[i] = cur[i] * (1 - k) + blur[i] * k;
    }
    cur = out;
  }
  return cur;
}

// Turbo colormap
function turboColor(v: number): [number, number, number] {
  const x = clamp01(v);
  const r = 34.61 + x * (1172.33 - x * (10793.6 - x * (33300.1 - x * (38394.5 - x * 14825.0))));
  const g = 23.31 + x * (557.33 - x * (1225.0 - x * (3574.3 - x * (1073.77 + x * 707.56))));
  const b = 27.2 + x * (3211.1 - x * (15327.97 - x * (27814.0 - x * (22569.18 - x * 6838.66))));
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

function paintHeatmapToImageData(buf01: Float32Array, W: number, H: number): ImageData {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0, j = 0; i < buf01.length; i++, j += 4) {
    const [r, g, b] = turboColor(buf01[i]);
    out[j] = (r * 255) | 0; 
    out[j + 1] = (g * 255) | 0; 
    out[j + 2] = (b * 255) | 0; 
    out[j + 3] = 255;
  }
  return new ImageData(out, W, H);
}

// ========== Main Component ==========

export default function ChargeFieldPage() {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);

  const [uploaded, setUploaded] = useState<HTMLImageElement | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
  const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
  const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showCropMenu, setShowCropMenu] = useState(false);
  const cropMenuRef = useRef<HTMLDivElement>(null);
  const [clipboardOpen, setClipboardOpen] = useState(false);

  // Persisted state - remembers settings across navigation
  const [persistedState, setPersistedState] = usePageState("charge-field", {
    params: { 
      levels: 4, 
      alpha: [0.6, 0.9, 1.2, 1.4], 
      beta: 0.8, 
      gamma: 0.5, 
      squash: 1.2, 
      smooth: 0.35 
    },
    view: 'charge' as 'charge' | 'ms' | 'gl' | 'lf',
  });

  const { params, view } = persistedState;
  const setParams = (p: typeof params) => setPersistedState(prev => ({ ...prev, params: p }));
  const setView = (v: typeof view) => setPersistedState(prev => ({ ...prev, view: v }));

  // Metrics
  const [maxCharge, setMaxCharge] = useState(0);
  const [meanCharge, setMeanCharge] = useState(0);

  // Cropping handlers
  const handleCrop = (type: "square" | "circle" | "custom") => {
    const canvas = heatRef.current;
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
      await saveToClipboard(croppedResult.blob, `charge_field_cropped_${Date.now()}.png`);
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

  const handleFile = (file: File) => {
    if (typeof Image === 'undefined') return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setUploaded(img);
        setImgPreview(reader.result as string);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleClipboardImage = (record: any) => {
    if (typeof Image === 'undefined') return;
    const url = URL.createObjectURL(record.blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setUploaded(img);
      setImgPreview(url);
      setClipboardOpen(false);
    };
    img.src = url;
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const render = () => {
    if (!uploaded || !baseRef.current || !heatRef.current) return;

    const base = baseRef.current;
    const heat = heatRef.current;
    const maxW = 960;
    const scale = Math.min(1, maxW / uploaded.naturalWidth);
    base.width = (uploaded.naturalWidth * scale) | 0;
    base.height = (uploaded.naturalHeight * scale) | 0;
    heat.width = base.width;
    heat.height = base.height;

    const bctx = base.getContext('2d')!;
    bctx.clearRect(0, 0, base.width, base.height);
    bctx.drawImage(uploaded, 0, 0, base.width, base.height);

    const id = bctx.getImageData(0, 0, base.width, base.height);
    const L = rgbToLuma(id.data);
    let buf: Float32Array;

    if (view === 'charge') {
      buf = aestheticCharge(L, base.width, base.height, params);
      buf = guidedSmooth(buf, L, base.width, base.height, params.smooth, 1);
    } else if (view === 'ms') {
      buf = multiScaleContrast(L, base.width, base.height, params.levels, params.alpha);
    } else if (view === 'gl') {
      buf = globalLuminancePull(L);
    } else {
      buf = lowFreqSalience(L, base.width, base.height);
    }

    // Compute metrics
    let max = 0, sum = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] > max) max = buf[i];
      sum += buf[i];
    }
    setMaxCharge(max);
    setMeanCharge(sum / buf.length);

    // Paint heatmap
    const hctx = heat.getContext('2d')!;
    hctx.clearRect(0, 0, heat.width, heat.height);
    const hm = paintHeatmapToImageData(normalize01(buf), heat.width, heat.height);
    hctx.putImageData(hm, 0, 0);
  };

  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploaded, params, view]);

  const aggLabel = (v: number) => (v === 0 ? "—" : v.toFixed(3));

  return (
    <div className="min-h-screen w-full bg-[#0D0D0F] text-neutral-200">
      <ToolHeader />
      <main className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Multi-Scale Aesthetic Charge</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input + Controls */}
          <div>
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <div className="space-y-3">
                {/* Image Upload + Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Upload */}
                  <div>
                    <div className="text-xs text-neutral-300 mb-2">Input Image</div>
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
                        <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                      </label>
                      {imgPreview && (
                        <div className="absolute bottom-1.5 right-1.5">
                          <label className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-black/70 border border-neutral-700 cursor-pointer hover:bg-black/80">
                            <ImagePlus className="h-3 w-3"/>
                            <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Metrics */}
                  <div>
                    <div className="text-xs text-neutral-300 mb-2">Charge Metrics</div>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="rounded border border-neutral-800 bg-black/30 p-2">
                        <div className="text-[9px] text-neutral-500">Max Q</div>
                        <div className="text-sm font-semibold text-neutral-200">{aggLabel(maxCharge)}</div>
                      </div>
                      <div className="rounded border border-neutral-800 bg-black/30 p-2">
                        <div className="text-[9px] text-neutral-500">Mean Q</div>
                        <div className="text-sm font-semibold text-neutral-200">{aggLabel(meanCharge)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* View selector */}
                <div>
                  <div className="text-xs text-neutral-300 mb-2">View Mode</div>
                  <div className="inline-flex p-0.5 bg-neutral-900/60 rounded-xl border border-neutral-800 w-full">
                    <button onClick={() => setView('charge')} className={`flex-1 px-2.5 py-1 rounded-lg text-xs transition ${view === "charge" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>Charge</button>
                    <button onClick={() => setView('ms')} className={`flex-1 px-2.5 py-1 rounded-lg text-xs transition ${view === "ms" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>Multi-Scale</button>
                    <button onClick={() => setView('gl')} className={`flex-1 px-2.5 py-1 rounded-lg text-xs transition ${view === "gl" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>Global</button>
                    <button onClick={() => setView('lf')} className={`flex-1 px-2.5 py-1 rounded-lg text-xs transition ${view === "lf" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white"}`}>Low-Freq</button>
                  </div>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Controls */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Levels ({params.levels})</label>
                    <input type="range" min={3} max={6} value={params.levels} onChange={(e) => setParams({ ...params, levels: parseInt(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">β Global ({params.beta.toFixed(2)})</label>
                    <input type="range" min={0} max={1.5} step={0.05} value={params.beta} onChange={(e) => setParams({ ...params, beta: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">γ Low-Freq ({params.gamma.toFixed(2)})</label>
                    <input type="range" min={0} max={1.5} step={0.05} value={params.gamma} onChange={(e) => setParams({ ...params, gamma: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Squash ({params.squash.toFixed(2)})</label>
                    <input type="range" min={0.5} max={2.0} step={0.05} value={params.squash} onChange={(e) => setParams({ ...params, squash: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5 col-span-2">
                    <label className="text-neutral-300">Edge-Aware Smoothing ({params.smooth.toFixed(2)})</label>
                    <input type="range" min={0} max={0.8} step={0.05} value={params.smooth} onChange={(e) => setParams({ ...params, smooth: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Output */}
          <div>
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-neutral-300">Charge Field</h3>
                {uploaded && !cropMode && (
                  <div className="flex gap-2">
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
                    <button
                      onClick={async () => {
                        const canvas = heatRef.current;
                        if (!canvas) return;
                        try {
                          const blob = await new Promise<Blob>((resolve, reject) => {
                            canvas.toBlob((b) => b ? resolve(b) : reject(), "image/png");
                          });
                          const item = new ClipboardItem({ "image/png": blob });
                          await navigator.clipboard.write([item]);
                          alert("Copied to system clipboard! Open Studio to paste.");
                        } catch (err) {
                          console.error("Clipboard error:", err);
                          alert("Failed to copy to clipboard");
                        }
                      }}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    >
                      📋 Studio
                    </button>
                    <button
                      onClick={() => {
                        const canvas = heatRef.current;
                        if (!canvas) return;
                        canvas.toBlob((blob) => {
                          if (!blob) return;
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `charge_field_${Date.now()}.png`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }, "image/png");
                      }}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    >
                      <Download className="h-3.5 w-3.5"/>
                    </button>
                  </div>
                )}
              </div>
              <div className="relative flex-1 flex items-center justify-center">
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
                    <canvas ref={heatRef} className="w-full rounded-xl border border-neutral-800 bg-black/40" style={{maxWidth: '100%', height: 'auto'}} />
                    <canvas ref={baseRef} className="hidden" />
                    {!uploaded && (
                      <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm">
                        Upload an image to begin
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

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
                  a.download = `cropped_${Date.now()}.png`;
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
