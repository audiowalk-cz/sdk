export interface LocalStorageOptions {
  prefix?: string;
}

export class LocalStorage {
  constructor(private options: Partial<LocalStorageOptions> = {}) {}

  async get<T = unknown>(key: string, validate?: (value: unknown) => value is T): Promise<T | null> {
    const data = window.localStorage.getItem(this.getPrefixedKey(key));
    if (data === null) return null;

    const value = this.parseData(data);

    if (typeof validate === "function") {
      if (validate(value)) {
        return this.parseData(data) as T;
      } else {
        return null;
      }
    } else {
      return value as T;
    }
  }

  async set(key: string, value: any) {
    const data = JSON.stringify(value);
    return window.localStorage.setItem(this.getPrefixedKey(key), data);
  }

  private parseData(data: string): unknown {
    try {
      return JSON.parse(data);
    } catch (e) {
      return data;
    }
  }

  private getPrefixedKey(key: string) {
    const keyParts = ["audiowalk"];
    if (this.options.prefix) keyParts.push(this.options.prefix);

    keyParts.push(key);

    return keyParts.join("-");
  }
}
