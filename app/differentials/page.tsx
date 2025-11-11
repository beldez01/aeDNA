// =============================================
// app/phase-3c/page.tsx (Revised)
// Phase 3C: Divergence & Curl visualizer (with vector culling + extra colormaps)
// =============================================
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Download, ImagePlus, Maximize2, RefreshCw } from "lucide-react";
import { ToolHeader } from "../../components/ToolHeader";
import CropperWithMenu, { Cropper } from "../../components/CropperWithMenu";
import { usePageState } from "../../lib/usePageState";
import { ClipboardViewer, ClipboardButton, saveToClipboard } from "../../components/ClipboardViewer";

type Vec2 = { x: number; y: number };

type Field = {
  width: number;
  height: number;
  u: Float32Array; // x component per pixel
  v: Float32Array; // y component per pixel
};

const Panel: React.FC<React.PropsWithChildren<{ title?: string; right?: React.ReactNode }>> = ({ title, right, children }) => (
  <div className="rounded-2xl bg-neutral-900/40 border border-neutral-800 backdrop-blur p-4 md:p-6 shadow-xl">
    <div className="flex items-center justify-between mb-3">
      {title ? <h3 className="text-lg md:text-xl font-semibold tracking-tight text-neutral-100">{title}</h3> : <div />}
      {right}
    </div>
    {children}
  </div>
);

const Lightbox: React.FC<{ src: string; alt?: string; onClose: () => void }> = ({ src, alt, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <motion.img
      initial={{ scale: 0.95 }}
      animate={{ scale: 1 }}
      alt={alt}
      src={src}
      className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl border border-neutral-700"
    />
  </motion.div>
);

// -------------------- Core Math: Sobel + Divergence/Curl --------------------

function toGrayscale(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

function getChannel(img: ImageData, ch: "luma"|"r"|"g"|"b"): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  if (ch === "luma") {
    for (let i = 0; i < width * height; i++) {
      out[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
    }
  } else {
    const offset = ch === "r" ? 0 : ch === "g" ? 1 : 2;
    for (let i = 0; i < width * height; i++) out[i] = data[i*4 + offset];
  }
  return out;
}

function nthDerivative(gray: Float32Array, w: number, h: number, order: number): Float32Array {
  if (order === 0) return gray;
  let curr = new Float32Array(gray);
  for (let n = 0; n < order; n++) {
    const next = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const avg = (curr[idx - 1] + curr[idx + 1] + curr[idx - w] + curr[idx + w]) / 4;
        next[idx] = Math.abs(curr[idx] - avg);
      }
    }
    curr = next;
  }
  return curr;
}

function sobel(gray: Float32Array, width: number, height: number): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sx = 0, sy = 0; let idx = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const p = gray[(y + j) * width + (x + i)];
          sx += p * kx[idx];
          sy += p * ky[idx];
          idx++;
        }
      }
      gx[y * width + x] = sx; gy[y * width + x] = sy;
    }
  }
  return { gx, gy };
}

function fieldFromImage(img: ImageData, gain = 1.0, smooth = 0): Field {
  const { width, height } = img;
  const gray = toGrayscale(img);
  const { gx, gy } = sobel(gray, width, height);
  const u = new Float32Array(gx);
  const v = new Float32Array(gy);
  if (smooth > 0) {
    const kernel = (2 * smooth + 1) ** 2;
    const tmpU = new Float32Array(u);
    const tmpV = new Float32Array(v);
    for (let y = smooth; y < height - smooth; y++) {
      for (let x = smooth; x < width - smooth; x++) {
        let su = 0, sv = 0;
        for (let j = -smooth; j <= smooth; j++) {
          for (let i = -smooth; i <= smooth; i++) {
            const idx = (y + j) * width + (x + i);
            su += tmpU[idx]; sv += tmpV[idx];
          }
        }
        const id = y * width + x;
        u[id] = su / kernel; v[id] = sv / kernel;
      }
    }
  }
  for (let i = 0; i < u.length; i++) { u[i] *= gain / 255; v[i] *= gain / 255; }
  return { width, height, u, v };
}

function divergence(field: Field): Float32Array {
  const { width, height, u, v } = field;
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const du_dx = (u[idx + 1] - u[idx - 1]) * 0.5;
      const dv_dy = (v[idx + width] - v[idx - width]) * 0.5;
      out[idx] = du_dx + dv_dy;
    }
  }
  return out;
}

function curlZ(field: Field): Float32Array {
  const { width, height, u, v } = field;
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const dv_dx = (v[idx + 1] - v[idx - 1]) * 0.5;
      const du_dy = (u[idx + width] - u[idx - width]) * 0.5;
      out[idx] = dv_dx - du_dy; // z-component of 2D curl
    }
  }
  return out;
}

// -------------------- Colormaps --------------------

