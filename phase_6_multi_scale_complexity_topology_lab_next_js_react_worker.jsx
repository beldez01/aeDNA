"use client";

// =============================================
// File: app/phase-6/page.tsx
// =============================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Upload, Play, Pause, RotateCcw, Save, Download, Maximize2, X, Settings, Wand2 } from "lucide-react";
import dynamic from "next/dynamic";
import {
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

// Local helpers (lightweight). Heavier algorithms run in worker (see /workers/complexity.worker.ts)
import {
  fitContain,
  drawImageToCanvas,
  toGrayscaleU8,
  tileOrientationCoherence,
} from "@/lib/complexity/utils-client";

const DEFAULT_WEIGHTS = {
  fractalD: 0.25,
  lacunarity: 0.15,
  persistenceSpan: 0.2,
  skeletonBranching: 0.15,
  coherence: 0.15,
  kolmogorov: 0.10,
};

// Dynamically import Atlas and Barcode charts (client-only)
const BarcodeChart = dynamic(() => import("@/components/BarcodeChart"), { ssr: false });
const Atlas = dynamic(() => import("@/components/Atlas"), { ssr: false });

export default function Phase6Page() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [downscale, setDownscale] = useState(1024);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);

  const [overlay, setOverlay] = useState<{ fractal: boolean; lacunarity: boolean; skeleton: boolean; persistence: boolean; coherence: boolean }>({ fractal: true, lacunarity: false, skeleton: false, persistence: false, coherence: false });

  const [workerReady, setWorkerReady] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [running, setRunning] = useState(false);

  const [results, setResults] = useState<any | null>(null);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [fullscreenSrc, setFullscreenSrc] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenImgRef = useRef<HTMLImageElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // worker boot
  useEffect(() => {
    const w = new Worker(new URL("../../workers/complexity.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent) => {
      const { type, data } = e.data || {};
      if (type === "ready") setWorkerReady(true);
      if (type === "progress") setProgress(data);
      if (type === "result") { setResults(data); setRunning(false); setProgress("Done."); }
      if (type === "error") { setRunning(false); setProgress("Error: " + data); }
    };
    return () => { w.terminate(); };
  }, []);

  // image load
  useEffect(() => {
    const img = hiddenImgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !imgUrl) return;
    img.onload = () => { drawImageToCanvas(img, canvas, downscale, downscale); };
    img.src = imgUrl;
  }, [imgUrl, downscale]);

  // run analysis
  function analyze() {
    const canvas = canvasRef.current; if (!canvas) return;
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
        // parameters for algorithms
        fractal: { minBox: 4, maxBox: Math.floor(Math.min(w, h) / 2), steps: 8 },
        lacunarity: { windowSizes: [5, 9, 17, 33] },
        persistence: { thresholds: 32 },
        skeleton: { thinningIters: 30 },
        orientation: { tile: 32, bins: 9 },
      }
    } as const;

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
    const a = document.createElement("a"); a.href = url; a.download = "phase6_profile.json"; a.click(); URL.revokeObjectURL(url);
  }

  function importProfile(file: File) {
    file.text().then((t) => { try { const obj = JSON.parse(t); if (obj.weights) setWeights(obj.weights); } catch {} });
  }

  // derived scores
  const score = useMemo(() => {
    if (!results) return null;
    const r = results.metrics;
    const ACI =
      weights.fractalD * norm01(r.fractalD, 0, 2) +
      weights.lacunarity * (1 - clamp01(r.lacunarityMean)) + // lower lacunarity often feels denser/filled
      weights.persistenceSpan * clamp01(r.persistenceSpanNorm) +
      weights.skeletonBranching * clamp01(r.skeleton.branchingNorm) +
      weights.coherence * clamp01(r.orientation.coherenceMean) +
      weights.kolmogorov * clamp01(r.kolmogorovNorm);
    return { ...r, ACI: +ACI.toFixed(3) };
  }, [results, weights]);

  // overlay painter
  useEffect(() => {
    if (!results || !imgUrl) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { width: w, height: h } = canvas;
    // redraw base
    const img = results.baseImage as ImageData | null;
    if (img) ctx.putImageData(img, 0, 0);

    // overlay toggles
    if (overlay.fractal && results.overlays?.fractalHeat) paintHeat(ctx, results.overlays.fractalHeat, w, h, 0.45);
    if (overlay.lacunarity && results.overlays?.lacunarityHeat) paintHeat(ctx, results.overlays.lacunarityHeat, w, h, 0.45);
    if (overlay.coherence && results.overlays?.coherenceHeat) paintHeat(ctx, results.overlays.coherenceHeat, w, h, 0.45);
    if (overlay.persistence && results.overlays?.persistenceHot) paintMask(ctx, results.overlays.persistenceHot, w, h, [255, 64, 64, 160]);
    if (overlay.skeleton && results.overlays?.skeleton) paintSkeleton(ctx, results.overlays.skeleton, w, h);
  }, [results, overlay]);

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 backdrop-blur bg-black/40">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" className="text-xl font-bold tracking-widest" onClick={() => (window.location.href = "/")}>aeDNA</Button>
            <span className="text-white/50">/</span>
            <span className="text-sm uppercase tracking-wider">Phase 6 – Multi-Scale Complexity & Topology Lab</span>
          </div>
          <nav className="hidden md:flex items-center gap-3 text-sm">
            <a href="/phase-4" className="hover:text-white/90 text-white/60">4</a>
            <a href="/phase-5" className="hover:text-white/90 text-white/60">5</a>
            <span className="text-white">6</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 grid lg:grid-cols-[1.2fr_0.8fr] gap-4 items-start">
        {/* LEFT: Image + controls */}
        <div>
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Image & Overlays</CardTitle>
              <div className="flex items-center gap-2 text-xs text-white/60">{workerReady ? "Worker ready" : "Booting…"} {progress && <span className="ml-2">• {progress}</span>}</div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/50">
                  <canvas ref={canvasRef} className="block w-full h-auto" />
                  {!imgUrl && (
                    <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">Upload an image to begin</div>
                  )}
                </div>
                <div className="space-y-4">
                  <Uploader onFile={(f) => setImgUrl(URL.createObjectURL(f))} />
                  <LabeledSlider label={`Downscale to: ${downscale}px`} min={256} max={2048} step={64} value={downscale} onChange={setDownscale} />

                  <div className="grid grid-cols-2 gap-3">
                    <ToggleRow label="Fractal heatmap" checked={overlay.fractal} onCheckedChange={(b)=> setOverlay({ ...overlay, fractal: b })} />
                    <ToggleRow label="Lacunarity map" checked={overlay.lacunarity} onCheckedChange={(b)=> setOverlay({ ...overlay, lacunarity: b })} />
                    <ToggleRow label="Skeleton" checked={overlay.skeleton} onCheckedChange={(b)=> setOverlay({ ...overlay, skeleton: b })} />
                    <ToggleRow label="Persistence hotspots" checked={overlay.persistence} onCheckedChange={(b)=> setOverlay({ ...overlay, persistence: b })} />
                    <ToggleRow label="Orientation coherence" checked={overlay.coherence} onCheckedChange={(b)=> setOverlay({ ...overlay, coherence: b })} />
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <Button size="sm" onClick={analyze} disabled={!imgUrl || running}><Wand2 className="h-4 w-4 mr-1"/> Analyze</Button>
                    <Button size="sm" variant={running ? "destructive" : "secondary"} onClick={()=> setRunning(false)} disabled={!running}><Pause className="h-4 w-4 mr-1"/> Stop</Button>
                    <Button size="sm" variant="outline" onClick={reset}><RotateCcw className="h-4 w-4 mr-1"/> Reset</Button>
                    <Button size="sm" variant="outline" onClick={()=> setFullscreenSrc(canvasRef.current?.toDataURL() || null)}><Maximize2 className="h-4 w-4 mr-1"/> Fullscreen</Button>
                    <Button size="sm" variant="outline" onClick={()=> setAtlasOpen(true)}><Settings className="h-4 w-4 mr-1"/> Open Atlas</Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Metrics, Barcodes, Weights */}
        <div className="space-y-4">
          <Card className="bg-white/5 border-white/10">
            <CardHeader><CardTitle className="text-lg">Metrics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {score ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricBox label="Fractal D" value={score.fractalD} />
                    <MetricBox label="Lacunarity (mean)" value={score.lacunarityMean} />
                    <MetricBox label="Persistence span (norm)" value={score.persistenceSpanNorm} />
                    <MetricBox label="Skeleton branching (norm)" value={score.skeleton.branchingNorm} />
                    <MetricBox label="Orientation coherence (mean)" value={score.orientation.coherenceMean} />
                    <MetricBox label="Kolmogorov proxy (norm)" value={score.kolmogorovNorm} />
                    <MetricBox label="ACI (composite)" value={score.ACI} highlight />
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metricPairs(score)} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="name" stroke="#aaa" tick={{ fill: "#aaa" }} />
                        <YAxis stroke="#aaa" tick={{ fill: "#aaa" }} />
                        <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
                        <Bar dataKey="value" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className="text-sm text-white/60">Run analysis to populate metrics.</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10">
            <CardHeader><CardTitle className="text-lg">Persistence Barcodes</CardTitle></CardHeader>
            <CardContent>
              {results?.persistence ? (
                <BarcodeChart bars={results.persistence.bars} onFocus={(id)=> highlightRegion(id)} />
              ) : (
                <div className="text-sm text-white/60">No barcode yet. Run analysis.</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10">
            <CardHeader><CardTitle className="text-lg">ACI Weights</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <WeightRow label="Fractal D" value={weights.fractalD} onChange={(v)=> setWeights({ ...weights, fractalD: v })} />
              <WeightRow label="Lacunarity" value={weights.lacunarity} onChange={(v)=> setWeights({ ...weights, lacunarity: v })} />
              <WeightRow label="Persistence span" value={weights.persistenceSpan} onChange={(v)=> setWeights({ ...weights, persistenceSpan: v })} />
              <WeightRow label="Skeleton branching" value={weights.skeletonBranching} onChange={(v)=> setWeights({ ...weights, skeletonBranching: v })} />
              <WeightRow label="Coherence" value={weights.coherence} onChange={(v)=> setWeights({ ...weights, coherence: v })} />
              <WeightRow label="Kolmogorov proxy" value={weights.kolmogorov} onChange={(v)=> setWeights({ ...weights, kolmogorov: v })} />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={exportProfile}><Save className="h-4 w-4 mr-1"/> Export profile</Button>
                <label className="text-xs text-white/70 flex items-center gap-2 cursor-pointer">
                  <Upload className="h-4 w-4"/>
                  Import profile
                  <input type="file" accept="application/json" className="hidden" onChange={(e)=> e.target.files && importProfile(e.target.files[0])} />
                </label>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Hidden loader */}
      <img ref={hiddenImgRef} alt="hidden-loader" className="hidden" />

      {/* Atlas modal */}
      {atlasOpen && results?.atlas && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={()=> setAtlasOpen(false)}>
          <Button variant="ghost" className="absolute top-4 right-4" onClick={()=> setAtlasOpen(false)}><X className="h-5 w-5"/></Button>
          <div className="max-w-5xl w-full">
            <Atlas atlas={results.atlas} />
          </div>
        </div>
      )}

      {/* Fullscreen */}
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

  // helpers
  function highlightRegion(id:number){
    // optional: send a message to worker in future to return mask for region id.
    if (!results?.persistence?.regionMasks) return;
    const mask = results.persistence.regionMasks[id];
    if (!mask) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { width: w, height: h } = canvas;
    if (results.baseImage) ctx.putImageData(results.baseImage, 0, 0);
    paintMask(ctx, mask, w, h, [255, 120, 40, 160]);
  }
}

