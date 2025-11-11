// app/entropy-complexity/page.tsx
// Unified Entropy & Exhaustion
// Combines comprehensive entropy metrics with exhaustion curve tracking

"use client";

import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Play, Pause, RefreshCw, Save, Download } from "lucide-react";
import { ToolHeader } from "../../components/ToolHeader";
import { usePageState } from "../../lib/usePageState";
import { Cropper } from "../../components/CropperWithMenu";
import dynamic from "next/dynamic";
import { ClipboardViewer, ClipboardButton, saveToClipboard } from "../../components/ClipboardViewer";

const ResponsiveContainer = dynamic(() => import("recharts").then(m => m.ResponsiveContainer), { ssr: false });
const LineChart = dynamic(() => import("recharts").then(m => m.LineChart), { ssr: false });
const Line = dynamic(() => import("recharts").then(m => m.Line), { ssr: false });
const XAxis = dynamic(() => import("recharts").then(m => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then(m => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then(m => m.Tooltip), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then(m => m.CartesianGrid), { ssr: false });

// -------------------------------------------------------------
// Math / Image Helpers
// -------------------------------------------------------------
const LUMA = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function toGrayscaleUint8(imgData: ImageData) {
  const { data, width, height } = imgData;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = Math.max(0, Math.min(255, Math.round(LUMA(data[i], data[i + 1], data[i + 2]))));
  }
  return { gray: out, width, height } as const;
}

function histogram(gray: Uint8ClampedArray, bins: number) {
  const h = new Float32Array(bins);
  const binSize = 256 / bins;
  for (let i = 0; i < gray.length; i++) {
    const b = Math.min(bins - 1, Math.floor(gray[i] / binSize));
    h[b]++;
  }
  const n = gray.length || 1;
  for (let i = 0; i < bins; i++) h[i] /= n;
  return h;
}

function entropyFromProb(prob: Float32Array) {
  let H = 0;
  for (let i = 0; i < prob.length; i++) {
    const p = prob[i];
    if (p > 0) H -= p * Math.log2(p);
  }
  return H;
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
  return { r: ent(rHist), g: ent(gHist), b: ent(bHist), avg: (ent(rHist) + ent(gHist) + ent(bHist)) / 3 };
}

function localVariance(gray: Uint8ClampedArray, w: number, h: number) {
  let acc = 0, cnt = 0;
  const idx = (x: number, y: number) => y * w + x;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
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

function sobel(gray: Uint8ClampedArray, width: number, height: number) {
  const Gx = new Float32Array(width * height);
  const Gy = new Float32Array(width * height);
  const idx = (x: number, y: number) => y * width + x;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const xm1 = x - 1, xp1 = x + 1, ym1 = y - 1, yp1 = y + 1;
      const a = gray[idx(xm1, ym1)], b = gray[idx(x, ym1)], c = gray[idx(xp1, ym1)];
      const d = gray[idx(xm1, y)],   f = gray[idx(xp1, y)];
      const g = gray[idx(xm1, yp1)], h = gray[idx(x, yp1)], i = gray[idx(xp1, yp1)];
      const gx = (-a - 2 * d - g + c + 2 * f + i);
      const gy = (-a - 2 * b - c + g + 2 * h + i);
      Gx[y * width + x] = gx;
      Gy[y * width + x] = gy;
    }
  }
  return { Gx, Gy } as const;
}

function lempelZivComplexity(data: Uint8ClampedArray, windowSize: number) {
  const n = Math.min(data.length, windowSize);
  const dict = new Set<string>();
  let i = 0, s = "";
  while (i < n) {
    s += String.fromCharCode(data[i] & 0x0f);
    if (!dict.has(s)) {
      dict.add(s);
      s = "";
    }
    i++;
  }
  return dict.size;
}

// Transforms
function applyQuantization(imgData: ImageData, levels: number) {
  const out = new ImageData(imgData.width, imgData.height);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const r = Math.floor(imgData.data[i] / 256 * levels) * (256 / levels);
    const g = Math.floor(imgData.data[i + 1] / 256 * levels) * (256 / levels);
    const b = Math.floor(imgData.data[i + 2] / 256 * levels) * (256 / levels);
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
    out.data[i + 3] = imgData.data[i + 3];
  }
  return out;
}

