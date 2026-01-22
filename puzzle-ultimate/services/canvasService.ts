import { ImageItem, AppSettings } from '../types';

// Constants
const MAX_CANVAS_DIMENSION = 12000; // Increased base limit for desktops
const MAX_SAFE_HEIGHT = 16000; // Safe limit for iOS Canvas (prevents white screen/crashing)

export interface GenerationResult {
  blob: Blob;
  width: number;
  height: number;
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

// Helper for delays to unblock UI thread
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const drawAsync = async (
  ctx: CanvasRenderingContext2D,
  images: ImageItem[],
  settings: AppSettings,
  globalOffset: number,
  maskIndices: number[],
  stickerImg: HTMLImageElement | null,
  overlayImg: HTMLImageElement | null,
  isCancelled: () => boolean,
  onProgress?: (current: number, total: number) => void
): Promise<void> => {
  const {
    cols, gap, aspectRatio,
    showNum, startNumber, fontSize, fontFamily, fontColor, fontStrokeColor, enableStroke, fontShadowColor, enableShadow, fontPos,
    maskColor, maskWidth, lineStyle, maskMode, stickerSize, stickerX, stickerY,
    overlayMode, overlayOpacity
  } = settings;

  // 1. Calculate ideal dimensions
  let cellW = 1500;
  if (cols * cellW > MAX_CANVAS_DIMENSION) {
    cellW = Math.floor((MAX_CANVAS_DIMENSION - (cols * gap)) / cols);
  }
  const cellH = Math.floor(cellW / aspectRatio);
  const rows = Math.ceil(images.length / cols);
  
  // 2. Check total height against safe limits
  const totalH = rows * cellH + (rows - 1) * gap;
  const totalW = cols * cellW + (cols - 1) * gap;
  
  let scaleFactor = 1;
  // If height exceeds safe limit, we must scale down the entire drawing context
  if (totalH > MAX_SAFE_HEIGHT) {
      scaleFactor = MAX_SAFE_HEIGHT / totalH;
      console.warn(`Canvas height ${totalH} exceeds limit. Scaling by ${scaleFactor.toFixed(4)}`);
  }

  const canvas = ctx.canvas;
  // Ensure we set dimensions only if changed to avoid flicker (though usually this function runs once per canvas)
  // For batch processing, we might reuse canvas, so checking is good.
  const targetW = Math.floor(totalW * scaleFactor);
  const targetH = Math.floor(totalH * scaleFactor);
  
  if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
  } else {
      ctx.clearRect(0, 0, targetW, targetH);
  }
  
  // Apply scaling to the context so we can use original coordinates
  ctx.scale(scaleFactor, scaleFactor);

  // Fill background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalW, totalH); // Fill logical size (scaled by ctx.scale)

  // Chunk configuration for parallel processing
  const CONCURRENCY = 4;

