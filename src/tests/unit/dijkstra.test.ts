/**
 * Unit tests for the Dijkstra algorithm and MinHeap
 *
 * The algorithm is a pure function — no mocks, no DB, no side effects.
 * Every test constructs a graph directly and asserts on the output.
 *
 * Test scenarios:
 *  1.  Basic shortest path (A → B → D, direct)
 *  2.  Multiple possible routes (indirect is cheaper)
 *  3.  Direct vs indirect route
 *  4.  Source equals destination
 *  5.  No available route
 *  6.  Disconnected graph
 *  7.  Duplicate edges (last one wins in adjacency list)
 *  8.  Zero-cost edge
 *  9.  Negative edge rejection
 * 10.  Path reconstruction correctness
 * 11.  Total cost correctness
 * 12.  Deterministic results for identical input
 * 13.  Min-heap basic operations
 * 14.  Min-heap ordering with equal priorities
 * 15.  Unknown source hub
 * 16.  Unknown destination hub
 */

import { describe, it, expect } from 'vitest';
import { MinHeap } from '../../app/modules/route-optimization/min-heap';
import { dijkstra, GraphError, type AdjacencyList } from '../../app/modules/route-optimization/dijkstra';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGraph(): AdjacencyList {
  return new Map();
}

function addEdge(graph: AdjacencyList, from: string, to: string, cost: number) {
  if (!graph.has(from)) graph.set(from, []);
  if (!graph.has(to) && !graph.get(to)) graph.set(to, graph.get(to) ?? []);
  graph.get(from)!.push({ to, cost });
  // Ensure destination exists as a node
  if (!graph.has(to)) graph.set(to, []);
}

function makeLabels(...hubs: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const h of hubs) labels.set(h, h);
  return labels;
}

// ── Dijkstra tests ────────────────────────────────────────────────────────────

describe('Dijkstra — basic shortest path', () => {
  it('scenario 1: finds direct path A → B → D', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 10);
    addEdge(graph, 'B', 'D', 5);
    addEdge(graph, 'A', 'D', 20);
    const labels = makeLabels('A', 'B', 'D');

    const result = dijkstra(graph, labels, 'A', 'D');

    expect(result.found).toBe(true);
    expect(result.path).toEqual(['A', 'B', 'D']);
    expect(result.totalCost).toBe(15);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].from).toBe('A');
    expect(result.segments[0].to).toBe('B');
    expect(result.segments[0].cost).toBe(10);
    expect(result.segments[1].cost).toBe(5);
  });
});

describe('Dijkstra — multiple possible routes', () => {
  it('scenario 2: indirect route A → C → B → D is cheaper than direct A → B → D', () => {
    // A → B: 10, A → C: 4, C → B: 2, B → D: 5, C → D: 12
    // A → B → D = 15, A → C → D = 16, A → C → B → D = 11 ← optimal
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 10);
    addEdge(graph, 'A', 'C', 4);
    addEdge(graph, 'C', 'B', 2);
    addEdge(graph, 'B', 'D', 5);
    addEdge(graph, 'C', 'D', 12);
    const labels = makeLabels('A', 'B', 'C', 'D');

    const result = dijkstra(graph, labels, 'A', 'D');

    expect(result.found).toBe(true);
    expect(result.path).toEqual(['A', 'C', 'B', 'D']);
    expect(result.totalCost).toBe(11);
  });

  it('scenario 3: direct route is used when it is cheaper than indirect', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'D', 3);
    addEdge(graph, 'A', 'B', 10);
    addEdge(graph, 'B', 'D', 5);
    const labels = makeLabels('A', 'B', 'D');

    const result = dijkstra(graph, labels, 'A', 'D');

    expect(result.found).toBe(true);
    expect(result.path).toEqual(['A', 'D']);
    expect(result.totalCost).toBe(3);
  });
});

describe('Dijkstra — edge cases', () => {
  it('scenario 4: source equals destination → path [source], cost 0', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 5);
    const labels = makeLabels('A', 'B');

    const result = dijkstra(graph, labels, 'A', 'A');

    expect(result.found).toBe(true);
    expect(result.path).toEqual(['A']);
    expect(result.totalCost).toBe(0);
    expect(result.segments).toHaveLength(0);
  });

  it('scenario 5: no available route → found false', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 5);
    addEdge(graph, 'C', 'D', 3);
    const labels = makeLabels('A', 'B', 'C', 'D');

    const result = dijkstra(graph, labels, 'A', 'D');

    expect(result.found).toBe(false);
    expect(result.path).toEqual([]);
    expect(result.totalCost).toBe(Infinity);
  });

  it('scenario 6: disconnected graph → found false for unreachable destination', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 5);
    // C is a node with no edges
    graph.set('C', []);
    const labels = makeLabels('A', 'B', 'C');

    const result = dijkstra(graph, labels, 'A', 'C');

    expect(result.found).toBe(false);
  });

  it('scenario 7: duplicate edges — algorithm handles gracefully', () => {
    const graph = makeGraph();
    // Two edges A → B with different costs
    graph.set('A', [
      { to: 'B', cost: 10 },
      { to: 'B', cost: 3 }, // cheaper duplicate
    ]);
    graph.set('B', []);
    const labels = makeLabels('A', 'B');

    const result = dijkstra(graph, labels, 'A', 'B');

    // Dijkstra relaxes both; the cheaper edge should determine the final distance
    expect(result.found).toBe(true);
    expect(result.path).toEqual(['A', 'B']);
    expect(result.totalCost).toBe(3);
  });

  it('scenario 8: zero-cost edge is valid and handled', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 0);
    addEdge(graph, 'B', 'C', 5);
    const labels = makeLabels('A', 'B', 'C');

    const result = dijkstra(graph, labels, 'A', 'C');

    expect(result.found).toBe(true);
    expect(result.path).toEqual(['A', 'B', 'C']);
    expect(result.totalCost).toBe(5);
  });

  it('scenario 9: negative edge weight → throws GraphError', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 5);
    addEdge(graph, 'B', 'C', -1); // negative weight
    const labels = makeLabels('A', 'B', 'C');

    expect(() => dijkstra(graph, labels, 'A', 'C')).toThrow(GraphError);
    expect(() => dijkstra(graph, labels, 'A', 'C')).toThrow(/negative/i);
  });
});