// ================= UI Subcomponents =================
function Uploader({ onFile }: { onFile: (f: File) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      className={`rounded-xl border ${dragOver ? 'border-white/60' : 'border-white/10'} bg-black/40 p-3 flex items-center justify-between gap-3`}
    >
      <div className="flex items-center gap-3 text-white/70 text-sm">
        <Upload className="h-4 w-4"/> Drag & drop or
        <Button size="sm" onClick={() => inputRef.current?.click()}>Browse</Button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files && e.target.files[0]) onFile(e.target.files[0]); }} />
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
      <div className="w-40 text-xs text-white/70">{label}</div>
      <div className="flex-1"><Slider min={0} max={0.6} step={0.01} value={[value]} onValueChange={(a)=> onChange(a[0])} /></div>
      <div className="w-12 text-right text-xs text-white/60">{value.toFixed(2)}</div>
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

function metricPairs(s:any){
  return [
    { name: "FractalD", value: s.fractalD },
    { name: "Lacunarity", value: s.lacunarityMean },
    { name: "Persist", value: s.persistenceSpanNorm },
    { name: "Branching", value: s.skeleton.branchingNorm },
    { name: "Coherence", value: s.orientation.coherenceMean },
    { name: "K̂", value: s.kolmogorovNorm },
    { name: "ACI", value: s.ACI },
  ];
}

