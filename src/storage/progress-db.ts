import type { ProgressRecord } from "../domain/progress.ts";

const DATABASE_NAME = "ai-anim-rank";
const DATABASE_VERSION = 1;
const STORE_NAME = "private-progress";

export class ProgressRepository {
  private readonly indexedDb: IDBFactory | undefined;

  constructor(indexedDb: IDBFactory | undefined = globalThis.indexedDB) {
    this.indexedDb = indexedDb;
  }

  async loadAll(): Promise<ProgressRecord[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const records = await requestResult(request);
    await transactionComplete(transaction);
    database.close();
    return records as ProgressRecord[];
  }

  async save(record: ProgressRecord): Promise<void> {
    await this.write((store) => store.put(record));
  }

  async replaceAll(records: readonly ProgressRecord[]): Promise<void> {
    await this.write((store) => {
      store.clear();
      for (const record of records) {
        store.put(record);
      }
    });
  }

  async clear(): Promise<void> {
    await this.write((store) => store.clear());
  }

  private async write(operation: (store: IDBObjectStore) => void): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    operation(transaction.objectStore(STORE_NAME));
    await transactionComplete(transaction);
    database.close();
  }

  private open(): Promise<IDBDatabase> {
    const indexedDb = this.indexedDb;
    if (!indexedDb) {
      return Promise.reject(new Error("IndexedDB is unavailable in this environment"));
    }

    return new Promise((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "workId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}
