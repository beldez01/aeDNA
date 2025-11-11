// Lacunarity analysis for spatial distribution

export function lacunarityMap(gray: Uint8Array, w: number, h: number, opts: { windowSizes: number[] }) {
  const heat = new Float32Array(w * h);
  const means: number[] = [];
  
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
        const mean = m / (cnt || 1);
        let varsum = 0;
        for (let j = y; j < Math.min(h, y + win); j++) {
          for (let i = x; i < Math.min(w, x + win); i++) {
            const v = (255 - gray[j * w + i]) - mean;
            varsum += v * v;
          }
        }
        const lambda = varsum / (cnt || 1) / ((mean || 1) ** 2 + 1e-9);
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
  
  // Average across scales
  for (let i = 0; i < heat.length; i++) {
    heat[i] = heat[i] / (opts.windowSizes.length || 1);
  }
  
  // Normalize
  let max = 0;
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] > max) max = heat[i];
  }
  if (max > 0) {
    for (let i = 0; i < heat.length; i++) {
      heat[i] /= max;
    }
  }
  
  const meanL = means.reduce((a, b) => a + b, 0) / (means.length || 1);
  return { heat, mean: meanL };
}