function clamp01(x:number){ return Math.max(0, Math.min(1, x)); }
function norm01(x:number, a=0, b=1){ return clamp01((x-a)/(b-a || 1)); }

// Overlay painters
function paintHeat(ctx:CanvasRenderingContext2D, heat:Float32Array, w:number, h:number, alpha=0.4){
  const img = ctx.getImageData(0, 0, w, h);
  let min=Infinity, max=-Infinity;
  for (let i=0;i<heat.length;i++){ const v=heat[i]; if (v<min) min=v; if (v>max) max=v; }
  const rng = max-min || 1;
  for (let i=0;i<heat.length;i++){
    const v = (heat[i]-min)/rng; // 0..1
    const [r,g,b] = turbo(v);
    const j = i*4;
    img.data[j] = Math.round(r*255*alpha + img.data[j]*(1-alpha));
    img.data[j+1] = Math.round(g*255*alpha + img.data[j+1]*(1-alpha));
    img.data[j+2] = Math.round(b*255*alpha + img.data[j+2]*(1-alpha));
  }
  ctx.putImageData(img,0,0);
}

function paintMask(ctx:CanvasRenderingContext2D, mask:Uint8Array, w:number, h:number, rgba:[number,number,number,number]){
  const img = ctx.getImageData(0,0,w,h);
  for (let i=0;i<mask.length;i++){
    if (mask[i]){
      const j=i*4; img.data[j]=rgba[0]; img.data[j+1]=rgba[1]; img.data[j+2]=rgba[2]; img.data[j+3]=rgba[3];
    }
  }
  ctx.putImageData(img,0,0);
}

