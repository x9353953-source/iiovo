export interface ImageData {
  id: string;
  url: string;
  name: string;
  size: number;
}

export interface AppSettings {
  // Layout
  aspectRatio: number;
  isCustomRatio: boolean;
  customW: number;
  customH: number;
  gap: number;
  cols: number;
  groupRows: number;

  // Numbering
  showNum: boolean;
  startNumber: number;
  fontSize: number;
  fontColor: string;
  fontStrokeColor: string;
  enableStroke: boolean; // Added
  fontWeight: string; // Added: 100, normal, bold, 900
  fontShadowColor: string;
  enableShadow: boolean;
  fontFamily: string;
  fontPos: 'bottom-center' | 'bottom-left' | 'bottom-right' | 'center' | 'top-left' | 'top-right';

  // Export
  exportQuality: number; // 10-100
  
  // Overlay
  overlayImgUrl: string | null;
  overlayOpacity: number;
  overlayMode: GlobalCompositeOperation;

  // Masking
  maskIndicesStr: string;
  maskMode: 'line' | 'image';
  lineStyle: 'cross' | 'slash';
  maskColor: string;
  maskWidth: number;
  
  // Sticker
  stickerImgUrl: string | null;
  stickerSize: number;
  stickerX: number;
  stickerY: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  aspectRatio: 0.5625, // 9:16 default
  isCustomRatio: false,
  customW: 1000,
  customH: 1500,
  gap: 0,
  cols: 3,
  groupRows: 0, // 0 means Auto (all in one group)
  
  showNum: true,
  startNumber: 1,
  fontSize: 350,
  fontColor: '#FFFFFF',
  fontStrokeColor: '#000000',
  enableStroke: true, // Default enabled
  fontWeight: 'bold', // Default font weight
  fontShadowColor: '#000000',
  enableShadow: true,
  fontFamily: 'sans-serif',
  fontPos: 'bottom-center',
  
  exportQuality: 80,
  
  overlayImgUrl: null,
  overlayOpacity: 1,
  overlayMode: 'source-over',
  
  maskIndicesStr: '',
  maskMode: 'line',
  lineStyle: 'cross',
  maskColor: '#FF3B30',
  maskWidth: 10,
  
  stickerImgUrl: null,
  stickerSize: 50,
  stickerX: 50,
  stickerY: 50,
};