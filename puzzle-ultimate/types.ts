
export interface ImageItem {
  id: string;
  url: string;
  file: File;
  name: string;
  size: number;
}

export interface AppSettings {
  cols: number;
  groupRows: number;
  aspectRatio: number; // calculated value
  aspectRatioMode: string; // '0.5625', '0.75', '1', 'custom', etc.
  customW: number;
  customH: number;
  gap: number;
  
  // Numbering
  showNum: boolean;
  startNumber: number;
  fontSize: number;
  fontColor: string;
  fontStrokeColor: string;
  enableStroke: boolean;
  fontShadowColor: string;
  enableShadow: boolean;
  fontFamily: string;
  fontPos: string;
  
  // Overlay
  overlayMode: GlobalCompositeOperation;
  overlayOpacity: number;
  
  // Masking
  maskIndices: string; // raw input string
  maskMode: 'line' | 'image';
  lineStyle: 'cross' | 'slash';
  maskColor: string;
  maskWidth: number;
  
  // Sticker settings
  stickerSize: number;
  stickerX: number;
  stickerY: number;

  // Quality
  quality: number;
  qualityPreset: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  cols: 3,
  groupRows: 0, // 0 means Auto-calculate based on safe canvas height
  aspectRatio: 0.75,
  aspectRatioMode: '0.75',
  customW: 1000,
  customH: 1500,
  gap: 0,
  
  showNum: true,
  startNumber: 1,
  fontSize: 350,
  fontColor: '#FFFFFF',
  fontStrokeColor: '#000000',
  enableStroke: true,
  fontShadowColor: '#000000',
  enableShadow: true,
  fontFamily: 'sans-serif',
  fontPos: 'bottom-center',
  
  overlayMode: 'source-over',
  overlayOpacity: 1,
  
  maskIndices: '',
  maskMode: 'line',
  lineStyle: 'cross',
  maskColor: '#FF3B30',
  maskWidth: 10,
  
  stickerSize: 50,
  stickerX: 50,
  stickerY: 50,
  
  quality: 80,
  qualityPreset: '0.80'
};