function applyBoxBlur(imgData: ImageData, radius: number) {
  if (radius === 0) return imgData;
  const { width, height, data } = imgData;
  const out = new Uint8ClampedArray(data);
  const r = Math.max(1, radius);
  const d = 2 * r + 1;
  const n = d * d;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rAcc = 0, gAcc = 0, bAcc = 0, cnt = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) {
          const idx = (yy * width + xx) * 4;
          rAcc += data[idx];
          gAcc += data[idx + 1];
          bAcc += data[idx + 2];
          cnt++;
        }
      }
      const idx = (y * width + x) * 4;
      out[idx] = rAcc / cnt;
      out[idx + 1] = gAcc / cnt;
      out[idx + 2] = bAcc / cnt;
    }
  }
  return new ImageData(out, width, height);
}

function applyPixelSort(imgData: ImageData, ratio: number) {
  const { width, height, data } = imgData;
  const out = new Uint8ClampedArray(data);
  const sortRows = Math.floor(height * ratio);
  for (let y = 0; y < sortRows; y++) {
    const row: { r: number; g: number; b: number; a: number; luma: number }[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      const luma = LUMA(r, g, b);
      row.push({ r, g, b, a, luma });
    }
    row.sort((a, b) => a.luma - b.luma);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[i] = row[x].r;
      out[i + 1] = row[x].g;
      out[i + 2] = row[x].b;
      out[i + 3] = row[x].a;
    }
  }
  return new ImageData(out, width, height);
}

// Colormaps
function magmaColor(t: number) {
  const r = Math.min(255, Math.max(0, Math.round(255 * (0.001462 + t * (2.258267 + t * (-3.557995 + t * 5.375986))))));
  const g = Math.min(255, Math.max(0, Math.round(255 * (0.000466 + t * (0.179190 + t * (4.243327 + t * (-7.437655)))))));
  const b = Math.min(255, Math.max(0, Math.round(255 * (0.013866 + t * (2.393285 + t * (-5.353797 + t * 3.818268))))));
  return [r, g, b];
}

function viridisColor(t: number) {
  const r = Math.min(255, Math.max(0, Math.round(255 * (0.267004 + t * (-0.119374 + t * (1.855084 + t * (-2.505638)))))));
  const g = Math.min(255, Math.max(0, Math.round(255 * (0.004874 + t * (1.424487 + t * (-0.660518 + t * 0.028306))))));
  const b = Math.min(255, Math.max(0, Math.round(255 * (0.329415 + t * (1.780914 + t * (-4.590288 + t * 3.451434))))));
  return [r, g, b];
}

