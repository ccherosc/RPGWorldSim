/**
 * Minimal binary min-heap.
 *
 * The scheduler is the hot path of the whole simulation, so this is a plain
 * array heap with no allocations per push/pop beyond the array growth itself.
 *
 * Heap array order is an implementation detail and is NOT stable across
 * equivalent logical states — two schedulers holding the same set of events can
 * have different internal arrays. Anything that serializes or hashes heap
 * contents must sort them first (see `Scheduler.save`).
 */
export class BinaryHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0] as T;
    const last = items.pop() as T;
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Unordered view of the contents. Callers must sort if order matters. */
  toArray(): readonly T[] {
    return this.items;
  }

  private siftUp(startIndex: number): void {
    const items = this.items;
    let index = startIndex;
    const item = items[index] as T;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = items[parentIndex] as T;
      if (this.compare(item, parent) >= 0) break;
      items[index] = parent;
      index = parentIndex;
    }
    items[index] = item;
  }

  private siftDown(startIndex: number): void {
    const items = this.items;
    const length = items.length;
    let index = startIndex;
    const item = items[index] as T;
    const half = length >> 1;
    while (index < half) {
      let childIndex = index * 2 + 1;
      const rightIndex = childIndex + 1;
      let child = items[childIndex] as T;
      if (rightIndex < length && this.compare(items[rightIndex] as T, child) < 0) {
        childIndex = rightIndex;
        child = items[rightIndex] as T;
      }
      if (this.compare(child, item) >= 0) break;
      items[index] = child;
      index = childIndex;
    }
    items[index] = item;
  }
}
