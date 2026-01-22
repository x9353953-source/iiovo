import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sortable from 'sortablejs';
import JSZip from 'jszip';
import { IOSCard } from './components/IOSCard';
import { Accordion } from './components/Accordion';
import { AppSettings, DEFAULT_SETTINGS, ImageItem } from './types';
import { drawAsync, parseMaskIndices, GenerationResult } from './services/canvasService';
import { saveImageToDB, saveImagesToDB, deleteImageFromDB, clearImagesDB, loadImagesFromDB } from './services/storageService';

// --- Icons ---
const ResetIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>;
const AddIcon = () => <svg className="w-4 h-4 stroke-[3px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"></path></svg>;
const CloseIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>;
const InfoIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>;

// --- Helper Functions ---
const generateId = () => Math.random().toString(36).substr(2, 9);
const SETTINGS_KEY = 'puzzleSettings_Ultimate_V3';
const IMAGE_ORDER_KEY = 'puzzleImageOrder_V1';

// --- Global Variables (Strict Performance Requirement) ---
// Kept outside component to prevent re-creation during React render cycles
let stickerImg: HTMLImageElement | null = null;
let globalOverlayImg: HTMLImageElement | null = null;

const App: React.FC = () => {
  // --- State ---
  const [images, setImages] = useState<ImageItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  // Overlay Name Display State
  const [overlayName, setOverlayName] = useState<string>('');
  
  // UI State
  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [generatedBlobs, setGeneratedBlobs] = useState<Blob[]>([]);
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('预览');
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  const [showResetAlert, setShowResetAlert] = useState(false);
  const [activeMaskTab, setActiveMaskTab] = useState<'line' | 'image'>('line');
  
  // Size Display State
  const [showSizeDetails, setShowSizeDetails] = useState(false);
  
  // Notes Modal State
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showNotesBtn, setShowNotesBtn] = useState(false);
  
  // Image Action Modal
  const [activeImgIndex, setActiveImgIndex] = useState<number | null>(null);

  // Refs
  const gridRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const isCancelledRef = useRef(false);
  const stickerCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Cache for Preview Background to prevent flickering
  const previewBgRef = useRef<HTMLImageElement | null>(null);
  const lastBgUrlRef = useRef<string | null>(null);

  // --- Initialization ---
  useEffect(() => {
    // 1. Load Settings
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings(prev => ({ ...prev, ...parsed }));
        if(parsed.maskMode) setActiveMaskTab(parsed.maskMode);
      } catch (e) { console.error('Failed to load settings', e); }
    }
    
    // 2. Load Images from IndexedDB (Persistence Feature)
    const restoreSession = async () => {
      try {
        setLoading(true);
        setLoadingText('恢复上次图片...');
        const savedImages = await loadImagesFromDB();
        
        if (savedImages.length > 0) {
          // Re-sort based on saved order in localStorage
          const orderJson = localStorage.getItem(IMAGE_ORDER_KEY);
          if (orderJson) {
             const orderIds = JSON.parse(orderJson) as string[];
             const imgMap = new Map(savedImages.map(img => [img.id, img]));
             const orderedImages: ImageItem[] = [];
             
             // First add images that exist in the order list
             orderIds.forEach(id => {
               if (imgMap.has(id)) {
                 orderedImages.push(imgMap.get(id)!);
                 imgMap.delete(id);
               }
             });
             // Then add any remaining images (e.g. if order save failed)
             imgMap.forEach(img => orderedImages.push(img));
             
             setImages(orderedImages);
          } else {
             setImages(savedImages);
          }
        }
      } catch (e) {
        console.error("Failed to restore images", e);
      } finally {
        setLoading(false);
      }
    };
    
    restoreSession();
    
    // Check update notice
    if (!localStorage.getItem('puzzle_update_notice_v3')) {
      setTimeout(() => setShowUpdateNotice(true), 500);
    }
    
    // Check Notes Visibility
    if (!localStorage.getItem('puzzle_hide_notes_v1')) {
        setShowNotesBtn(true);
    }
  }, []);

  // Save Settings on Change
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Save Image Order on Change
  useEffect(() => {
    if (images.length > 0) {
      const ids = images.map(i => i.id);
      localStorage.setItem(IMAGE_ORDER_KEY, JSON.stringify(ids));
    } else {
      localStorage.removeItem(IMAGE_ORDER_KEY);
    }
  }, [images]);

  // SortableJS Setup
  useEffect(() => {
    if (gridRef.current) {
      const sortable = Sortable.create(gridRef.current, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        delay: 100,
        delayOnTouchOnly: true,
        onEnd: (evt) => {
          if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
            setImages(prev => {
              const list = [...prev];
              const [moved] = list.splice(evt.oldIndex!, 1);
              list.splice(evt.newIndex!, 0, moved);
              return list;
            });
          }
        }
      });
      return () => sortable.destroy();
    }
  }, [images.length]); 

  // --- High Performance Sticker Preview Logic ---

  const drawPreviewContent = (ctx: CanvasRenderingContext2D, w: number, h: number, bgImg: HTMLImageElement | null) => {
     // 1. Draw Background (Fit Contain logic for preview)
     if (bgImg && bgImg.complete && bgImg.naturalWidth) {
         const iRatio = bgImg.width / bgImg.height;
         const cRatio = w / h;
         if (iRatio > cRatio) {
             // Image is wider relative to canvas
             const drawH = w / iRatio;
             ctx.drawImage(bgImg, 0, (h - drawH) / 2, w, drawH);
         } else {
             // Image is taller relative to canvas
             const drawW = h * iRatio;
             ctx.drawImage(bgImg, (w - drawW) / 2, 0, drawW, h);
         }
     } else {
         // Placeholder
         ctx.fillStyle = '#f0f0f0';
         ctx.fillRect(0, 0, w, h);
         ctx.fillStyle = '#ccc';
         ctx.font = '14px sans-serif';
         ctx.textAlign = 'center';
         ctx.fillText('首张图片预览', w/2, h/2);
     }

     // 2. Draw Sticker (Using Global Variable)
     if (stickerImg && stickerImg.complete && stickerImg.naturalWidth) {
         const { stickerSize, stickerX, stickerY } = settings;
         // percentage to pixels
         const sPct = stickerSize / 100;
         const xPct = stickerX / 100;
         const yPct = stickerY / 100;
         
         const sw = w * sPct;
         const sh = sw * (stickerImg.height / stickerImg.width);
         
         const dx = (w * xPct) - sw / 2;
         const dy = (h * yPct) - sh / 2;
         
         ctx.drawImage(stickerImg, dx, dy, sw, sh);
         
         // Selection Border
         ctx.strokeStyle = '#007AFF';
         ctx.lineWidth = 2;
         ctx.strokeRect(dx, dy, sw, sh);
     }
  };

  const updateStickerPreview = useCallback(() => {
     if (!stickerCanvasRef.current) return;
     const canvas = stickerCanvasRef.current;
     const ctx = canvas.getContext('2d');
     if (!ctx) return;
     
     const w = 300;
     const h = 300;
     // Only set dimensions if changed to avoid flicker, but here consistent 300
     if (canvas.width !== w) canvas.width = w;
     if (canvas.height !== h) canvas.height = h;
     
     ctx.clearRect(0, 0, w, h);
     drawPreviewContent(ctx, w, h, previewBgRef.current);
  }, [settings]);

  // Load Background Image for Preview (One-time load)
  useEffect(() => {
     if (images.length > 0) {
         const url = images[0].url;
         if (lastBgUrlRef.current !== url) {
             const img = new Image();
             img.onload = () => {
                 previewBgRef.current = img;
                 updateStickerPreview();
             };
             img.src = url;
             lastBgUrlRef.current = url;
         } else {
             // If coming back from another tab/state but image is same
             if (!previewBgRef.current) {
                 const img = new Image();
                 img.onload = () => {
                     previewBgRef.current = img;
                     updateStickerPreview();
                 };
                 img.src = url;
                 previewBgRef.current = img;
             } else {
                 updateStickerPreview();
             }
         }
     } else {
         previewBgRef.current = null;
         lastBgUrlRef.current = null;
         updateStickerPreview();
     }
  }, [images, updateStickerPreview]);
  
  // Re-draw when settings change (zero latency)
  useEffect(() => {
      updateStickerPreview();
  }, [settings, updateStickerPreview]);


  // --- Event Handlers ---

  const handleStickerFile = (files: FileList | null) => {
      if (!files || !files[0]) return;
      const file = files[0];
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
          stickerImg = img; // Set Global
          updateStickerPreview();
      };
      img.src = url;
  };

  const handleOverlayFile = (files: FileList | null) => {
      if (!files || !files[0]) return;
      const file = files[0];
      setOverlayName(file.name);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
          globalOverlayImg = img; // Set Global
      };
      img.src = url;
  };

  // Optimized File Import for handling 100+ images without blocking UI
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    // Show Loading immediately
    setLoading(true);
    setLoadingText('处理图片中...');

    // Small delay to allow React to render the loading state
    await new Promise(r => setTimeout(r, 50));

    const newImages: ImageItem[] = [];
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    for (const file of fileArray) {
        newImages.push({
          id: generateId(),
          url: URL.createObjectURL(file),
          file,
          name: file.name,
          size: file.size
        });
    }
    
    // Persist to DB asynchronously
    try {
        await saveImagesToDB(newImages);
    } catch (e) {
        console.error("DB Save failed", e);
    }

    setImages(prev => [...prev, ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    setLoading(false);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const clearImages = async () => {
    if (confirm('确定清空?')) {
      // Clear persistence
      await clearImagesDB();
      localStorage.removeItem(IMAGE_ORDER_KEY);
      
      images.forEach(img => URL.revokeObjectURL(img.url));
      setImages([]);
    }
  };

  const removeDuplicates = () => {
    const seen = new Set();
    const keep: ImageItem[] = [];
    const removeIds: string[] = [];

    images.forEach(item => {
        const key = item.name + item.size;
        if (seen.has(key)) {
            URL.revokeObjectURL(item.url);
            removeIds.push(item.id);
        } else {
            seen.add(key);
            keep.push(item);
        }
    });

    // Remove duplicates from DB
    removeIds.forEach(id => deleteImageFromDB(id));
    setImages(keep);
  };
  
  const duplicateCount = images.length - new Set(images.map(i => i.name + i.size)).size;

  const replaceImage = async (files: FileList | null) => {
    if (!files?.length || activeImgIndex === null) return;
    const file = files[0];
    const newUrl = URL.createObjectURL(file);
    
    const oldItem = images[activeImgIndex];
    const newItem: ImageItem = {
        ...oldItem,
        url: newUrl,
        file,
        name: file.name,
        size: file.size
    };

    // Update DB
    await saveImageToDB(newItem);
    URL.revokeObjectURL(oldItem.url);

    setImages(prev => {
        const next = [...prev];
        next[activeImgIndex] = newItem;
        return next;
    });
    setActiveImgIndex(null);
  };

  const deleteImage = () => {
      if (activeImgIndex === null) return;
      if (confirm('确定删除?')) {
          const itemToDelete = images[activeImgIndex];
          // Delete from DB
          deleteImageFromDB(itemToDelete.id);
          
          setImages(prev => {
              const next = [...prev];
              URL.revokeObjectURL(next[activeImgIndex].url);
              next.splice(activeImgIndex, 1);
              return next;
          });
      }
      setActiveImgIndex(null);
  };

  // --- Generation Logic ---

  const startGeneration = async (opType: 'normal' | 'apply' | 'repack') => {
    if (images.length === 0) return alert('请添加图片');
    isCancelledRef.current = false;
    setLoading(true);
    setLoadingText('准备中...');
    setShowSizeDetails(false); // Reset details toggle on new generation
    
    await new Promise(r => setTimeout(r, 50));

    setGeneratedBlobs([]);
    
    let targetIndices = images.map((_, i) => i);
    const maskTargetIndices = parseMaskIndices(settings.maskIndices);

    if (opType === 'repack') {
         targetIndices = targetIndices.filter((idx) => !maskTargetIndices.includes(settings.startNumber + idx));
    }

    // Capture settings locally to apply auto-calculation without affecting UI state
    let { cols, groupRows, quality, qualityPreset } = settings;

    // --- Automatic Group Rows Calculation ---
    // If groupRows is 0, calculate max rows to fit within safe canvas limits (~16000px)
    if (groupRows <= 0) {
        const MAX_CANVAS_DIM = 12000;
        const SAFE_H = 15500; // Slightly conservative limit (iOS safe limit is ~16384)
        
        // Estimate Cell Width (mirror logic from canvasService)
        let cW = 1500;
        if (cols * cW > MAX_CANVAS_DIM) {
            cW = Math.floor((MAX_CANVAS_DIM - (cols * settings.gap)) / cols);
        }
        const cH = cW / settings.aspectRatio;
        
        // Equation: rows * (cH + gap) <= SAFE_H + gap
        const calculated = Math.floor((SAFE_H + settings.gap) / (cH + settings.gap));
        groupRows = Math.max(1, calculated);
        console.log(`Auto-calculated groupRows: ${groupRows}`);
    }
    // ----------------------------------------

    // Safety: ensure reasonable batch size if image count is huge
    const batchSize = cols * groupRows;
    const totalBatches = Math.ceil(targetIndices.length / batchSize);
    
    const canvas = document.createElement('canvas');
    // We do NOT set width/height here, drawAsync does it dynamically
    const ctx = canvas.getContext('2d');
    if (!ctx) { setLoading(false); return; }

    const isPng = qualityPreset === '1.0';
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    const qVal = isPng ? undefined : quality / 100;

    const newBlobs: Blob[] = [];

    try {
        for (let b = 0; b < totalBatches; b++) {
            if (isCancelledRef.current) break;
            
            setLoadingText(`生成中: ${b + 1}/${totalBatches}`);
            // Yield longer for UI update
            await new Promise(r => setTimeout(r, 20)); 

            const batchIndices = targetIndices.slice(b * batchSize, Math.min((b + 1) * batchSize, targetIndices.length));
            const batchImages = batchIndices.map(i => images[i]);
            
            // NOTE: We pass the calculated `groupRows` implicitly by how we sliced the batch
            // The canvas service will just draw what we give it, but we need to ensure the settings passed 
            // don't confuse it. Actually canvasService calculates rows based on images.length. 
            // So we just pass the batchImages and it figures out the height.
            
            await drawAsync(
                ctx,
                batchImages,
                settings, // settings.groupRows is effectively ignored by drawAsync logic which relies on images.length
                b * batchSize, 
                maskTargetIndices,
                stickerImg, // Pass Global
                globalOverlayImg, // Pass Global
                () => isCancelledRef.current
            );

            if (isCancelledRef.current) break;

            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mimeType, qVal));
            if (blob) newBlobs.push(blob);
            
            // Cleanup context
            ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset scale
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.width = 1; canvas.height = 1;
        }

        if (!isCancelledRef.current) {
            setGeneratedBlobs(newBlobs);
            setTimeout(() => {
                const resEl = document.getElementById('resultArea');
                if (resEl) resEl.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        }

    } catch (e: any) {
        console.error(e);
        if (!isCancelledRef.current) alert('生成中断: ' + e.message);
    } finally {
        setLoading(false);
    }
  };

  const cancelGeneration = () => {
      isCancelledRef.current = true;
      setLoading(false);
      alert('已取消生成');
  };

  // --- Downloads ---
  const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownload = async (mode: 'parts' | 'combine' | 'zip') => {
      if (generatedBlobs.length === 0) return alert('请先生成拼图');

      if (mode === 'zip') {
          setLoading(true);
          setLoadingText('打包 ZIP...');
          try {
              const zip = new JSZip();
              const folder = zip.folder("拼图分组");
              const ext = settings.qualityPreset === '1.0' ? 'png' : 'jpg';
              generatedBlobs.forEach((b, i) => folder?.file(`拼图_Part_${i+1}.${ext}`, b));
              const content = await zip.generateAsync({type:"blob"});
              downloadBlob(content, `拼图打包_${Date.now()}.zip`);
          } catch (e) { alert('打包失败'); }
          setLoading(false);
      } else if (mode === 'combine') {
          // Optimized Combined Download for 500+ images
          setLoading(true);
          setLoadingText('合并处理中...');
          
          try {
             // 1. Pre-calculate Dimensions
             // We need to read the size of the first blob to know width.
             // For height, we need to sum up all heights.
             // We can do this efficiently by reading bitmaps one by one, but that's slow.
             // Instead, we trust they are roughly uniform in width (they should be identical).
             
             // Just read the first one for width.
             const firstBmp = await createImageBitmap(generatedBlobs[0]);
             const maxW = firstBmp.width;
             const firstH = firstBmp.height;
             firstBmp.close();
             
             // Estimate Total Height (assuming standard blobs are similar, but safer to sum)
             // If we can't load all bitmaps at once due to memory, we assume height based on blob size or re-measure?
             // Safest: Iterate and measure, closing immediately.
             
             let totalH = 0;
             setLoadingText('计算总尺寸...');
             for (const b of generatedBlobs) {
                 const bmp = await createImageBitmap(b);
                 totalH += bmp.height;
                 bmp.close();
             }
             
             // Canvas Safe Limit Check (approx 200MB or 30k pixels height depending on browser)
             const MAX_SAFE_TOTAL_HEIGHT = 28000; 
             const PIXEL_LIMIT = 80 * 1000 * 1000; // 80 Megapixels

             let finalW = maxW;
             let finalH = totalH;
             let scale = 1;

             if (totalH > MAX_SAFE_TOTAL_HEIGHT || (maxW * totalH) > PIXEL_LIMIT) {
                 const scaleH = MAX_SAFE_TOTAL_HEIGHT / totalH;
                 const scaleP = Math.sqrt(PIXEL_LIMIT / (maxW * totalH));
                 scale = Math.min(scaleH, scaleP);
                 finalW = Math.floor(maxW * scale);
                 finalH = Math.floor(totalH * scale);
                 console.log(`Scaling down combine by ${scale.toFixed(2)} to fit browser limits`);
             }
             
             const cvs = document.createElement('canvas');
             cvs.width = finalW; cvs.height = finalH;
             const ctx = cvs.getContext('2d');
             if (ctx) {
                 let y = 0;
                 // Sequential Processing to keep memory low
                 for (let i = 0; i < generatedBlobs.length; i++) {
                     setLoadingText(`合并中: ${i+1}/${generatedBlobs.length}`);
                     const bmp = await createImageBitmap(generatedBlobs[i]);
                     const drawH = Math.floor(bmp.height * scale);
                     ctx.drawImage(bmp, 0, y, finalW, drawH);
                     y += drawH;
                     bmp.close();
                     // Yield to UI
                     await new Promise(r => setTimeout(r, 0));
                 }

                 const ext = settings.qualityPreset === '1.0' ? 'png' : 'jpg';
                 const suffix = scale < 1 ? '_已压缩' : '';
                 
                 cvs.toBlob(b => {
                     if (b) downloadBlob(b, `拼图_合并版${suffix}_${Date.now()}.${ext}`);
                     else alert("合并失败：浏览器内存不足");
                     setLoading(false);
                 }, settings.qualityPreset === '1.0' ? 'image/png' : 'image/jpeg', settings.quality / 100);
             } else {
                 throw new Error("Canvas init failed");
             }
          } catch (e) {
              setLoading(false);
              alert('合并失败：图片总量过大，建议使用 ZIP 打包下载。');
          }
      } else if (mode === 'parts') {
          if (!confirm(`即将下载 ${generatedBlobs.length} 张图片。\n请允许浏览器下载多个文件。`)) return;
          for (let i = 0; i < generatedBlobs.length; i++) {
              const ext = generatedBlobs[i].type.includes('png') ? 'png' : 'jpg';
              downloadBlob(generatedBlobs[i], `拼图_Part_${i+1}.${ext}`);
              await new Promise(r => setTimeout(r, 800)); // Faster interval
          }
      }
  };

  const previewQuality = async () => {
      if (images.length === 0) return alert('请先添加图片');
      const img = images[0];
      const q = settings.quality;
      setPreviewTitle('画质预览');
      setPreviewBlob(img.url);
  };
  
  const handleStickerPreviewClick = () => {
      const size = 1000;
      const cvs = document.createElement('canvas');
      cvs.width = size; cvs.height = size;
      const ctx = cvs.getContext('2d');
      if (ctx) {
          drawPreviewContent(ctx, size, size, previewBgRef.current);
          setPreviewTitle('贴纸效果预览');
          setPreviewBlob(cvs.toDataURL());
      }
  };
  
  const handlePermanentCloseNotes = () => {
      if (confirm('确定不再显示此悬浮球吗？\n(您可以通过清除浏览器缓存来恢复)')) {
          localStorage.setItem('puzzle_hide_notes_v1', 'true');
          setShowNotesModal(false);
          setShowNotesBtn(false);
      }
  };

  // --- Render ---
  return (
    <div className="min-h-screen pb-20">
      {/* Drag Overlay */}
      {isDragOver && (
          <div className="fixed inset-0 bg-blue-500/10 backdrop-blur-sm z-[999] flex items-center justify-center border-4 border-dashed border-[#007AFF] m-3 rounded-2xl pointer-events-none">
              <div className="text-[#007AFF] font-bold text-2xl bg-white/90 px-6 py-3 rounded-xl shadow-lg">松手释放图片</div>
          </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#F2F2F7]/90 backdrop-blur-xl border-b border-gray-200/50 h-[52px] flex items-center justify-between px-5 max-w-2xl mx-auto">
        <h1 className="text-[22px] font-bold tracking-tight text-black flex items-center">
            拼图排序 <span className="text-xs font-normal text-white bg-black px-1.5 py-0.5 rounded ml-1">Ultimate</span>
        </h1>
        <div className="flex items-center gap-2">
            <button onClick={() => setShowResetAlert(true)} className="bg-gray-100 text-gray-500 text-[13px] font-bold px-3 py-1.5 rounded-full shadow-sm active:bg-gray-200 transition flex items-center gap-1">
                <ResetIcon /> 重置
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="bg-white text-[#007AFF] text-[15px] font-bold px-4 py-1.5 rounded-full shadow-sm active:bg-gray-100 transition flex items-center gap-1">
                <AddIcon /> 添加
            </button>
        </div>
        <input type="file" ref={fileInputRef} multiple accept="image/*" className="hidden" onChange={e => handleFileSelect(e.target.files)} />
        <input type="file" ref={replaceInputRef} accept="image/*" className="hidden" onChange={e => replaceImage(e.target.files)} />
        <input type="file" ref={stickerInputRef} accept="image/*" className="hidden" onChange={e => handleStickerFile(e.target.files)} />
        <input type="file" ref={overlayInputRef} accept="image/*" className="hidden" onChange={e => handleOverlayFile(e.target.files)} />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 relative" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        
        {/* Loading Toast */}
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ${loading ? 'translate-y-0 opacity-100' : '-translate-y-[200%] opacity-0 pointer-events-none'}`}>
             <div className="bg-white/95 backdrop-blur-xl text-gray-900 rounded-full shadow-2xl flex items-center py-3 pl-6 pr-4 gap-3 border border-gray-200/50 min-w-[200px]">
                <div className="flex-1 flex flex-col justify-center min-w-0">
                    <div className="flex items-center justify-center gap-2">
                        <span className="text-[15px] font-bold leading-tight truncate text-[#007AFF]">{loadingText}</span>
                    </div>
                </div>
                <button onClick={cancelGeneration} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-[#FF3B30]">
                    <CloseIcon />
                </button>
             </div>
        </div>

        {/* Image Grid */}
        <IOSCard noPadding>
            <Accordion 
                defaultOpen 
                title={
                    <span className="text-[13px] text-gray-500 uppercase font-medium pl-1">
                        已导入 <span id="countBadge">{images.length}</span> 张 
                        <span className="text-[10px] text-[#007AFF] bg-[#007AFF]/10 px-1.5 py-0.5 rounded ml-2 font-bold">支持长按拖拽排序</span>
                    </span>
                }
                rightElement={images.length > 0 && <button onClick={clearImages} className="text-[#FF3B30] text-[13px] font-bold">清空</button>}
            >
                <div className="p-4 pt-0">
                    <div ref={gridRef} className="grid grid-cols-4 gap-2 overflow-y-auto max-h-[220px] min-h-[100px] no-scrollbar touch-pan-y mt-4 content-visibility-auto">
                        {images.length === 0 ? (
                            <div className="col-span-full flex flex-col items-center justify-center py-8 space-y-3" onClick={() => fileInputRef.current?.click()}>
                                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                                    <AddIcon />
                                </div>
                                <span className="text-gray-400 text-sm">导入图片 (点击可替换/长按拖拽)</span>
                            </div>
                        ) : (
                            images.map((img, idx) => (
                                <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-100 cursor-grab active:cursor-grabbing" onMouseUp={() => setActiveImgIndex(idx)}>
                                    <img src={img.url} className="w-full h-full object-cover pointer-events-none select-none" loading="lazy" decoding="async" />
                                </div>
                            ))
                        )}
                    </div>
                    {duplicateCount > 0 && (
                        <div className="mt-3 bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-xs text-yellow-700 flex items-start gap-2">
                            <span className="font-bold">发现重复图片：</span> <span>{duplicateCount}</span> 张。
                            <button onClick={removeDuplicates} className="underline text-yellow-800 font-bold ml-1">一键去重</button>
                        </div>
                    )}
                </div>
            </Accordion>
        </IOSCard>

        {/* Settings - Layout */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">单元格与间距</div>
        <IOSCard noPadding>
            <Accordion title="单元格与间距设置" subtitle="设置画布比例、留白间隙">
                <div className="divide-y divide-gray-200">
                    <div className="p-4 bg-white flex items-center justify-between">
                         <span className="text-[17px]">画布比例</span>
                         <select 
                            value={settings.aspectRatioMode} 
                            onChange={e => {
                                const val = e.target.value;
                                let ratio = settings.aspectRatio;
                                if (val !== 'custom') ratio = parseFloat(val);
                                setSettings({...settings, aspectRatioMode: val, aspectRatio: ratio});
                            }}
                            className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none text-right appearance-none cursor-pointer dir-rtl"
                         >
                            <option value="0.5625">9:16 手机全屏</option>
                            <option value="0.75">3:4 海报</option>
                            <option value="1">1:1 正方形</option>
                            <option value="1.333">4:3 照片</option>
                            <option value="custom">自定义...</option>
                         </select>
                    </div>
                    {settings.aspectRatioMode === 'custom' && (
                        <div className="p-4 bg-gray-50 flex items-center justify-end gap-3 border-t border-gray-100">
                            <input type="number" placeholder="宽" className="bg-white border rounded px-2 py-1 text-center w-20 text-sm" value={settings.customW} onChange={e => {
                                const w = parseInt(e.target.value) || 1000;
                                setSettings({...settings, customW: w, aspectRatio: w / settings.customH});
                            }} />
                            <span className="text-gray-400">:</span>
                            <input type="number" placeholder="高" className="bg-white border rounded px-2 py-1 text-center w-20 text-sm" value={settings.customH} onChange={e => {
                                const h = parseInt(e.target.value) || 1500;
                                setSettings({...settings, customH: h, aspectRatio: settings.customW / h});
                            }} />
                        </div>
                    )}
                    <div className="p-4 bg-white">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[17px]">图片间隙</span>
                            <span className="text-[#007AFF] font-bold text-[15px]">{settings.gap}px</span>
                        </div>
                        <input type="range" min="0" max="100" value={settings.gap} onChange={e => setSettings({...settings, gap: parseInt(e.target.value)})} />
                    </div>
                </div>
            </Accordion>
        </IOSCard>

        {/* Settings - Numbering */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">序号标注</div>
        <IOSCard noPadding>
             <div className="flex items-center justify-between p-4 bg-white border-b border-gray-100">
                <span className="text-[17px]">显示序号</span>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={settings.showNum} onChange={e => setSettings({...settings, showNum: e.target.checked})} className="sr-only peer" />
                    <div className="w-[51px] h-[31px] bg-[#E9E9EA] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[27px] after:w-[27px] after:shadow-sm after:transition-all peer-checked:bg-[#34C759]"></div>
                </label>
            </div>
            <Accordion title={<span className="text-[#007AFF]">序号详细设置</span>} subtitle="设置序号大小、颜色、字体、起始位置">
                <div className="divide-y divide-gray-200">
                     <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">起始数值</span>
                        <input type="number" value={settings.startNumber} onChange={e => setSettings({...settings, startNumber: parseInt(e.target.value)})} className="text-right text-[#007AFF] text-[17px] focus:outline-none w-20 bg-transparent" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">字号大小</span>
                        <input type="number" value={settings.fontSize} onChange={e => setSettings({...settings, fontSize: parseInt(e.target.value)})} className="text-right text-[#007AFF] text-[17px] focus:outline-none w-20 bg-transparent" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">字体颜色</span>
                        <input type="color" value={settings.fontColor} onChange={e => setSettings({...settings, fontColor: e.target.value})} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                         <div className="flex items-center gap-2">
                            <span className="text-[17px]">描边颜色</span>
                            <label className="flex items-center cursor-pointer gap-1 bg-gray-100 px-2 py-1 rounded-md text-xs text-gray-500 font-bold active:bg-gray-200 transition">
                                <input type="checkbox" checked={settings.enableStroke} onChange={e => setSettings({...settings, enableStroke: e.target.checked})} className="accent-[#34C759]" />
                                <span>启用</span>
                            </label>
                        </div>
                        <input type="color" value={settings.fontStrokeColor} onChange={e => setSettings({...settings, fontStrokeColor: e.target.value})} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                         <div className="flex items-center gap-2">
                            <span className="text-[17px]">阴影颜色</span>
                            <label className="flex items-center cursor-pointer gap-1 bg-gray-100 px-2 py-1 rounded-md text-xs text-gray-500 font-bold active:bg-gray-200 transition">
                                <input type="checkbox" checked={settings.enableShadow} onChange={e => setSettings({...settings, enableShadow: e.target.checked})} className="accent-[#34C759]" />
                                <span>启用</span>
                            </label>
                        </div>
                        <input type="color" value={settings.fontShadowColor} onChange={e => setSettings({...settings, fontShadowColor: e.target.value})} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">字体类型</span>
                        <select value={settings.fontFamily} onChange={e => setSettings({...settings, fontFamily: e.target.value})} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl text-right w-40">
                            <option value="sans-serif">默认</option>
                            <option value="'Heiti SC', 'Microsoft YaHei', sans-serif">黑体</option>
                            <option value="'Songti SC', 'SimSun', serif">宋体</option>
                            <option value="'KaiTi', '楷体', serif">楷体</option>
                            <option value="cursive">手写</option>
                        </select>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white">
                        <span className="text-[17px]">位置</span>
                        <select value={settings.fontPos} onChange={e => setSettings({...settings, fontPos: e.target.value})} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl">
                            <option value="bottom-center">底部居中</option>
                            <option value="bottom-left">底部左侧</option>
                            <option value="center">正中间</option>
                            <option value="top-left">左上角</option>
                        </select>
                    </div>
                </div>
            </Accordion>
        </IOSCard>

        {/* Settings - Export & Grouping */}
        <IOSCard noPadding>
            <Accordion title="导出与布局策略" subtitle="设置排列列数、分组方式、画质">
                <div className="divide-y divide-gray-200">
                    <div className="p-4 bg-white">
                         <div className="flex items-center justify-between mb-2">
                            <span className="text-[17px] font-bold text-gray-800">排列与分组</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                 <label className="text-[11px] text-gray-500 block mb-1">列数 (横向)</label>
                                 <input type="number" onFocus={(e) => e.target.select()} value={settings.cols} onChange={e => setSettings({...settings, cols: parseInt(e.target.value) || 3})} className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm font-bold text-[#007AFF] focus:border-[#007AFF] outline-none" />
                            </div>
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                 <label className="text-[11px] text-gray-500 block mb-1">每组行数 (0=自动)</label>
                                 <input 
                                    type="number" 
                                    min="0"
                                    onFocus={(e) => e.target.select()}
                                    value={settings.groupRows} 
                                    onChange={e => {
                                        const val = parseInt(e.target.value);
                                        setSettings({...settings, groupRows: isNaN(val) ? 0 : val});
                                    }} 
                                    placeholder="0 (自动)"
                                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm font-bold text-[#007AFF] focus:border-[#007AFF] outline-none" 
                                />
                            </div>
                        </div>
                        <div className="mt-3 text-[11px] text-gray-500 bg-[#F2F2F7] p-2 rounded flex items-center gap-2">
                             <span className="font-bold">Info</span> 
                             <span>{settings.groupRows === 0 ? "根据画布高度自动计算每组行数" : `每组最多 ${settings.cols * settings.groupRows} 张图片`}</span>
                        </div>
                    </div>

                    <div className="p-4 bg-white">
                        <div className="flex items-center justify-between mb-3">
                             <div className="flex flex-col">
                                <span className="text-[17px] font-bold text-gray-800">全局纹理 / 覆盖层</span>
                            </div>
                            <button onClick={() => overlayInputRef.current?.click()} className="text-[#007AFF] text-[13px] font-bold bg-[#007AFF]/10 px-3 py-1.5 rounded-full">+ 图片</button>
                        </div>
                        {overlayName && (
                            <div className="bg-gray-50 rounded-lg p-2 mb-3 flex items-center justify-between border border-gray-100">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <span className="text-xs text-gray-500 truncate max-w-[150px]">{overlayName}</span>
                                </div>
                                <button onClick={() => { globalOverlayImg = null; setOverlayName(''); }} className="text-gray-400 hover:text-[#FF3B30] px-2">✕</button>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[11px] text-gray-500 block mb-1">混合模式</label>
                                <select value={settings.overlayMode} onChange={e => setSettings({...settings, overlayMode: e.target.value as GlobalCompositeOperation})} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-700 outline-none">
                                    <option value="source-over">标准</option>
                                    <option value="multiply">正片叠底</option>
                                    <option value="screen">滤色</option>
                                    <option value="overlay">覆盖</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] text-gray-500 block mb-1">不透明度</label>
                                <input type="range" min="0" max="1" step="0.01" value={settings.overlayOpacity} onChange={e => setSettings({...settings, overlayOpacity: parseFloat(e.target.value)})} className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer mt-3" />
                            </div>
                        </div>
                    </div>

                    <div className="p-4 bg-white">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[17px] font-bold text-gray-800">导出画质</span>
                            <div className="flex items-center gap-2">
                                <button onClick={previewQuality} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded">👁️ 预览</button>
                                <input type="number" value={settings.quality} onChange={e => setSettings({...settings, quality: parseInt(e.target.value)})} className="bg-gray-100 rounded px-1 py-1 text-center w-14 text-[15px] font-bold text-[#007AFF] outline-none" />
                                <select value={settings.qualityPreset} onChange={e => {
                                    const val = e.target.value;
                                    let q = settings.quality;
                                    if(val !== 'custom' && val !== 'none') q = Math.round(parseFloat(val) * 100);
                                    setSettings({...settings, qualityPreset: val, quality: q});
                                }} className="text-[#007AFF] text-[15px] bg-transparent focus:outline-none text-right dir-rtl cursor-pointer max-w-[140px]">
                                    <option value="1.0">原图 (PNG)</option>
                                    <option value="0.80">标准 (80%)</option>
                                    <option value="custom">自定义</option>
                                </select>
                            </div>
                        </div>
                        <div className="text-[10px] text-[#FF3B30] mt-1 font-bold">⚠️ 建议50%，否则图片可能过大</div>
                    </div>
                </div>
            </Accordion>
        </IOSCard>

        {/* Masking */}
        <IOSCard noPadding>
            <Accordion title="打码与贴纸" subtitle="遮挡特定图片或序号">
                 <div className="p-4 bg-white border-t border-gray-100">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex flex-col">
                            <span className="text-[17px] font-bold text-gray-800">目标序号</span>
                            <span className="text-[10px] text-gray-400">输入数字 (如: 5, 12, 1-3)</span>
                        </div>
                        <input type="text" value={settings.maskIndices} onChange={e => setSettings({...settings, maskIndices: e.target.value})} placeholder="如: 5, 12" className="text-right text-[#007AFF] text-[17px] focus:outline-none w-40 placeholder-gray-300 bg-gray-50 rounded px-2 py-1" />
                    </div>
                    <div className="flex p-1 bg-gray-100 rounded-lg mb-4">
                        <button onClick={() => { setActiveMaskTab('line'); setSettings({...settings, maskMode: 'line'}); }} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeMaskTab==='line' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>画线打码</button>
                        <button onClick={() => { setActiveMaskTab('image'); setSettings({...settings, maskMode: 'image'}); }} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeMaskTab==='image' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>图片/贴纸</button>
                    </div>

                    {activeMaskTab === 'line' ? (
                        <div className="animate-fade-in">
                            <div className="flex justify-between items-center pb-3 border-b border-gray-100 mb-3">
                                <span className="text-sm text-gray-500">形状样式</span>
                                <div className="flex items-center gap-4 text-sm">
                                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={settings.lineStyle==='cross'} onChange={() => setSettings({...settings, lineStyle: 'cross'})} className="accent-[#FF3B30]"/> <span>❌ 交叉</span></label>
                                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={settings.lineStyle==='slash'} onChange={() => setSettings({...settings, lineStyle: 'slash'})} className="accent-[#FF3B30]"/> <span>╱ 斜线</span></label>
                                </div>
                            </div>
                            <div className="flex justify-between items-center py-2">
                                <input type="color" value={settings.maskColor} onChange={e => setSettings({...settings, maskColor: e.target.value})} className="w-8 h-8 rounded-full border border-gray-200 shrink-0" />
                                <input type="range" min="1" max="20" value={settings.maskWidth} onChange={e => setSettings({...settings, maskWidth: parseInt(e.target.value)})} className="flex-1 ml-4" />
                            </div>
                        </div>
                    ) : (
                        <div className="animate-fade-in">
                            <button onClick={() => stickerInputRef.current?.click()} className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-sm mb-3">+ 上传遮挡图</button>
                            <div className="flex gap-4 mb-1">
                                <div 
                                    onClick={handleStickerPreviewClick}
                                    className="w-24 h-24 checkered-bg rounded-lg overflow-hidden border border-gray-200 shrink-0 relative cursor-pointer group"
                                >
                                    <canvas ref={stickerCanvasRef} className="w-full h-full object-contain" />
                                    {/* Overlay hint */}
                                    <div className="absolute inset-0 bg-black/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        <svg className="w-6 h-6 text-white drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                    </div>
                                </div>
                                <div className="flex-1 flex flex-col justify-center space-y-4">
                                     <div className="flex items-center text-xs text-gray-500"><span className="w-8 text-right mr-3">大小</span> <input type="range" value={settings.stickerSize} onChange={e => setSettings({...settings, stickerSize: parseInt(e.target.value)})} className="flex-1"/></div>
                                     <div className="flex items-center text-xs text-gray-500"><span className="w-8 text-right mr-3">左右</span> <input type="range" value={settings.stickerX} onChange={e => setSettings({...settings, stickerX: parseInt(e.target.value)})} className="flex-1"/></div>
                                     <div className="flex items-center text-xs text-gray-500"><span className="w-8 text-right mr-3">上下</span> <input type="range" value={settings.stickerY} onChange={e => setSettings({...settings, stickerY: parseInt(e.target.value)})} className="flex-1"/></div>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-3 mt-4">
                        <button onClick={() => startGeneration('apply')} className="py-3 rounded-xl bg-[#007AFF]/10 active:bg-[#007AFF]/20 text-[#007AFF] font-bold text-[15px] transition-all flex items-center justify-center gap-1">✨ 生成/更新</button>
                        <button onClick={() => startGeneration('repack')} className="py-3 rounded-xl bg-[#FF3B30]/10 active:bg-[#FF3B30]/20 text-[#FF3B30] font-bold text-[15px] transition-all flex items-center justify-center gap-1">🔄 剔除并重排</button>
                    </div>
                </div>
            </Accordion>
        </IOSCard>

        {/* Results Area */}
        {generatedBlobs.length > 0 && (
             <div id="resultArea" className="pb-10">
                <IOSCard noPadding>
                    <Accordion title={<span className="text-[#34C759]">生成结果</span>} subtitle="预览与下载拼图" defaultOpen>
                        <div className="border-t border-gray-100 p-4">
                            
                            {/* Size Display Block */}
                            <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                                <div className="flex justify-between items-center font-bold border-b border-green-200/50 pb-2 mb-2">
                                    <span className="flex items-center gap-1">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                        生成完成
                                    </span>
                                    <span>分卷总计: {(generatedBlobs.reduce((acc, b) => acc + b.size, 0) / 1024 / 1024).toFixed(2)} MB</span>
                                </div>
                                
                                {images.length <= 100 && (
                                     <div className="text-xs text-green-600 mb-2 flex justify-between">
                                        <span>若合并为一张长图约:</span>
                                        <span className="font-bold">{(generatedBlobs.reduce((acc, b) => acc + b.size, 0) / 1024 / 1024).toFixed(2)} MB</span>
                                    </div>
                                )}

                                {showSizeDetails && (
                                    <div className="pt-1 text-xs text-green-700 grid grid-cols-2 gap-y-1 animate-fade-in border-t border-green-200/30 mt-1 pt-2">
                                        {generatedBlobs.map((blob, i) => (
                                            <div key={i} className="px-2">
                                                <span className="opacity-70">分组 {i + 1}:</span> <span className="font-bold">{(blob.size / 1024 / 1024).toFixed(2)} MB</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                {generatedBlobs.length > 1 && (
                                    <button onClick={() => setShowSizeDetails(!showSizeDetails)} className="text-[10px] underline mt-1 w-full text-left text-green-600">
                                        {showSizeDetails ? '收起详情 ▲' : `展开 ${generatedBlobs.length} 个分组详情 ▼`}
                                    </button>
                                )}
                            </div>
                            
                            <div className="bg-gray-50/50 max-h-[50vh] overflow-y-auto mb-4 border border-gray-200 rounded-xl">
                                {generatedBlobs.map((blob, i) => (
                                    <img key={i} src={URL.createObjectURL(blob)} className="w-full block border-b border-gray-100 last:border-0" />
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-4">
                                <button onClick={() => handleDownload('parts')} className="col-span-2 bg-[#34C759] text-white text-[16px] font-bold py-4 rounded-xl shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2">
                                    <span>逐张下载 (防漏图版)</span>
                                </button>
                                <button onClick={() => handleDownload('combine')} className="bg-white text-black border border-gray-200 text-[14px] font-medium py-3 rounded-xl active:scale-95 transition">合并为一张长图</button>
                                <button onClick={() => handleDownload('zip')} className="bg-white text-[#007AFF] border border-gray-200 text-[14px] font-medium py-3 rounded-xl active:scale-95 transition">打包下载 (ZIP)</button>
                            </div>
                        </div>
                    </Accordion>
                </IOSCard>
             </div>
        )}

        <div className="w-full text-center py-6 pb-20">
            <span className="text-[10px] text-gray-400 font-bold tracking-widest uppercase">Created by ikko</span>
        </div>

      </main>

      {/* Main Action Button */}
      <div className="fixed bottom-8 left-0 right-0 px-4 z-40 pointer-events-none">
        <button onClick={() => startGeneration('normal')} className="pointer-events-auto w-full max-w-2xl mx-auto bg-white/80 backdrop-blur-md text-black border border-white/40 font-semibold text-[17px] py-3.5 rounded-full shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2">
            <span>✨ 开始生成拼图</span>
        </button>
      </div>
      
      {/* Floating Permission Fix */}
      <div className="fixed top-[70px] right-[20px] z-[999]">
          <button onClick={() => {
              const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['test'], {type:'text/plain'})); a.download = 'permission_check.txt';
              const b = document.createElement('a'); b.href = URL.createObjectURL(new Blob(['test2'], {type:'text/plain'})); b.download = 'permission_check2.txt';
              document.body.appendChild(a); document.body.appendChild(b);
              a.click(); setTimeout(() => { b.click(); alert('请允许浏览器下载多个文件'); }, 100);
          }} className="bg-[#007AFF] text-white px-3 py-2 rounded-full text-xs font-bold shadow-lg">⚠️ 点我开启批量下载权限</button>
      </div>

      {/* Notes Floating Button */}
      {showNotesBtn && (
          <div className="fixed right-5 bottom-28 z-40 transition-all duration-300 hover:scale-105">
              <button onClick={() => setShowNotesModal(true)} className="bg-white/90 backdrop-blur-md text-[#007AFF] shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-white/50 font-bold text-[13px] px-4 py-2.5 rounded-full flex items-center gap-1.5 active:scale-95 transition">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span>注意事项</span>
              </button>
          </div>
      )}

      {/* Modals */}

      {/* Notes Modal */}
      {showNotesModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setShowNotesModal(false)}>
              <div className="bg-white w-full max-w-[320px] rounded-2xl p-6 relative shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#007AFF]">
                          <InfoIcon />
                      </div>
                      <h3 className="text-[18px] font-bold text-gray-900">使用须知</h3>
                  </div>
                  <div className="text-[14px] text-gray-600 leading-relaxed mb-6 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                      <p>1. 建议使用 <b>edg</b> 浏览器以获得最佳体验。</p>
                      <p>2. 如果图片超过 100 张，生成过程可能会有短暂卡顿。甚至第一组拼图是全黑色，如果遇到重新拼图。</p>
                      <p>3. 多组图片导出，受浏览器影响，可能不会全部下载完图片。请尝试使用“打包下载(ZIP)”功能。</p>
                      <p>4. ❗️❗️❗️多图一定要调一下画质，不然图片太大了❗️调30%也不影响看图❗️❗️❗️</p>
                      <p>5. 老师们有时间可以找平替一些原因我可能会删链接，，，:0❗️</p>
                      <p>6. ❗️超过一百张图不会合并生成一张拼图， 请自行填写行列，分多张图导出❗️</p>
                      <p>7.可在edg浏览器选择 <b>添加到手机</b>安装到主屏幕，不用再点链接打开</p>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                      <button onClick={handlePermanentCloseNotes} className="text-xs text-gray-400 font-medium py-2 px-2 active:text-gray-600 transition">不再显示</button>
                      <button onClick={() => setShowNotesModal(false)} className="flex-1 bg-[#007AFF] text-white text-[15px] font-bold py-3 rounded-xl shadow-lg shadow-blue-500/30 active:scale-95 transition">我知道了</button>
                  </div>
              </div>
          </div>
      )}

      {/* Reset Alert */}
      {showResetAlert && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setShowResetAlert(false)}>
              <div className="bg-[#F2F2F2]/85 backdrop-blur-xl rounded-[14px] w-[270px] text-center shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="pt-5 px-4 pb-4">
                      <h3 className="text-[17px] font-bold text-black mb-1">⚠️ 警告</h3>
                      <p className="text-[13px] text-black leading-snug">确定要重置吗？<br/>这将清空所有内容。</p>
                  </div>
                  <div className="flex border-t border-[#3C3C43]/30 h-[44px]">
                      <button onClick={() => setShowResetAlert(false)} className="flex-1 text-[17px] text-[#007AFF] font-normal border-r border-[#3C3C43]/30 active:bg-gray-200">取消</button>
                      <button onClick={() => { 
                          // Hard reset
                          localStorage.removeItem(SETTINGS_KEY);
                          localStorage.removeItem(IMAGE_ORDER_KEY);
                          clearImagesDB().then(() => window.location.reload());
                      }} className="flex-1 text-[17px] text-[#FF3B30] font-bold active:bg-gray-200">重置</button>
                  </div>
              </div>
          </div>
      )}

      {/* Image Actions ActionSheet */}
      {activeImgIndex !== null && (
          <div className="fixed inset-0 z-[150]" onClick={() => setActiveImgIndex(null)}>
               <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"></div>
               <div className="absolute bottom-0 left-0 right-0 bg-[#F2F2F7] rounded-t-2xl p-4 animate-fade-in" onClick={e => e.stopPropagation()}>
                    <div className="text-center text-gray-400 text-sm mb-4 font-medium">图片操作</div>
                    <div className="space-y-3">
                        <button onClick={() => replaceInputRef.current?.click()} className="w-full bg-white text-[#007AFF] font-bold text-[17px] py-3.5 rounded-xl shadow-sm active:bg-gray-50">替换图片</button>
                        <button onClick={deleteImage} className="w-full bg-white text-[#FF3B30] font-bold text-[17px] py-3.5 rounded-xl shadow-sm active:bg-gray-50">删除图片</button>
                    </div>
                    <button onClick={() => setActiveImgIndex(null)} className="w-full bg-white text-black font-semibold text-[17px] py-3.5 rounded-xl shadow-sm mt-4 active:bg-gray-50">取消</button>
               </div>
          </div>
      )}
      
      {/* Preview Modal */}
      {previewBlob && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-md z-[200] flex items-center justify-center p-4" onClick={() => setPreviewBlob(null)}>
              <div className="bg-white p-2 rounded-xl max-w-full max-h-[80vh] relative shadow-2xl flex flex-col">
                  <div className="text-center py-2 text-sm font-bold text-gray-500">{previewTitle}</div>
                  <img src={previewBlob} className="object-contain max-h-[70vh] w-auto" />
                  <button className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center">×</button>
              </div>
          </div>
      )}

      {/* Update Notice Modal */}
      {showUpdateNotice && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-md z-[300] flex items-center justify-center">
              <div className="bg-white w-[85%] max-w-[320px] rounded-2xl p-6 shadow-2xl animate-fade-in">
                  <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-[#34C759]">✨</div>
                      <h3 className="text-[18px] font-bold text-gray-900">性能优化公告</h3>
                  </div>
                  <div className="text-[14px] text-gray-600 space-y-2 mb-6">
                      <p>✨ <b>极速导入</b>：支持100+张图片秒导入。</p>
                      <p>✨ <b>自动保存</b>：刷新页面不丢失进度。</p>
                      <p>✨ <b>内存管理</b>：更流畅的拖拽体验。</p>
                  </div>
                  <button onClick={() => { localStorage.setItem('puzzle_update_notice_v3', 'true'); setShowUpdateNotice(false); }} className="w-full bg-[#34C759] text-white py-3 rounded-xl font-bold">开始体验</button>
              </div>
          </div>
      )}

    </div>
  );
};

export default App;