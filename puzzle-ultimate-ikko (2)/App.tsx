import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import JSZip from 'jszip';
import Sortable from 'sortablejs';
import { AppSettings, DEFAULT_SETTINGS, ImageData } from './types';
import { drawAsync, parseMaskIndices, calculateCellDimensions } from './utils/canvasUtils';
import { IOSCard, IOSButton, IOSToggle, Accordion, SettingRow } from './components/UIComponents';
import { saveImageToDB, saveBatchImagesToDB, getImageFromDB, deleteImageFromDB, clearImagesDB } from './utils/storage';

const SETTINGS_KEY = 'puzzleSettings_Ultimate_V3_React';
const IMAGES_META_KEY = 'puzzleImages_Metadata_V3';

// --- Optimized Sub-components ---

// Memoized Thumbnail to prevent re-rendering entire grid when one item changes
const ThumbnailItem = memo(({ img, index, onMouseUp }: { img: ImageData; index: number; onMouseUp: (idx: number) => void }) => {
    return (
        <div 
            className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-100 thumbnail-item active:opacity-80 transition cursor-grab active:cursor-grabbing will-change-transform"
            onMouseUp={() => onMouseUp(index)}
        >
            <img 
                src={img.url} 
                className="w-full h-full object-cover pointer-events-none select-none" 
                loading="lazy" 
                decoding="async"
                alt="" 
            />
        </div>
    );
}, (prev, next) => prev.img.id === next.img.id && prev.index === next.index);

