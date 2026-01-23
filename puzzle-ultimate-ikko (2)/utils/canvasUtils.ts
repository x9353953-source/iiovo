import { ImageData, AppSettings } from '../types';

const MAX_CANVAS_DIMENSION = 8192;
const CONCURRENCY_LIMIT = 8; // Adjust based on memory/performance balance

export interface DrawOptions {
  ctx: CanvasRenderingContext2D;
  images: string[]; // URLs
  rows: number;
  cols: number;
  w: number;
  h: number;
  gap: number;
  globalOffset: number;
  startNum: number;
  maskIndices: number[];
  settings: AppSettings;
  applyMask: boolean;
  isCancelled: () => boolean;
  onProgress?: (count: number) => void;
}

export const parseMaskIndices = (input: string): number[] => {
  const indices: number[] = [];
  const parts = input.split(/[,，、\s]+/);
  parts.forEach(part => {
    part = part.trim();
    if (!part) return;
    const standardPart = part.replace(/[~—–]/g, '-');
    if (standardPart.includes('-')) {
      const rangeParts = standardPart.split('-');
      if (rangeParts.length === 2) {
        const s = parseInt(rangeParts[0]);
        const e = parseInt(rangeParts[1]);
        if (!isNaN(s) && !isNaN(e)) {
          for (let k = Math.min(s, e); k <= Math.max(s, e); k++) indices.push(k);
        }
      }
    } else {
      const num = parseInt(standardPart);
      if (!isNaN(num)) indices.push(num);
    }
  });
  return indices;
};

export const drawAsync = async ({
  ctx,
  images,
  rows,
  cols,
  w,
  h,
  gap,
  globalOffset,
  startNum,
  maskIndices,
  settings,
  applyMask,
  isCancelled,
  onProgress
}: DrawOptions) => {
  const canvas = ctx.canvas;
  canvas.width = cols * w + (cols - 1) * gap;
  canvas.height = rows * h + (rows - 1) * gap;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Pre-load sticker if needed
  let stickerImgEl: HTMLImageElement | null = null;
  if (settings.maskMode === 'image' && settings.stickerImgUrl) {
    stickerImgEl = new Image();
    stickerImgEl.src = settings.stickerImgUrl;
    try { await stickerImgEl.decode(); } catch(e) { /* ignore */ }
  }

  // Pre-load overlay if needed
  let overlayImgEl: HTMLImageElement | null = null;
  if (settings.overlayImgUrl) {
    overlayImgEl = new Image();
    overlayImgEl.src = settings.overlayImgUrl;
    try { await overlayImgEl.decode(); } catch(e) { /* ignore */ }
  }

  const tasks = images.map((imgUrl, i) => async () => {
    if (isCancelled()) return;

    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = c * (w + gap);
    const y = r * (h + gap);
    const currentNum = startNum + globalOffset + i;

    // Load Image Concurrently
    const img = new Image();
    img.src = imgUrl;
    let isBroken = false;
    
    try {
        await img.decode();
    } catch (e) {
        isBroken = true;
        // console.warn('Image decode failed', e);
    }

    // --- Synchronous Drawing Block ---
    // Because JS is single-threaded, once we await above, this block executes atomically 
    // relative to other drawing operations on the same context (mostly).
    
    try {
      if (isBroken || img.naturalWidth === 0) {
        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#ff3b30';
        ctx.font = `bold ${w / 10}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('❌Error', x + w / 2, y + h / 2);
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        const iRatio = img.width / img.height;
        const cRatio = w / h;
        if (iRatio > cRatio) {
          ctx.drawImage(img, x - (h * iRatio - w) / 2, y, h * iRatio, h);
        } else {
          ctx.drawImage(img, x, y - (w / iRatio - h) / 2, w, w / iRatio);
        }
        ctx.restore();
      }
    } catch (err) {
      console.warn(`Draw error index:${i}`, err);
    } finally {
      img.src = '';
      // img.remove(); // Not strictly necessary for unmounted elements but good practice
    }

    // Numbering
    if (settings.showNum) {
      ctx.save();
      ctx.font = `${settings.fontWeight || 'bold'} ${settings.fontSize}px ${settings.fontFamily}`;
      let tx = x + w / 2, ty = y + h - settings.fontSize / 2;
      
      const { fontPos, fontSize } = settings;
      if (fontPos === 'center') ty = y + h / 2 + fontSize / 3;
      else if (fontPos.includes('top')) ty = y + fontSize + 20;

      if (fontPos.includes('left')) { tx = x + 20; ctx.textAlign = 'left'; }
      else if (fontPos.includes('right')) { tx = x + w - 20; ctx.textAlign = 'right'; }
      else ctx.textAlign = 'center';

      if (settings.enableStroke) {
        ctx.lineWidth = fontSize / 12;
        ctx.strokeStyle = settings.fontStrokeColor;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(String(currentNum), tx, ty);
      }

      if (settings.enableShadow) {
        ctx.shadowColor = settings.fontShadowColor;
        ctx.shadowBlur = fontSize / 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = settings.fontColor;
      ctx.fillText(String(currentNum), tx, ty);
      ctx.restore();
    }

    // Masking
    if (applyMask && maskIndices.includes(currentNum)) {
      if (settings.maskMode === 'line') {
        ctx.beginPath();
        ctx.strokeStyle = settings.maskColor;
        ctx.lineWidth = settings.maskWidth * (w / 500) * 5;
        ctx.lineCap = 'round';
        if (settings.lineStyle === 'cross') {
          ctx.moveTo(x + w * 0.2, y + h * 0.2); ctx.lineTo(x + w * 0.8, y + h * 0.8);
          ctx.moveTo(x + w * 0.8, y + h * 0.2); ctx.lineTo(x + w * 0.2, y + h * 0.8);
        } else {
          ctx.moveTo(x + w * 0.2, y + h * 0.8); ctx.lineTo(x + w * 0.8, y + h * 0.2);
        }
        ctx.stroke();
      } else if (settings.maskMode === 'image' && stickerImgEl) {
        const sizePct = settings.stickerSize / 100;
        const xPct = settings.stickerX / 100;
        const yPct = settings.stickerY / 100;
        const sw = w * sizePct;
        const sh = sw * (stickerImgEl.height / stickerImgEl.width);
        ctx.drawImage(stickerImgEl, x + (w * xPct) - sw / 2, y + (h * yPct) - sh / 2, sw, sh);
      }
    }
  });

  // Execute with Concurrency Limit
  const executing = new Set<Promise<void>>();
  for (const task of tasks) {
      if (isCancelled()) break;
      const p = task().then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= CONCURRENCY_LIMIT) {
          await Promise.race(executing);
      }
      if (onProgress) onProgress(images.indexOf(task as any)); // Approximation
  }
  await Promise.all(executing);

  // Global Overlay
  if (overlayImgEl) {
    ctx.save();
    ctx.globalAlpha = settings.overlayOpacity;
    ctx.globalCompositeOperation = settings.overlayMode;
    ctx.drawImage(overlayImgEl, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
};

export const calculateCellDimensions = (cols: number, ratio: number, gap: number): { cellW: number, cellH: number } => {
    let cellW = 1500;
    if (cols * cellW > MAX_CANVAS_DIMENSION) {
        cellW = Math.floor((MAX_CANVAS_DIMENSION - (cols * gap)) / cols);
    }
    const cellH = Math.floor(cellW / ratio);
    return { cellW, cellH };
};