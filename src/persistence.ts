import { GameModel } from './model.ts';

export const SAVE_KEY = 'voidforge.save.v1';
const BACKUP_KEY = 'voidforge.save.backup', STAMP_KEY = 'voidforge.save.at';
const DB_NAME = 'voidforge', DB_STORE = 'saves', DB_CURRENT = 'current', DB_BACKUP = 'backup';
export const SAVE_FAILED = 'Save failed: browser storage is unavailable or full. Export a save file instead.';

/** A stored save with the time it was written, so the newer of two copies can be chosen. */
export type SaveRecord = { at: number; text: string };
/** Small synchronous storage (localStorage): survives a closing tab, but holds only about 5 MB. */
export type SmallStore = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
/** Large asynchronous storage (IndexedDB): room for long-played worlds. */
export type LargeStore = { get(key: string): Promise<SaveRecord | undefined>; put(key: string, record: SaveRecord): Promise<void> };
export type SaveStores = { small?: SmallStore; large?: LargeStore };

/**
 * Save text with non-integer numbers kept to four decimals. Positions, velocities and asteroid outlines
 * otherwise carry 17 digits each, which roughly doubles the size of a save for no visible difference.
 * Integers (ids, seeds, RNG state, counts) are untouched.
 */
export const saveText = (model: GameModel) => JSON.stringify(model.toSave(), (_key, value) => typeof value === 'number' && !Number.isInteger(value) && Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value);

function browserSmall(): SmallStore | undefined {
  try { const storage = globalThis.localStorage; if (!storage) return; return { get: key => storage.getItem(key), set: (key, value) => storage.setItem(key, value), remove: key => storage.removeItem(key) }; }
  catch { return; }
}
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(DB_STORE); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('blocked'));
  });
  database.catch(() => { database = undefined; });
  return database;
}
function browserLarge(): LargeStore | undefined {
  try { if (typeof indexedDB === 'undefined') return; } catch { return; }
  const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) => openDatabase().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, mode), request = work(transaction.objectStore(DB_STORE));
    transaction.oncomplete = () => resolve(request.result); transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error);
  }));
  return { get: key => run<SaveRecord | undefined>('readonly', store => store.get(key)), put: (key, record) => run('readwrite', store => store.put(record, key)).then(() => undefined) };
}
let defaults: SaveStores | undefined;
const browserStores = () => defaults ??= { small: browserSmall(), large: browserLarge() };

function readSmall(small: SmallStore | undefined, key: string): SaveRecord | undefined {
  try { const text = small?.get(key); return text ? { at: Number(small!.get(STAMP_KEY)) || 0, text } : undefined; } catch { return; }
}
const readLarge = (large: LargeStore | undefined, key: string) => large ? large.get(key).catch(() => undefined) : Promise.resolve(undefined);
const valid = (record: SaveRecord | undefined): record is SaveRecord => Boolean(record && typeof record.text === 'string' && record.text);

/** Loads the newest valid save from either store. A copy that fails to parse falls back to the other one. */
export async function loadSavedGame(stores: SaveStores = browserStores()): Promise<GameModel | null> {
  const copies = [readSmall(stores.small, SAVE_KEY), await readLarge(stores.large, DB_CURRENT)].filter(valid).sort((a, b) => b.at - a.at);
  for (const copy of copies) { try { return GameModel.fromSave(JSON.parse(copy.text)); } catch { /* try the other copy */ } }
  return null;
}

/**
 * Saves to both stores. The small store is written synchronously so a closing tab keeps its progress; when
 * the world has outgrown it, the large store alone holds the save and the older small copy is left as it was.
 * Returns an error straight away only when neither store can be used; a later failure of the large store is
 * reported through `onError` if the small store did not take the save either.
 */
export function saveGame(model: GameModel, onError?: (message: string) => void, stores: SaveStores = browserStores()): string | undefined {
  let text: string; try { text = saveText(model); } catch { return SAVE_FAILED; }
  const at = Date.now(); let small = false;
  try { if (stores.small) { stores.small.set(SAVE_KEY, text); stores.small.set(STAMP_KEY, String(at)); small = true; } } catch { small = false; }
  if (!stores.large) return small ? undefined : SAVE_FAILED;
  stores.large.put(DB_CURRENT, { at, text }).catch(() => { if (!small) onError?.(SAVE_FAILED); });
}

/** Keeps the current save as a backup before a new or imported world replaces it. */
export async function backupSavedGame(stores: SaveStores = browserStores()) {
  const copies = [readSmall(stores.small, SAVE_KEY), await readLarge(stores.large, DB_CURRENT)].filter(valid).sort((a, b) => b.at - a.at);
  if (!copies.length) return;
  if (stores.large) {
    // The backup now lives in the large store, so the older small-store backup only wastes scarce space.
    try { await stores.large.put(DB_BACKUP, copies[0]); try { stores.small?.remove(BACKUP_KEY); } catch { /* harmless */ } return; } catch { /* fall through to the small store */ }
  }
  try { stores.small?.set(BACKUP_KEY, copies[0].text); } catch { /* Export remains available. */ }
}
