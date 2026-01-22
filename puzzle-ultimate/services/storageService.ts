import { openDB } from 'idb';
import { ImageItem } from '../types';

const DB_NAME = 'puzzle_pro_max_v1';
const STORE_NAME = 'images';

// Initialize DB
const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  },
});

export const saveImageToDB = async (item: ImageItem) => {
  const db = await dbPromise;
  // We only store the serializable File object and metadata
  // URL.createObjectURL result is transient and shouldn't be stored
  await db.put(STORE_NAME, {
    id: item.id,
    file: item.file,
    name: item.name,
    size: item.size
  });
};

export const saveImagesToDB = async (items: ImageItem[]) => {
  const db = await dbPromise;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await Promise.all(items.map(item => store.put({
    id: item.id,
    file: item.file,
    name: item.name,
    size: item.size
  })));
  await tx.done;
};

export const deleteImageFromDB = async (id: string) => {
  const db = await dbPromise;
  await db.delete(STORE_NAME, id);
};

export const clearImagesDB = async () => {
  const db = await dbPromise;
  await db.clear(STORE_NAME);
};

export const loadImagesFromDB = async (): Promise<ImageItem[]> => {
  const db = await dbPromise;
  const records = await db.getAll(STORE_NAME);
  
  // Re-hydrate the ImageItem objects
  return records.map(rec => ({
    id: rec.id,
    file: rec.file,
    name: rec.name,
    size: rec.size,
    // Create new blob URL for this session
    url: URL.createObjectURL(rec.file)
  }));
};