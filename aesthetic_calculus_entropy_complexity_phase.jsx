// app/entropy-complexity/page.tsx
// Aesthetic Entropy & Complexity Analyzer
// - Global Shannon entropy (grayscale)
// - Local entropy heatmap (configurable patch/stride/bins)
// - Gradient metrics: edge density, mean grad mag, gradient entropy
// - Spectral entropy via 2D FFT on a downsampled view (configurable size)
// - Lempel–Ziv complexity over serialized, quantized rows
// - Metric cards + toggles + heatmap previews
// Stack: React (client) + TailwindCSS; no external libs

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

// -------------------------------------------------------------
// Utility Hooks
// -------------------------------------------------------------
function useResize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [rect, setRect] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setRect({ width: Math.max(1, cr.width), height: Math.max(1, cr.height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, rect } as const;
}

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
  return H; // bits
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function downsampleTo(canvas: HTMLCanvasElement, img: HTMLImageElement, target: number) {
  const iw = img.naturalWidth || 256;
  const ih = img.naturalHeight || 256;
  const ar = iw / ih;
  let w = target, h = target;
  if (ar >= 1) {
    h = Math.max(1, Math.round(target / ar));
  } else {
    w = Math.max(1, Math.round(target * ar));
  }
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, iw, ih, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Sobel kernel
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
      Gx[idx(x, y)] = (c + 2 * f + i) - (a + 2 * d + g);
      Gy[idx(x, y)] = (g + 2 * h + i) - (a + 2 * b + c);
    }
  }
  return { Gx, Gy };
}

function gradientMagnitude(Gx: Float32Array, Gy: Float32Array) {
  const N = Gx.length;
  const mag = new Float32Array(N);
  for (let i = 0; i < N; i++) mag[i] = Math.hypot(Gx[i], Gy[i]);
  return mag;
}

function otsuThreshold(values: Float32Array) {
  // Simple Otsu over normalized array -> returns threshold
  // Build histogram with 256 bins over normalized range
  let min = Infinity, max = -Infinity;
  for (let v of values) { if (v < min) min = v; if (v > max) max = v; }
  const span = Math.max(1e-9, max - min);
  const bins = 256, hist = new Float32Array(bins);
  for (let v of values) {
    const t = Math.floor(((v - min) / span) * (bins - 1));
    hist[t]++;
  }
  const N = values.length;
  const prob = new Float32Array(bins);
  for (let i = 0; i < bins; i++) prob[i] = hist[i] / N;
  const omega = new Float32Array(bins);
  const mu = new Float32Array(bins);
  omega[0] = prob[0]; mu[0] = 0 * prob[0];
  for (let i = 1; i < bins; i++) {
    omega[i] = omega[i - 1] + prob[i];
    mu[i] = mu[i - 1] + i * prob[i];
  }
  const muT = mu[bins - 1];
  let maxSigma = -1, best = 0;
  for (let i = 0; i < bins; i++) {
    const w0 = omega[i], w1 = 1 - w0;
    if (w0 === 0 || w1 === 0) continue;
    const mu0 = mu[i] / w0;
    const mu1 = (muT - mu[i]) / w1;
    const sigmaB = w0 * w1 * (mu0 - mu1) * (mu0 - mu1);
    if (sigmaB > maxSigma) { maxSigma = sigmaB; best = i; }
  }
  const thr = min + (best / (bins - 1)) * span;
  return thr;
}

