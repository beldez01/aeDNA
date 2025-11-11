// Skeleton extraction using Zhang-Suen thinning

export function skeletonize(gray: Uint8Array, w: number, h: number, opts: { thinningIters: number }) {
  const bin = new Uint8Array(w * h);
  const thr = 180;
  for (let i = 0; i < w * h; i++) {
    bin[i] = gray[i] < thr ? 1 : 0;
  }
  
  const skel = zhangSuen(bin, w, h, opts.thinningIters || 30);
  
  // Branching metric: count junctions (>2 neighbors)
  let junctions = 0, pixels = 0;
  const idx = (x: number, y: number) => y * w + x;
  
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (skel[idx(x, y)]) {
        pixels++;
        const n = +skel[idx(x - 1, y)] + +skel[idx(x + 1, y)] + +skel[idx(x, y - 1)] + +skel[idx(x, y + 1)] +
                  +skel[idx(x - 1, y - 1)] + +skel[idx(x + 1, y - 1)] + +skel[idx(x - 1, y + 1)] + +skel[idx(x + 1, y + 1)];
        if (n >= 3) junctions++;
      }
    }
  }
  
  const branchingNorm = Math.min(1, junctions / Math.max(1, pixels / 50));
  return { points: skel, branchingNorm };
}

function zhangSuen(img: Uint8Array, w: number, h: number, maxIter: number) {
  const P = img.slice();
  
  const N = (x: number, y: number) => {
    let c = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        if (i || j) c += +P[(y + j) * w + (x + i)];
      }
    }
    return c;
  };
  
  const S = (x: number, y: number) => {
    const p = [
      P[(y - 1) * w + x], P[(y - 1) * w + (x + 1)], P[y * w + (x + 1)], P[(y + 1) * w + (x + 1)],
      P[(y + 1) * w + x], P[(y + 1) * w + (x - 1)], P[y * w + (x - 1)], P[(y - 1) * w + (x - 1)]
    ];
    let t = 0;
    for (let i = 0; i < 8; i++) {
      if (p[i] === 0 && p[(i + 1) % 8] === 1) t++;
    }
    return t;
  };
  
  let changed = true, iter = 0;
  while (changed && iter < maxIter) {
    changed = false;
    iter++;
    const toRemove: number[] = [];
    
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = P[y * w + x];
        if (!p) continue;
        const n = N(x, y);
        if (n < 2 || n > 6) continue;
        if (S(x, y) !== 1) continue;
        if (P[(y - 1) * w + x] * P[y * w + (x + 1)] * P[(y + 1) * w + x] === 0 &&
            P[y * w + (x + 1)] * P[(y + 1) * w + x] * P[y * w + (x - 1)] === 0) {
          toRemove.push(y * w + x);
        }
      }
    }
    
    if (toRemove.length) {
      changed = true;
      for (const i of toRemove) P[i] = 0;
    }
  }
  
  return P;
}