function paintSkeleton(ctx:CanvasRenderingContext2D, points:Uint8Array, w:number, h:number){
  const img = ctx.getImageData(0,0,w,h);
  for (let i=0;i<points.length;i++) if (points[i]){ const j=i*4; img.data[j]=240; img.data[j+1]=240; img.data[j+2]=240; img.data[j+3]=255; }
  ctx.putImageData(img,0,0);
}

// simple Turbo colormap
function turbo(x:number){
  const r = Math.min(1, Math.max(0, 1.0 + 0.0*x - 1.5*(x-0.5)**2));
  const g = Math.min(1, Math.max(0, 1.2 - 4.0*(x-0.5)**2));
  const b = Math.min(1, Math.max(0, 1.0 + 0.0*x - 1.5*(x-0.5)**2));
  return [r,g,b];
}

// =============================================
// File: lib/complexity/utils-client.ts
// =============================================
export function fitContain(w:number, h:number, maxW:number, maxH:number){
  const r = Math.min(maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

export function drawImageToCanvas(img: HTMLImageElement, canvas: HTMLCanvasElement, maxW = 1024, maxH = 1024) {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = fitContain(img.naturalWidth, img.naturalHeight, maxW, maxH);
  canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
}

export function toGrayscaleU8(px: Uint8ClampedArray){
  const out = new Uint8Array(px.length/4);
  for (let i=0,j=0;i<px.length;i+=4,j++) out[j] = (0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2])|0;
  return out;
}

export function tileOrientationCoherence(gray:Uint8Array, w:number, h:number, tile=32, bins=9){
  // Coherence per tile using simple Sobel orientation histogram; returns Float32Array heat
  const heat = new Float32Array(w*h);
  const Gx = [-1,0,1,-2,0,2,-1,0,1];
  const Gy = [-1,-2,-1,0,0,0,1,2,1];
  const idx = (x:number,y:number)=> y*w+x;
  const mag = new Float32Array(w*h);
  const ang = new Float32Array(w*h);
  for (let y=1;y<h-1;y++){
    for (let x=1;x<w-1;x++){
      let sx=0, sy=0, k=0;
      for (let j=-1;j<=1;j++) for (let i=-1;i<=1;i++,k++){
        const v = gray[idx(x+i,y+j)]; sx += v*Gx[k]; sy += v*Gy[k];
      }
      const m = Math.hypot(sx,sy); mag[idx(x,y)]=m; ang[idx(x,y)] = Math.atan2(sy,sx); // -pi..pi
    }
  }
  for (let ty=0; ty<h; ty+=tile){
    for (let tx=0; tx<w; tx+=tile){
      const hist = new Float32Array(bins);
      let sum=0;
      for (let y=ty; y<Math.min(h, ty+tile); y++){
        for (let x=tx; x<Math.min(w, tx+tile); x++){
          const m = mag[idx(x,y)];
          if (m>0){
            const a = (ang[idx(x,y)] + Math.PI) / (2*Math.PI); // 0..1
            const bIdx = Math.min(bins-1, Math.floor(a*bins));
            hist[bIdx] += m; sum += m;
          }
        }
      }
      if (sum===0) continue;
      const mean = hist.reduce((a,b)=>a+b,0)/bins;
      let varsum=0; for (let i=0;i<bins;i++){ const d=hist[i]-mean; varsum+=d*d; }
      const coh = Math.sqrt(varsum)/ (sum||1); // normalized spread
      const val = 1 - Math.min(1, coh*2); // higher = more coherent
      for (let y=ty; y<Math.min(h, ty+tile); y++) for (let x=tx; x<Math.min(w, tx+tile); x++) heat[idx(x,y)] = val;
    }
  }
  return heat;
}

// =============================================
// File: workers/complexity.worker.ts
// =============================================
/// <reference lib="webworker" />
import { boxCountFractal } from "../lib/complexity/fractal";
import { lacunarityMap } from "../lib/complexity/lacunarity";
import { persistenceSweep } from "../lib/complexity/persistence";
import { skeletonize } from "../lib/complexity/skeleton";
import { kolmogorovProxy } from "../lib/complexity/kolmogorov";
import { orientationCoherenceHeat } from "../lib/complexity/orientation";

self.postMessage({ type: "ready" });

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data || {};
  if (type !== "analyze") return;
  try {
    const { width:w, height:h } = payload;
    const rgba = new Uint8ClampedArray(payload.rgba);
    const gray = new Uint8Array(payload.gray);

    // Base copy
    const base = new ImageData(new Uint8ClampedArray(rgba), w, h);

    // Fractal
    self.postMessage({ type: "progress", data: "Fractal D…" });
    const fractal = boxCountFractal(gray, w, h, payload.fractal);

    // Lacunarity
    self.postMessage({ type: "progress", data: "Lacunarity…" });
    const lac = lacunarityMap(gray, w, h, payload.lacunarity);

    // Persistence threshold sweep
    self.postMessage({ type: "progress", data: "Persistence sweep…" });
    const pers = persistenceSweep(gray, w, h, payload.persistence);

    // Skeleton
    self.postMessage({ type: "progress", data: "Skeletonizing…" });
    const skel = skeletonize(gray, w, h, payload.skeleton);

    // Orientation coherence
    self.postMessage({ type: "progress", data: "Orientation coherence…" });
    const coh = orientationCoherenceHeat(gray, w, h, payload.orientation);

    // Kolmogorov proxy
    self.postMessage({ type: "progress", data: "Compression proxy…" });
    const kproxy = kolmogorovProxy(rgba, w, h);

    // Aggregate metrics
    const metrics = {
      fractalD: fractal.D,
      lacunarityMean: lac.mean,
      persistenceSpanNorm: pers.spanNorm,
      skeleton: { branchingNorm: skel.branchingNorm },
      orientation: { coherenceMean: coh.mean },
      kolmogorovNorm: kproxy.norm,
    };

    const overlays = {
      fractalHeat: fractal.heat,
      lacunarityHeat: lac.heat,
      persistenceHot: pers.hot,
      skeleton: skel.points,
      coherenceHeat: coh.heat,
    };

    const atlas = {
      tiles: [
        { name: "Fractal", heat: fractal.heat, w, h },
        { name: "Lacunarity", heat: lac.heat, w, h },
        { name: "Coherence", heat: coh.heat, w, h },
      ]
    };

    const result = {
      baseImage: base,
      metrics,
      overlays,
      persistence: { bars: pers.bars, regionMasks: pers.regionMasks },
      atlas,
    };

    self.postMessage({ type: "result", data: result }, [
      result.overlays.fractalHeat.buffer,
      result.overlays.lacunarityHeat.buffer,
      result.overlays.coherenceHeat.buffer,
      result.overlays.persistenceHot.buffer,
      result.overlays.skeleton.buffer,
    ]);
  } catch (err:any) {
    self.postMessage({ type: "error", data: String(err?.message || err) });
  }
};

