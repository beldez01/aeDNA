// Persistence homology for topological analysis

export function persistenceSweep(gray: Uint8Array, w: number, h: number, opts: { thresholds: number }) {
  const T = Math.max(8, opts.thresholds | 0);
  const bars: { id: number; birth: number; death: number }[] = [];
  const regionMasks: Record<number, Uint8Array> = {};
  const ids = new Int32Array(w * h);
  let nextId = 1;
  const lifespans = new Map<number, { birth: number; death: number }>();
  const hot = new Uint8Array(w * h);
  
  for (let t = 0; t < T; t++) {
    const thr = Math.round((t / (T - 1)) * 255);
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      bin[i] = gray[i] < thr ? 1 : 0;
    }
    
    ids.fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!bin[idx] || ids[idx]) continue;
        const id = nextId++;
        const q = [idx];
        ids[idx] = id;
        
        while (q.length) {
          const p = q.pop()!;
          const px = p % w, py = (p / w) | 0;
          const nbr = [p - 1, p + 1, p - w, p + w];
          for (const n of nbr) {
            if (n < 0 || n >= w * h) continue;
            const nx = n % w, ny = (n / w) | 0;
            if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
            if (bin[n] && !ids[n]) {
              ids[n] = id;
              q.push(n);
            }
          }
        }
        if (!lifespans.has(id)) {
          lifespans.set(id, { birth: thr, death: thr });
        }
      }
    }
    
    for (let i = 0; i < w * h; i++) {
      if (ids[i]) {
        const rec = lifespans.get(ids[i])!;
        rec.death = thr;
      }
    }
  }
  
  lifespans.forEach((v, k) => {
    bars.push({ id: k, birth: v.birth, death: v.death });
  });
  bars.sort((a, b) => (b.death - b.birth) - (a.death - a.birth));
  
  const top = bars.slice(0, Math.min(10, bars.length));
  for (const b of top) {
    const thr = Math.round((b.birth + b.death) / 2);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (gray[i] < thr) mask[i] = 1;
    }
    regionMasks[b.id] = mask;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) hot[i] = 1;
    }
  }
  
  const spanMax = 255;
  const spanNorm = top.length ? Math.min(1, (top[0].death - top[0].birth) / spanMax) : 0;
  return { bars, regionMasks, hot, spanNorm };
}