function turboColor(t: number): [number, number, number] { t = clamp01(t); return [c(turbo(0,t)), c(turbo(1,t)), c(turbo(2,t))]; }
function turbo(channel: 0|1|2, x:number): number { const c0=[0.13572138,0.09140261,0.10667330][channel]; const c1=[4.61539260,2.19418839,1.97214727][channel]; const c2=[-42.66032258,-4.56418214,-31.29901412][channel]; const c3=[132.13108234,13.13828186,82.00982465][channel]; const c4=[-152.94239396,-27.08917800,-107.94342506][channel]; const c5=[59.28637943,14.66861254,44.98632945][channel]; return c0 + x*(c1 + x*(c2 + x*(c3 + x*(c4 + x*(c5))))); }
function viridisColor(t:number): [number,number,number] { const a=clamp01(t); return [c(0.2803+0.2499*a-1.1759*a*a+0.9212*a*a*a), c(0.1655+1.1661*a-1.1645*a*a+0.1840*a*a*a), c(0.4762+0.3321*a-0.3041*a*a+0.0550*a*a*a)]; }
function plasmaColor(t:number): [number,number,number] { const a=clamp01(t); return [c(0.050+2.404*a-2.318*a*a+0.864*a*a*a), c(0.030+0.528*a+0.657*a*a-0.214*a*a*a), c(0.527+0.533*a-0.586*a*a+0.324*a*a*a)]; }
function blueRedDiverging(t:number): [number,number,number] {
  const a=clamp01(t);
  if (a<0.5){ const k=a/0.5; return [c(k), c(k), 255]; } else { const k=(a-0.5)/0.5; return [255, c(1-k), c(1-k)]; }
}
function c(x:number){ return Math.round(255*Math.max(0,Math.min(1,x))); }
function clamp01(x:number){ return Math.max(0,Math.min(1,x)); }

function normalize(data: Float32Array, symmetric = false): { arr: Float32Array; min: number; max: number } {
  let min = Infinity, max = -Infinity;
  if (symmetric) {
    let amax = 0; for (let i=0;i<data.length;i++) amax = Math.max(amax, Math.abs(data[i]));
    min = -amax; max = amax;
  } else {
    for (let i=0;i<data.length;i++){ const v=data[i]; if(v<min)min=v; if(v>max)max=v; }
  }
  const out = new Float32Array(data.length);
  const range = max - min || 1;
  for (let i=0;i<data.length;i++) out[i] = (data[i] - min) / range;
  return { arr: out, min, max };
}

function scalarToImage(scalar: Float32Array, width: number, symmetric = false, palette: (t:number)=>[number,number,number] = turboColor): ImageData {
  const { arr } = normalize(scalar, symmetric);
  const img = new ImageData(width, scalar.length / width);
  for (let i=0;i<arr.length;i++){
    const [r,g,b] = palette(arr[i]);
    img.data[i*4+0]=r; img.data[i*4+1]=g; img.data[i*4+2]=b; img.data[i*4+3]=255;
  }
  return img;
}

// -------------------- Canvas Helpers --------------------

function drawImageDataToCanvas(ctx: CanvasRenderingContext2D, img: ImageData) {
  ctx.canvas.width = img.width; ctx.canvas.height = img.height; ctx.putImageData(img, 0, 0);
}

function drawArrows(
  ctx: CanvasRenderingContext2D,
  field: Field,
  opts: { step: number; scale: number; lineWidth: number; alpha: number; color?: string; cullWeak?: boolean; cullThreshold?: number }
) {
  const { width, height, u, v } = field;
  const { step, scale, lineWidth, alpha, color, cullWeak, cullThreshold } = opts;
  ctx.save();
  ctx.lineWidth = lineWidth; ctx.globalAlpha = alpha; ctx.strokeStyle = color || "white";
  const thresh = Math.max(0, cullThreshold ?? 0);
  const arrow = (x:number,y:number,dx:number,dy:number)=>{
    const mag = Math.hypot(dx,dy);
    if (cullWeak && mag < thresh) return;
    const len = mag * scale; const tx = x + dx * scale; const ty = y + dy * scale;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(tx,ty);
    const ang = Math.atan2(ty - y, tx - x); const ah = Math.max(3, Math.min(8, 0.25 * len));
    ctx.moveTo(tx,ty); ctx.lineTo(tx - ah*Math.cos(ang - Math.PI/6), ty - ah*Math.sin(ang - Math.PI/6));
    ctx.moveTo(tx,ty); ctx.lineTo(tx - ah*Math.cos(ang + Math.PI/6), ty - ah*Math.sin(ang + Math.PI/6));
    ctx.stroke();
  };
  for (let y=0;y<height;y+=step){
    for (let x=0;x<width;x+=step){ const idx=y*width+x; arrow(x+0.5,y+0.5,u[idx],v[idx]); }
  }
  ctx.restore();
}

// -------------------- Main --------------------