// =============================================
// File: lib/complexity/fractal.ts
// =============================================
export function boxCountFractal(gray:Uint8Array, w:number, h:number, opts:{minBox:number; maxBox:number; steps:number}){
  const sizes:number[] = [];
  const counts:number[] = [];
  const heat = new Float32Array(w*h);
  const { minBox, maxBox, steps } = opts;
  for (let s=0; s<steps; s++){
    const box = Math.max(2, Math.round(minBox * Math.pow(maxBox/minBox, s/(steps-1))));
    sizes.push(box);
    let c=0;
    for (let y=0; y<h; y+=box){
      for (let x=0; x<w; x+=box){
        // if any pixel in box > threshold consider filled
        let filled = false;
        for (let j=y; j<Math.min(h, y+box) && !filled; j++) for (let i=x; i<Math.min(w, x+box) && !filled; i++){
          if (gray[j*w+i] < 250) filled = true; // treat non-white as signal
        }
        if (filled){ c++; for (let j=y; j<Math.min(h, y+box); j++) for (let i=x; i<Math.min(w, x+box); i++) heat[j*w+i] += 1; }
      }
    }
    counts.push(c);
  }
  // log–log slope (least squares)
  const xs = sizes.map(s=> Math.log(1/s));
  const ys = counts.map(c=> Math.log(c+1e-9));
  const D = slope(xs, ys);
  // normalize heat by number of hits
  let max=0; for (let i=0;i<heat.length;i++) if (heat[i]>max) max=heat[i];
  if (max>0) for (let i=0;i<heat.length;i++) heat[i]/=max;
  return { D, heat };
}