  for (let i = 0; i < images.length; i += CONCURRENCY) {
    if (isCancelled()) return;
    
    // Update progress callback
    if (onProgress) onProgress(i, images.length);

    // Create batch indices
    const chunkIndices: number[] = [];
    const limit = Math.min(i + CONCURRENCY, images.length);
    for (let k = i; k < limit; k++) chunkIndices.push(k);

    // 1. Parallel Decode (Off-Main-Thread)
    const bitmaps = await Promise.all(chunkIndices.map(async (idx) => {
        const item = images[idx];
        try {
            // High performance decoding
            return await createImageBitmap(item.file);
        } catch (e) {
            console.warn(`Fast decode failed for ${item.name}, falling back to Image tag`, e);
            // Fallback for incompatible formats or Safari edge cases
            return new Promise<HTMLImageElement | null>(resolve => {
                const img = new Image();
                // We use sync decoding here to ensure it's ready when promise resolves
                img.decoding = 'sync'; 
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = item.url;
            });
        }
    }));

    if (isCancelled()) {
        bitmaps.forEach(b => { if (b instanceof ImageBitmap) b.close(); });
        return;
    }

    // 2. Sequential Draw (Sync Canvas Operations)
    // We must draw in order to maintain stack state safety if we used complex clips, 
    // though here cells are independent. Sequential is safer and predictable.
    for (let j = 0; j < chunkIndices.length; j++) {
        const idx = chunkIndices[j];
        const bitmap = bitmaps[j];
        
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = c * (cellW + gap);
        const y = r * (cellH + gap);
        const currentNum = startNumber + globalOffset + idx;

        if (bitmap) {
            const imgW = (bitmap instanceof ImageBitmap) ? bitmap.width : (bitmap as HTMLImageElement).naturalWidth;
            const imgH = (bitmap instanceof ImageBitmap) ? bitmap.height : (bitmap as HTMLImageElement).naturalHeight;

            if (imgW && imgH) {
                // Draw Image (Object Cover)
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, cellW, cellH);
                ctx.clip();
                const iRatio = imgW / imgH;
                const cRatio = cellW / cellH;
                
                let drawX = x, drawY = y, drawW = cellW, drawH = cellH;

                if (iRatio > cRatio) {
                    // Image is wider than cell
                    drawW = cellH * iRatio;
                    drawX = x - (drawW - cellW) / 2;
                } else {
                    // Image is taller than cell
                    drawH = cellW / iRatio;
                    drawY = y - (drawH - cellH) / 2;
                }
                
                ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
                ctx.restore();
            }
            
            // Release memory immediately
            if (bitmap instanceof ImageBitmap) bitmap.close();
        } else {
            // Draw error placeholder
            ctx.fillStyle = '#f9f9f9';
            ctx.fillRect(x, y, cellW, cellH);
            ctx.fillStyle = '#ff3b30';
            ctx.font = `bold ${cellW/10}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('❌Error', x + cellW/2, y + cellH/2);
        }

        // Numbering
        if (showNum) {
            ctx.save();
            ctx.font = `bold ${fontSize}px ${fontFamily}`;
            let tx = x + cellW / 2;
            let ty = y + cellH - fontSize / 2;
            
            if (fontPos === 'center') ty = y + cellH / 2 + fontSize / 3;
            else if (fontPos.includes('top')) ty = y + fontSize + 20;

            if (fontPos.includes('left')) { tx = x + 20; ctx.textAlign = 'left'; }
            else if (fontPos.includes('right')) { tx = x + cellW - 20; ctx.textAlign = 'right'; }
            else { ctx.textAlign = 'center'; }

            if (enableStroke) {
                ctx.lineWidth = fontSize / 12;
                ctx.strokeStyle = fontStrokeColor;
                ctx.lineJoin = 'round';
                ctx.miterLimit = 2;
                ctx.strokeText(currentNum.toString(), tx, ty);
            }

            if (enableShadow) {
                ctx.shadowColor = fontShadowColor;
                ctx.shadowBlur = fontSize / 10;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            } else {
                ctx.shadowColor = 'transparent';
            }
            ctx.fillStyle = fontColor;
            ctx.fillText(currentNum.toString(), tx, ty);
            ctx.restore();
        }

        // Masking / Stickers
        if (maskIndices.includes(currentNum)) {
            if (maskMode === 'line') {
                ctx.beginPath();
                ctx.strokeStyle = maskColor;
                ctx.lineWidth = maskWidth * (cellW / 500) * 5;
                ctx.lineCap = 'round';
                if (lineStyle === 'cross') {
                    ctx.moveTo(x + cellW * 0.2, y + cellH * 0.2);
                    ctx.lineTo(x + cellW * 0.8, y + cellH * 0.8);
                    ctx.moveTo(x + cellW * 0.8, y + cellH * 0.2);
                    ctx.lineTo(x + cellW * 0.2, y + cellH * 0.8);
                } else {
                    // Slash
                    ctx.moveTo(x + cellW * 0.2, y + cellH * 0.8);
                    ctx.lineTo(x + cellW * 0.8, y + cellH * 0.2);
                }
                ctx.stroke();
            } else if (maskMode === 'image' && stickerImg) {
                const sPct = stickerSize / 100;
                const xPct = stickerX / 100;
                const yPct = stickerY / 100;
                const sw = cellW * sPct;
                const sh = sw * (stickerImg.height / stickerImg.width);
                const dx = x + (cellW * xPct) - sw / 2;
                const dy = y + (cellH * yPct) - sh / 2;
                ctx.drawImage(stickerImg, dx, dy, sw, sh);
            }
        }
    }

    // Yield to main thread to prevent UI freezing
    await delay(0);
  }

  // Overlay
  if (overlayImg) {
      ctx.save();
      ctx.globalAlpha = overlayOpacity;
      ctx.globalCompositeOperation = overlayMode;
      // Draw over the entire logical area
      ctx.drawImage(overlayImg, 0, 0, totalW, totalH);
      ctx.restore();
  }
};