// Box-counting fractal dimension calculation

export function boxCountFractal(gray: Uint8Array, w: number, h: number, opts: { minBox: number; maxBox: number; steps: number }) {
  const sizes: number[] = [];
  const counts: number[] = [];
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
  
  // log–log slope (least squares)
  const xs = sizes.map(s => Math.log(1 / s));
  const ys = counts.map(c => Math.log(c + 1e-9));
  const D = slope(xs, ys);
  
  // normalize heat
  let max = 0;
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] > max) max = heat[i];
  }
  if (max > 0) {
    for (let i = 0; i < heat.length; i++) {
      heat[i] /= max;
    }
  }
  
  return { D, heat };
}

function slope(x: number[], y: number[]) {
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

function mean(a: number[]) {
  return a.reduce((p, c) => p + c, 0) / (a.length || 1);
}