function slope(x:number[], y:number[]){
  const n = x.length; const mx = mean(x); const my = mean(y);
  let num=0, den=0; for (let i=0;i<n;i++){ const dx=x[i]-mx; num += dx*(y[i]-my); den += dx*dx; }
  return den ? num/den : 0;
}
function mean(a:number[]){ return a.reduce((p,c)=>p+c,0)/(a.length||1); }

// =============================================
// File: lib/complexity/lacunarity.ts
// =============================================
export function lacunarityMap(gray:Uint8Array, w:number, h:number, opts:{windowSizes:number[]}){
  const heat = new Float32Array(w*h);
  const means:number[] = [];
  for (const win of opts.windowSizes){
    let sumL=0, sumN=0;
    for (let y=0; y<h; y+=win){
      for (let x=0; x<w; x+=win){
        let m=0, cnt=0;
        for (let j=y; j<Math.min(h,y+win); j++) for (let i=x; i<Math.min(w,x+win); i++){ m += 255-gray[j*w+i]; cnt++; }
        const mean = m/(cnt||1);
        let varsum=0; for (let j=y; j<Math.min(h,y+win); j++) for (let i=x; i<Math.min(w,x+win); i++){ const v=(255-gray[j*w+i])-mean; varsum+=v*v; }
        const lambda = varsum/(cnt||1) / ((mean||1)**2 + 1e-9); // var/mean^2
        sumL += lambda; sumN++;
        for (let j=y; j<Math.min(h,y+win); j++) for (let i=x; i<Math.min(w,x+win); i++){ heat[j*w+i] += lambda; }
      }
    }
    means.push(sumN? sumL/sumN : 0);
  }
  // average across scales
  for (let i=0;i<heat.length;i++) heat[i] = heat[i]/(opts.windowSizes.length||1);
  let max=0; for (let i=0;i<heat.length;i++) if (heat[i]>max) max=heat[i]; if (max>0) for (let i=0;i<heat.length;i++) heat[i]/=max;
  const meanL = means.reduce((a,b)=>a+b,0)/(means.length||1);
  return { heat, mean: meanL };
}

// =============================================
// File: lib/complexity/persistence.ts
// =============================================
export function persistenceSweep(gray:Uint8Array, w:number, h:number, opts:{thresholds:number}){
  // Sweep thresholds uniformly 0..255 and track connected components lifespan
  const T = Math.max(8, opts.thresholds|0);
  const bars: { id:number; birth:number; death:number }[] = [];
  const regionMasks: Record<number, Uint8Array> = {};
  const ids = new Int32Array(w*h);
  let nextId=1; const lifespans = new Map<number,{birth:number; death:number}>();

  const hot = new Uint8Array(w*h); // highlight of long-lived pixels (coarse)

  for (let t=0;t<T;t++){
    const thr = Math.round((t/(T-1))*255);
    // binary mask (signal = dark or mid, adjust to taste)
    const bin = new Uint8Array(w*h);
    for (let i=0;i<w*h;i++) bin[i] = gray[i] < thr ? 1 : 0;
    // label components (4-neighborhood)
    ids.fill(0);
    let comps=0;
    for (let y=0;y<h;y++){
      for (let x=0;x<w;x++){
        const idx=y*w+x; if (!bin[idx] || ids[idx]) continue;
        const id = nextId++;
        comps++;
        const q=[idx]; ids[idx]=id;
        while(q.length){
          const p=q.pop()!;
          const px=p%w, py=(p/w)|0;
          const nbr=[p-1, p+1, p-w, p+w];
          for (const n of nbr){
            if (n<0 || n>=w*h) continue;
            const nx=n%w, ny=(n/w)|0; if (Math.abs(nx-px)+Math.abs(ny-py)!==1) continue;
            if (bin[n] && !ids[n]){ ids[n]=id; q.push(n); }
          }
        }
        if (!lifespans.has(id)) lifespans.set(id, { birth: thr, death: thr });
      }
    }
    // update deaths for present ids
    for (let i=0;i<w*h;i++) if (ids[i]){ const rec = lifespans.get(ids[i])!; rec.death = thr; }
  }

  lifespans.forEach((v,k)=>{ bars.push({ id:k, birth:v.birth, death:v.death }); });
  bars.sort((a,b)=> (b.death-b.birth) - (a.death-a.birth));

  // Build a coarse hotspot mask from top 10 bars
  const top = bars.slice(0, Math.min(10, bars.length));
  for (const b of top) {
    // reconstruct final mask approx at (birth+death)/2
    const thr = Math.round((b.birth + b.death)/2);
    const mask = new Uint8Array(w*h);
    for (let i=0;i<w*h;i++) if (gray[i] < thr) mask[i]=1;
    regionMasks[b.id] = mask;
    for (let i=0;i<mask.length;i++) if (mask[i]) hot[i]=1;
  }

  // normalize span
  const spanMax = 255; // worst-case
  const spanNorm = top.length ? Math.min(1, (top[0].death - top[0].birth)/spanMax) : 0;
  return { bars, regionMasks, hot, spanNorm };
}

