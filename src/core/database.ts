// IndexedDB 持久层:帆型、桅杆、测帆照片、设置分库存放
import type { AppSettings, MastSpec, PhotoRecord, SailProfile } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'sail-design-studio';
const DB_VERSION = 1;
const STORE_SAILS = 'sails';
const STORE_MASTS = 'masts';
const STORE_PHOTOS = 'photos';
const STORE_SETTINGS = 'settings';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SAILS)) db.createObjectStore(STORE_SAILS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MASTS)) db.createObjectStore(STORE_MASTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  async put<T>(store: string, value: T, key?: IDBValidKey): Promise<IDBValidKey> {
    return tx(store, 'readwrite', (s) => s.put(value as object, key));
  },
  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return tx(store, 'readonly', (s) => s.get(key));
  },
  async getAll<T>(store: string): Promise<T[]> {
    return tx(store, 'readonly', (s) => s.getAll());
  },
  async remove(store: string, key: IDBValidKey): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(key));
  },
  async clear(store: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },
};

export const STORES = {
  SAILS: STORE_SAILS,
  MASTS: STORE_MASTS,
  PHOTOS: STORE_PHOTOS,
  SETTINGS: STORE_SETTINGS,
};

// ---- 领域专用便捷方法 ----

export async function saveSail(sail: SailProfile): Promise<void> {
  await idb.put(STORE_SAILS, sail);
}

export async function loadAllSails(): Promise<SailProfile[]> {
  return idb.getAll<SailProfile>(STORE_SAILS);
}

export async function deleteSail(id: string): Promise<void> {
  await idb.remove(STORE_SAILS, id);
  const photos = await idb.getAll<PhotoRecord>(STORE_PHOTOS);
  await Promise.all(photos.filter((p) => p.sailId === id).map((p) => idb.remove(STORE_PHOTOS, p.id)));
}

export async function saveMast(mast: MastSpec): Promise<void> {
  await idb.put(STORE_MASTS, mast);
}

export async function loadAllMasts(): Promise<MastSpec[]> {
  return idb.getAll<MastSpec>(STORE_MASTS);
}

export async function savePhoto(photo: PhotoRecord): Promise<void> {
  await idb.put(STORE_PHOTOS, photo);
}

export async function loadPhotosBySail(sailId: string): Promise<PhotoRecord[]> {
  const all = await idb.getAll<PhotoRecord>(STORE_PHOTOS);
  return all.filter((p) => p.sailId === sailId);
}

export async function deletePhoto(id: string): Promise<void> {
  await idb.remove(STORE_PHOTOS, id);
}

const SETTINGS_KEY = 'app';

export async function loadSettings(): Promise<AppSettings> {
  const s = await idb.get<AppSettings>(STORE_SETTINGS, SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await idb.put(STORE_SETTINGS, settings, SETTINGS_KEY);
}
