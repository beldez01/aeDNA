// Client-side utility functions for image processing

export function fitContain(w: number, h: number, maxW: number, maxH: number) {
  const r = Math.min(maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

export function drawImageToCanvas(img: HTMLImageElement, canvas: HTMLCanvasElement, maxW = 1024, maxH = 1024) {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = fitContain(img.naturalWidth, img.naturalHeight, maxW, maxH);
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);
}

export function toGrayscaleU8(px: Uint8ClampedArray) {
  const out = new Uint8Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    out[j] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0;
  }
  return out;
}

export function tileOrientationCoherence(gray: Uint8Array, w: number, h: number, tile = 32, bins = 9) {
  // Coherence per tile using simple Sobel orientation histogram
  const heat = new Float32Array(w * h);
  const Gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const Gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const idx = (x: number, y: number) => y * w + x;
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);
  
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sx = 0, sy = 0, k = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++, k++) {
          const v = gray[idx(x + i, y + j)];
          sx += v * Gx[k];
          sy += v * Gy[k];
        }
      }
      const m = Math.hypot(sx, sy);
      mag[idx(x, y)] = m;
      ang[idx(x, y)] = Math.atan2(sy, sx);
    }
  }
  
  for (let ty = 0; ty < h; ty += tile) {
    for (let tx = 0; tx < w; tx += tile) {
      const hist = new Float32Array(bins);
      let sum = 0;
      for (let y = ty; y < Math.min(h, ty + tile); y++) {
        for (let x = tx; x < Math.min(w, tx + tile); x++) {
          const m = mag[idx(x, y)];
          if (m > 0) {
            const a = (ang[idx(x, y)] + Math.PI) / (2 * Math.PI);
            const bIdx = Math.min(bins - 1, Math.floor(a * bins));
            hist[bIdx] += m;
            sum += m;
          }
        }
      }
      if (sum === 0) continue;
      const mean = hist.reduce((a, b) => a + b, 0) / bins;
      let varsum = 0;
      for (let i = 0; i < bins; i++) {
        const d = hist[i] - mean;
        varsum += d * d;
      }
      const coh = Math.sqrt(varsum) / (sum || 1);
      const val = 1 - Math.min(1, coh * 2);
      for (let y = ty; y < Math.min(h, ty + tile); y++) {
        for (let x = tx; x < Math.min(w, tx + tile); x++) {
          heat[idx(x, y)] = val;
        }
      }
    }
  }
  return heat;
}