// =============================================
// File: lib/complexity/skeleton.ts
// =============================================
export function skeletonize(gray:Uint8Array, w:number, h:number, opts:{thinningIters:number}){
  // Simple threshold then Zhang-Suen thinning (approx)
  const bin = new Uint8Array(w*h);
  const thr = 180; for (let i=0;i<w*h;i++) bin[i] = gray[i] < thr ? 1 : 0;
  const skel = zhangSuen(bin, w, h, opts.thinningIters||30);
  // Branching metric: count junctions (>2 neighbors)
  let junctions=0, pixels=0;
  const idx=(x:number,y:number)=> y*w+x;
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) if (skel[idx(x,y)]){
    pixels++;
    const n = +skel[idx(x-1,y)] + +skel[idx(x+1,y)] + +skel[idx(x,y-1)] + +skel[idx(x,y+1)] +
              +skel[idx(x-1,y-1)] + +skel[idx(x+1,y-1)] + +skel[idx(x-1,y+1)] + +skel[idx(x+1,y+1)];
    if (n>=3) junctions++;
  }
  const branchingNorm = Math.min(1, junctions/Math.max(1, pixels/50));
  return { points: skel, branchingNorm };
}

function zhangSuen(img:Uint8Array, w:number, h:number, maxIter:number){
  const P = img.slice();
  const N = (x:number,y:number)=>{
    let c=0; for (let j=-1;j<=1;j++) for (let i=-1;i<=1;i++){ if (i||j) c += +P[(y+j)*w + (x+i)]; } return c;
  };
  const S = (x:number,y:number)=>{
    const p=[P[(y-1)*w+x],P[(y-1)*w+(x+1)],P[y*w+(x+1)],P[(y+1)*w+(x+1)],P[(y+1)*w+x],P[(y+1)*w+(x-1)],P[y*w+(x-1)],P[(y-1)*w+(x-1)]];
    let t=0; for(let i=0;i<8;i++) if (p[i]===0 && p[(i+1)%8]===1) t++; return t;
  };
  let changed=true, iter=0;
  while (changed && iter<maxIter){
    changed=false; iter++;
    const toRemove:number[]=[];
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++){
      const p = P[y*w+x]; if (!p) continue;
      const n=N(x,y); if (n<2||n>6) continue;
      if (S(x,y)!==1) continue;
      if (P[(y-1)*w+x]*P[y*w+(x+1)]*P[(y+1)*w+x]===0 && P[y*w+(x+1)]*P[(y+1)*w+x]*P[y*w+(x-1)]===0) toRemove.push(y*w+x);
    }
    if (toRemove.length){ changed=true; for (const i of toRemove) P[i]=0; }
  }
  return P;
}