describe('Dijkstra — path reconstruction and cost', () => {
  it('scenario 10: path reconstruction is correct for multi-hop route', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 1);
    addEdge(graph, 'B', 'C', 1);
    addEdge(graph, 'C', 'D', 1);
    addEdge(graph, 'A', 'D', 10); // longer direct route
    const labels = makeLabels('A', 'B', 'C', 'D');

    const result = dijkstra(graph, labels, 'A', 'D');

    expect(result.path).toEqual(['A', 'B', 'C', 'D']);
    expect(result.pathLabels).toEqual(['A', 'B', 'C', 'D']);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0].from).toBe('A');
    expect(result.segments[2].to).toBe('D');
  });

  it('scenario 11: total cost is the sum of segment costs', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 3);
    addEdge(graph, 'B', 'C', 7);
    addEdge(graph, 'C', 'D', 2);
    const labels = makeLabels('A', 'B', 'C', 'D');

    const result = dijkstra(graph, labels, 'A', 'D');

    expect(result.totalCost).toBe(12);
    expect(result.segments.reduce((sum, s) => sum + s.cost, 0)).toBe(12);
  });

  it('scenario 12: identical input always produces identical output (determinism)', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 5);
    addEdge(graph, 'A', 'C', 4);
    addEdge(graph, 'C', 'B', 2);
    addEdge(graph, 'B', 'D', 5);
    const labels = makeLabels('A', 'B', 'C', 'D');

    const r1 = dijkstra(graph, labels, 'A', 'D');
    const r2 = dijkstra(graph, labels, 'A', 'D');
    const r3 = dijkstra(graph, labels, 'A', 'D');

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

describe('Dijkstra — unknown hubs', () => {
  it('scenario 15: unknown source hub → found false', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 5);
    const labels = makeLabels('A', 'B');

    const result = dijkstra(graph, labels, 'UNKNOWN', 'B');

    expect(result.found).toBe(false);
  });

  it('scenario 16: unknown destination hub → found false', () => {
    const graph = makeGraph();
    addEdge(graph, 'A', 'B', 5);
    const labels = makeLabels('A', 'B');

    const result = dijkstra(graph, labels, 'A', 'UNKNOWN');

    expect(result.found).toBe(false);
  });
});

// ── MinHeap tests ──────────────────────────────────────────────────────────────

describe('MinHeap — basic operations', () => {
  it('scenario 13: extractMin returns smallest priority first', () => {
    const heap = new MinHeap();
    heap.insert('C', 3);
    heap.insert('A', 1);
    heap.insert('B', 2);

    expect(heap.size).toBe(3);
    expect(heap.extractMin()?.nodeId).toBe('A');
    expect(heap.extractMin()?.nodeId).toBe('B');
    expect(heap.extractMin()?.nodeId).toBe('C');
    expect(heap.isEmpty()).toBe(true);
  });

  it('scenario 14: equal priorities are broken by insertion order (FIFO)', () => {
    const heap = new MinHeap();
    heap.insert('X', 5);
    heap.insert('Y', 5);
    heap.insert('Z', 5);

    // All have priority 5 — first inserted should come out first
    expect(heap.extractMin()?.nodeId).toBe('X');
    expect(heap.extractMin()?.nodeId).toBe('Y');
    expect(heap.extractMin()?.nodeId).toBe('Z');
  });

  it('handles single element', () => {
    const heap = new MinHeap();
    heap.insert('A', 0);

    expect(heap.isEmpty()).toBe(false);
    expect(heap.extractMin()?.nodeId).toBe('A');
    expect(heap.isEmpty()).toBe(true);
  });

  it('peek returns minimum without removing', () => {
    const heap = new MinHeap();
    heap.insert('B', 2);
    heap.insert('A', 1);

    expect(heap.peek()?.nodeId).toBe('A');
    expect(heap.size).toBe(2); // still there
  });

  it('empty heap returns undefined from extractMin', () => {
    const heap = new MinHeap();
    expect(heap.extractMin()).toBeUndefined();
  });
});