export default function EntropyComplexityPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);
  
  const [uploaded, setUploaded] = useState<HTMLImageElement | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cropMode, setCropMode] = useState<"square" | "circle" | "custom" | null>(null);
  const [outputDataURL, setOutputDataURL] = useState<string | null>(null);
  const [croppedResult, setCroppedResult] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [showCropMenu, setShowCropMenu] = useState(false);
  const cropMenuRef = useRef<HTMLDivElement>(null);
  const [clipboardOpen, setClipboardOpen] = useState(false);

  // Metrics
  const [globalEntropy, setGlobalEntropy] = useState(0);
  const [spectralEntropy, setSpectralEntropy] = useState(0);
  const [edgeDensity, setEdgeDensity] = useState(0);
  const [meanGradMag, setMeanGradMag] = useState(0);
  const [gradEntropy, setGradEntropy] = useState(0);
  const [lzComplex, setLzComplex] = useState(0);
  const [chromaEntropy, setChromaEntropy] = useState(0);
  const [texture, setTexture] = useState(0);
  const [aestheticEntropy, setAestheticEntropy] = useState(0);

  // Exhaustion tracking
  const [trace, setTrace] = useState<any[]>([]);
  const [playing, setPlaying] = useState(false);
  const [autoRecord, setAutoRecord] = useState(true);

  // Persisted controls - remembers settings across navigation
  const [persistedState, setPersistedState] = usePageState("entropy-complexity", {
    bins: 64,
    patch: 16,
    stride: 8,
    fftSize: 128,
    lzWindow: 1024,
    localNormalize: false,
    downscale: 640,
    quantLevels: 16,
    blurRadius: 0,
    sortRatio: 0,
    stepDelay: 200,
    showLocalEntropy: true,
    showGradMag: false,
    showSpectral: false,
    heatScheme: "magma" as "magma" | "viridis" | "gray",
    weights: { gray: 0.35, chroma: 0.25, texture: 0.2, edges: 0.2 }
  });

  const { 
    bins, patch, stride, fftSize, lzWindow, localNormalize, downscale,
    quantLevels, blurRadius, sortRatio, stepDelay,
    showLocalEntropy, showGradMag, showSpectral, heatScheme, weights
  } = persistedState;

  const setBins = (v: number) => setPersistedState(p => ({ ...p, bins: v }));
  const setPatch = (v: number) => setPersistedState(p => ({ ...p, patch: v }));
  const setStride = (v: number) => setPersistedState(p => ({ ...p, stride: v }));
  const setFftSize = (v: number) => setPersistedState(p => ({ ...p, fftSize: v }));
  const setLzWindow = (v: number) => setPersistedState(p => ({ ...p, lzWindow: v }));
  const setLocalNormalize = (v: boolean) => setPersistedState(p => ({ ...p, localNormalize: v }));
  const setDownscale = (v: number) => setPersistedState(p => ({ ...p, downscale: v }));
  const setQuantLevels = (v: number) => setPersistedState(p => ({ ...p, quantLevels: v }));
  const setBlurRadius = (v: number) => setPersistedState(p => ({ ...p, blurRadius: v }));
  const setSortRatio = (v: number) => setPersistedState(p => ({ ...p, sortRatio: v }));
  const setStepDelay = (v: number) => setPersistedState(p => ({ ...p, stepDelay: v }));
  const setShowLocalEntropy = (v: boolean) => setPersistedState(p => ({ ...p, showLocalEntropy: v }));
  const setShowGradMag = (v: boolean) => setPersistedState(p => ({ ...p, showGradMag: v }));
  const setShowSpectral = (v: boolean) => setPersistedState(p => ({ ...p, showSpectral: v }));
  const setHeatScheme = (v: "magma" | "viridis" | "gray") => setPersistedState(p => ({ ...p, heatScheme: v }));
  const setWeights = (v: typeof weights) => setPersistedState(p => ({ ...p, weights: v }));

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
      await saveToClipboard(croppedResult.blob, `entropy_cropped_${Date.now()}.png`);
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
        setTrace([]);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
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

  const handleClipboardImage = (record: any) => {
    if (typeof Image === 'undefined') return;
    const url = URL.createObjectURL(record.blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setUploaded(img);
      setImgPreview(url);
      setTrace([]);
      setClipboardOpen(false);
    };
    img.src = url;
  };

  // Compute all metrics
  const computeMetrics = (imgData: ImageData) => {
    const { gray, width, height } = toGrayscaleUint8(imgData);
    
    // Global entropy
    const hist = histogram(gray, bins);
    const H = entropyFromProb(hist);
    setGlobalEntropy(H);

    // Chromatic entropy
    const chroma = perChannelEntropies(imgData.data, bins);
    setChromaEntropy(chroma.avg);

    // Texture
    const tex = localVariance(gray, width, height);
    setTexture(tex);

    // Sobel edges
    const { Gx, Gy } = sobel(gray, width, height);
    let edgeSum = 0, gradSum = 0;
    const gradMags: number[] = [];
    for (let i = 0; i < Gx.length; i++) {
      const mag = Math.sqrt(Gx[i] * Gx[i] + Gy[i] * Gy[i]);
      gradSum += mag;
      gradMags.push(Math.min(255, mag));
      if (mag > 20) edgeSum++;
    }
    setEdgeDensity(edgeSum / Gx.length);
    setMeanGradMag(gradSum / Gx.length);
    
    // Gradient entropy
    const gradGray = new Uint8ClampedArray(gradMags);
    const gradHist = histogram(gradGray, bins);
    setGradEntropy(entropyFromProb(gradHist));

    // LZ complexity
    const lz = lempelZivComplexity(gray, lzWindow);
    setLzComplex(lz);

    // Spectral entropy (simplified - just FFT magnitude entropy)
    const fftData = gray.slice(0, fftSize * fftSize);
    const fftHist = histogram(fftData, bins);
    setSpectralEntropy(entropyFromProb(fftHist));

    // Aesthetic entropy (weighted combination)
    const Hnorm = H / Math.log2(bins);
    const Cnorm = chroma.avg / Math.log2(bins);
    const Tnorm = Math.min(1, tex / 1000);
    const Enorm = edgeSum / Gx.length;
    const aesthetic = weights.gray * Hnorm + weights.chroma * Cnorm + weights.texture * Tnorm + weights.edges * Enorm;
    setAestheticEntropy(aesthetic);

    return { H, chroma: chroma.avg, tex, edgeSum: edgeSum / Gx.length, aesthetic };
  };

  // Render with overlays
  const render = () => {
    if (!uploaded || !canvasRef.current || !originalRef.current) return;

    const orig = originalRef.current;
    const out = canvasRef.current;
    const ctx = out.getContext("2d")!;

    // Downsample to original canvas
    const iw = uploaded.naturalWidth;
    const ih = uploaded.naturalHeight;
    const maxDim = downscale;
    let w = iw, h = ih;
    if (w > maxDim || h > maxDim) {
      if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
      else { w = Math.round(w * maxDim / h); h = maxDim; }
    }
    orig.width = w;
    orig.height = h;
    const origCtx = orig.getContext("2d")!;
    origCtx.drawImage(uploaded, 0, 0, w, h);
    let imgData = origCtx.getImageData(0, 0, w, h);

    // Apply transforms
    if (quantLevels < 64) imgData = applyQuantization(imgData, quantLevels);
    if (blurRadius > 0) imgData = applyBoxBlur(imgData, blurRadius);
    if (sortRatio > 0) imgData = applyPixelSort(imgData, sortRatio);

    out.width = w;
    out.height = h;
    ctx.putImageData(imgData, 0, 0);

    // Compute metrics
    const metrics = computeMetrics(imgData);

    // Apply overlays
    if (showLocalEntropy || showGradMag) {
      const { gray } = toGrayscaleUint8(imgData);
      
      if (showLocalEntropy) {
        // Local entropy heatmap
        const localMap = new Float32Array(w * h);
        for (let y = 0; y < h; y += stride) {
          for (let x = 0; x < w; x += stride) {
            const patchData: number[] = [];
            for (let py = 0; py < patch && y + py < h; py++) {
              for (let px = 0; px < patch && x + px < w; px++) {
                patchData.push(gray[(y + py) * w + (x + px)]);
              }
            }
            const pHist = new Float32Array(bins);
            const binSize = 256 / bins;
            for (const v of patchData) pHist[Math.min(bins - 1, Math.floor(v / binSize))]++;
            for (let i = 0; i < bins; i++) pHist[i] /= patchData.length || 1;
            let H = 0;
            for (let i = 0; i < bins; i++) if (pHist[i] > 0) H -= pHist[i] * Math.log2(pHist[i]);
            const Hnorm = localNormalize ? H / Math.log2(bins) : H / 8;
            for (let py = 0; py < patch && y + py < h; py++) {
              for (let px = 0; px < patch && x + px < w; px++) {
                localMap[(y + py) * w + (x + px)] = Hnorm;
              }
            }
          }
        }
        
        const overlay = ctx.createImageData(w, h);
        for (let i = 0; i < localMap.length; i++) {
          const t = Math.min(1, Math.max(0, localMap[i]));
          const [r, g, b] = heatScheme === "viridis" ? viridisColor(t) : heatScheme === "gray" ? [t * 255, t * 255, t * 255] : magmaColor(t);
          overlay.data[i * 4] = r;
          overlay.data[i * 4 + 1] = g;
          overlay.data[i * 4 + 2] = b;
          overlay.data[i * 4 + 3] = 180;
        }
        ctx.globalCompositeOperation = "multiply";
        ctx.putImageData(overlay, 0, 0);
        ctx.globalCompositeOperation = "source-over";
      }

      if (showGradMag) {
        const { Gx, Gy } = sobel(gray, w, h);
        const overlay = ctx.createImageData(w, h);
        for (let i = 0; i < Gx.length; i++) {
          const mag = Math.sqrt(Gx[i] * Gx[i] + Gy[i] * Gy[i]);
          const t = Math.min(1, mag / 100);
          const [r, g, b] = viridisColor(t);
          overlay.data[i * 4] = r;
          overlay.data[i * 4 + 1] = g;
          overlay.data[i * 4 + 2] = b;
          overlay.data[i * 4 + 3] = 160;
        }
        ctx.globalCompositeOperation = "screen";
        ctx.putImageData(overlay, 0, 0);
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // Record if auto-record is on
    if (autoRecord && trace.length < 200) {
      setTrace(prev => [...prev, { 
        step: prev.length, 
        aesthetic: aestheticEntropy, 
        Hgray: globalEntropy, 
        Hchroma: chromaEntropy, 
        texture, 
        edges: edgeDensity * 100 
      }]);
    }
  };

  const applyStep = () => {
    if (!canvasRef.current || !originalRef.current) return;
    
    // Apply one iteration of transform
    const ctx = canvasRef.current.getContext("2d")!;
    const imgData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    let transformed = imgData;
    if (quantLevels < 64) transformed = applyQuantization(transformed, Math.max(2, quantLevels - 1));
    if (blurRadius > 0) transformed = applyBoxBlur(transformed, Math.min(8, blurRadius + 1));
    if (sortRatio < 1) {
      const newRatio = Math.min(1, sortRatio + 0.05);
      setSortRatio(newRatio);
      transformed = applyPixelSort(transformed, newRatio);
    }
    
    ctx.putImageData(transformed, 0, 0);
    const metrics = computeMetrics(transformed);
    
    setTrace(prev => [...prev, { 
      step: prev.length, 
      aesthetic: metrics.aesthetic, 
      Hgray: metrics.H, 
      Hchroma: metrics.chroma, 
      texture: metrics.tex, 
      edges: metrics.edgeSum * 100 
    }]);
  };

  const resetCanvas = () => {
    setTrace([]);
    setSortRatio(0);
    render();
  };

  const exportCSV = () => {
    const header = "step,aesthetic,Hgray,Hchroma,texture,edges\n";
    const rows = trace.map(d => `${d.step},${d.aesthetic},${d.Hgray},${d.Hchroma},${d.texture},${d.edges}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "exhaustion-curve.csv";
    a.click();
  };

  const exportPNG = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "entropy-output.png";
    a.click();
  };

  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploaded, bins, patch, stride, fftSize, lzWindow, localNormalize, downscale, quantLevels, blurRadius, sortRatio, showLocalEntropy, showGradMag, showSpectral, heatScheme, weights.gray, weights.chroma, weights.texture, weights.edges]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      applyStep();
    }, stepDelay);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stepDelay]);

  const aggLabel = (v: number) => (v === 0 ? "—" : v.toFixed(3));

  return (
    <div className="min-h-screen w-full bg-[#0D0D0F] text-neutral-200">
      <ToolHeader />
      <main className="mx-auto max-w-7xl px-1 py-4 md:py-6">
        <h1 className="text-2xl md:text-3xl font-medium tracking-wide text-neutral-200 mb-4 md:mb-6 text-center">Entropy & Exhaustion</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input + Controls */}
          <div>
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <div className="space-y-3">
                {/* Image Upload + Overlays */}
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

                  {/* Overlays */}
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-neutral-300 mb-2">Overlays</div>
                      <div className="space-y-2">
                        <label className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-neutral-300">Local Entropy</span>
                          <button onClick={()=>setShowLocalEntropy(!showLocalEntropy)} className={`w-10 h-6 rounded-full border transition relative ${showLocalEntropy?"bg-teal-500/30 border-teal-400":"bg-neutral-800 border-neutral-700"}`}>
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition ${showLocalEntropy?"translate-x-4 bg-teal-400":"bg-neutral-500"}`}></span>
                          </button>
                        </label>
                        <label className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-neutral-300">Gradient Mag</span>
                          <button onClick={()=>setShowGradMag(!showGradMag)} className={`w-10 h-6 rounded-full border transition relative ${showGradMag?"bg-teal-500/30 border-teal-400":"bg-neutral-800 border-neutral-700"}`}>
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition ${showGradMag?"translate-x-4 bg-teal-400":"bg-neutral-500"}`}></span>
                          </button>
                        </label>
                      </div>
                    </div>

                    {/* Colormap */}
                    <div>
                      <div className="text-xs text-neutral-300 mb-2">Colormap</div>
                      <div className="inline-flex p-0.5 bg-neutral-900/60 rounded-xl border border-neutral-800 w-full">
                        <button onClick={()=>setHeatScheme("magma")} className={`flex-1 px-2.5 py-1 rounded-lg text-xs transition ${heatScheme==="magma"?"bg-neutral-700 text-white":"text-neutral-400 hover:text-white"}`}>Magma</button>
                        <button onClick={()=>setHeatScheme("viridis")} className={`flex-1 px-2.5 py-1 rounded-lg text-xs transition ${heatScheme==="viridis"?"bg-neutral-700 text-white":"text-neutral-400 hover:text-white"}`}>Viridis</button>
                        <button onClick={()=>setHeatScheme("gray")} className={`flex-1 px-2.5 py-1 rounded-lg text-xs transition ${heatScheme==="gray"?"bg-neutral-700 text-white":"text-neutral-400 hover:text-white"}`}>Gray</button>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div>
                      <div className="text-xs text-neutral-300 mb-2">Live Metrics</div>
                      <div className="rounded-lg border border-neutral-800 bg-black/40 p-1.5 mb-2">
                        <div className="text-[9px] text-neutral-500">Aesthetic Entropy</div>
                        <div className="text-sm font-semibold text-teal-400">{aggLabel(aestheticEntropy)}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">Global H</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{aggLabel(globalEntropy)}</div>
                        </div>
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">Chroma H</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{aggLabel(chromaEntropy)}</div>
                        </div>
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">Spectral</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{aggLabel(spectralEntropy)}</div>
                        </div>
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">Grad H</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{aggLabel(gradEntropy)}</div>
                        </div>
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">LZ</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{lzComplex}</div>
                        </div>
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">Texture</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{aggLabel(texture / 10)}</div>
                        </div>
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">Edges</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{aggLabel(edgeDensity)}</div>
                        </div>
                        <div className="rounded border border-neutral-800 bg-black/30 p-1">
                          <div className="text-[8px] text-neutral-500">Mean Grad</div>
                          <div className="text-[11px] font-semibold text-neutral-200">{aggLabel(meanGradMag)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Controls */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Bins ({bins})</label>
                    <input type="range" min={16} max={256} step={16} value={bins} onChange={(e) => setBins(parseInt(e.target.value))} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Patch ({patch}px)</label>
                    <input type="range" min={8} max={64} step={2} value={patch} onChange={(e) => setPatch(parseInt(e.target.value))} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Stride ({stride}px)</label>
                    <input type="range" min={2} max={32} step={2} value={stride} onChange={(e) => setStride(parseInt(e.target.value))} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Quant ({quantLevels})</label>
                    <input type="range" min={2} max={64} step={1} value={quantLevels} onChange={(e) => setQuantLevels(parseInt(e.target.value))} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Blur ({blurRadius})</label>
                    <input type="range" min={0} max={8} step={1} value={blurRadius} onChange={(e) => setBlurRadius(parseInt(e.target.value))} className="w-full accent-teal-400" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-neutral-300">Sort ({(sortRatio * 100).toFixed(0)}%)</label>
                    <input type="range" min={0} max={1} step={0.01} value={sortRatio} onChange={(e) => setSortRatio(parseFloat(e.target.value))} className="w-full accent-teal-400" />
                  </div>
                  <label className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-neutral-300">Local Norm</span>
                    <button onClick={()=>setLocalNormalize(!localNormalize)} className={`w-10 h-6 rounded-full border transition relative ${localNormalize?"bg-teal-500/30 border-teal-400":"bg-neutral-800 border-neutral-700"}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition ${localNormalize?"translate-x-4 bg-teal-400":"bg-neutral-500"}`}></span>
                    </button>
                  </label>
                  <label className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-neutral-300">Auto-record</span>
                    <button onClick={() => setAutoRecord(!autoRecord)} className={`w-10 h-6 rounded-full border transition relative ${autoRecord?"bg-teal-500/30 border-teal-400":"bg-neutral-800 border-neutral-700"}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition ${autoRecord?"translate-x-4 bg-teal-400":"bg-neutral-500"}`}></span>
                    </button>
                  </label>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Aesthetic weights */}
                <div>
                  <div className="text-xs text-neutral-300 mb-2">Aesthetic Entropy Weights</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <label className="text-xs text-neutral-300">Gray ({weights.gray.toFixed(2)})</label>
                      <input type="range" min={0} max={1} step={0.01} value={weights.gray} onChange={(e) => setWeights({ ...weights, gray: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-xs text-neutral-300">Chroma ({weights.chroma.toFixed(2)})</label>
                      <input type="range" min={0} max={1} step={0.01} value={weights.chroma} onChange={(e) => setWeights({ ...weights, chroma: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-xs text-neutral-300">Texture ({weights.texture.toFixed(2)})</label>
                      <input type="range" min={0} max={1} step={0.01} value={weights.texture} onChange={(e) => setWeights({ ...weights, texture: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-xs text-neutral-300">Edges ({weights.edges.toFixed(2)})</label>
                      <input type="range" min={0} max={1} step={0.01} value={weights.edges} onChange={(e) => setWeights({ ...weights, edges: parseFloat(e.target.value) })} className="w-full accent-teal-400" />
                    </div>
                  </div>
                </div>

                <div className="h-px bg-neutral-800" />

                {/* Actions */}
                <div className="flex gap-2">
                  <button onClick={applyStep} className="flex-1 inline-flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">
                    <Play className="h-3.5 w-3.5"/>Step
                  </button>
                  <button onClick={() => setPlaying(!playing)} className={`flex-1 inline-flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-xl border ${playing ? 'bg-red-900/30 border-red-700' : 'bg-neutral-800 border-neutral-700 hover:bg-neutral-700'}`}>
                    {playing ? <><Pause className="h-3.5 w-3.5"/>Pause</> : <><Play className="h-3.5 w-3.5"/>Auto</>}
                  </button>
                  <button onClick={resetCanvas} className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">
                    <RefreshCw className="h-3.5 w-3.5"/>
                  </button>
                  <button onClick={exportCSV} className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">
                    <Save className="h-3.5 w-3.5"/>
                  </button>
                  <button onClick={exportPNG} className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">
                    <Download className="h-3.5 w-3.5"/>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Output + Chart */}
          <div className="space-y-6">
            {/* Output canvas */}
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-neutral-300">Output</h3>
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
                        const canvas = canvasRef.current;
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
                    <canvas ref={originalRef} className="hidden" />
                  </>
                )}
              </div>
            </div>

            {/* Exhaustion curve */}
            <div className="rounded-2xl border border-neutral-800 bg-black/40 p-4">
              <h3 className="mb-2 text-sm font-medium text-neutral-300">Exhaustion Curve</h3>
              <div className="h-56">
                {typeof window !== "undefined" && trace.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trace} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="step" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }} labelStyle={{ color: "#fff" }} />
                      <Line type="monotone" dataKey="aesthetic" dot={false} strokeWidth={2.5} stroke="#14b8a6" />
                      <Line type="monotone" dataKey="Hgray" dot={false} strokeWidth={1.5} stroke="#60a5fa" />
                      <Line type="monotone" dataKey="Hchroma" dot={false} strokeWidth={1.5} stroke="#f472b6" />
                      <Line type="monotone" dataKey="edges" dot={false} strokeWidth={1} stroke="#fbbf24" />
                      <Line type="monotone" dataKey="texture" dot={false} strokeWidth={1} stroke="#a78bfa" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full grid place-items-center text-neutral-500 text-sm">Upload image to begin tracking</div>
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