// Local entropy map
function localEntropy(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  bins: number,
  patch: number,
  stride: number,
  normalize: boolean
) {
  const mapW = Math.max(1, Math.floor((width - patch) / stride) + 1);
  const mapH = Math.max(1, Math.floor((height - patch) / stride) + 1);
  const out = new Float32Array(mapW * mapH);
  const binSize = 256 / bins;
  const hist = new Float32Array(bins);
  let minE = Infinity, maxE = -Infinity;

  for (let my = 0, y0 = 0; my < mapH; my++, y0 += stride) {
    for (let mx = 0, x0 = 0; mx < mapW; mx++, x0 += stride) {
      hist.fill(0);
      let n = 0;
      // optional local contrast normalization
      let mean = 0, std = 1;
      if (normalize) {
        for (let yy = 0; yy < patch; yy++) {
          for (let xx = 0; xx < patch; xx++) {
            mean += gray[(y0 + yy) * width + (x0 + xx)];
          }
        }
        n = patch * patch; mean /= n;
        let varr = 0;
        for (let yy = 0; yy < patch; yy++) {
          for (let xx = 0; xx < patch; xx++) {
            const v = gray[(y0 + yy) * width + (x0 + xx)] - mean;
            varr += v * v;
          }
        }
        std = Math.sqrt(varr / n) || 1;
      }

      for (let yy = 0; yy < patch; yy++) {
        for (let xx = 0; xx < patch; xx++) {
          let val = gray[(y0 + yy) * width + (x0 + xx)];
          if (normalize) val = clamp(Math.round((val - mean) / std * 32 + 128), 0, 255);
          const b = Math.min(bins - 1, Math.floor(val / binSize));
          hist[b]++;
        }
      }
      n = patch * patch;
      for (let i = 0; i < bins; i++) hist[i] = hist[i] / n;
      let H = 0;
      for (let i = 0; i < bins; i++) { const p = hist[i]; if (p > 0) H -= p * Math.log2(p); }
      out[my * mapW + mx] = H;
      if (H < minE) minE = H; if (H > maxE) maxE = H;
    }
  }
  return { map: out, mapW, mapH, minE, maxE } as const;
}

// Simple radix-2 FFT (real) utilities for spectral entropy
class Complex {
  constructor(public re: number, public im: number) {}
  add(b: Complex) { return new Complex(this.re + b.re, this.im + b.im); }
  sub(b: Complex) { return new Complex(this.re - b.re, this.im - b.im); }
  mul(b: Complex) { return new Complex(this.re * b.re - this.im * b.im, this.re * b.im + this.im * b.re); }
}

function fft1d(signal: Complex[]): Complex[] {
  const N = signal.length;
  if (N <= 1) return signal;
  if ((N & (N - 1)) !== 0) throw new Error("fft1d: N must be power of two");
  const even = new Array<Complex>(N / 2);
  const odd = new Array<Complex>(N / 2);
  for (let i = 0; i < N / 2; i++) { even[i] = signal[2 * i]; odd[i] = signal[2 * i + 1]; }
  const Fe = fft1d(even);
  const Fo = fft1d(odd);
  const out = new Array<Complex>(N);
  for (let k = 0; k < N / 2; k++) {
    const t = new Complex(Math.cos(-2 * Math.PI * k / N), Math.sin(-2 * Math.PI * k / N)).mul(Fo[k]);
    out[k] = Fe[k].add(t);
    out[k + N / 2] = Fe[k].sub(t);
  }
  return out;
}

function fft2dReal(input: Float32Array, W: number, H: number): Float32Array {
  // Convert rows to Complex, FFT rows, then columns
  const rows = new Array<Array<Complex>>(H);
  for (let y = 0; y < H; y++) {
    const row = new Array<Complex>(W);
    for (let x = 0; x < W; x++) row[x] = new Complex(input[y * W + x], 0);
    rows[y] = fft1d(row);
  }
  // columns
  const cols = new Array<Array<Complex>>(W);
  for (let x = 0; x < W; x++) {
    const col = new Array<Complex>(H);
    for (let y = 0; y < H; y++) col[y] = rows[y][x];
    cols[x] = fft1d(col);
  }
  // power spectrum
  const power = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cols[x][y];
      power[y * W + x] = c.re * c.re + c.im * c.im;
    }
  }
  return power;
}

function nextPow2(n: number) { let p = 1; while (p < n) p <<= 1; return p; }

// Lempel–Ziv complexity (LZ76) for a byte array
function lzComplexity(bytes: Uint8Array) {
  // Basic phrase count implementation
  const N = bytes.length;
  let i = 0, c = 1, l = 1, k = 1, kMax = 1;
  while (true) {
    if (i + k > N) { c++; break; }
    let match = false;
    for (let j = Math.max(0, i - l); j < i; j++) {
      let m = 0;
      while (m < k && bytes[j + m] === bytes[i + m]) m++;
      if (m === k) { match = true; break; }
    }
    if (match) {
      k++;
      if (k > kMax) kMax = k;
      if (i + k - 1 >= N) { c++; break; }
    } else {
      c++;
      i += k; l = Math.max(l, k); k = 1; kMax = Math.max(kMax, 1);
      if (i + k > N) break;
    }
  }
  // Normalize by N / log N (upper bound scaling for comparability)
  return c / (N / Math.log2(N + 1));
}

