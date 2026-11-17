/**
 * Binary Min-Heap Priority Queue
 *
 * A min-heap where the element with the smallest priority value is always at
 * the root. Used by Dijkstra's algorithm to efficiently extract the unvisited
 * node with the smallest known distance.
 *
 * Each entry is a [nodeId, priority] pair. When two entries have the same
 * priority, the insertion order breaks ties (FIFO within equal priority).
 *
 * Complexity:
 *   - insert:          O(log n)
 *   - extractMin:      O(log n)
 *   - peek:            O(1)
 *   - isEmpty:         O(1)
 *   - size:            O(1)
 *
 * Space: O(n) for n entries in the heap.
 */

export interface HeapEntry {
  nodeId: string;
  priority: number;
  /** Monotonic insertion counter for stable ordering within equal priority. */
  order: number;
}

export class MinHeap {
  private heap: HeapEntry[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /** Insert a node with the given priority into the heap. O(log n). */
  insert(nodeId: string, priority: number): void {
    const entry: HeapEntry = { nodeId, priority, order: this.counter++ };
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  /** Remove and return the entry with the smallest priority. O(log n). */
  extractMin(): HeapEntry | undefined {
    if (this.heap.length === 0) return undefined;

    const min = this.heap[0];
    const last = this.heap.pop()!;

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }

    return min;
  }

  /** Return the smallest entry without removing it. O(1). */
  peek(): HeapEntry | undefined {
    return this.heap[0];
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private parent(i: number): number {
    return Math.floor((i - 1) / 2);
  }

  private leftChild(i: number): number {
    return 2 * i + 1;
  }

  private rightChild(i: number): number {
    return 2 * i + 2;
  }

  /** Compare two entries: lower priority wins, ties broken by insertion order. */
  private isHigher(a: HeapEntry, b: HeapEntry): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.order < b.order;
  }

  private swap(i: number, j: number): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  /** Bubble up the element at index i until the heap property is restored. */
  private siftUp(i: number): void {
    while (i > 0) {
      const p = this.parent(i);
      if (this.isHigher(this.heap[i], this.heap[p])) {
        this.swap(i, p);
        i = p;
      } else {
        break;
      }
    }
  }

  /** Sink down the element at index i until the heap property is restored. */
  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const left = this.leftChild(i);
      const right = this.rightChild(i);
      let smallest = i;

      if (left < n && this.isHigher(this.heap[left], this.heap[smallest])) {
        smallest = left;
      }
      if (right < n && this.isHigher(this.heap[right], this.heap[smallest])) {
        smallest = right;
      }

      if (smallest !== i) {
        this.swap(i, smallest);
        i = smallest;
      } else {
        break;
      }
    }
  }
}