const Phase3CPage: React.FC = () => {
  const [imgURL, setImgURL] = useState<string | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [field, setField] = useState<Field | null>(null);
  const [divImg, setDivImg] = useState<string | null>(null);
  const [curlImg, setCurlImg] = useState<string | null>(null);
  const [showLightbox, setShowLightbox] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
  const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
  const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showCropMenu, setShowCropMenu] = useState(false);
  const cropMenuRef = useRef<HTMLDivElement>(null);
  const [clipboardOpen, setClipboardOpen] = useState(false);

  // Persisted controls using localStorage - state is remembered across navigation
  const [persistedState, setPersistedState] = usePageState("differentials", {
    gain: 1.25,
    smooth: 1,
    arrowDensity: 12,
    vectorScale: 6,
    arrowAlpha: 0.9,
    mapMode: "div" as "derivative"|"div"|"curl",
    derivativeOrder: 1,
    channelMode: "luma" as "luma"|"r"|"g"|"b",
    showVectors: true,
    cullThreshold: 0.06,
    divPalette: "turbo" as "turbo"|"viridis"|"plasma"|"diverging",
  });

  const symmetric = true; // Always symmetric normalize

  // Destructure for easier access
  const {
    gain,
    smooth,
    arrowDensity,
    vectorScale,
    arrowAlpha,
    mapMode,
    derivativeOrder,
    channelMode,
    showVectors,
    cullThreshold,
    divPalette,
  } = persistedState;

  // Setters that update the persisted state
  const setGain = (v: number) => setPersistedState(p => ({ ...p, gain: v }));
  const setSmooth = (v: number) => setPersistedState(p => ({ ...p, smooth: v }));
  const setArrowDensity = (v: number) => setPersistedState(p => ({ ...p, arrowDensity: v }));
  const setVectorScale = (v: number) => setPersistedState(p => ({ ...p, vectorScale: v }));
  const setArrowAlpha = (v: number) => setPersistedState(p => ({ ...p, arrowAlpha: v }));
  const setMapMode = (v: "derivative"|"div"|"curl") => setPersistedState(p => ({ ...p, mapMode: v }));
  const setDerivativeOrder = (v: number) => setPersistedState(p => ({ ...p, derivativeOrder: v }));
  const setChannelMode = (v: "luma"|"r"|"g"|"b") => setPersistedState(p => ({ ...p, channelMode: v }));
  const setShowVectors = (v: boolean) => setPersistedState(p => ({ ...p, showVectors: v }));
  const setCullThreshold = (v: number) => setPersistedState(p => ({ ...p, cullThreshold: v }));
  const setDivPalette = (v: "turbo"|"viridis"|"plasma"|"diverging") => setPersistedState(p => ({ ...p, divPalette: v }));

  const baseCanvasRef = useRef<HTMLCanvasElement>(null); // hidden - for processing
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgURL(url);
    setImgPreview(url);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setImgURL(url);
      setImgPreview(url);
    }
  }

  function handleClipboardImage(record: any) {
    const url = URL.createObjectURL(record.blob);
    setImgURL(url);
    setImgPreview(url);
    setClipboardOpen(false);
  }

  useEffect(() => {
    if (!imgURL || !baseCanvasRef.current) return;
    const img = new Image(); img.crossOrigin="anonymous";
    img.onload = () => {
      const MAX = 640; let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX){ const s = Math.min(MAX/w, MAX/h); w = Math.round(w*s); h = Math.round(h*s); }
      const c = baseCanvasRef.current!; c.width = w; c.height = h;
      const ctx = c.getContext("2d")!; ctx.drawImage(img,0,0,w,h);
      const data = ctx.getImageData(0,0,w,h); setImageData(data);
    };
    img.src = imgURL;
  }, [imgURL]);

  const recompute = () => {
    if (!imageData) return;
    const { width: w, height: h } = imageData;
    
    const mapCanvas = mapCanvasRef.current!; const mapCtx = mapCanvas.getContext("2d")!;
    const overlayCanvas = overlayCanvasRef.current!; const overlayCtx = overlayCanvas.getContext("2d")!;

    mapCanvas.width = w; mapCanvas.height = h;
    overlayCanvas.width = w; overlayCanvas.height = h;
    overlayCtx.clearRect(0, 0, w, h);

    if (mapMode === "derivative") {
      // Derivative mode - use channel and order
      const channel = getChannel(imageData, channelMode);
      const deriv = nthDerivative(channel, w, h, derivativeOrder);
      const imgData = scalarToImage(deriv, w, false, turboColor);
      mapCtx.putImageData(imgData, 0, 0);
      
      // Draw vectors if enabled
      if (showVectors) {
        const { gx, gy } = sobel(channel, w, h);
        const field = { width: w, height: h, u: gx.map(v => -v), v: gy.map(v => -v) };
        const arrowWidth = 0.8 + (vectorScale * 0.05);
        const step = Math.max(4, 54 - arrowDensity); // Invert: higher density = lower step = more arrows
        drawArrows(overlayCtx, field, { step, scale: vectorScale, lineWidth: arrowWidth, alpha: arrowAlpha, cullWeak: cullThreshold > 0, cullThreshold });
      }
    } else {
      // Divergence or Curl mode
      const f = fieldFromImage(imageData, gain, smooth);
      const div = divergence(f);
      const curl = curlZ(f);

      const paletteFn = mapMode === "div"
        ? (divPalette === "turbo" ? turboColor : divPalette === "viridis" ? viridisColor : divPalette === "plasma" ? plasmaColor : blueRedDiverging)
        : turboColor;

      const divId = scalarToImage(div, f.width, symmetric, divPalette === "diverging" ? blueRedDiverging : paletteFn);
      const curlId = scalarToImage(curl, f.width, symmetric, paletteFn);

      drawImageDataToCanvas(mapCtx, mapMode === "div" ? divId : curlId);
      
      // Draw vectors
      const arrowWidth = 0.8 + (vectorScale * 0.05);
      const step = Math.max(4, 54 - arrowDensity); // Invert: higher density = lower step = more arrows
      drawArrows(overlayCtx, f, { step, scale: vectorScale, lineWidth: arrowWidth, alpha: arrowAlpha, cullWeak: cullThreshold > 0, cullThreshold });

      setField(f);
      setDivImg(mapMode === "div" ? mapCanvas.toDataURL("image/png") : divImg);
      setCurlImg(mapMode === "curl" ? mapCanvas.toDataURL("image/png") : curlImg);
    }
  };

  useEffect(() => { recompute(); /* eslint-disable-next-line */ }, [imageData, gain, smooth, arrowDensity, vectorScale, arrowAlpha, mapMode, cullThreshold, divPalette, derivativeOrder, channelMode, showVectors]);

  function exportPNG(){ const c = mapCanvasRef.current; if(!c) return; const a = document.createElement("a"); a.href=c.toDataURL("image/png"); a.download=`phase3c_${mapMode}.png`; a.click(); }
  function reset(){ setGain(1.25); setSmooth(1); setArrowDensity(12); setVectorScale(6); setArrowAlpha(0.9); setMapMode("div"); setCullThreshold(0.06); setDivPalette("turbo"); setDerivativeOrder(1); setChannelMode("luma"); setShowVectors(true); }

  // Close crop menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cropMenuRef.current && !cropMenuRef.current.contains(e.target as Node)) {
        setShowCropMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#0D0D0F] text-neutral-200">
      <ToolHeader />
      <div className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Differentials</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Controls */}
          <div className="space-y-6">
            <Panel title="Source & Settings" right={<button onClick={reset} className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"><RefreshCw className="h-3.5 w-3.5"/>Reset</button>}>
              <div className="space-y-3">
                {/* Top section: Image preview + Toggles side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Image preview box */}
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

                  {/* Toggles */}
                  <div className="space-y-2">
                    <ToggleGroup label="Map" value={mapMode} onChange={(v)=>setMapMode(v as any)} options={[
                      {value:"derivative", label:"Derivative"},
                      {value:"div", label:"Divergence"},
                      {value:"curl", label:"Curl (z)"}
                    ]} />
                    {mapMode === "derivative" && (
                      <>
                        <ToggleGroup label="Channel" value={channelMode} onChange={(v)=>setChannelMode(v as any)} options={[
                          {value:"luma", label:"Luma"},
                          {value:"r", label:"R"},
                          {value:"g", label:"G"},
                          {value:"b", label:"B"}
                        ]} />
                        <Toggle label="Show Vectors" checked={showVectors} onChange={setShowVectors} />
                      </>
                    )}
                    {mapMode === "div" && (
                      <ToggleGroup label="Div Colormap" value={divPalette} onChange={(v)=>setDivPalette(v as any)} options={[
                        {value:"turbo", label:"Turbo"},
                        {value:"viridis", label:"Viridis"},
                        {value:"plasma", label:"Plasma"},
                        {value:"diverging", label:"Blue↔Red"}
                      ]} />
                    )}
                  </div>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Sliders in 2-column grid below */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {mapMode === "derivative" ? (
                    <>
                      <Slider label={`Order (${derivativeOrder})`} min={0} max={8} step={1} value={derivativeOrder} onChange={setDerivativeOrder} />
                      {showVectors && (
                        <>
                          <Slider label={`Density (${arrowDensity})`} min={6} max={48} step={2} value={arrowDensity} onChange={setArrowDensity} />
                          <Slider label={`Vector Scale (${vectorScale.toFixed(1)})`} min={1} max={100} step={0.5} value={vectorScale} onChange={setVectorScale} />
                          <Slider label={`Alpha (${arrowAlpha.toFixed(2)})`} min={0.2} max={1} step={0.05} value={arrowAlpha} onChange={setArrowAlpha} />
                          <Slider label={`Cull (${cullThreshold.toFixed(2)})`} min={0} max={1} step={0.01} value={cullThreshold} onChange={setCullThreshold} />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <Slider label={`Gain (${gain.toFixed(2)})`} min={0.25} max={4} step={0.05} value={gain} onChange={setGain} />
                      <Slider label={`Smooth (${smooth})`} min={0} max={4} step={1} value={smooth} onChange={setSmooth} />
                      <Slider label={`Density (${arrowDensity})`} min={6} max={48} step={2} value={arrowDensity} onChange={setArrowDensity} />
                      <Slider label={`Vector Scale (${vectorScale.toFixed(1)})`} min={1} max={100} step={0.5} value={vectorScale} onChange={setVectorScale} />
                      <Slider label={`Alpha (${arrowAlpha.toFixed(2)})`} min={0.2} max={1} step={0.05} value={arrowAlpha} onChange={setArrowAlpha} />
                      <Slider label={`Cull (${cullThreshold.toFixed(2)})`} min={0} max={1} step={0.01} value={cullThreshold} onChange={setCullThreshold} />
                    </>
                  )}
                </div>
              </div>
            </Panel>
          </div>

          {/* Right: Output */}
          <div className="space-y-6">
            <Panel 
              title="Scalar Map" 
              right={
                <div className="flex gap-2">
                  {/* Crop button with inline dropdown */}
                  <div className="relative" ref={cropMenuRef}>
                    <button 
                      onClick={() => {
                        if (cropMode) {
                          setCropMode(null);
                        } else {
                          setShowCropMenu(!showCropMenu);
                        }
                      }}
                      className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    >
                      {cropMode ? "Cancel" : "Crop"}
                    </button>
                    {showCropMenu && !cropMode && (
                      <div className="absolute z-50 mt-2 w-40 rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl overflow-hidden">
                        <button
                          onClick={() => {
                            const canvas = mapCanvasRef.current;
                            if (canvas) {
                              setOutputDataURL(canvas.toDataURL('image/png'));
                              setCropMode("square");
                              setShowCropMenu(false);
                            }
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-800"
                        >
                          Square crop
                        </button>
                        <button
                          onClick={() => {
                            const canvas = mapCanvasRef.current;
                            if (canvas) {
                              setOutputDataURL(canvas.toDataURL('image/png'));
                              setCropMode("circle");
                              setShowCropMenu(false);
                            }
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-800"
                        >
                          Circle crop
                        </button>
                        <button
                          onClick={() => {
                            const canvas = mapCanvasRef.current;
                            if (canvas) {
                              setOutputDataURL(canvas.toDataURL('image/png'));
                              setCropMode("custom");
                              setShowCropMenu(false);
                            }
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-800"
                        >
                          Custom (polygon)
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={exportPNG} className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">
                    <Download className="h-3.5 w-3.5"/>PNG
                  </button>
                </div>
              }
            >
              <div className="relative">
                {cropMode && outputDataURL ? (
                  <Cropper
                    src={outputDataURL}
                    mode={cropMode}
                    onCrop={(result: any) => {
                      setCroppedResult(result);
                      setCropMode(null);
                    }}
                    onClipboardUpdate={(result: any) => {}}
                    writeToSystemClipboard={false}
                    showToolbar={true}
                    overlayEnabled={true}
                  />
                ) : (
                  <>
                    <canvas ref={mapCanvasRef} className="w-full rounded-xl border border-neutral-800 bg-black/40 select-none" style={{maxWidth: '100%', height: 'auto'}} />
                    <canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 w-full h-full rounded-xl" />
                  </>
                )}
                {imageData && !cropMode && (
                  <button onClick={() => setShowLightbox(mapCanvasRef.current?.toDataURL("image/png") || "")} className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-black/60 border border-neutral-700 hover:bg-black/70">
                    <Maximize2 className="h-3.5 w-3.5"/> Expand
                  </button>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* Hidden canvas for processing */}
      <canvas ref={baseCanvasRef} className="hidden" />

      {showLightbox && <Lightbox src={showLightbox} onClose={() => setShowLightbox(null)} />}
      
      {/* Export dialog */}
      {croppedResult && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setCroppedResult(null)}
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">Export Cropped Image</h3>
            <img src={croppedResult.dataUrl} alt="cropped" className="w-full h-auto rounded-xl border border-neutral-800 mb-4" />
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  try {
                    await saveToClipboard(croppedResult.blob, `differentials_cropped_${Date.now()}.png`);
                    alert("✓ Saved to Studio clipboard!");
                    setCroppedResult(null);
                  } catch (err) {
                    console.error("Clipboard error:", err);
                    alert("Failed to save to clipboard");
                  }
                }}
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
          </motion.div>
        </motion.div>
      )}

      {/* Clipboard Viewer */}
      <ClipboardViewer 
        isOpen={clipboardOpen} 
        onClose={() => setClipboardOpen(false)}
        onImageSelect={handleClipboardImage}
      />
      
      {/* Clipboard Button */}
      <ClipboardButton onClick={() => setClipboardOpen(true)} />

      {/* Section Divider */}
      <div className="border-t-4 border-neutral-800 my-12" />

      {/* Calculus Lab Section */}
      <CalculusLabSection />
    </div>
  );
};

// ========== CALCULUS LAB SECTION ==========

function CalculusLabSection() {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
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
  const [w1, setW1] = useState(0.5);
  const [w2, setW2] = useState(0.2);
  const [w3, setW3] = useState(0.2);
  const [w4, setW4] = useState(0.1);
  const [w5, setW5] = useState(0.1);
  const [showEdges, setShowEdges] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showCenter, setShowCenter] = useState(true);
  const [showSourcesSinks, setShowSourcesSinks] = useState(true);
  const [showTension, setShowTension] = useState(true);
  const [clipboardOpen2, setClipboardOpen2] = useState(false);

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setImgPreview(url);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImgEl(img);
    img.src = url;
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
    setImgPreview(url);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImgEl(img);
      setClipboardOpen2(false);
    };
    img.src = url;
  }

  useEffect(() => {
    if (!imgEl) return;
    const MAX = 640;
    let W = imgEl.naturalWidth;
    let H = imgEl.naturalHeight;
    if (W > MAX || H > MAX) {
      const s = Math.min(MAX / W, MAX / H);
      W = Math.round(W * s);
      H = Math.round(H * s);
    }
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(imgEl, 0, 0, W, H);
    const id = ctx.getImageData(0, 0, W, H);
    setImageData(id);
  }, [imgEl]);

  const metrics = useMemo(() => {
    if (!imageData) return null;
    const { width: W, height: H } = imageData;

    const { Ix, Iy, mag } = computeGradientsCalc(imageData, sigma);
    const lap = computeLaplacianCalc(imageData, sigma);
    const logPos = new Float32Array(W * H);
    for (let i = 0; i < lap.length; i++) logPos[i] = Math.max(0, lap[i]);

    const tensor = computeStructureTensorCalc(Ix, Iy, W, H, sigma);
    const corner = tensor.corner;

    const gradSmooth = gaussianBlurCalc(mag, W, H, sigma);
    const homogeneity = new Float32Array(W * H);
    const gnorm = normalize01Calc(gradSmooth);
    for (let i = 0; i < homogeneity.length; i++) homogeneity[i] = 1 - gnorm[i];

    const colorContrast = normalize01Calc(mag);

    const phi = composeAttentionalPotentialCalc(
      {
        grad: normalize01Calc(mag),
        logPos: normalize01Calc(logPos),
        corners: normalize01Calc(corner),
        colorContrast: normalize01Calc(colorContrast),
        homogeneity: normalize01Calc(homogeneity),
      },
      { w1, w2, w3, w4, w5 }
    );

    return { W, H, mag, Ix, Iy, lap, logPos, corner, homogeneity, colorContrast, phi };
  }, [imageData, sigma, w1, w2, w3, w4, w5]);

  const overlays = useMemo(() => {
    if (!metrics) return null;
    const { W, H, mag, corner, phi } = metrics;

    const center = computeAttentionCenterCalc(phi, W, H, { topPercent, multiscale });
    const ss = findSourcesSinksCalc(phi, W, H, { zPos, zNeg, nmsRadius: nmsR, maxPoints: maxMarkers });
    const tension = greatestAestheticTensionCalc(mag, corner, phi, W, H, { w1: 0.5, w2: 0.3, w3: 0.2, nmsRadius: nmsR });

    return { center, ss, tension };
  }, [metrics, topPercent, multiscale, zPos, zNeg, nmsR, maxMarkers]);

  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs || !metrics || !imageData) return;
    const ctx = cvs.getContext("2d")!;
    const { W, H, mag, phi } = metrics;
    cvs.width = W; cvs.height = H;

    ctx.putImageData(imageData, 0, 0);

    if (showEdges) {
      drawHeatmapCalc(ctx, normalize01Calc(mag), W, H, { alpha: 0.35 });
    }
    if (showHotspots) {
      const thr = percentileCalc(phi, 100 - topPercent);
      const mask = new Float32Array(W * H);
      for (let i = 0; i < phi.length; i++) mask[i] = phi[i] >= thr ? phi[i] : 0;
      drawHeatmapCalc(ctx, mask, W, H, { alpha: 0.4 });
    }

    if (overlays) {
      if (showCenter) drawCrosshairCalc(ctx, overlays.center.x, overlays.center.y, { ringRadius: Math.max(6, overlays.center.radius), color: "#F5C84B" });
      if (showSourcesSinks) {
        drawGlyphsCalc(ctx, overlays.ss.sources, { color: "#00B3B3", shape: "triangleUp" });
        drawGlyphsCalc(ctx, overlays.ss.sinks, { color: "#FF4D9A", shape: "triangleDown" });
      }
      if (showTension) {
        drawGlyphsCalc(ctx, [{ x: overlays.tension.x, y: overlays.tension.y, z: overlays.tension.tau }], { color: "#FF3333", shape: "bolt" });
      }
    }
  }, [metrics, overlays, imageData, showEdges, showHotspots, showCenter, showSourcesSinks, showTension, topPercent]);

  function exportPNG() {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "calculus-lab.png";
    a.click();
  }

  function reset() {
    setSigma(1.5);
    setTopPercent(10);
    setMultiscale(true);
    setZPos(1.5);
    setZNeg(-1.5);
    setNmsR(7);
    setMaxMarkers(50);
    setW1(0.5);
    setW2(0.2);
    setW3(0.2);
    setW4(0.1);
    setW5(0.1);
    setShowEdges(true);
    setShowHotspots(true);
    setShowCenter(true);
    setShowSourcesSinks(true);
    setShowTension(true);
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6">Calculus Lab</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Controls */}
          <div className="space-y-6">
            <Panel title="Source & Settings" right={<button onClick={reset} className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"><RefreshCw className="h-3.5 w-3.5"/>Reset</button>}>
              <div className="space-y-3">
                {/* Image upload */}
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
                                setClipboardOpen2(true);
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

                  {/* Overlays */}
                  <div className="space-y-2">
                    <div className="text-xs text-neutral-300 mb-1">Overlays</div>
                    <Toggle label="Edges" checked={showEdges} onChange={setShowEdges} />
                    <Toggle label="Hotspots" checked={showHotspots} onChange={setShowHotspots} />
                    <Toggle label="Center" checked={showCenter} onChange={setShowCenter} />
                    <Toggle label="Sources/Sinks" checked={showSourcesSinks} onChange={setShowSourcesSinks} />
                    <Toggle label="Tension" checked={showTension} onChange={setShowTension} />
                  </div>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Core params */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Slider label={`Smooth σ (${sigma.toFixed(1)})`} min={0.8} max={3.0} step={0.1} value={sigma} onChange={setSigma} />
                  <Slider label={`Top % (${topPercent})`} min={2} max={20} step={1} value={topPercent} onChange={setTopPercent} />
                  <Slider label={`NMS radius (${nmsR})`} min={3} max={15} step={1} value={nmsR} onChange={setNmsR} />
                  <Slider label={`Max markers (${maxMarkers})`} min={10} max={100} step={5} value={maxMarkers} onChange={setMaxMarkers} />
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Attention weights */}
                <div>
                  <div className="text-xs text-neutral-300 mb-2">Attention Weights</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <Slider label={`w₁ Edges (${w1.toFixed(2)})`} min={0} max={1} step={0.05} value={w1} onChange={setW1} />
                    <Slider label={`w₂ LoG+ (${w2.toFixed(2)})`} min={0} max={1} step={0.05} value={w2} onChange={setW2} />
                    <Slider label={`w₃ Corners (${w3.toFixed(2)})`} min={0} max={1} step={0.05} value={w3} onChange={setW3} />
                    <Slider label={`w₄ Color (${w4.toFixed(2)})`} min={0} max={1} step={0.05} value={w4} onChange={setW4} />
                    <Slider label={`w₅ Homo− (${w5.toFixed(2)})`} min={0} max={1} step={0.05} value={w5} onChange={setW5} />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <Toggle label="Multiscale" checked={multiscale} onChange={setMultiscale} />
                </div>
              </div>
            </Panel>
          </div>

          {/* Right: Output */}
          <div className="space-y-6">
            <Panel title="Output" right={<button onClick={exportPNG} className="inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"><Download className="h-3.5 w-3.5"/>PNG</button>}>
              <div className="relative">
                <canvas ref={canvasRef} className="w-full rounded-xl border border-neutral-800 bg-black/40 select-none" style={{maxWidth: '100%', height: 'auto'}} />
                {metrics && (
                  <div className="mt-2 text-xs text-neutral-500">
                    {metrics.W} × {metrics.H}px
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* Clipboard Viewer for Calculus Lab */}
      <ClipboardViewer 
        isOpen={clipboardOpen2} 
        onClose={() => setClipboardOpen2(false)}
        onImageSelect={handleClipboardImage}
      />
      
      {/* Clipboard Button for Calculus Lab */}
      <ClipboardButton onClick={() => setClipboardOpen2(true)} />
    </>
  );
}

// ========== Calculus Lab Math Functions ==========

type FieldCalc = Float32Array;

function toGrayscaleCalc(image: ImageData): FieldCalc {
  const { data, width: W, height: H } = image;
  const out = new Float32Array(W * H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    out[j] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return out;
}

function gaussianBlurCalc(src: FieldCalc, W: number, H: number, sigma: number): FieldCalc {
  if (sigma <= 0) return src.slice() as FieldCalc;
  const r = Math.max(1, Math.round(sigma * 3));
  const kernel: number[] = [];
  const s2 = sigma * sigma;
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * s2)); kernel.push(v); sum += v; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
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

function computeGradientsCalc(image: ImageData, sigma = 1.0) {
  const gray = toGrayscaleCalc(image);
  const { width: W, height: H } = image;
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);

  const g = gaussianBlurCalc(gray, W, H, sigma);
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

function computeLaplacianCalc(image: ImageData, sigma = 1.0): FieldCalc {
  const gray = toGrayscaleCalc(image);
  const { width: W, height: H } = image;
  const g = gaussianBlurCalc(gray, W, H, sigma);
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      out[i] = -4 * g[i] + g[i - 1] + g[i + 1] + g[i - W] + g[i + W];
    }
  }
  return out;
}

