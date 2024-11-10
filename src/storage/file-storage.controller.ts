export interface FileStorageControllerOptions {
  version: number;
  storeName: string;
}

export class FileStorageController {
  private db?: IDBDatabase;

  constructor(private readonly options: FileStorageControllerOptions) {}

  private async getDatabase(): Promise<IDBDatabase> {
    if (!this.db) this.db = await this.createDB();

    return this.db;
  }

  private async createDB(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const result = indexedDB.open("audio", this.options.version);
      result.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      result.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);

      result.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        db.createObjectStore(this.options.storeName);
      };
    });
  }

  async has(key: string): Promise<boolean> {
    return this.get(key).then((value) => value !== null);
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.getDatabase();
    return new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(this.options.storeName).objectStore(this.options.storeName).get(key);
      request.onsuccess = () => resolve((request.result as T) || null);
      request.onerror = () => reject();
    });
  }

  async put(key: string, value: any) {
    const db = await this.getDatabase();
    return new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(this.options.storeName, "readwrite")
        .objectStore(this.options.storeName)
        .put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  async delete(key: string) {
    const db = await this.getDatabase();
    return new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(this.options.storeName, "readwrite")
        .objectStore(this.options.storeName)
        .delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }

  async clear() {
    const db = await this.getDatabase();
    return new Promise<void>((resolve, reject) => {
      const request = db.transaction(this.options.storeName, "readwrite").objectStore(this.options.storeName).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  }
}