// Colormap
function colorize(val: number, min: number, max: number, scheme: "magma" | "viridis" | "gray") {
  const t = clamp((val - min) / Math.max(1e-9, max - min), 0, 1);
  if (scheme === "gray") {
    const c = Math.round(t * 255); return [c, c, c];
  }
  if (scheme === "viridis") {
    // Quick approximate viridis
    const r = Math.round(255 * t ** 0.2 * 0.9);
    const g = Math.round(255 * Math.min(1, 1.2 * t * (1 - 0.3 * (1 - t))));
    const b = Math.round(255 * (1 - t ** 1.2) * 0.9);
    return [r, g, b];
  }
  // magma-ish
  const r = Math.round(255 * Math.pow(t, 0.25));
  const g = Math.round(255 * Math.pow(t, 0.5) * 0.6);
  const b = Math.round(255 * t * 0.4);
  return [r, g, b];
}

// -------------------------------------------------------------
// Component
// -------------------------------------------------------------
export default function EntropyComplexityPage() {
  // Image and layout state
  const [uploaded, setUploaded] = useState<HTMLImageElement | null>(null);
  const [imgAR, setImgAR] = useState(16 / 9);
  const { ref: containerRef, rect } = useResize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Controls
  const [bins, setBins] = useState(64);
  const [patch, setPatch] = useState(16);
  const [stride, setStride] = useState(8);
  const [localNormalize, setLocalNormalize] = useState(true);
  const [fftSize, setFftSize] = useState(128);
  const [lzWindow, setLzWindow] = useState(512);
  const [aggregate, setAggregate] = useState<"mean" | "median" | "p90">("mean");
  const [heatScheme, setHeatScheme] = useState<"magma" | "viridis" | "gray">("magma");

  const [showLocalEntropy, setShowLocalEntropy] = useState(true);
  const [showGradMag, setShowGradMag] = useState(false);
  const [showSpectral, setShowSpectral] = useState(false);

  // Metrics
  const [globalEntropy, setGlobalEntropy] = useState<number | null>(null);
  const [edgeDensity, setEdgeDensity] = useState<number | null>(null);
  const [meanGradMag, setMeanGradMag] = useState<number | null>(null);
  const [gradEntropy, setGradEntropy] = useState<number | null>(null);
  const [spectralEntropy, setSpectralEntropy] = useState<number | null>(null);
  const [lzComplex, setLzComplex] = useState<number | null>(null);

  // Demo gradient image if none
  const demoURL = useMemo(() => {
    const c = document?.createElement("canvas");
    if (!c) return "";
    c.width = 256; c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, "#0b0b0c"); g.addColorStop(1, "#b3b3b3");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    return c.toDataURL();
  }, []);

  const img = useMemo(() => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.src = uploaded?.src || demoURL;
    el.onload = () => setImgAR(el.naturalWidth / el.naturalHeight || 16 / 9);
    return el;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploaded?.src, demoURL]);

  // Derived draw size: fit to width, preserve aspect, keep within viewport height
  const drawSize = useMemo(() => {
    const w = rect.width;
    const hMax = Math.max(240, window.innerHeight * 0.6);
    const hFromW = w / imgAR;
    const h = Math.min(hMax, hFromW);
    return { w: Math.floor(w), h: Math.floor(h) };
  }, [rect.width, imgAR]);

  // Render + compute metrics
  useEffect(() => {
    if (!canvasRef.current || !drawSize.w || !drawSize.h) return;
    const canvas = canvasRef.current; canvas.width = drawSize.w; canvas.height = drawSize.h;
    const ctx = canvas.getContext("2d")!;

    // draw image to fit
    const iw = img.naturalWidth || 256, ih = img.naturalHeight || 256;
    const targetAR = drawSize.w / drawSize.h; const srcAR = iw / ih;
    let sx = 0, sy = 0, sw = iw, sh = ih;
    if (srcAR > targetAR) { const newW = ih * targetAR; sx = (iw - newW) / 2; sw = newW; }
    else if (srcAR < targetAR) { const newH = iw / targetAR; sy = (ih - newH) / 2; sh = newH; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, drawSize.w, drawSize.h);

    // base buffers
    const frame = ctx.getImageData(0, 0, drawSize.w, drawSize.h);
    const { gray, width, height } = toGrayscaleUint8(frame);

    // Global entropy
    {
      const h = histogram(gray, bins);
      setGlobalEntropy(entropyFromProb(h));
    }

    // Gradients + gradient metrics
    const { Gx, Gy } = sobel(gray, width, height);
    const mag = gradientMagnitude(Gx, Gy);
    const N = mag.length;
    let sumMag = 0; for (let i = 0; i < N; i++) sumMag += mag[i];
    setMeanGradMag(sumMag / N);
    {
      // Edge density via Otsu on magnitude
      const thr = otsuThreshold(mag);
      let edges = 0; for (let i = 0; i < N; i++) if (mag[i] >= thr) edges++;
      setEdgeDensity((edges / N) * 100);
      // Gradient entropy from binned magnitudes
      const gm = new Uint8ClampedArray(N);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < N; i++) { const v = mag[i]; if (v < min) min = v; if (v > max) max = v; }
      const span = Math.max(1e-9, max - min);
      for (let i = 0; i < N; i++) gm[i] = Math.max(0, Math.min(255, Math.floor(((mag[i] - min) / span) * 255)));
      const hg = histogram(gm, bins);
      setGradEntropy(entropyFromProb(hg));
    }

    // Local entropy map (optionally rendered)
    let localE: ReturnType<typeof localEntropy> | null = null;
    {
      const effPatch = clamp(patch, 4, 96);
      const effStride = clamp(stride, 2, Math.max(2, Math.floor(effPatch / 2)));
      localE = localEntropy(gray, width, height, bins, effPatch, effStride, localNormalize);
    }

    // Spectral entropy (downsample to fftSize x fftSize)
    {
      const off = document.createElement("canvas");
      const pow2 = clamp(nextPow2(fftSize), 32, 256);
      const imgData = downsampleTo(off, img, pow2);
      const g2 = toGrayscaleUint8(imgData).gray;
      // zero-center values
      const f32 = new Float32Array(imgData.width * imgData.height);
      for (let i = 0; i < f32.length; i++) f32[i] = g2[i] - 127.5;
      const P = fft2dReal(f32, imgData.width, imgData.height);
      // Convert power to probability
      let sumP = 0; for (let i = 0; i < P.length; i++) sumP += P[i];
      const prob = new Float32Array(P.length);
      const eps = 1e-12; const inv = 1 / Math.max(eps, sumP);
      for (let i = 0; i < P.length; i++) prob[i] = P[i] * inv;
      setSpectralEntropy(entropyFromProb(prob));
    }

    // LZ complexity over quantized rows (windowed)
    {
      const qBins = 32; const qSize = 256 / qBins;
      // Serialize rows until window length, or whole frame if smaller
      const W = width, H = height;
      const total = Math.min(lzWindow, W * H);
      const data = new Uint8Array(total);
      for (let i = 0; i < total; i++) data[i] = Math.min(qBins - 1, Math.floor(gray[i] / qSize));
      setLzComplex(lzComplexity(data));
    }

    // Heatmap overlay draw
    if (showLocalEntropy && localE) {
      const { map, mapW, mapH, minE, maxE } = localE;
      // upscale each cell to a rect on top of the image
      const cellW = width / mapW; const cellH = height / mapH;
      const overlay = ctx.getImageData(0, 0, width, height);
      const buf = overlay.data;
      for (let my = 0; my < mapH; my++) {
        for (let mx = 0; mx < mapW; mx++) {
          const v = map[my * mapW + mx];
          const [r, g, b] = colorize(v, minE, maxE, heatScheme);
          const x0 = Math.floor(mx * cellW), y0 = Math.floor(my * cellH);
          const x1 = Math.floor((mx + 1) * cellW), y1 = Math.floor((my + 1) * cellH);
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const k = (y * width + x) * 4;
              // alpha blend ~35%
              const a = 90; // 0..255
              buf[k] = (buf[k] * (255 - a) + r * a) / 255;
              buf[k + 1] = (buf[k + 1] * (255 - a) + g * a) / 255;
              buf[k + 2] = (buf[k + 2] * (255 - a) + b * a) / 255;
            }
          }
        }
      }
      ctx.putImageData(overlay, 0, 0);
    }

    if (showGradMag) {
      // draw a subtle grad magnitude overlay
      let min = Infinity, max = -Infinity;
      for (let v of mag) { if (v < min) min = v; if (v > max) max = v; }
      const overlay = ctx.getImageData(0, 0, width, height);
      const buf = overlay.data;
      for (let i = 0; i < mag.length; i++) {
        const t = (mag[i] - min) / Math.max(1e-9, max - min);
        const [r, g, b] = colorize(t, 0, 1, heatScheme);
        const k = i * 4; const a = 80;
        buf[k] = (buf[k] * (255 - a) + r * a) / 255;
        buf[k + 1] = (buf[k + 1] * (255 - a) + g * a) / 255;
        buf[k + 2] = (buf[k + 2] * (255 - a) + b * a) / 255;
      }
      ctx.putImageData(overlay, 0, 0);
    }

    if (showSpectral) {
      // Visualize low-res spectral energy as a small inset heatmap (top-right)
      const off = document.createElement("canvas");
      const s = clamp(nextPow2(fftSize), 32, 256);
      const imgData = downsampleTo(off, img, s);
      const g2 = toGrayscaleUint8(imgData).gray;
      const f32 = new Float32Array(imgData.width * imgData.height);
      for (let i = 0; i < f32.length; i++) f32[i] = g2[i] - 127.5;
      const P = fft2dReal(f32, imgData.width, imgData.height);
      let min = Infinity, max = -Infinity;
      for (let v of P) { if (v < min) min = v; if (v > max) max = v; }
      const scale = 2; // visualize inset at 2x
      const insetW = imgData.width * scale, insetH = imgData.height * scale;
      const inset = ctx.createImageData(insetW, insetH);
      for (let y = 0; y < insetH; y++) {
        for (let x = 0; x < insetW; x++) {
          const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
          const v = P[sy * imgData.width + sx];
          const [r, g, b] = colorize(v, min, max, heatScheme);
          const k = (y * insetW + x) * 4;
          inset.data[k] = r; inset.data[k + 1] = g; inset.data[k + 2] = b; inset.data[k + 3] = 220;
        }
      }
      ctx.putImageData(inset, Math.max(8, width - insetW - 8), 8);
      // border
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(Math.max(8, width - insetW - 8), 8, insetW, insetH);
    }
  }, [img, drawSize.w, drawSize.h, bins, patch, stride, localNormalize, fftSize, lzWindow, heatScheme, showLocalEntropy, showGradMag, showSpectral]);

  // Helpers
  function aggLabel(v: number | null) {
    return v == null ? "—" : (Math.round(v * 100) / 100).toString();
  }

  return (
    <div className="min-h-screen w-full bg-black text-zinc-200">
      {/* Shared header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <a href="/" className="text-lg font-semibold tracking-wide">aeDNA</a>
          <nav className="hidden gap-4 md:flex text-sm">
            <a className="opacity-80 hover:opacity-100" href="/aesthetic-calculus">Aesthetic Calculus</a>
            <a className="opacity-80 hover:opacity-100" href="/divergence-curl">Divergence & Curl</a>
            <a className="opacity-80 hover:opacity-100" href="/entropy-complexity">Entropy & Complexity</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* Output */}
          <section className="lg:col-span-7 xl:col-span-8">
            <div className="rounded-2xl border border-white/10 p-2 shadow-inner" ref={containerRef}>
              <div style={{ aspectRatio: `${imgAR}` }} className="relative w-full">
                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full rounded-xl" />
              </div>
            </div>
            <p className="mt-2 text-xs opacity-70">Output auto-fits your browser. Toggle overlays to explore different complexity lenses.</p>
          </section>

          {/* Controls & Metrics */}
          <aside className="lg:col-span-5 xl:col-span-4 space-y-4">
            <div className="rounded-2xl border border-white/10 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">Upload</h2>
              <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 p-4 hover:border-white/40">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  const url = URL.createObjectURL(file);
                  const im = new Image(); im.onload = () => setUploaded(im); im.src = url;
                }} />
                <span className="text-xs opacity-80">Click to upload image</span>
              </label>
              <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                <img src={uploaded?.src || demoURL} alt="thumbnail" className="h-28 w-full object-cover opacity-90" />
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">Global Entropy (bits)</div>
                <div className="text-2xl font-semibold">{aggLabel(globalEntropy)}</div>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">Spectral Entropy</div>
                <div className="text-2xl font-semibold">{aggLabel(spectralEntropy)}</div>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">Edge Density (%)</div>
                <div className="text-2xl font-semibold">{aggLabel(edgeDensity)}</div>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">Mean Grad Mag</div>
                <div className="text-2xl font-semibold">{aggLabel(meanGradMag)}</div>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">Gradient Entropy</div>
                <div className="text-2xl font-semibold">{aggLabel(gradEntropy)}</div>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">LZ Complexity (norm)</div>
                <div className="text-2xl font-semibold">{aggLabel(lzComplex)}</div>
              </div>
            </div>

            {/* Controls */}
            <div className="rounded-2xl border border-white/10 p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">Analysis Controls</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <label className="flex items-center justify-between"><span>Histogram Bins</span><span className="tabular-nums">{bins}</span></label>
                  <input type="range" min={16} max={256} step={16} value={bins} onChange={(e) => setBins(parseInt(e.target.value))} />
                </div>
                <div className="col-span-1">
                  <label className="flex items-center justify-between"><span>Patch Size</span><span className="tabular-nums">{patch}px</span></label>
                  <input type="range" min={8} max={64} step={2} value={patch} onChange={(e) => setPatch(parseInt(e.target.value))} />
                </div>
                <div className="col-span-1">
                  <label className="flex items-center justify-between"><span>Stride</span><span className="tabular-nums">{stride}px</span></label>
                  <input type="range" min={2} max={32} step={2} value={stride} onChange={(e) => setStride(parseInt(e.target.value))} />
                </div>
                <label className="col-span-2 flex items-center justify-between gap-4">
                  <span>Local Normalize</span>
                  <input type="checkbox" checked={localNormalize} onChange={(e) => setLocalNormalize(e.target.checked)} />
                </label>
                <div className="col-span-2">
                  <label className="flex items-center justify-between"><span>FFT Size</span><span className="tabular-nums">{fftSize}</span></label>
                  <input type="range" min={32} max={256} step={32} value={fftSize} onChange={(e) => setFftSize(parseInt(e.target.value))} />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center justify-between"><span>LZ Window</span><span className="tabular-nums">{lzWindow}</span></label>
                  <input type="range" min={128} max={4096} step={128} value={lzWindow} onChange={(e) => setLzWindow(parseInt(e.target.value))} />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center justify-between"><span>Colormap</span>
                    <select value={heatScheme} onChange={(e) => setHeatScheme(e.target.value as any)} className="rounded bg-zinc-900 px-2 py-1">
                      <option value="magma">Magma</option>
                      <option value="viridis">Viridis</option>
                      <option value="gray">Grayscale</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

            {/* Overlays */}
            <div className="rounded-2xl border border-white/10 p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">Overlays</h3>
              <div className="space-y-2 text-sm">
                <label className="flex items-center justify-between"><span>Local Entropy Map</span><input type="checkbox" checked={showLocalEntropy} onChange={(e) => setShowLocalEntropy(e.target.checked)} /></label>
                <label className="flex items-center justify-between"><span>Gradient Magnitude</span><input type="checkbox" checked={showGradMag} onChange={(e) => setShowGradMag(e.target.checked)} /></label>
                <label className="flex items-center justify-between"><span>Spectral Energy (Inset)</span><input type="checkbox" checked={showSpectral} onChange={(e) => setShowSpectral(e.target.checked)} /></label>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
