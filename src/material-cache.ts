// A rendered paper is refreshed sooner than a cached URL can approach expiry.
export const MATERIAL_URL_CACHE_MS = 25 * 60 * 1000;
export const PAPER_LINK_CACHE_MS = 20 * 60 * 1000;

export function materialKey(path: string): string {
  const key = path.replace(/^\//, "");
  if (!/^(data|sources)\/[A-Za-z0-9/_.-]+$/.test(key) || key.split("/").some(part => part === "." || part === ".." || !part)) {
    throw Error("Invalid material path");
  }
  return key;
}

export class MaterialUrlCache {
  private owner: string | null = null;
  private generation = 0;
  private values = new Map<string, { url: string; expires: number }>();
  private readonly sign: (key: string) => Promise<string>;
  private readonly now: () => number;
  constructor(sign: (key: string) => Promise<string>, now = () => Date.now()) { this.sign = sign; this.now = now; }
  clear() { this.generation++; this.owner = null; this.values.clear(); }
  setOwner(owner: string) {
    if (!owner) throw Error("A verified account is required.");
    if (this.owner !== owner) { this.clear(); this.owner = owner; }
  }
  async get(path: string): Promise<string> {
    const key = materialKey(path);
    if (!this.owner) throw Error("자료 연결을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.");
    const owner = this.owner, generation = this.generation;
    const cached = this.values.get(key);
    if (cached && cached.expires > this.now()) return cached.url;
    const startedAt = this.now();
    const url = await this.sign(key);
    if (owner !== this.owner || generation !== this.generation) {
      throw new DOMException("The signed-in account changed.", "AbortError");
    }
    this.values.set(key, { url, expires: startedAt + MATERIAL_URL_CACHE_MS });
    return url;
  }
}
