import type { ReviewPaper } from "./review-types";
import { PAPER_LINK_CACHE_MS } from "./material-cache.ts";

export class ReviewPaperCache extends Map<string, ReviewPaper> {
  private rendered = new Map<string, { raw: ReviewPaper; paper: ReviewPaper; expires: number }>();
  private readonly now: () => number;
  constructor(now = () => Date.now()) { super(); this.now = now; }
  override set(id: string, paper: ReviewPaper): this { this.rendered.delete(id); return super.set(id, paper); }
  override delete(id: string): boolean { this.rendered.delete(id); return super.delete(id); }
  override clear(): void { this.rendered.clear(); super.clear(); }
  displayIsFresh(id: string): boolean {
    const item = this.rendered.get(id);
    return !!item && item.raw === this.get(id) && item.expires > this.now();
  }
  async raw(id: string, load: () => Promise<ReviewPaper>): Promise<ReviewPaper> {
    const cached = this.get(id);
    if (cached) return cached;
    const paper = await load();
    if (paper.id !== id || !Array.isArray(paper.questions) || !Array.isArray(paper.references)) throw Error("The requested paper does not match.");
    this.set(id, paper);
    return paper;
  }
  async display(id: string, load: () => Promise<ReviewPaper>, hydrate: (paper: ReviewPaper) => Promise<ReviewPaper>): Promise<ReviewPaper> {
    const raw = await this.raw(id, load);
    const cached = this.rendered.get(id);
    if (cached && cached.raw === raw && cached.expires > this.now()) return cached.paper;
    const startedAt = this.now(), paper = await hydrate(raw);
    if (this.get(id) !== raw) throw new DOMException("The paper changed while refreshing links.", "AbortError");
    this.rendered.set(id, { raw, paper, expires: startedAt + PAPER_LINK_CACHE_MS });
    return paper;
  }
}
