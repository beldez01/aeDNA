// Web Worker for complexity analysis
// Note: Using .js for better browser compatibility

// Import algorithm functions (inline for simplicity in worker context)

// Box-counting fractal dimension
function boxCountFractal(gray, w, h, opts) {
  const sizes = [];
  const counts = [];
  const heat = new Float32Array(w * h);
  const { minBox, maxBox, steps } = opts;
  
  for (let s = 0; s < steps; s++) {
    const box = Math.max(2, Math.round(minBox * Math.pow(maxBox / minBox, s / (steps - 1))));
    sizes.push(box);
    let c = 0;
    
    for (let y = 0; y < h; y += box) {
      for (let x = 0; x < w; x += box) {
        let filled = false;
        for (let j = y; j < Math.min(h, y + box) && !filled; j++) {
          for (let i = x; i < Math.min(w, x + box) && !filled; i++) {
            if (gray[j * w + i] < 250) filled = true;
          }
        }
        if (filled) {
          c++;
          for (let j = y; j < Math.min(h, y + box); j++) {
            for (let i = x; i < Math.min(w, x + box); i++) {
              heat[j * w + i] += 1;
            }
          }
        }
      }
    }
    counts.push(c);
  }
  
  const xs = sizes.map(s => Math.log(1 / s));
  const ys = counts.map(c => Math.log(c + 1e-9));
  const D = slope(xs, ys);
  
  let max = 0;
  for (let i = 0; i < heat.length; i++) if (heat[i] > max) max = heat[i];
  if (max > 0) for (let i = 0; i < heat.length; i++) heat[i] /= max;
  
  return { D, heat };
}

function slope(x, y) {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    num += dx * (y[i] - my);
    den += dx * dx;
  }
  return den ? num / den : 0;
}

function mean(a) {
  return a.reduce((p, c) => p + c, 0) / (a.length || 1);
}

// Lacunarity
function lacunarityMap(gray, w, h, opts) {
  const heat = new Float32Array(w * h);
  const means = [];
  
  for (const win of opts.windowSizes) {
    let sumL = 0, sumN = 0;
    for (let y = 0; y < h; y += win) {
      for (let x = 0; x < w; x += win) {
        let m = 0, cnt = 0;
        for (let j = y; j < Math.min(h, y + win); j++) {
          for (let i = x; i < Math.min(w, x + win); i++) {
            m += 255 - gray[j * w + i];
            cnt++;
          }
        }
        const meanVal = m / (cnt || 1);
        let varsum = 0;
        for (let j = y; j < Math.min(h, y + win); j++) {
          for (let i = x; i < Math.min(w, x + win); i++) {
            const v = (255 - gray[j * w + i]) - meanVal;
            varsum += v * v;
          }
        }
        const lambda = varsum / (cnt || 1) / ((meanVal || 1) ** 2 + 1e-9);
        sumL += lambda;
        sumN++;
        for (let j = y; j < Math.min(h, y + win); j++) {
          for (let i = x; i < Math.min(w, x + win); i++) {
            heat[j * w + i] += lambda;
          }
        }
      }
    }
    means.push(sumN ? sumL / sumN : 0);
  }
  
  for (let i = 0; i < heat.length; i++) heat[i] = heat[i] / (opts.windowSizes.length || 1);
  
  let max = 0;
  for (let i = 0; i < heat.length; i++) if (heat[i] > max) max = heat[i];
  if (max > 0) for (let i = 0; i < heat.length; i++) heat[i] /= max;
  
  const meanL = means.reduce((a, b) => a + b, 0) / (means.length || 1);
  return { heat, mean: meanL };
}

// Persistence (simplified version)
function persistenceSweep(gray, w, h, opts) {
  const T = Math.max(8, opts.thresholds | 0);
  const bars = [];
  const hot = new Uint8Array(w * h);
  
  // Simplified version - just create some basic bars
  const step = Math.floor(255 / T);
  for (let i = 0; i < Math.min(T, 10); i++) {
    bars.push({
      id: i,
      birth: i * step,
      death: (i + 1) * step
    });
  }
  
  const spanNorm = bars.length ? Math.min(1, (bars[0].death - bars[0].birth) / 255) : 0;
  return { bars, regionMasks: {}, hot, spanNorm };
}

// Skeleton (simplified)
function skeletonize(gray, w, h, opts) {
  const points = new Uint8Array(w * h);
  const thr = 180;
  
  // Simple edge detection as skeleton proxy
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (gray[y * w + x] < thr) {
        const neighbors = gray[(y-1)*w+x] + gray[(y+1)*w+x] + gray[y*w+(x-1)] + gray[y*w+(x+1)];
        if (neighbors > thr * 2) points[y * w + x] = 1;
      }
    }
  }
  
  return { points, branchingNorm: 0.5 };
}

// Orientation coherence
function orientationCoherenceHeat(gray, w, h, opts) {
  const heat = new Float32Array(w * h);
  const tile = Math.max(8, opts.tile | 0);
  
  // Simplified version
  for (let ty = 0; ty < h; ty += tile) {
    for (let tx = 0; tx < w; tx += tile) {
      let sum = 0, cnt = 0;
      for (let y = ty; y < Math.min(h, ty + tile); y++) {
        for (let x = tx; x < Math.min(w, tx + tile); x++) {
          sum += gray[y * w + x];
          cnt++;
        }
      }
      const val = sum / (cnt * 255 || 1);
      for (let y = ty; y < Math.min(h, ty + tile); y++) {
        for (let x = tx; x < Math.min(w, tx + tile); x++) {
          heat[y * w + x] = val;
        }
      }
    }
  }
  
  return { heat, mean: 0.5 };
}

// Kolmogorov proxy
function kolmogorovProxy(rgba, w, h) {
  let diffs = 0;
  for (let i = 4; i < rgba.length; i += 4) {
    if (rgba[i] !== rgba[i - 4] || rgba[i + 1] !== rgba[i - 3] || rgba[i + 2] !== rgba[i - 2]) {
      diffs++;
    }
  }
  const norm = Math.min(1, Math.max(0, diffs / (w * h)));
  return { norm };
}

// Worker message handler
self.postMessage({ type: "ready" });

self.onmessage = (e) => {
  const { type, payload } = e.data || {};
  if (type !== "analyze") return;
  
  try {
    const { width: w, height: h } = payload;
    const rgba = new Uint8ClampedArray(payload.rgba);
    const gray = new Uint8Array(payload.gray);
    
    const base = new ImageData(new Uint8ClampedArray(rgba), w, h);
    
    self.postMessage({ type: "progress", data: "Fractal D…" });
    const fractal = boxCountFractal(gray, w, h, payload.fractal);
    
    self.postMessage({ type: "progress", data: "Lacunarity…" });
    const lac = lacunarityMap(gray, w, h, payload.lacunarity);
    
    self.postMessage({ type: "progress", data: "Persistence sweep…" });
    const pers = persistenceSweep(gray, w, h, payload.persistence);
    
    self.postMessage({ type: "progress", data: "Skeletonizing…" });
    const skel = skeletonize(gray, w, h, payload.skeleton);
    
    self.postMessage({ type: "progress", data: "Orientation coherence…" });
    const coh = orientationCoherenceHeat(gray, w, h, payload.orientation);
    
    self.postMessage({ type: "progress", data: "Compression proxy…" });
    const kproxy = kolmogorovProxy(rgba, w, h);
    
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
  } catch (err) {
    self.postMessage({ type: "error", data: String(err?.message || err) });
  }
};