export default function App() {
  // State
  const [images, setImages] = useState<ImageData[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [generatedBlobs, setGeneratedBlobs] = useState<Blob[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [showModal, setShowModal] = useState<'none' | 'preview' | 'note' | 'reset' | 'update'>('none');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Refs
  const gridRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const sortableInstance = useRef<Sortable | null>(null);
  const isCancelledRef = useRef(false);
  const targetImageIndex = useRef<number>(-1);
  const stickerCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Refs for drawing images to prevent flickering
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const stickerImgRef = useRef<HTMLImageElement | null>(null);

  // --- Initialization & Effects ---

  useEffect(() => {
    const loadData = async () => {
        // 1. Load settings
        const savedSettings = localStorage.getItem(SETTINGS_KEY);
        if (savedSettings) {
          try {
            setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
          } catch (e) {
            console.error("Failed to load settings", e);
          }
        }

        // 2. Load Images from IndexedDB (Lazy load if massive?)
        const savedMeta = localStorage.getItem(IMAGES_META_KEY);
        if (savedMeta) {
            try {
                const metaList: {id: string, name: string, size: number}[] = JSON.parse(savedMeta);
                const loadedImages: ImageData[] = [];
                
                // Process in chunks to avoid blocking UI on load
                const chunkSize = 50;
                for (let i = 0; i < metaList.length; i += chunkSize) {
                    const chunk = metaList.slice(i, i + chunkSize);
                    await Promise.all(chunk.map(async (meta) => {
                        try {
                            const blob = await getImageFromDB(meta.id);
                            if (blob) {
                                loadedImages.push({ ...meta, url: URL.createObjectURL(blob) });
                            }
                        } catch (err) { /* ignore missing */ }
                    }));
                    
                    await new Promise(r => setTimeout(r, 0));
                }
                
                const imageMap = new Map(loadedImages.map(img => [img.id, img]));
                const sortedImages = metaList
                    .map(meta => imageMap.get(meta.id))
                    .filter((img): img is ImageData => !!img);

                setImages(sortedImages);
            } catch (e) {
                console.error("Failed to load image metadata", e);
            }
        }
        
        // 3. Check update modal
        if (!localStorage.getItem('puzzle_update_notice_v3_react')) {
            setShowModal('update');
        }

        setIsLoaded(true);
    };

    loadData();
  }, []);

  // Save Settings
  useEffect(() => {
    if (isLoaded) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }, [settings, isLoaded]);

  // Save Image Metadata
  useEffect(() => {
      if (isLoaded) {
          const metaToSave = images.map(({ id, name, size }) => ({ id, name, size }));
          localStorage.setItem(IMAGES_META_KEY, JSON.stringify(metaToSave));
      }
  }, [images, isLoaded]);

  useEffect(() => {
    if (gridRef.current && !sortableInstance.current) {
      sortableInstance.current = new Sortable(gridRef.current, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        delay: 100, // Debounce drag slightly for performance
        delayOnTouchOnly: true,
        forceFallback: false, // Use native DnD for better performance
        onEnd: (evt) => {
          const { oldIndex, newIndex } = evt;
          if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== newIndex) {
            setImages(prev => {
              const newItems = [...prev];
              const [removed] = newItems.splice(oldIndex, 1);
              newItems.splice(newIndex, 0, removed);
              return newItems;
            });
          }
        }
      });
    }
  }, [images.length]); 

  // --- Sticker Preview Logic (Anti-flicker) ---

  const drawPreviewContent = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);
      if (bgImgRef.current) {
          const img = bgImgRef.current;
          const sRatio = img.width / img.height;
          const cRatio = w / h;
          if(sRatio > cRatio) ctx.drawImage(img, (img.width - img.height*cRatio)/2, 0, img.height*cRatio, img.height, 0, 0, w, h);
          else ctx.drawImage(img, 0, (img.height - img.width/cRatio)/2, img.width, img.width/cRatio, 0, 0, w, h);
      } else {
          ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0,0,w,h); 
          ctx.fillStyle = '#ccc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('无图', w/2, h/2);
      }
      if (stickerImgRef.current) {
          const img = stickerImgRef.current;
          const sizePct = settings.stickerSize / 100;
          const sw = w * sizePct;
          const sh = sw * (img.height / img.width);
          const dx = (w * settings.stickerX / 100) - sw/2;
          const dy = (h * settings.stickerY / 100) - sh/2;
          ctx.drawImage(img, dx, dy, sw, sh);
      }
  };

  const drawStickerPreview = () => {
      const canvas = stickerCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = 300, h = 300;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      drawPreviewContent(ctx, w, h);
  };

  useEffect(() => {
    if (images.length > 0) {
      const url = images[0].url;
      const img = new Image();
      img.src = url;
      img.onload = () => { bgImgRef.current = img; drawStickerPreview(); };
      if (img.complete) { bgImgRef.current = img; drawStickerPreview(); }
    } else {
      bgImgRef.current = null;
      drawStickerPreview();
    }
  }, [images.length > 0 ? images[0].url : null]);

  useEffect(() => {
    if (settings.stickerImgUrl) {
      const img = new Image();
      img.src = settings.stickerImgUrl;
      img.onload = () => { stickerImgRef.current = img; drawStickerPreview(); };
    } else {
      stickerImgRef.current = null;
      drawStickerPreview();
    }
  }, [settings.stickerImgUrl]);

  useEffect(() => { drawStickerPreview(); }, [settings.stickerSize, settings.stickerX, settings.stickerY]);

  const enlargeStickerPreview = () => {
      const w = 600;
      const ratio = getRatio();
      const h = Math.floor(w / ratio);
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      const ctx = cvs.getContext('2d');
      if(!ctx) return;
      drawPreviewContent(ctx, w, h);
      setPreviewSrc(cvs.toDataURL('image/jpeg', 0.9));
      setShowModal('preview');
  };

  // --- Optimized File Handling ---

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    
    const fileList: File[] = Array.from(files);
    isCancelledRef.current = false; // Reset cancel flag
    setIsGenerating(true); 
    
    // Clear input immediately
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Optimized chunk processing
    // Decouple DB writes from UI updates to avoid IO blocking the main thread
    const CHUNK_SIZE = 40; 
    let processedCount = 0;

    const processNextChunk = async (startIndex: number) => {
        if (isCancelledRef.current || startIndex >= fileList.length) {
            setIsGenerating(false);
            setProgressText('');
            return;
        }

        const endIndex = Math.min(startIndex + CHUNK_SIZE, fileList.length);
        const chunk = fileList.slice(startIndex, endIndex);

        const batchDBItems: {id: string, blob: Blob}[] = [];
        const chunkImages: ImageData[] = [];

        // Synchronous Block: Create Object URLs
        // Fast enough for 40 items
        for (const file of chunk) {
            if (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                const id = Math.random().toString(36).substr(2, 9) + Date.now() + Math.random();
                batchDBItems.push({ id, blob: file });
                chunkImages.push({
                    id,
                    url: URL.createObjectURL(file),
                    name: file.name,
                    size: file.size
                });
            }
        }

        // Async DB Save - Fire and forget (queued by IDB)
        // We do NOT await here to prevent UI lag. 
        // Data integrity risk is low as state is updated immediately in memory.
        saveBatchImagesToDB(batchDBItems).catch(console.error);

        // Update UI
        setImages(prev => [...prev, ...chunkImages]);
        processedCount += chunk.length;
        setProgressText(`已导入 ${processedCount} / ${fileList.length}`);

        // Yield to main thread to allow React Render
        setTimeout(() => processNextChunk(endIndex), 0);
    };

    processNextChunk(0);
  };

  const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || targetImageIndex.current === -1) return;
    const file = e.target.files[0];
    const newUrl = URL.createObjectURL(file);
    const targetIndex = targetImageIndex.current;
    const oldImage = images[targetIndex];

    saveImageToDB(oldImage.id, file).catch(e => console.error("Replace in DB failed", e));
    setImages(prev => {
        const copy = [...prev];
        const old = copy[targetIndex];
        URL.revokeObjectURL(old.url);
        copy[targetIndex] = { ...old, url: newUrl, name: file.name, size: file.size };
        return copy;
    });
    if (replaceInputRef.current) replaceInputRef.current.value = '';
  };

  const handleDelete = (index: number) => {
      const imgToDelete = images[index];
      // Optimistic Update
      setImages(prev => {
          const copy = [...prev];
          URL.revokeObjectURL(copy[index].url);
          copy.splice(index, 1);
          return copy;
      });
      deleteImageFromDB(imgToDelete.id).catch(e => console.error("Delete from DB failed", e));
  };

  const handleThumbnailClick = useCallback((index: number) => {
      targetImageIndex.current = index;
      const img = images[index];
      if(window.confirm(`操作图片 "${img.name}" ?\n\n[确定] = 替换\n[取消] = 删除`)) {
          replaceInputRef.current?.click();
      } else {
          handleDelete(index);
      }
  }, [images]); // Images dependency is needed to get correct name, but index is stable.

  const handleOverlayFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      setSettings(s => ({ ...s, overlayImgUrl: url }));
      if (overlayInputRef.current) overlayInputRef.current.value = '';
  };

  const handleStickerFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const file = e.target.files[0];
      const url = URL.createObjectURL(file);
      setSettings(s => ({ ...s, stickerImgUrl: url }));
      if (stickerInputRef.current) stickerInputRef.current.value = '';
  };

  const clearAll = async () => {
      if (window.confirm('确定清空?')) {
          isCancelledRef.current = true; // Stop ongoing imports/generation
          setIsGenerating(true);
          setProgressText('正在清理...');
          await new Promise(r => setTimeout(r, 50)); // allow render
          
          await clearImagesDB();
          images.forEach(i => URL.revokeObjectURL(i.url));
          setImages([]);
          setGeneratedBlobs([]);
          setResultsOpen(false);
          localStorage.removeItem(IMAGES_META_KEY);
          
          if(fileInputRef.current) fileInputRef.current.value = ''; // Ensure input is cleared
          
          setIsGenerating(false);
      }
  };

  const removeDuplicates = async () => {
      const seen = new Set();
      const newImages: ImageData[] = [];
      const idsToDelete: string[] = [];

      images.forEach(item => {
          const key = item.name + item.size;
          if (seen.has(key)) {
              idsToDelete.push(item.id);
              URL.revokeObjectURL(item.url);
          } else {
              seen.add(key);
              newImages.push(item);
          }
      });
      
      idsToDelete.forEach(id => deleteImageFromDB(id)); // Fire and forget
      setImages(newImages);
  };

  const getRatio = () => {
      if (settings.isCustomRatio) return (settings.customW || 1000) / (settings.customH || 1500);
      return settings.aspectRatio;
  };

  // --- Core Generation ---

  const generate = async (opType: 'normal' | 'repack' | 'apply' = 'normal') => {
      if (!images.length) return alert('请添加图片');
      
      setIsGenerating(true);
      setGeneratedBlobs([]);
      setResultsOpen(false);
      isCancelledRef.current = false;
      setProgressText('准备开始...');
      
      await new Promise(r => setTimeout(r, 50));

      const ratio = getRatio();
      const { cellW, cellH } = calculateCellDimensions(settings.cols, ratio, settings.gap);
      
      let targets = images.map(d => d.url);
      const maskIndices = parseMaskIndices(settings.maskIndicesStr);
      
      if (opType === 'repack') {
          targets = targets.filter((_, i) => !maskIndices.includes(settings.startNumber + i));
      }

      let finalApplyMask = (opType === 'apply' || (opType === 'normal' && settings.maskIndicesStr.length > 0));
      
      // Calculate effective rows per group: use explicit setting or all-in-one
      const effectiveGroupRows = settings.groupRows > 0 ? settings.groupRows : Math.ceil(targets.length / settings.cols);
      const batchSize = settings.cols * effectiveGroupRows;
      const totalBatches = Math.ceil(targets.length / batchSize);
      
      const blobs: Blob[] = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { setIsGenerating(false); return; }

      const qualityVal = settings.exportQuality > 100 ? 100 : settings.exportQuality;
      const isPng = qualityVal === 100;

      try {
          for (let b = 0; b < totalBatches; b++) {
              if (isCancelledRef.current) break;
              setProgressText(`正在生成 ${b+1}/${totalBatches} 组...`);
              await new Promise(r => setTimeout(r, 100)); // Yield
              const currentImgs = targets.slice(b * batchSize, Math.min((b + 1) * batchSize, targets.length));
              
              await drawAsync({
                  ctx,
                  images: currentImgs,
                  rows: Math.ceil(currentImgs.length / settings.cols),
                  cols: settings.cols,
                  w: cellW,
                  h: cellH,
                  gap: settings.gap,
                  globalOffset: b * batchSize,
                  startNum: settings.startNumber,
                  maskIndices,
                  settings,
                  applyMask: finalApplyMask,
                  isCancelled: () => isCancelledRef.current
              });

              if (isCancelledRef.current) break;

              const blob = await new Promise<Blob | null>(resolve => 
                canvas.toBlob(resolve, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : qualityVal / 100)
              );
              
              if (blob) blobs.push(blob);
              ctx.clearRect(0,0, canvas.width, canvas.height);
              canvas.width = 1; canvas.height = 1; 
          }

          if (!isCancelledRef.current) {
              setGeneratedBlobs(blobs);
              setResultsOpen(true);
              setTimeout(() => {
                  document.getElementById('result-anchor')?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
          }

      } catch (e: any) {
          console.error(e);
          if (!isCancelledRef.current) alert('生成中断: ' + e.message);
      } finally {
          setIsGenerating(false);
      }
  };

  const previewOverlay = async () => {
    if (!images.length || !settings.overlayImgUrl) return alert('需有拼图图片和覆盖层图片');
    setIsGenerating(true);
    setProgressText('生成预览...');
    try {
        const previewCanvas = document.createElement('canvas');
        const ctx = previewCanvas.getContext('2d')!;
        const ratio = getRatio();
        const previewImgs = images.slice(0, 9).map(i => i.url);
        while(previewImgs.length < 9 && images.length > 0) previewImgs.push(images[0].url);

        await drawAsync({
            ctx,
            images: previewImgs,
            rows: 3,
            cols: 3,
            w: 200, 
            h: Math.floor(200 / ratio),
            gap: Math.max(0, Math.floor(settings.gap / 5)),
            globalOffset: 0,
            startNum: 1,
            maskIndices: [],
            settings: { ...settings, showNum: false },
            applyMask: false,
            isCancelled: () => false
        });
        setPreviewSrc(previewCanvas.toDataURL('image/jpeg', 0.8));
        setShowModal('preview');
    } catch(e) { alert('预览失败'); } finally { setIsGenerating(false); }
  };

  const previewQuality = async () => {
      if (!images.length) return alert('请先添加图片');
      setIsGenerating(true);
      setProgressText('生成画质预览...');
      try {
          const img = new Image();
          img.src = images[0].url;
          await new Promise(r => img.onload = r);
          const cvs = document.createElement('canvas');
          const scale = Math.min(1, 1000 / img.width);
          cvs.width = img.width * scale; cvs.height = img.height * scale;
          const ctx = cvs.getContext('2d')!;
          ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
          const q = settings.exportQuality > 100 ? 100 : settings.exportQuality;
          setPreviewSrc(cvs.toDataURL(q === 100 ? 'image/png' : 'image/jpeg', q === 100 ? undefined : q / 100));
          setShowModal('preview');
      } catch(e) { alert('预览失败'); } finally { setIsGenerating(false); }
  };

  const downloadBlob = (blob: Blob, name: string) => {
      const link = document.createElement('a');
      link.download = name; link.href = URL.createObjectURL(blob);
      document.body.appendChild(link); link.click();
      document.body.removeChild(link); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const downloadZip = async () => {
      setIsGenerating(true); setProgressText('打包 ZIP...');
      const zip = new JSZip();
      const folder = zip.folder("拼图分组");
      const ext = settings.exportQuality === 100 ? 'png' : 'jpg';
      generatedBlobs.forEach((blob, i) => { folder?.file(`拼图_Part_${i+1}.${ext}`, blob); });
      try {
          const content = await zip.generateAsync({ type: "blob" });
          if (!isCancelledRef.current) downloadBlob(content, `拼图打包_${Date.now()}.zip`);
      } catch (e: any) { alert('打包失败: ' + e.message); } finally { setIsGenerating(false); }
  };

  const combineAndDownload = async () => {
      if (images.length > 100) return alert('⚠️ 图片数量超过100张，禁止合并导出。请使用 ZIP。');
      setIsGenerating(true); setProgressText('合并中...');
      try {
          const bitmaps = await Promise.all(generatedBlobs.map(b => createImageBitmap(b)));
          const totalH = bitmaps.reduce((sum, b) => sum + b.height, 0);
          const maxW = bitmaps[0].width;
          if (maxW * totalH > 50000000) throw new Error('图片总像素过大'); // Simpler check
          const cvs = document.createElement('canvas');
          cvs.width = maxW; cvs.height = totalH;
          const ctx = cvs.getContext('2d')!;
          let y = 0;
          for (const bmp of bitmaps) { ctx.drawImage(bmp, 0, y); y += bmp.height; }
          cvs.toBlob(blob => {
              if(blob) downloadBlob(blob, `拼图_合并版_${Date.now()}.${settings.exportQuality===100?'png':'jpg'}`);
              setIsGenerating(false);
          }, settings.exportQuality===100 ? 'image/png' : 'image/jpeg', settings.exportQuality/100);
      } catch (e) { alert('合并失败，请使用ZIP'); setIsGenerating(false); }
  };

  const downloadParts = async () => {
      if (!confirm('即将逐张下载，请保持页面开启。确认？')) return;
      setIsGenerating(true);
      const ext = settings.exportQuality === 100 ? 'png' : 'jpg';
      for (let i = 0; i < generatedBlobs.length; i++) {
          setProgressText(`下载第 ${i+1} / ${generatedBlobs.length} 张...`);
          downloadBlob(generatedBlobs[i], `拼图_Part_${i+1}.${ext}`);
          if (i < generatedBlobs.length - 1) await new Promise(r => setTimeout(r, 1500));
      }
      setIsGenerating(false); alert('下载请求已发送完毕');
  };

  return (
    <div className="pb-[200px]">
      <div 
        className="fixed inset-0 bg-[rgba(0,122,255,0.1)] backdrop-blur-[2px] z-[999] hidden flex justify-center items-center m-2.5 border-4 border-dashed border-[#007AFF] rounded-[20px] pointer-events-none"
        id="dragOverlay"
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.remove('hidden'); e.currentTarget.classList.add('flex'); }}
        onDragLeave={(e) => { e.currentTarget.classList.add('hidden'); e.currentTarget.classList.remove('flex'); }}
        onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.add('hidden'); }}
      >
        <div className="text-[#007AFF] font-bold text-2xl bg-white/90 px-6 py-3 rounded-xl shadow-lg">松手释放图片</div>
      </div>

      <header className="sticky top-0 z-50 bg-[#F2F2F7]/90 backdrop-blur-xl border-b border-gray-200/50">
        <div className="max-w-2xl mx-auto px-5 py-3 flex justify-between items-center h-[52px]">
          <h1 className="text-[22px] font-bold tracking-tight text-black">拼图排序<span className="text-xs font-normal text-white bg-black px-1.5 py-0.5 rounded ml-1">Ultimate</span></h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowModal('reset')} className="bg-gray-100 text-gray-500 text-[13px] font-bold px-3 py-1.5 rounded-full shadow-sm active:bg-gray-200 transition flex items-center gap-1">
              重置
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="bg-white text-[#007AFF] text-[15px] font-bold px-4 py-1.5 rounded-full shadow-sm active:bg-gray-100 transition flex items-center gap-1">
              添加
            </button>
          </div>
          <input type="file" ref={fileInputRef} multiple accept="image/*" className="hidden" onChange={handleFiles} />
          <input type="file" ref={replaceInputRef} accept="image/*" className="hidden" onChange={handleReplace} />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 relative" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFiles({ target: { files: e.dataTransfer.files } } as any); }}>
        
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-200 ${isGenerating ? 'translate-y-0 opacity-100' : '-translate-y-[200%] opacity-0 pointer-events-none'}`}>
          <div className="bg-white/95 backdrop-blur-xl text-gray-900 rounded-full shadow-2xl flex items-center py-3 pl-6 pr-4 gap-3 border border-gray-200/50 min-w-[200px]">
             <div className="flex-1 flex flex-col justify-center min-w-0">
               <span className="text-[15px] font-bold leading-tight truncate text-[#007AFF]">{progressText}</span>
             </div>
             <button onClick={() => { isCancelledRef.current = true; setIsGenerating(false); }} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-[#FF3B30]">✕</button>
          </div>
        </div>

        <IOSCard>
          <Accordion title={`已导入 ${images.length} 张`} subtitle="支持长按拖拽排序" isOpen={true} icon={null}>
             <div className="p-4 pt-0 border-t border-gray-100">
                <div ref={gridRef} className="grid grid-cols-4 gap-2 overflow-y-auto max-h-[220px] min-h-[100px] no-scrollbar touch-pan-y mt-4">
                   {images.length === 0 && (
                      <div className="col-span-full flex flex-col items-center justify-center py-8 space-y-3 text-gray-400">
                        <span className="text-sm">导入图片 (点击可替换/长按拖拽)</span>
                      </div>
                   )}
                   {images.map((img, idx) => (
                       <ThumbnailItem key={img.id} img={img} index={idx} onMouseUp={handleThumbnailClick} />
                   ))}
                </div>
                {(() => {
                   const unique = new Set(images.map(i => i.name + i.size)).size;
                   const diff = images.length - unique;
                   if (diff > 0) return (
                     <div className="mt-3 bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-xs text-yellow-700 flex items-start gap-2">
                        <span className="font-bold">发现重复:</span> {diff} 张. <button onClick={removeDuplicates} className="underline text-yellow-800 font-bold ml-1">一键去重</button>
                     </div>
                   );
                   return null;
                })()}
                {images.length > 0 && (
                    <div className="flex justify-end mt-3 mb-1 relative z-10">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation(); // Stop bubbling
                                clearAll();
                            }} 
                            className="text-[#FF3B30] text-[13px] font-bold py-2 px-4 bg-transparent active:bg-red-50 rounded-lg transition-colors duration-200"
                        >
                            清空所有
                        </button>
                    </div>
                )}
             </div>
          </Accordion>
        </IOSCard>

        {/* --- Reuse existing UI Components for Settings --- */}
        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">单元格与间距</div>
        <IOSCard>
            <Accordion title="单元格与间距设置" subtitle="设置画布比例、留白间隙">
                <SettingRow label="画布比例">
                    <select 
                        value={settings.isCustomRatio ? 'custom' : settings.aspectRatio} 
                        onChange={(e) => {
                            if (e.target.value === 'custom') setSettings({...settings, isCustomRatio: true});
                            else setSettings({...settings, isCustomRatio: false, aspectRatio: parseFloat(e.target.value)});
                        }}
                        className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none text-right appearance-none cursor-pointer dir-rtl"
                    >
                        <option value="0.5625">9:16 手机全屏</option>
                        <option value="0.75">3:4 海报</option>
                        <option value="1">1:1 正方形</option>
                        <option value="1.333">4:3 照片</option>
                        <option value="custom">自定义...</option>
                    </select>
                </SettingRow>
                <div className="p-4 bg-white active:bg-gray-50 transition">
                   <div className="flex items-center justify-between mb-2">
                       <span className="text-[17px]">图片间隙</span>
                       <span className="text-[#007AFF] font-bold text-[15px]">{settings.gap}px</span>
                   </div>
                   <input 
                       type="range" min="0" max="100" step="1" 
                       value={settings.gap} 
                       onChange={e => setSettings({...settings, gap: parseInt(e.target.value)})} 
                       style={{ touchAction: 'none' }}
                       onPointerDown={e => e.stopPropagation()}
                   />
                </div>
                {settings.isCustomRatio && (
                    <div className="p-4 bg-gray-50 flex items-center justify-end gap-3 border-t border-gray-100">
                        <input type="number" placeholder="宽" className="bg-white border rounded px-2 py-1 text-center w-20 text-sm" value={settings.customW} onChange={e => setSettings({...settings, customW: parseInt(e.target.value) || 1000})} />
                        <span className="text-gray-400">:</span>
                        <input type="number" placeholder="高" className="bg-white border rounded px-2 py-1 text-center w-20 text-sm" value={settings.customH} onChange={e => setSettings({...settings, customH: parseInt(e.target.value) || 1500})} />
                    </div>
                )}
            </Accordion>
        </IOSCard>

        <div className="mb-2 pl-4 text-[13px] text-gray-500 uppercase font-medium">序号标注</div>
        <IOSCard>
             <div className="flex items-center justify-between p-4 bg-white border-b border-gray-100">
                <span className="text-[17px]">显示序号</span>
                <IOSToggle checked={settings.showNum} onChange={(e) => setSettings({...settings, showNum: e.target.checked})} />
             </div>
             <Accordion title="序号详细设置" subtitle="设置序号大小、颜色、字体、位置">
                 <SettingRow label="起始数值">
                     <input type="number" value={settings.startNumber} onChange={e => setSettings({...settings, startNumber: parseInt(e.target.value) || 1})} className="text-right text-[#007AFF] text-[17px] focus:outline-none w-20 bg-transparent rounded px-2 py-1" />
                 </SettingRow>
                 <SettingRow label="字号大小">
                     <input type="number" value={settings.fontSize} onChange={e => setSettings({...settings, fontSize: parseInt(e.target.value) || 100})} className="text-right text-[#007AFF] text-[17px] focus:outline-none w-20 bg-transparent rounded px-2 py-1" />
                 </SettingRow>
                 <SettingRow label="字体颜色">
                     <input type="color" value={settings.fontColor} onChange={e => setSettings({...settings, fontColor: e.target.value})} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                 </SettingRow>
                 <SettingRow label="字体粗细">
                     <select value={settings.fontWeight || 'bold'} onChange={e => setSettings({...settings, fontWeight: e.target.value})} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl text-right w-40">
                         <option value="100">极细 (Thin)</option>
                         <option value="normal">常规 (Normal)</option>
                         <option value="bold">粗体 (Bold)</option>
                         <option value="900">特粗 (Heavy)</option>
                     </select>
                 </SettingRow>
                 
                 <div className="flex items-center justify-between p-4 bg-white border-t border-gray-100">
                        <div className="flex items-center gap-2">
                            <span className="text-[17px]">描边颜色</span>
                            <label className="flex items-center cursor-pointer gap-1 bg-gray-100 px-2 py-1 rounded-md text-xs text-gray-500 font-bold active:bg-gray-200 transition">
                                <input type="checkbox" checked={settings.enableStroke} onChange={e => setSettings({...settings, enableStroke: e.target.checked})} className="accent-[#34C759]" />
                                <span>启用</span>
                            </label>
                        </div>
                        <input type="color" value={settings.fontStrokeColor} onChange={e => setSettings({...settings, fontStrokeColor: e.target.value})} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                 </div>
                 
                 <div className="flex items-center justify-between p-4 bg-white border-t border-gray-100">
                        <div className="flex items-center gap-2">
                            <span className="text-[17px]">阴影颜色</span>
                            <label className="flex items-center cursor-pointer gap-1 bg-gray-100 px-2 py-1 rounded-md text-xs text-gray-500 font-bold active:bg-gray-200 transition">
                                <input type="checkbox" checked={settings.enableShadow} onChange={e => setSettings({...settings, enableShadow: e.target.checked})} className="accent-[#34C759]" />
                                <span>启用</span>
                            </label>
                        </div>
                        <input type="color" value={settings.fontShadowColor} onChange={e => setSettings({...settings, fontShadowColor: e.target.value})} className="w-8 h-8 rounded-full overflow-hidden border border-gray-200" />
                 </div>
                 
                 <SettingRow label="字体类型">
                     <select value={settings.fontFamily} onChange={e => setSettings({...settings, fontFamily: e.target.value})} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl text-right w-40">
                         <option value="sans-serif">默认</option>
                         <option value="'Heiti SC', 'Microsoft YaHei', sans-serif">黑体</option>
                         <option value="'Songti SC', 'SimSun', serif">宋体</option>
                         <option value="'KaiTi', '楷体', serif">楷体</option>
                         <option value="'Times New Roman', serif">Times New Roman</option>
                         <option value="cursive">手写风</option>
                     </select>
                 </SettingRow>
                 <SettingRow label="位置">
                     <select value={settings.fontPos} onChange={e => setSettings({...settings, fontPos: e.target.value as any})} className="text-[#007AFF] text-[17px] pr-6 bg-transparent focus:outline-none appearance-none dir-rtl">
                         <option value="bottom-center">底部居中</option>
                         <option value="bottom-left">底部左侧</option>
                         <option value="bottom-right">底部右侧</option>
                         <option value="center">正中间</option>
                         <option value="top-left">左上角</option>
                         <option value="top-right">右上角</option>
                     </select>
                 </SettingRow>
             </Accordion>
        </IOSCard>

        <IOSCard className="mb-6">
            <Accordion title="导出与布局策略" subtitle="设置排列列数、分组方式、画质">
                <div className="p-4 bg-white border-b border-gray-100">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <label className="text-[11px] text-gray-500 block mb-1">列数 (横向)</label>
                            <input type="number" value={settings.cols} onChange={e => setSettings({...settings, cols: parseInt(e.target.value) || 3})} className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm font-bold text-[#007AFF] outline-none" />
                        </div>
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <label className="text-[11px] text-gray-500 block mb-1">每组行数 <span className="text-[9px] text-gray-400 font-normal">(空=自动)</span></label>
                            <input 
                                type="number" 
                                placeholder="自动"
                                value={settings.groupRows === 0 ? '' : settings.groupRows} 
                                onChange={e => {
                                    const val = parseInt(e.target.value);
                                    setSettings({...settings, groupRows: isNaN(val) ? 0 : val});
                                }} 
                                className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm font-bold text-[#007AFF] outline-none" 
                            />
                        </div>
                    </div>
                    <div className="mt-3 text-[11px] bg-[#007AFF]/5 text-[#007AFF] border border-[#007AFF]/20 p-2 rounded flex items-center gap-2">
                        <span className="font-bold">Ready</span> <span>每组 <b>{settings.groupRows > 0 ? settings.cols * settings.groupRows : '自动(全部)'}</b> 张</span>
                    </div>
                </div>

                <div className="p-4 bg-white border-b border-gray-100">
                     <div className="flex items-center justify-between mb-3">
                         <div className="flex flex-col">
                             <span className="text-[17px] font-bold text-gray-800">全局纹理 / 覆盖层</span>
                         </div>
                         <div className="flex gap-2">
                             <IOSButton onClick={previewOverlay}>👁️ 预览</IOSButton>
                             <button onClick={() => overlayInputRef.current?.click()} className="text-[#007AFF] text-[13px] font-bold bg-[#007AFF]/10 px-3 py-1.5 rounded-full active:bg-[#007AFF]/20 transition">+ 图片</button>
                             <input type="file" ref={overlayInputRef} accept="image/*" className="hidden" onChange={handleOverlayFile} />
                         </div>
                     </div>
                     {settings.overlayImgUrl && (
                         <div className="bg-gray-50 rounded-lg p-2 mb-3 flex items-center justify-between border border-gray-100">
                             <div className="flex items-center gap-2 overflow-hidden">
                                 <img src={settings.overlayImgUrl} className="w-8 h-8 rounded object-cover border border-gray-200 bg-white" alt="" />
                                 <span className="text-xs text-gray-500 truncate max-w-[150px]">覆盖层已加载</span>
                             </div>
                             <button onClick={() => setSettings(s => ({...s, overlayImgUrl: null}))} className="text-gray-400 hover:text-[#FF3B30] px-2">✕</button>
                         </div>
                     )}
                     <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className="text-[11px] text-gray-500 block mb-1">混合模式</label>
                            <select value={settings.overlayMode} onChange={e => setSettings({...settings, overlayMode: e.target.value as any})} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold text-gray-700 outline-none">
                                <option value="source-over">标准</option>
                                <option value="multiply">正片叠底</option>
                                <option value="screen">滤色</option>
                                <option value="overlay">覆盖</option>
                                <option value="soft-light">柔光</option>
                            </select>
                         </div>
                         <div>
                            <label className="text-[11px] text-gray-500 block mb-1">不透明度</label>
                            <input 
                                type="range" min="0" max="1" step="0.01" 
                                value={settings.overlayOpacity} 
                                onChange={e => setSettings({...settings, overlayOpacity: parseFloat(e.target.value)})} 
                                className="w-full" 
                                style={{ touchAction: 'none' }}
                                onPointerDown={e => e.stopPropagation()}
                            />
                         </div>
                     </div>
                </div>

                <div className="p-4 bg-white">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[17px] font-bold text-gray-800">导出画质</span>
                        <div className="flex items-center gap-2">
                            <button onClick={previewQuality} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded flex items-center gap-1 transition"><span>👁️ 预览</span></button>
                            <input type="number" min="10" max="100" value={settings.exportQuality} onChange={e => setSettings({...settings, exportQuality: parseInt(e.target.value) || 80})} className="bg-gray-100 rounded px-1 py-1 text-center w-14 text-[15px] font-bold text-[#007AFF] outline-none" />
                            <span className="text-xs text-gray-500">%</span>
                        </div>
                    </div>
                </div>
            </Accordion>
        </IOSCard>

        <IOSCard>
            <Accordion title="打码与贴纸" subtitle="遮挡特定图片或序号">
                 <div className="p-4 bg-white">
                     <div className="flex items-center justify-between mb-4">
                        <div className="flex flex-col">
                            <span className="text-[17px] font-bold text-gray-800">目标序号</span>
                            <span className="text-[10px] text-gray-400">输入数字 (如: 5, 12, 1-3)</span>
                        </div>
                        <input type="text" value={settings.maskIndicesStr} onChange={e => setSettings({...settings, maskIndicesStr: e.target.value})} placeholder="如: 5, 12" className="text-right text-[#007AFF] text-[17px] focus:outline-none w-40 placeholder-gray-300 bg-gray-50 rounded px-2 py-1" />
                     </div>
                     <div className="flex p-1 bg-gray-100 rounded-lg mb-4">
                        <button onClick={() => setSettings({...settings, maskMode: 'line'})} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${settings.maskMode === 'line' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>画线打码</button>
                        <button onClick={() => setSettings({...settings, maskMode: 'image'})} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${settings.maskMode === 'image' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>图片/贴纸</button>
                     </div>

                     {settings.maskMode === 'line' ? (
                         <div className="animate-fade-in">
                             <div className="flex justify-between items-center pb-3 border-b border-gray-100 mb-3">
                                <span className="text-sm text-gray-500">形状样式</span>
                                <div className="flex items-center gap-4 text-sm">
                                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={settings.lineStyle === 'cross'} onChange={() => setSettings({...settings, lineStyle: 'cross'})} className="accent-[#FF3B30]" /> <span>❌ 交叉</span></label>
                                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={settings.lineStyle === 'slash'} onChange={() => setSettings({...settings, lineStyle: 'slash'})} className="accent-[#FF3B30]" /> <span>╱ 斜线</span></label>
                                </div>
                             </div>
                             <div className="flex justify-between items-center py-2">
                                <span className="text-sm text-gray-500 w-20">颜色/粗细</span>
                                <div className="flex items-center flex-1 gap-3">
                                    <input type="color" value={settings.maskColor} onChange={e => setSettings({...settings, maskColor: e.target.value})} className="w-8 h-8 rounded-full border border-gray-200 shrink-0" />
                                    <input 
                                        type="range" min="1" max="20" 
                                        value={settings.maskWidth} 
                                        onChange={e => setSettings({...settings, maskWidth: parseInt(e.target.value)})} 
                                        className="flex-1" 
                                        style={{ touchAction: 'none' }}
                                        onPointerDown={e => e.stopPropagation()}
                                    />
                                </div>
                             </div>
                         </div>
                     ) : (
                         <div className="animate-fade-in">
                             <button onClick={() => stickerInputRef.current?.click()} className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-sm mb-3 active:bg-gray-50">+ 上传贴纸</button>
                             <input type="file" ref={stickerInputRef} accept="image/*" className="hidden" onChange={handleStickerFile} />
                             
                             <div className="flex gap-4 mb-1">
                                <div onClick={enlargeStickerPreview} className="w-24 h-24 checkered-bg rounded-lg overflow-hidden border border-gray-200 shrink-0 relative shadow-sm cursor-pointer active:scale-95 transition">
                                    <canvas ref={stickerCanvasRef} className="w-full h-full object-contain" />
                                </div>
                                <div className="flex-1 flex flex-col justify-center space-y-4">
                                    <div className="flex items-center text-xs text-gray-500">
                                        <span className="w-8 text-right mr-3">大小</span> 
                                        <input 
                                            type="range" min="10" max="200" 
                                            value={settings.stickerSize} 
                                            onChange={e => setSettings({...settings, stickerSize: parseInt(e.target.value)})} 
                                            className="flex-1" 
                                            style={{ touchAction: 'none' }}
                                            onPointerDown={e => e.stopPropagation()}
                                        />
                                    </div>
                                    <div className="flex items-center text-xs text-gray-500">
                                        <span className="w-8 text-right mr-3">左右</span> 
                                        <input 
                                            type="range" min="0" max="100" 
                                            value={settings.stickerX} 
                                            onChange={e => setSettings({...settings, stickerX: parseInt(e.target.value)})} 
                                            className="flex-1" 
                                            style={{ touchAction: 'none' }}
                                            onPointerDown={e => e.stopPropagation()}
                                        />
                                    </div>
                                    <div className="flex items-center text-xs text-gray-500">
                                        <span className="w-8 text-right mr-3">上下</span> 
                                        <input 
                                            type="range" min="0" max="100" 
                                            value={settings.stickerY} 
                                            onChange={e => setSettings({...settings, stickerY: parseInt(e.target.value)})} 
                                            className="flex-1" 
                                            style={{ touchAction: 'none' }}
                                            onPointerDown={e => e.stopPropagation()}
                                        />
                                    </div>
                                </div>
                             </div>
                         </div>
                     )}
                     
                     <div className="grid grid-cols-2 gap-3 mt-4">
                        <button onClick={() => generate('apply')} className="py-3 rounded-xl bg-[#007AFF]/10 active:bg-[#007AFF]/20 text-[#007AFF] font-bold text-[15px] transition-all flex items-center justify-center gap-1">✨ 生成/更新</button>
                        <button onClick={() => generate('repack')} className="py-3 rounded-xl bg-[#FF3B30]/10 active:bg-[#FF3B30]/20 text-[#FF3B30] font-bold text-[15px] transition-all flex items-center justify-center gap-1">🔄 剔除并重排</button>
                     </div>
                 </div>
            </Accordion>
        </IOSCard>

        {/* Results Area */}
        <div id="result-anchor" className={resultsOpen ? 'block pb-10' : 'hidden'}>
             <IOSCard>
                 <details className="group" open>
                     <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none">
                        <div>
                            <div className="text-[17px] font-bold text-[#34C759]">生成结果</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">预览与下载</div>
                        </div>
                     </summary>
                     <div className="border-t border-gray-100 p-4">
                         <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                             <div className="flex justify-between items-center font-bold">
                                <span>生成完成</span>
                                <span>{(generatedBlobs.reduce((a,b) => a+b.size, 0) / 1024 / 1024).toFixed(2)} MB</span>
                             </div>
                         </div>
                         <div className="result-scroll-container bg-gray-50/50 max-h-[50vh] overflow-y-auto p-2 border border-gray-200 rounded-xl mb-4">
                             {generatedBlobs.map((blob, i) => (
                                 <img key={i} src={URL.createObjectURL(blob)} className="w-full block border-b border-gray-100 last:border-0 mb-2 shadow-sm" alt="" />
                             ))}
                         </div>
                         <div className="grid grid-cols-2 gap-3">
                            <button onClick={downloadParts} className="col-span-2 bg-[#34C759] text-white text-[16px] font-bold py-4 rounded-xl shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2">
                                逐张下载 (防漏图)
                            </button>
                            <button onClick={combineAndDownload} className="bg-white text-black border border-gray-200 text-[14px] font-medium py-3 rounded-xl active:scale-95 transition">合并为长图</button>
                            <button onClick={downloadZip} className="bg-white text-[#007AFF] border border-gray-200 text-[14px] font-medium py-3 rounded-xl active:scale-95 transition">打包下载 (ZIP)</button>
                         </div>
                     </div>
                 </details>
             </IOSCard>
        </div>

        <div className="py-10 text-center text-gray-400 text-xs">
            <p className="font-medium text-gray-500">拼图Ultimate (React)</p>
            <p>High Fidelity Recreation</p>
        </div>

      </main>

      <div className="fixed bottom-8 left-0 right-0 px-4 z-40 pointer-events-none">
          <button onClick={() => generate('normal')} className="pointer-events-auto w-full max-w-2xl mx-auto bg-white/80 backdrop-blur-md text-black border border-white/40 font-semibold text-[17px] py-3.5 rounded-full shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2">
              <span>✨ 开始生成拼图</span>
          </button>
      </div>

      {!localStorage.getItem('puzzle_hide_notes_v1') && (
          <div className="fixed right-5 bottom-28 z-40 transition-all duration-300 hover:scale-105">
            <button onClick={() => setShowModal('note')} className="bg-white/90 backdrop-blur-md text-[#007AFF] shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-white/50 font-bold text-[13px] px-4 py-2.5 rounded-full flex items-center gap-1.5 active:scale-95 transition">
                <span>注意事项</span>
            </button>
          </div>
      )}

      {showModal === 'preview' && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowModal('none')}>
              <div className="bg-white p-2 rounded-xl shadow-2xl relative max-w-[90%] max-h-[80%]" onClick={e => e.stopPropagation()}>
                  <img src={previewSrc || ''} className="object-contain max-w-full max-h-[70vh]" alt="Preview" />
                  <button onClick={() => setShowModal('none')} className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8 flex items-center justify-center">×</button>
              </div>
          </div>
      )}

      {showModal === 'reset' && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowModal('none')}>
               <div className="bg-[#F2F2F2]/95 backdrop-blur-xl rounded-[14px] w-[270px] text-center shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="pt-5 px-4 pb-4">
                        <h3 className="text-[17px] font-bold text-black mb-1">⚠️ 警告</h3>
                        <p className="text-[13px] text-black leading-snug">确定要重置吗？<br/>这将清空所有内容。</p>
                    </div>
                    <div className="flex border-t border-gray-300/50 h-[44px]">
                        <button onClick={() => setShowModal('none')} className="flex-1 text-[17px] text-[#007AFF] active:bg-gray-200 transition border-r border-gray-300/50">取消</button>
                        <button onClick={async () => { 
                            localStorage.removeItem(SETTINGS_KEY); 
                            localStorage.removeItem(IMAGES_META_KEY); 
                            await clearImagesDB();
                            window.location.reload(); 
                        }} className="flex-1 text-[17px] text-[#FF3B30] font-bold active:bg-gray-200 transition">重置</button>
                    </div>
               </div>
          </div>
      )}

      {showModal === 'note' && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowModal('none')}>
              <div className="bg-white w-[85%] max-w-[320px] rounded-2xl p-6 relative shadow-2xl" onClick={e => e.stopPropagation()}>
                  <h3 className="text-[18px] font-bold text-gray-900 mb-4">使用须知</h3>
                  <div className="text-[14px] text-gray-600 space-y-3 mb-6 max-h-[50vh] overflow-y-auto">
                      <p>1. 建议使用 Chrome/Edge 浏览器。</p>
                      <p>2. 多图生成时请调低画质(建议50-80%)，防止内存溢出。</p>
                      <p>3. 超过100张图自动分卷，不支持合并长图。</p>
                  </div>
                  <div className="flex gap-3">
                      <button onClick={() => { localStorage.setItem('puzzle_hide_notes_v1', 'true'); setShowModal('none'); }} className="text-xs text-gray-400 px-2">不再显示</button>
                      <button onClick={() => setShowModal('none')} className="flex-1 bg-[#007AFF] text-white py-3 rounded-xl font-bold">我知道了</button>
                  </div>
              </div>
           </div>
      )}

      {showModal === 'update' && (
           <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-white w-[85%] max-w-[320px] rounded-2xl p-6 shadow-2xl animate-fade-in">
                  <h3 className="text-[18px] font-bold text-gray-900 mb-2">更新提示</h3>
                  <p className="text-sm text-gray-600 mb-6">欢迎使用 React 重构版 Pro Max。保留了所有核心功能与原生体验。</p>
                  <button onClick={() => { localStorage.setItem('puzzle_update_notice_v3_react', 'true'); setShowModal('none'); }} className="w-full bg-[#34C759] text-white py-3 rounded-xl font-bold">开始体验</button>
              </div>
           </div>
      )}

    </div>
  );
}