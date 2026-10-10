export class BoundedMathCache<T> {
  private values = new Map<string, { value: T; cost: number }>();
  private cost = 0;
  constructor(
    private readonly maxEntries: number,
    private readonly maxCost: number,
  ) {}
  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, cost: number): void {
    const old = this.values.get(key);
    if (old) {
      this.values.delete(key);
      this.cost -= old.cost;
    }
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > this.maxCost) return;
    this.values.set(key, { value, cost });
    this.cost += cost;
    while (this.values.size > this.maxEntries || this.cost > this.maxCost) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.cost -= this.values.get(oldest)!.cost;
      this.values.delete(oldest);
    }
  }
  snapshot(): { entries: number; cost: number } {
    return { entries: this.values.size, cost: this.cost };
  }
}
