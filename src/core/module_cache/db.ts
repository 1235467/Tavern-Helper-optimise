// db.ts — IndexedDB persistence for the module cache.
// Store 'modules' keyed by canonical URL. Records keep the *rewritten*
// module text so iframe-time work is zero-parse.

export interface ModuleRecord {
  url: string;
  /** final URL after redirects (jsdelivr may redirect canonical → commit hash) */
  resolvedUrl: string;
  /** module text with nested specifiers already rewritten to absolute URLs */
  text: string;
  contentType: string;
  bytes: number;
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
}

const DB_NAME = 'th-module-cache';
const DB_VERSION = 1;
const STORE = 'modules';

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openModuleDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise(resolve => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'url' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetAll(): Promise<ModuleRecord[]> {
  const db = await openModuleDb();
  if (!db) return [];
  try {
    return (await tx(db, 'readonly', s => s.getAll())) as ModuleRecord[];
  } catch {
    return [];
  }
}

export async function idbPut(rec: ModuleRecord): Promise<void> {
  const db = await openModuleDb();
  if (!db) return;
  try {
    await tx(db, 'readwrite', s => s.put(rec));
  } catch {
    // quota/CORS-edge failures — treat as cache miss, never fatal
  }
}

export async function idbDelete(url: string): Promise<void> {
  const db = await openModuleDb();
  if (!db) return;
  try {
    await tx(db, 'readwrite', s => s.delete(url));
  } catch {
    //
  }
}

export async function idbClear(): Promise<void> {
  const db = await openModuleDb();
  if (!db) return;
  try {
    await tx(db, 'readwrite', s => s.clear());
  } catch {
    //
  }
}