function computeStructureTensorCalc(Ix: FieldCalc, Iy: FieldCalc, W: number, H: number, sigma = 1.0) {
  const Ixx = new Float32Array(W * H);
  const Iyy = new Float32Array(W * H);
  const Ixy = new Float32Array(W * H);
  for (let i = 0; i < Ixx.length; i++) {
    const ix = Ix[i] || 0, iy = Iy[i] || 0;
    Ixx[i] = ix * ix; Iyy[i] = iy * iy; Ixy[i] = ix * iy;
  }
  const Jxx = gaussianBlurCalc(Ixx, W, H, sigma);
  const Jyy = gaussianBlurCalc(Iyy, W, H, sigma);
  const Jxy = gaussianBlurCalc(Ixy, W, H, sigma);

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
    corner[i] = l1;
    theta[i] = 0.5 * Math.atan2(2 * b, a - d);
  }
  const cornerN = normalize01Calc(corner);
  return { coherence, corner: cornerN, theta };
}

function normalize01Calc(src: FieldCalc): FieldCalc {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < src.length; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const out = new Float32Array(src.length);
  const den = mx - mn > 1e-9 ? (mx - mn) : 1;
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - mn) / den;
  return out;
}

function percentileCalc(src: FieldCalc, p: number) {
  const arr = Array.from(src);
  arr.sort((a, b) => a - b);
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)));
  return arr[idx];
}

