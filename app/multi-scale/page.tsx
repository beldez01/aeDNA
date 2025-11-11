"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ImagePlus, Wand2, Pause, RotateCcw, Maximize2, Settings, Save, Upload, Download, X } from "lucide-react";
import dynamic from "next/dynamic";
import { ToolHeader } from "../../components/ToolHeader";
import { drawImageToCanvas, toGrayscaleU8 } from "../../lib/complexity/utils-client";
import { ClipboardViewer, ClipboardButton, saveToClipboard } from "../../components/ClipboardViewer";
import { Cropper } from "../../components/CropperWithMenu";

// Lazy-load charts
const BarChart = dynamic(() => import("recharts").then(m => m.BarChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then(m => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then(m => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then(m => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then(m => m.Tooltip), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then(m => m.CartesianGrid), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then(m => m.ResponsiveContainer), { ssr: false });

const BarcodeChart = dynamic(() => import("../../components/BarcodeChart"), { ssr: false });
const Atlas = dynamic(() => import("../../components/Atlas"), { ssr: false });

const DEFAULT_WEIGHTS = {
  fractalD: 0.25,
  lacunarity: 0.15,
  persistenceSpan: 0.2,
  skeletonBranching: 0.15,
  coherence: 0.15,
  kolmogorov: 0.10,
};

export default function Phase6Page() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const downscale = 640; // Fixed at 640px
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  
  const [overlay, setOverlay] = useState({
    fractal: true,
    lacunarity: false,
    skeleton: false,
    persistence: false,
    coherence: false,
  });
  
  const [workerReady, setWorkerReady] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any | null>(null);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [fullscreenSrc, setFullscreenSrc] = useState<string | null>(null);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
  const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
  const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showCropMenu, setShowCropMenu] = useState(false);
  const cropMenuRef = useRef<HTMLDivElement>(null);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenImgRef = useRef<HTMLImageElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  
  // Worker boot
  useEffect(() => {
    const w = new Worker("/workers/complexity.worker.js");
    workerRef.current = w;
    w.onmessage = (e: MessageEvent) => {
      const { type, data } = e.data || {};
      if (type === "ready") setWorkerReady(true);
      if (type === "progress") setProgress(data);
      if (type === "result") {
        setResults(data);
        setRunning(false);
        setProgress("Done.");
      }
      if (type === "error") {
        setRunning(false);
        setProgress("Error: " + data);
      }
    };
    return () => {
      w.terminate();
    };
  }, []);
  
  // Image load
  useEffect(() => {
    const img = hiddenImgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !imgUrl) return;
    img.onload = () => {
      drawImageToCanvas(img, canvas, downscale, downscale);
    };
    img.src = imgUrl;
  }, [imgUrl, downscale]);
  
  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
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
    setImgUrl(url);
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
      await saveToClipboard(croppedResult.blob, `topology_cropped_${Date.now()}.png`);
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
  
  function analyze() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { width: w, height: h } = canvas;
    const img = ctx.getImageData(0, 0, w, h);
    const gray = toGrayscaleU8(img.data);
    
    const msg = {
      type: "analyze",
      payload: {
        width: w,
        height: h,
        rgba: img.data.buffer,
        gray: gray.buffer,
        weights,
        fractal: { minBox: 4, maxBox: Math.floor(Math.min(w, h) / 2), steps: 8 },
        lacunarity: { windowSizes: [5, 9, 17, 33] },
        persistence: { thresholds: 32 },
        skeleton: { thinningIters: 30 },
        orientation: { tile: 32, bins: 9 },
      }
    };
    
    setRunning(true);
    setProgress("Computing…");
    workerRef.current?.postMessage(msg, [img.data.buffer, gray.buffer]);
  }
  
  function reset() {
    if (!imgUrl) return;
    const img = hiddenImgRef.current!;
    const canvas = canvasRef.current!;
    drawImageToCanvas(img, canvas, downscale, downscale);
    setResults(null);
    setProgress("");
  }
  
  function exportProfile() {
    const blob = new Blob([JSON.stringify({ weights }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "phase6_profile.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  
  function importProfile(file: File) {
    file.text().then((t) => {
      try {
        const obj = JSON.parse(t);
        if (obj.weights) setWeights(obj.weights);
      } catch {}
    });
  }
  
  // Derived scores
  const score = useMemo(() => {
    if (!results) return null;
    const r = results.metrics;
    const ACI =
      weights.fractalD * norm01(r.fractalD, 0, 2) +
      weights.lacunarity * (1 - clamp01(r.lacunarityMean)) +
      weights.persistenceSpan * clamp01(r.persistenceSpanNorm) +
      weights.skeletonBranching * clamp01(r.skeleton.branchingNorm) +
      weights.coherence * clamp01(r.orientation.coherenceMean) +
      weights.kolmogorov * clamp01(r.kolmogorovNorm);
    return { ...r, ACI: +ACI.toFixed(3) };
  }, [results, weights]);
  
  // Overlay painter
  useEffect(() => {
    if (!results || !imgUrl) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { width: w, height: h } = canvas;
    const img = results.baseImage as ImageData | null;
    if (img) ctx.putImageData(img, 0, 0);
    
    if (overlay.fractal && results.overlays?.fractalHeat) paintHeat(ctx, results.overlays.fractalHeat, w, h, 0.45);
    if (overlay.lacunarity && results.overlays?.lacunarityHeat) paintHeat(ctx, results.overlays.lacunarityHeat, w, h, 0.45);
    if (overlay.coherence && results.overlays?.coherenceHeat) paintHeat(ctx, results.overlays.coherenceHeat, w, h, 0.45);
    if (overlay.persistence && results.overlays?.persistenceHot) paintMask(ctx, results.overlays.persistenceHot, w, h, [255, 64, 64, 160]);
    if (overlay.skeleton && results.overlays?.skeleton) paintSkeleton(ctx, results.overlays.skeleton, w, h);
  }, [results, overlay, imgUrl]);
  
  return (
    <div className="min-h-screen bg-[#0D0D0F] text-white">
      <ToolHeader />
      
      <main className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Multi-Scale Complexity & Topology</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT: Input & Controls */}
          <div>
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <div className="space-y-3">
                {/* Top section: Image upload + Overlays side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Upload */}
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
                  
                  {/* Overlay toggles */}
                  <div>
                    <div className="text-xs text-neutral-300 mb-2">Overlays</div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(overlay).map(([key, val]) => (
                        <button
                          key={key}
                          onClick={() => setOverlay({ ...overlay, [key]: !val })}
                          className={`flex items-center justify-between rounded-lg border px-2 py-1.5 text-xs transition ${
                            val
                              ? "border-teal-400/50 bg-teal-500/20 text-teal-300"
                              : "border-neutral-800 bg-black/40 text-neutral-400"
                          }`}
                        >
                          <span className="capitalize">{key}</span>
                          <div className={`w-3 h-3 rounded-sm ${val ? "bg-teal-400" : "bg-neutral-700"}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="h-px bg-neutral-800" />
                
                {/* ACI Weights */}
                <div>
                  <div className="text-xs text-neutral-300 mb-2">ACI Weights</div>
                  <div className="space-y-2">
                    <WeightRow label="Fractal D" value={weights.fractalD} onChange={(v) => setWeights({ ...weights, fractalD: v })} />
                    <WeightRow label="Lacunarity" value={weights.lacunarity} onChange={(v) => setWeights({ ...weights, lacunarity: v })} />
                    <WeightRow label="Persistence" value={weights.persistenceSpan} onChange={(v) => setWeights({ ...weights, persistenceSpan: v })} />
                    <WeightRow label="Branching" value={weights.skeletonBranching} onChange={(v) => setWeights({ ...weights, skeletonBranching: v })} />
                    <WeightRow label="Coherence" value={weights.coherence} onChange={(v) => setWeights({ ...weights, coherence: v })} />
                    <WeightRow label="K̂ proxy" value={weights.kolmogorov} onChange={(v) => setWeights({ ...weights, kolmogorov: v })} />
                  </div>
                </div>
                
                <div className="h-px bg-neutral-800" />
                
                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={analyze}
                    disabled={!imgUrl || running}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-teal-500/20 border border-teal-400/50 hover:bg-teal-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Analyze
                  </button>
                  <button
                    onClick={() => setRunning(false)}
                    disabled={!running}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-red-900/30 border border-red-700 hover:bg-red-900/40 disabled:opacity-50"
                  >
                    <Pause className="h-3.5 w-3.5" /> Stop
                  </button>
                  <button
                    onClick={reset}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </button>
                  <button
                    onClick={() => setFullscreenSrc(canvasRef.current?.toDataURL() || null)}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                  >
                    <Maximize2 className="h-3.5 w-3.5" /> Full
                  </button>
                  <button
                    onClick={() => setAtlasOpen(true)}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                  >
                    <Settings className="h-3.5 w-3.5" /> Atlas
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={exportProfile}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                  >
                    <Save className="h-3.5 w-3.5" /> Export
                  </button>
                  <label className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" /> Import
                    <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files && importProfile(e.target.files[0])} />
                  </label>
                </div>
                
                {/* Status */}
                {(workerReady || progress) && (
                  <div className="text-xs text-neutral-500">
                    {workerReady ? "Worker ready" : "Booting…"}
                    {progress && <span> • {progress}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* RIGHT: Output & Metrics */}
          <div className="space-y-4">
            {/* Canvas Output */}
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-neutral-300">Output</h3>
                {imgUrl && !cropMode && (
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
              </div>
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
                    {!imgUrl && (
                      <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm rounded-xl border border-neutral-800 bg-black/40" style={{minHeight: '300px'}}>
                        Upload an image to begin
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            
            {/* Metrics */}
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">Metrics</h3>
              {score ? (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <MetricBox label="Fractal D" value={score.fractalD} />
                    <MetricBox label="Lacunarity" value={score.lacunarityMean} />
                    <MetricBox label="Persist" value={score.persistenceSpanNorm} />
                    <MetricBox label="Branching" value={score.skeleton.branchingNorm} />
                    <MetricBox label="Coherence" value={score.orientation.coherenceMean} />
                    <MetricBox label="K̂" value={score.kolmogorovNorm} />
                    <MetricBox label="ACI" value={score.ACI} highlight />
                  </div>
                  <div className="h-48">
                    {typeof window !== "undefined" && (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={metricPairs(score)} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis dataKey="name" stroke="#aaa" tick={{ fill: "#aaa" }} />
                          <YAxis stroke="#aaa" tick={{ fill: "#aaa" }} />
                          <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
                          <Bar dataKey="value" fill="#22d3ee" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm text-neutral-500">Run analysis to populate metrics.</div>
              )}
            </div>
            
            {/* Persistence Barcodes */}
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">Persistence Barcodes</h3>
              {results?.persistence ? (
                <BarcodeChart bars={results.persistence.bars} />
              ) : (
                <div className="text-sm text-neutral-500">No barcode yet. Run analysis.</div>
              )}
            </div>
          </div>
        </div>
      </main>
      
      {/* Hidden loader */}
      <img ref={hiddenImgRef} alt="hidden-loader" className="hidden" />
      
      {/* Atlas modal */}
      {atlasOpen && results?.atlas && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setAtlasOpen(false)}>
          <button
            className="absolute top-4 right-4 p-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
            onClick={() => setAtlasOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="max-w-5xl w-full">
            <Atlas atlas={results.atlas} />
          </div>
        </div>
      )}
      
      {/* Fullscreen */}
      {fullscreenSrc && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setFullscreenSrc(null)}>
          <button
            className="absolute top-4 right-4 p-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
            onClick={() => setFullscreenSrc(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img src={fullscreenSrc} alt="fullscreen" className="max-w-full max-h-full rounded-xl border border-neutral-800" />
        </div>
      )}

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
                  a.download = `topology_cropped_${Date.now()}.png`;
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

// UI Components
function MetricBox({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border ${highlight ? 'border-teal-400/50 bg-teal-500/10' : 'border-neutral-800'} bg-black/40 p-2`}>
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className={`text-base font-semibold ${highlight ? 'text-teal-400' : 'text-neutral-200'}`}>
        {Number.isFinite(value) ? value.toFixed(3) : "—"}
      </div>
    </div>
  );
}

function WeightRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 text-xs text-neutral-400">{label}</div>
      <div className="flex-1">
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.01}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full accent-teal-400"
        />
      </div>
      <div className="w-12 text-right text-xs text-neutral-500">{value.toFixed(2)}</div>
    </div>
  );
}

function metricPairs(s: any) {
  return [
    { name: "FractalD", value: s.fractalD },
    { name: "Lacun", value: s.lacunarityMean },
    { name: "Persist", value: s.persistenceSpanNorm },
    { name: "Branch", value: s.skeleton.branchingNorm },
    { name: "Coher", value: s.orientation.coherenceMean },
    { name: "K̂", value: s.kolmogorovNorm },
    { name: "ACI", value: s.ACI },
  ];
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function norm01(x: number, a = 0, b = 1) {
  return clamp01((x - a) / (b - a || 1));
}

// Overlay painters
function paintHeat(ctx: CanvasRenderingContext2D, heat: Float32Array, w: number, h: number, alpha = 0.4) {
  const img = ctx.getImageData(0, 0, w, h);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < heat.length; i++) {
    const v = heat[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const rng = max - min || 1;
  for (let i = 0; i < heat.length; i++) {
    const v = (heat[i] - min) / rng;
    const [r, g, b] = turbo(v);
    const j = i * 4;
    img.data[j] = Math.round(r * 255 * alpha + img.data[j] * (1 - alpha));
    img.data[j + 1] = Math.round(g * 255 * alpha + img.data[j + 1] * (1 - alpha));
    img.data[j + 2] = Math.round(b * 255 * alpha + img.data[j + 2] * (1 - alpha));
  }
  ctx.putImageData(img, 0, 0);
}

function paintMask(ctx: CanvasRenderingContext2D, mask: Uint8Array, w: number, h: number, rgba: [number, number, number, number]) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      const j = i * 4;
      img.data[j] = rgba[0];
      img.data[j + 1] = rgba[1];
      img.data[j + 2] = rgba[2];
      img.data[j + 3] = rgba[3];
    }
  }
  ctx.putImageData(img, 0, 0);
}

function paintSkeleton(ctx: CanvasRenderingContext2D, points: Uint8Array, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < points.length; i++) {
    if (points[i]) {
      const j = i * 4;
      img.data[j] = 240;
      img.data[j + 1] = 240;
      img.data[j + 2] = 240;
      img.data[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function turbo(x: number): [number, number, number] {
  const r = Math.min(1, Math.max(0, 1.0 + 0.0 * x - 1.5 * (x - 0.5) ** 2));
  const g = Math.min(1, Math.max(0, 1.2 - 4.0 * (x - 0.5) ** 2));
  const b = Math.min(1, Math.max(0, 1.0 + 0.0 * x - 1.5 * (x - 0.5) ** 2));
  return [r, g, b];
}

