/**
 * Minimal key-value storage the save repository needs. `putAll` must be atomic: either every
 * entry is written or none is, so rotating the backup and writing the new save cannot half-apply.
 */
export interface SaveStore {
  get(key: string): Promise<unknown>;
  getAll?(): Promise<unknown[]>;
  putAll(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store for tests and for browsers without IndexedDB (private modes). */
export class MemorySaveStore implements SaveStore {
  private readonly values = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }
  async getAll(): Promise<unknown[]> {
    return structuredClone([...this.values.values()]);
  }
  async putAll(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> {
    const cloned = entries.map(([key, value]) => [key, structuredClone(value)] as const);
    for (const [key, value] of cloned) this.values.set(key, value);
  }
  async clear(): Promise<void> {
    this.values.clear();
  }
}

/** IndexedDB store. Database and object store names are unchanged from the first web slice. */
export class IndexedDbSaveStore implements SaveStore {
  constructor(
    private readonly database = "vqsv-web-native",
    private readonly store = "saves",
  ) {}

  async get(key: string): Promise<unknown> {
    return this.run("readonly", (store) => store.get(key));
  }
  async getAll(): Promise<unknown[]> {
    return (await this.run("readonly", (store) => store.getAll())) as unknown[];
  }

  async putAll(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> {
    await this.run("readwrite", (store) => {
      let last: IDBRequest | undefined;
      for (const [key, value] of entries) last = store.put(value, key);
      return last;
    });
  }

  async clear(): Promise<void> {
    await this.run("readwrite", (store) => store.clear());
  }

  private async run(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest | undefined,
  ): Promise<unknown> {
    const db = await this.open();
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = db.transaction(this.store, mode),
          request = body(transaction.objectStore(this.store));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("save transaction aborted"));
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("save transaction failed"));
      });
    } finally {
      db.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
