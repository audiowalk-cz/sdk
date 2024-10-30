export interface LocalStorageOptions {
  prefix?: string;
}

export class LocalStorage {
  constructor(private options: Partial<LocalStorageOptions> = {}) {}

  async get(key: string) {
    return window.localStorage.getItem(this.getPrefixedKey(key));
  }

  async set(key: string, value: any) {
    return window.localStorage.setItem(this.getPrefixedKey(key), value);
  }

  private getPrefixedKey(key: string) {
    const keyParts = ["audiowalk"];
    if (this.options.prefix) keyParts.push(this.options.prefix);

    keyParts.push(key);

    return keyParts.join("-");
  }
}
