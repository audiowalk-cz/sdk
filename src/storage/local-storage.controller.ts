export interface LocalStorageOptions {
  prefix?: string;
}

export class LocalStorageController {
  private static readonly globalPrefix = "audiowalk";

  constructor(private options: Partial<LocalStorageOptions> = {}) {}

  static async clearAll(prefix?: string) {
    prefix = prefix ? `${LocalStorageController.globalPrefix}-${prefix}` : LocalStorageController.globalPrefix;
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        window.localStorage.removeItem(key);
      }
    }
  }

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

  async delete(key: string) {
    return window.localStorage.removeItem(this.getPrefixedKey(key));
  }

  private parseData(data: string): unknown {
    try {
      return JSON.parse(data);
    } catch (e) {
      return data;
    }
  }

  private getPrefixedKey(key: string) {
    const keyParts = [LocalStorageController.globalPrefix];
    if (this.options.prefix) keyParts.push(this.options.prefix);

    keyParts.push(key);

    return keyParts.join("-");
  }
}
