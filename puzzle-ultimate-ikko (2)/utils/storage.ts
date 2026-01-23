const DB_NAME = 'PuzzleProMax_DB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

let dbInstance: IDBDatabase | null = null;

// Open Database
const openDB = (): Promise<IDBDatabase> => {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    // Check if indexedDB is supported
    if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not supported'));
        return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME); // Key is the Image ID
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      
      dbInstance.onclose = () => {
          dbInstance = null;
      };
      
      dbInstance.onversionchange = () => {
          dbInstance?.close();
          dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

// Save Single Blob
export const saveImageToDB = async (id: string, blob: Blob): Promise<void> => {
  try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(blob, id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
  } catch (e) {
      console.warn("IndexedDB save failed", e);
  }
};

// Batch Save Blobs (High Performance)
export const saveBatchImagesToDB = async (items: {id: string, blob: Blob}[]): Promise<void> => {
    if (items.length === 0) return;
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);

            items.forEach(item => {
                store.put(item.blob, item.id);
            });
        });
    } catch (e) {
        console.warn("IndexedDB batch save failed", e);
    }
}

// Get Blob
export const getImageFromDB = async (id: string): Promise<Blob | undefined> => {
  try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
  } catch (e) {
      console.warn("IndexedDB get failed", e);
      return undefined;
  }
};

// Delete Blob
export const deleteImageFromDB = async (id: string): Promise<void> => {
  try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
  } catch (e) {
      console.warn("IndexedDB delete failed", e);
  }
};

// Clear All
export const clearImagesDB = async (): Promise<void> => {
  try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
  } catch (e) {
      console.warn("IndexedDB clear failed", e);
  }
};
