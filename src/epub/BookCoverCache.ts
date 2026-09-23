/** Device-local cover cache; never writes to the Vault or reads book contents. */
const DATABASE_NAME = "yh-inklight-local-v1";
const STORE_NAME = "book-covers";
const MAX_COVERS = 100;
const MAX_BYTES = 32 * 1024 * 1024;
const SAFE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"]);

export interface CoverRecord {
  key: string;
  sourceMtime: number;
  mime: string;
  blob: Blob;
  byteSize: number;
  lastAccess: number;
}

export function coverCacheKey(vaultKey: string, path: string): string {
  return `${encodeURIComponent(vaultKey)}:${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

export function coverIsUsable(record: CoverRecord, sourceMtime: number): boolean {
  return record.sourceMtime === sourceMtime
    && SAFE_IMAGE_MIMES.has(record.mime)
    && record.blob instanceof Blob
    && record.byteSize === record.blob.size
    && record.byteSize > 0
    && record.byteSize <= MAX_BYTES;
}

export function coverEvictions(records: readonly CoverRecord[]): string[] {
  const ordered = [...records].sort((a, b) => a.lastAccess - b.lastAccess || a.key.localeCompare(b.key));
  const evicted: string[] = [];
  let bytes = ordered.reduce((total, record) => total + record.byteSize, 0);
  while (ordered.length > MAX_COVERS || bytes > MAX_BYTES) {
    const oldest = ordered.shift();
    if (!oldest) break;
    evicted.push(oldest.key);
    bytes -= oldest.byteSize;
  }
  return evicted;
}

export async function extractFoliateCover(book: { getCover?: () => Promise<Blob | null> | Blob | null } | null | undefined): Promise<Blob | null> {
  if (typeof book?.getCover !== "function") return null;
  try {
    const cover = await book.getCover();
    if (!(cover instanceof Blob) || cover.size === 0 || cover.size > MAX_BYTES) return null;
    if (SAFE_IMAGE_MIMES.has(cover.type.toLowerCase())) return cover;
    if (cover.type && cover.type.toLowerCase() !== "application/octet-stream") return null;
    const signature = new Uint8Array(await cover.slice(0, 16).arrayBuffer());
    const mime = detectBitmapMime(signature);
    return mime ? new Blob([cover], { type: mime }) : null;
  } catch (error) {
    console.warn("yh-inklight: book cover unavailable", error);
    return null;
  }
}

function detectBitmapMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, value: string) =>
    [...value].every((letter, index) => bytes[start + index] === letter.charCodeAt(0));
  if (bytes[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftypavif") || ascii(4, "ftypavis")) return "image/avif";
  if (ascii(0, "BM")) return "image/bmp";
  return null;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  void done.catch(() => undefined);
  return done;
}

export class BookCoverCache {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private warned = false;

  constructor(private readonly vaultKey: string, private readonly factory: IDBFactory | null) {}

  private async database(): Promise<IDBDatabase> {
    if (!this.factory) throw new Error("IndexedDB unavailable");
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.factory!.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB open blocked"));
      });
    }
    return this.databasePromise;
  }

  async put(path: string, sourceMtime: number, blob: Blob): Promise<boolean> {
    if (!Number.isFinite(sourceMtime) || !SAFE_IMAGE_MIMES.has(blob.type.toLowerCase())
      || blob.size === 0 || blob.size > MAX_BYTES) return false;
    try {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const record: CoverRecord = {
        key: coverCacheKey(this.vaultKey, path), sourceMtime, mime: blob.type.toLowerCase(),
        blob, byteSize: blob.size, lastAccess: Date.now(),
      };
      await requestResult(store.put(record));
      const all = await requestResult(store.getAll() as IDBRequest<CoverRecord[]>);
      for (const key of coverEvictions(all)) store.delete(key);
      await done;
      return true;
    } catch (error) {
      this.warn(error);
      return false;
    }
  }

  async getMany(files: readonly { path: string; mtime: number }[]): Promise<Map<string, Blob>> {
    const result = new Map<string, Blob>();
    if (files.length === 0) return result;
    try {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const all = await requestResult(store.getAll() as IDBRequest<CoverRecord[]>);
      const requested = new Map(files.map(({ path, mtime }) => [coverCacheKey(this.vaultKey, path), { path, mtime }]));
      const now = Date.now();
      for (const record of all) {
        const file = requested.get(record.key);
        if (!file) continue;
        if (!coverIsUsable(record, file.mtime)) {
          store.delete(record.key);
          continue;
        }
        result.set(file.path, record.blob);
        store.put({ ...record, lastAccess: now });
      }
      await done;
    } catch (error) {
      this.warn(error);
    }
    return result;
  }

  async remove(path: string): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).delete(coverCacheKey(this.vaultKey, path));
      await done;
    } catch (error) {
      this.warn(error);
    }
  }

  async removeUnder(folderPath: string): Promise<void> {
    try {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const prefix = `${coverCacheKey(this.vaultKey, folderPath).replace(/\/+$/, "")}/`;
      const keys = await requestResult(store.getAllKeys());
      for (const key of keys) {
        if (typeof key === "string" && key.startsWith(prefix)) store.delete(key);
      }
      await done;
    } catch (error) {
      this.warn(error);
    }
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    try { (await this.databasePromise).close(); } catch { /* already unavailable */ }
    this.databasePromise = null;
  }

  private warn(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn("yh-inklight: local cover cache unavailable; using placeholders", error);
  }
}