function zscoreFieldCalc(src: FieldCalc): FieldCalc {
  let mean = 0; for (let i = 0; i < src.length; i++) mean += src[i];
  mean /= src.length;
  let v = 0; for (let i = 0; i < src.length; i++) { const d = src[i] - mean; v += d * d; }
  const sd = Math.sqrt(v / Math.max(1, src.length - 1)) || 1;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - mean) / sd;
  return out;
}

function gradientCalc(field: FieldCalc, W: number, H: number) {
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

function divergenceCalc(gx: FieldCalc, gy: FieldCalc, W: number, H: number): FieldCalc {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const ddx = (gx[i + 1] - gx[i - 1]) * 0.5;
      const ddy = (gy[i + W] - gy[i - W]) * 0.5;
      out[i] = ddx + ddy;
    }
  }
  return out;
}

function composeAttentionalPotentialCalc(
  inputs: { grad: FieldCalc; logPos: FieldCalc; corners: FieldCalc; colorContrast: FieldCalc; homogeneity: FieldCalc },
  weights: { w1: number; w2: number; w3: number; w4: number; w5: number }
): FieldCalc {
  const { grad, logPos, corners, colorContrast, homogeneity } = inputs;
  const { w1, w2, w3, w4, w5 } = weights;
  const N = grad.length;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = w1 * grad[i] + w2 * logPos[i] + w3 * corners[i] + w4 * colorContrast[i] - w5 * homogeneity[i];
  }
  return normalize01Calc(out);
}

