// =============================================================
// Multi‑Scale Aesthetic Charge — React Page + Core Functions
// Drop these files into your existing aeDNA project.
// - src/components/AestheticChargePage.jsx
// - src/lib/aestheticCharge.js
// The page renders a multi‑scale charge heatmap with controls and
// per‑scale visualization. CPU‑only (fast). No large kernels needed.
// =============================================================

// -------------------------------------------------------------
// src/lib/aestheticCharge.js
// -------------------------------------------------------------

// Small, fast numeric helpers for Float32 image buffers
export function normalize01(arr) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const d = hi - lo || 1e-6;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - lo) / d;
  return out;
}

function clamp01(x){ return x < 0 ? 0 : x > 1 ? 1 : x }

export function rgbToLuma(data) {
  // data: Uint8ClampedArray RGBA, return Float32Array [0,1]
  const n = (data.length / 4) | 0;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = data[j] / 255, g = data[j + 1] / 255, b = data[j + 2] / 255;
    // Rec. 709 luma
    out[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return out;
}

export function blur3x3(src, W, H) {
  // Separable [1,2,1]/4 blur; single pass horizontal + vertical
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

export function blur3x3Iter(src, W, H, iters = 1) {
  let cur = src;
  for (let i = 0; i < iters; i++) cur = blur3x3(cur, W, H);
  return cur === src ? src.slice() : cur;
}

export function downsampleBilinear(src, W, H, W2, H2) {
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

export function upsampleBilinear(src, W, H, W2, H2) {
  // Same as downsample but reversed roles
  return downsampleBilinear(src, W, H, W2, H2);
}

export function axpy(dst, src, a = 1) {
  for (let i = 0; i < dst.length; i++) dst[i] += a * src[i];
}

// --- Multi‑scale components -------------------------------------------------

function buildPyramid(L, W, H, levels = 4) {
  const pyr = [{ data: L, W, H }];
  for (let k = 1; k < levels; k++) {
    const { data, W: w, H: h } = pyr[k - 1];
    const w2 = Math.max(1, (w / 2) | 0), h2 = Math.max(1, (h / 2) | 0);
    const d2 = downsampleBilinear(data, w, h, w2, h2);
    pyr.push({ data: d2, W: w2, H: h2 });
  }
  return pyr;
}

function localBandpass3x3(img, W, H) {
  const blur = blur3x3(img, W, H);
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = Math.abs(img[i] - blur[i]);
  return normalize01(out);
}

export function multiScaleContrast(L, W, H, levels = 4, alphas = [0.6, 0.9, 1.2, 1.4]) {
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

export function globalLuminancePull(L) {
  const arr = Float32Array.from(L);
  // Faster median approx: nth_element would be ideal; use sort for simplicity (images are manageable)
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const med = sorted[(sorted.length / 2) | 0];
  const out = new Float32Array(L.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.abs(L[i] - med);
  return normalize01(out);
}

export function lowFreqSalience(L, W, H) {
  const w2 = Math.max(1, (W / 16) | 0), h2 = Math.max(1, (H / 16) | 0);
  const small = downsampleBilinear(L, W, H, w2, h2);
  const b1 = blur3x3Iter(small, w2, h2, 1);
  const b2 = blur3x3Iter(small, w2, h2, 3);
  const dog = new Float32Array(w2 * h2);
  for (let i = 0; i < dog.length; i++) dog[i] = Math.abs(b1[i] - b2[i]);
  const up = upsampleBilinear(normalize01(dog), w2, h2, W, H);
  return normalize01(up);
}

export function aestheticCharge(L, W, H, params) {
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

// Optional: simple edge‑aware smoothing — guided by luma to thicken masses without bleeding
export function guidedSmooth(signal, guide, W, H, strength = 0.4, iters = 1) {
  // One‑tap edge aware: blend with local blur but modulate by guide gradient magnitude
  let cur = signal;
  for (let t = 0; t < iters; t++) {
    const blur = blur3x3(cur, W, H);
    const out = new Float32Array(cur.length);
    // approximate gradient magnitude on guide
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
      const k = strength * (1.0 - grad); // preserve across strong edges
      out[i] = cur[i] * (1 - k) + blur[i] * k;
    }
    cur = out;
  }
  return cur;
}

// Colormap (Turbo‑like)
export function turboColor(v) {
  // Clamp and map v∈[0,1] to RGB (approx turbo)
  const x = clamp01(v);
  const r = 34.61 + x * (1172.33 - x * (10793.6 - x * (33300.1 - x * (38394.5 - x * 14825.0))));
  const g = 23.31 + x * (557.33 - x * (1225.0 - x * (3574.3 - x * (1073.77 + x * 707.56))));
  const b = 27.2 + x * (3211.1 - x * (15327.97 - x * (27814.0 - x * (22569.18 - x * 6838.66))));
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

export function toRGBA(col, A = 255) {
  return [Math.round(col[0] * 255), Math.round(col[1] * 255), Math.round(col[2] * 255), A];
}

export function paintHeatmapToImageData(buf01, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0, j = 0; i < buf01.length; i++, j += 4) {
    const [r, g, b] = turboColor(buf01[i]);
    out[j] = (r * 255) | 0; out[j + 1] = (g * 255) | 0; out[j + 2] = (b * 255) | 0; out[j + 3] = 255;
  }
  return new ImageData(out, W, H);
}

// -------------------------------------------------------------
// src/components/AestheticChargePage.jsx
// -------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react'
import { aestheticCharge, rgbToLuma, paintHeatmapToImageData, multiScaleContrast, globalLuminancePull, lowFreqSalience, guidedSmooth, normalize01 } from '../lib/aestheticCharge.js'

export default function AestheticChargePage(){
  const [imgURL, setImgURL] = useState(null)
  const [params, setParams] = useState({ levels: 4, alpha: [0.6,0.9,1.2,1.4], beta: 0.8, gamma: 0.5, squash: 1.2, smooth: 0.35 })
  const [view, setView] = useState('charge') // 'charge' | 'ms' | 'gl' | 'lf'
  const baseRef = useRef(null)
  const heatRef = useRef(null)

  useEffect(() => {
    if (!imgURL) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => render(img)
    img.src = imgURL
  }, [imgURL, params, view])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    setImgURL(url)
  }

  const render = (img) => {
    const base = baseRef.current
    const heat = heatRef.current
    const maxW = 960
    const scale = Math.min(1, maxW / img.width)
    base.width = (img.width * scale) | 0
    base.height = (img.height * scale) | 0
    heat.width = base.width
    heat.height = base.height

    const bctx = base.getContext('2d')
    bctx.clearRect(0,0,base.width, base.height)
    bctx.drawImage(img, 0, 0, base.width, base.height)

    const id = bctx.getImageData(0, 0, base.width, base.height)
    const L = rgbToLuma(id.data)
    let buf

    if (view === 'charge') {
      buf = aestheticCharge(L, base.width, base.height, params)
      // Edge‑aware smooth to thicken masses without bleeding across hard edges
      buf = guidedSmooth(buf, L, base.width, base.height, params.smooth, 1)
    } else if (view === 'ms') {
      buf = multiScaleContrast(L, base.width, base.height, params.levels, params.alpha)
    } else if (view === 'gl') {
      buf = globalLuminancePull(L)
    } else if (view === 'lf') {
      buf = lowFreqSalience(L, base.width, base.height)
    }

    // Paint heatmap
    const hctx = heat.getContext('2d')
    hctx.clearRect(0,0,heat.width, heat.height)
    const hm = paintHeatmapToImageData(normalize01(buf), heat.width, heat.height)
    hctx.putImageData(hm, 0, 0)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-4">Multi‑Scale Aesthetic Charge</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="text-sm opacity-80">Upload an image</div>
          <input type="file" accept="image/*" onChange={onFile} className="block w-full text-sm"/>

          <div className="p-3 rounded-xl border border-white/10 bg-white/5 space-y-3">
            <div className="text-xs opacity-80">View</div>
            <div className="flex gap-2 text-xs">
              {['charge','ms','gl','lf'].map(k => (
                <button key={k} onClick={()=>setView(k)} className={`px-3 py-1 rounded-lg border ${view===k? 'border-cyan-300 text-cyan-300':'border-white/10 opacity-80'}`}>{k}</button>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-white/10 bg-white/5 space-y-4">
            <div className="text-xs opacity-80">Parameters</div>
            <label className="block text-xs">Levels: {params.levels}
              <input type="range" min={3} max={6} value={params.levels} onChange={(e)=>setParams(p=>({...p, levels: parseInt(e.target.value)}))} className="w-full"/>
            </label>
            <label className="block text-xs">β (Global luminance): {params.beta.toFixed(2)}
              <input type="range" min={0} max={1.5} step={0.05} value={params.beta} onChange={(e)=>setParams(p=>({...p, beta: parseFloat(e.target.value)}))} className="w-full"/>
            </label>
            <label className="block text-xs">γ (Low‑freq salience): {params.gamma.toFixed(2)}
              <input type="range" min={0} max={1.5} step={0.05} value={params.gamma} onChange={(e)=>setParams(p=>({...p, gamma: parseFloat(e.target.value)}))} className="w-full"/>
            </label>
            <label className="block text-xs">Squash (tanh gain): {params.squash.toFixed(2)}
              <input type="range" min={0.5} max={2.0} step={0.05} value={params.squash} onChange={(e)=>setParams(p=>({...p, squash: parseFloat(e.target.value)}))} className="w-full"/>
            </label>
            <label className="block text-xs">Edge‑aware smoothing: {params.smooth.toFixed(2)}
              <input type="range" min={0} max={0.8} step={0.05} value={params.smooth} onChange={(e)=>setParams(p=>({...p, smooth: parseFloat(e.target.value)}))} className="w-full"/>
            </label>
          </div>

          <div className="text-xs opacity-70">Tip: for chiaroscuro scenes, raise β to 0.8–1.0 so bright masses lift as a whole while outlines remain crisp from multi‑scale contrast.</div>
        </div>

        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40">
              <canvas ref={baseRef} className="w-full h-auto block"/>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40 shadow-[0_0_40px_rgba(125,211,252,0.2)]">
              <canvas ref={heatRef} className="w-full h-auto block"/>
            </div>
          </div>
          <div className="text-xs opacity-70">Left: source image. Right: multi‑scale aesthetic charge heatmap.</div>
        </div>
      </div>
    </div>
  )
}
