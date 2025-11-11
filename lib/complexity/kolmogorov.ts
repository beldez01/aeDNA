// Kolmogorov complexity proxy via run-length analysis

export function kolmogorovProxy(rgba: Uint8ClampedArray, w: number, h: number) {
  let diffs = 0;
  let total = w * h;
  
  for (let i = 4; i < rgba.length; i += 4) {
    if (rgba[i] !== rgba[i - 4] || rgba[i + 1] !== rgba[i - 3] || rgba[i + 2] !== rgba[i - 2]) {
      diffs++;
    }
  }
  
  const ratio = diffs / Math.max(1, total);
  const norm = Math.min(1, Math.max(0, ratio));
  
  return { norm };
}