function computeAttentionCenterCalc(
  phi: FieldCalc, W: number, H: number,
  opts: { topPercent?: number; multiscale?: boolean } = {}
): { x: number; y: number; radius: number } {
  const { topPercent = 10, multiscale = true } = opts;
  const scales = multiscale ? [1, 2, 4] : [1];
  const pts: { x: number; y: number }[] = [];
  for (const s of scales) {
    const phis = s > 1 ? gaussianBlurCalc(phi, W, H, s) : phi;
    const thr = percentileCalc(phis, 100 - topPercent);
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

function findSourcesSinksCalc(
  phi: FieldCalc, W: number, H: number,
  opts: { zPos?: number; zNeg?: number; nmsRadius?: number; maxPoints?: number } = {}
): { sources: { x: number; y: number; z: number }[]; sinks: { x: number; y: number; z: number }[] } {
  const { zPos = 1.5, zNeg = -1.5, nmsRadius = 7, maxPoints = 50 } = opts;
  const { gx, gy } = gradientCalc(phi, W, H);
  const div = divergenceCalc(gx, gy, W, H);
  const z = zscoreFieldCalc(div);

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

function greatestAestheticTensionCalc(
  gradMag: FieldCalc, corner: FieldCalc, phi: FieldCalc, W: number, H: number,
  opts: { w1?: number; w2?: number; w3?: number; nmsRadius?: number } = {}
): { x: number; y: number; tau: number } {
  const { w1 = 0.5, w2 = 0.3, w3 = 0.2 } = opts;
  const { gx, gy } = gradientCalc(phi, W, H);
  const gphi = new Float32Array(W * H);
  for (let i = 0; i < gphi.length; i++) gphi[i] = Math.hypot(gx[i] || 0, gy[i] || 0);

  const e = normalize01Calc(gradMag);
  const k = normalize01Calc(corner);
  const g = normalize01Calc(gphi);

  const tau = new Float32Array(W * H);
  let bestI = 0;
  for (let i = 0; i < tau.length; i++) { tau[i] = w1 * e[i] + w2 * k[i] + w3 * g[i]; if (tau[i] > tau[bestI]) bestI = i; }

  const bx = bestI % W, by = Math.floor(bestI / W);
  return { x: bx, y: by, tau: tau[bestI] };
}

// ========== Calculus Lab Drawing Functions ==========

function turboCalc(u: number) {
  const r = Math.min(1, Math.max(0, 1.7 * u - 0.3));
  const g = Math.min(1, Math.max(0, 1.7 * (1 - Math.abs(u - 0.5) * 2)));
  const b = Math.min(1, Math.max(0, 1.7 * (1 - u) - 0.3));
  return [r * 255, g * 255, b * 255];
}

function drawHeatmapCalc(
  ctx: CanvasRenderingContext2D,
  field: Float32Array,
  W: number,
  H: number,
  opts: { alpha?: number } = {}
) {
  const { alpha = 0.35 } = opts;
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(1, field[i]));
    const [r, g, b] = turboCalc(v);
    img.data[4 * i + 0] = r;
    img.data[4 * i + 1] = g;
    img.data[4 * i + 2] = b;
    img.data[4 * i + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(img, 0, 0);
}

function drawCrosshairCalc(
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

function drawGlyphsCalc(
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

export default Phase3CPage;

// -------------------- Tiny UI Bits --------------------

const Slider: React.FC<{ label: string; min: number; max: number; step: number; value: number; onChange: (v:number)=>void }> = ({ label, min, max, step, value, onChange }) => (
  <div className="space-y-0.5">
    <label className="text-xs text-neutral-300">{label}</label>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e)=>onChange(parseFloat(e.target.value))} className="w-full accent-teal-400" />
  </div>
);

const ToggleGroup: React.FC<{ label: string; value: string; onChange: (v:string)=>void; options: {value:string; label:string}[] }> = ({ label, value, onChange, options }) => (
  <div className="space-y-1">
    <div className="text-xs text-neutral-300">{label}</div>
    <div className="inline-flex p-0.5 bg-neutral-900/60 rounded-xl border border-neutral-800">
      {options.map(opt => (
        <button key={opt.value} onClick={()=>onChange(opt.value)} className={`px-2.5 py-1 rounded-lg text-xs transition ${value===opt.value?"bg-neutral-700 text-white":"text-neutral-400 hover:text-white"}`}>{opt.label}</button>
      ))}
    </div>
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

const Select: React.FC<{ label: string; value: string; onChange: (v:string)=>void; options: {value:string; label:string}[] }> = ({ label, value, onChange, options }) => (
  <label className="block">
    <span className="text-xs text-neutral-300">{label}</span>
    <select className="mt-0.5 w-full bg-neutral-900/60 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-600" value={value} onChange={(e)=>onChange(e.target.value)}>
      {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  </label>
);

const Empty: React.FC = () => (
  <div className="aspect-video w-full grid place-items-center rounded-xl border border-neutral-800 bg-neutral-900/30 text-neutral-500 text-sm">No data yet</div>
);

const NavPills: React.FC<{ items: { href: string; label: string; active?: boolean }[]; className?: string }> = ({ items, className }) => (
  <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
    {items.map((it) => (
      <a key={it.href} href={it.href} className={`px-3 py-1.5 rounded-xl border text-sm transition ${it.active?"bg-neutral-800 border-neutral-700 text-white":"bg-neutral-900/50 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700"}`}>
        {it.label}
      </a>
    ))}
  </div>
);
