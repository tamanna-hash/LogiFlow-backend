/**
 * Dijkstra's Shortest Path Algorithm
 *
 * Finds the minimum-cost path from a source node to a destination node in a
 * weighted directed graph with non-negative edge weights.
 *
 * Uses a binary min-heap priority queue for efficient node extraction.
 *
 * Complexity:
 *   Time:  O((V + E) log V)  — each edge relaxed once, each extraction is O(log V)
 *   Space: O(V + E)           — adjacency list + distance map + predecessor map + heap
 *
 * Where V = number of vertices (hubs) and E = number of edges (routes).
 *
 * Properties:
 *   - Deterministic: identical input always produces identical output.
 *   - Independent of databases and HTTP — pure function.
 *   - Handles edge cases: source = destination, no path, disconnected graph,
 *     zero-cost edges, negative weight rejection.
 */

import { MinHeap } from './min-heap';

// ── Graph types ───────────────────────────────────────────────────────────────

export interface GraphEdge {
  to: string;
  cost: number;
  /** Human-readable label for the destination node (for display). */
  toLabel?: string;
}

export type AdjacencyList = Map<string, GraphEdge[]>;

export interface DijkstraResult {
  /** Ordered list of node IDs from source to destination (inclusive). */
  path: string[];
  /** Ordered list of human-readable labels matching the path nodes. */
  pathLabels: string[];
  /** Total cost of the shortest path. 0 if source = destination. */
  totalCost: number;
  /** Whether a valid path was found. */
  found: boolean;
  /** Individual segment details for each hop in the path. */
  segments: RouteSegment[];
  /** Number of nodes visited during the search. */
  nodesVisited: number;
}

export interface RouteSegment {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  cost: number;
}

// ── Error class for invalid input ────────────────────────────────────────────

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

// ── Core algorithm ────────────────────────────────────────────────────────────

/**
 * dijkstra — computes the shortest path from source to destination.
 *
 * @param graph      Adjacency list: Map<nodeId, GraphEdge[]>
 * @param labels     Map<nodeId, humanReadableLabel>
 * @param source     Starting node ID
 * @param destination Target node ID
 *
 * @throws GraphError if any edge has a negative cost.
 */
export function dijkstra(
  graph: AdjacencyList,
  labels: Map<string, string>,
  source: string,
  destination: string,
): DijkstraResult {
  // ── Validate: reject negative edge weights ────────────────────────────────
  // Dijkstra requires non-negative weights. Negative weights produce
  // incorrect results silently — so we reject them explicitly.
  for (const [from, edges] of graph) {
    for (const edge of edges) {
      if (edge.cost < 0) {
        throw new GraphError(
          `Negative edge weight (${edge.cost}) found on edge ${from} → ${edge.to}. ` +
          'Dijkstra requires non-negative weights.',
        );
      }
    }
  }

  // ── Edge case: source = destination ───────────────────────────────────────
  if (source === destination) {
    const label = labels.get(source) ?? source;
    return {
      path: [source],
      pathLabels: [label],
      totalCost: 0,
      found: true,
      segments: [],
      nodesVisited: 0,
    };
  }

  // ── Initialize ────────────────────────────────────────────────────────────
  const distances = new Map<string, number>();
  const predecessors = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const nodeId of graph.keys()) {
    distances.set(nodeId, Infinity);
    predecessors.set(nodeId, null);
  }
  // Source might not be in the graph (unknown hub) — handle gracefully
  if (!distances.has(source)) {
    return notFoundResult();
  }
  distances.set(source, 0);

  const heap = new MinHeap();
  heap.insert(source, 0);

  let nodesVisited = 0;

  // ── Main loop ──────────────────────────────────────────────────────────────
  while (!heap.isEmpty()) {
    const entry = heap.extractMin()!;

    // Skip already-visited nodes (stale entries from the heap)
    if (visited.has(entry.nodeId)) continue;
    visited.add(entry.nodeId);
    nodesVisited++;

    // Early exit: destination finalized
    if (entry.nodeId === destination) break;

    const currentDist = distances.get(entry.nodeId)!;
    const neighbors = graph.get(entry.nodeId) ?? [];

    // ── Relax edges ─────────────────────────────────────────────────────────
    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue;

      const newDist = currentDist + edge.cost;
      const knownDist = distances.get(edge.to);

      // If destination node is not in the graph at all, skip
      if (knownDist === undefined) continue;

      if (newDist < knownDist) {
        distances.set(edge.to, newDist);
        predecessors.set(edge.to, entry.nodeId);
        heap.insert(edge.to, newDist);
      }
    }
  }

  // ── Reconstruct path ───────────────────────────────────────────────────────
  const destDist = distances.get(destination);

  if (destDist === undefined || destDist === Infinity) {
    return notFoundResult();
  }

  const path: string[] = [];
  let current: string | null = destination;
  while (current !== null) {
    path.unshift(current);
    current = predecessors.get(current) ?? null;
  }

  // ── Build segments ────────────────────────────────────────────────────────
  const segments: RouteSegment[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    // Find the edge cost for this segment
    const edge = (graph.get(from) ?? []).find((e) => e.to === to);
    segments.push({
      from,
      to,
      fromLabel: labels.get(from) ?? from,
      toLabel: labels.get(to) ?? to,
      cost: edge?.cost ?? 0,
    });
  }

  const pathLabels = path.map((id) => labels.get(id) ?? id);

  return {
    path,
    pathLabels,
    totalCost: destDist,
    found: true,
    segments,
    nodesVisited,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function notFoundResult(): DijkstraResult {
  return {
    path: [],
    pathLabels: [],
    totalCost: Infinity,
    found: false,
    segments: [],
    nodesVisited: 0,
  };
}