// =============================================
// File: lib/complexity/orientation.ts
// =============================================
export function orientationCoherenceHeat(gray:Uint8Array, w:number, h:number, opts:{tile:number; bins:number}){
  const heat = new Float32Array(w*h);
  const tile = Math.max(8, opts.tile|0);
  const bins = Math.max(6, opts.bins|0);
  // Reuse the client util algorithm structure (duplicated to keep worker self-contained)
  const Gx = [-1,0,1,-2,0,2,-1,0,1];
  const Gy = [-1,-2,-1,0,0,0,1,2,1];
  const idx = (x:number,y:number)=> y*w+x;
  const mag = new Float32Array(w*h);
  const ang = new Float32Array(w*h);
  for (let y=1;y<h-1;y++){
    for (let x=1;x<w-1;x++){
      let sx=0, sy=0, k=0;
      for (let j=-1;j<=1;j++) for (let i=-1;i<=1;i++,k++){
        const v = gray[idx(x+i,y+j)]; sx += v*Gx[k]; sy += v*Gy[k];
      }
      const m = Math.hypot(sx,sy); mag[idx(x,y)]=m; ang[idx(x,y)] = Math.atan2(sy,sx);
    }
  }
  let meanC=0, tiles=0;
  for (let ty=0; ty<h; ty+=tile){
    for (let tx=0; tx<w; tx+=tile){
      const hist = new Float32Array(bins);
      let sum=0;
      for (let y=ty; y<Math.min(h, ty+tile); y++){
        for (let x=tx; x<Math.min(w, tx+tile); x++){
          const m = mag[idx(x,y)];
          if (m>0){
            const a = (ang[idx(x,y)] + Math.PI) / (2*Math.PI);
            const bIdx = Math.min(bins-1, Math.floor(a*bins));
            hist[bIdx] += m; sum += m;
          }
        }
      }
      if (sum===0) continue;
      const mean = hist.reduce((a,b)=>a+b,0)/bins;
      let varsum=0; for (let i=0;i<bins;i++){ const d=hist[i]-mean; varsum+=d*d; }
      const coh = Math.sqrt(varsum)/ (sum||1);
      const val = 1 - Math.min(1, coh*2);
      meanC += val; tiles++;
      for (let y=ty; y<Math.min(h, ty+tile); y++) for (let x=tx; x<Math.min(w, tx+tile); x++) heat[idx(x,y)] = val;
    }
  }
  const mean = tiles? meanC/tiles : 0;
  return { heat, mean };
}

// =============================================
// File: lib/complexity/kolmogorov.ts
// =============================================
export function kolmogorovProxy(rgba:Uint8ClampedArray, w:number, h:number){
  // crude proxy: run-length like scan to estimate repetitiveness and approximate normalized compressed size
  let diffs=0; let total=w*h;
  for (let i=4;i<rgba.length;i+=4){
    if (rgba[i]!==rgba[i-4] || rgba[i+1]!==rgba[i-3] || rgba[i+2]!==rgba[i-2]) diffs++; // channel-shifted access slightly off is fine here
  }
  const ratio = diffs/Math.max(1,total);
  // invert so that more repeated structure => lower K; normalize 0..1
  const norm = Math.min(1, Math.max(0, ratio));
  return { norm };
}

// =============================================
// File: components/BarcodeChart.tsx
// =============================================
"use client";
import React from "react";
import { ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar } from "recharts";

export default function BarcodeChart({ bars, onFocus }:{ bars:{id:number; birth:number; death:number}[]; onFocus?:(id:number)=>void }){
  const data = bars.map(b=> ({ name: String(b.id), value: b.death - b.birth }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="name" stroke="#aaa" tick={{ fill: "#aaa" }} />
          <YAxis stroke="#aaa" tick={{ fill: "#aaa" }} />
          <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
          <Bar dataKey="value" onClick={(d:any)=> onFocus && onFocus(Number(d.name))} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// =============================================
// File: components/Atlas.tsx
// =============================================
"use client";
import React, { useMemo } from "react";

export default function Atlas({ atlas }:{ atlas:{ tiles:{ name:string; heat:Float32Array; w:number; h:number }[] } }){
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {atlas.tiles.map((t, i)=> <AtlasTile key={i} name={t.name} heat={t.heat} w={t.w} h={t.h} />)}
    </div>
  );
}

function AtlasTile({ name, heat, w, h }:{ name:string; heat:Float32Array; w:number; h:number }){
  const dataUrl = useMemo(()=> heatToDataURL(heat, w, h), [heat, w, h]);
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3">
      <div className="text-xs text-white/60 mb-2">{name}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUrl} alt={name} className="w-full h-auto rounded-md" />
    </div>
  );
}

function heatToDataURL(heat:Float32Array, w:number, h:number){
  const canvas = document.createElement("canvas"); canvas.width=w; canvas.height=h;
  const ctx = canvas.getContext("2d")!; const img = ctx.createImageData(w,h);
  let min=Infinity, max=-Infinity; for (let i=0;i<heat.length;i++){ const v=heat[i]; if (v<min) min=v; if (v>max) max=v; }
  const rng=max-min || 1;
  for (let i=0;i<heat.length;i++){
    const v=(heat[i]-min)/rng; const j=i*4; const [r,g,b]=turbo(v);
    img.data[j]=r; img.data[j+1]=g; img.data[j+2]=b; img.data[j+3]=255;
  }
  ctx.putImageData(img,0,0); return canvas.toDataURL("image/png");
}

function turbo(x:number){
  const r = Math.min(255, Math.max(0, 255*(1.0 - 1.5*(x-0.5)**2)));
  const g = Math.min(255, Math.max(0, 255*(1.2 - 4.0*(x-0.5)**2)));
  const b = Math.min(255, Math.max(0, 255*(1.0 - 1.5*(x-0.5)**2)));
  return [r,g,b];
}
