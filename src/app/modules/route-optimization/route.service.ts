/**
 * Route Optimization Service
 *
 * Builds the hub network graph from the HubRoute table, runs Dijkstra's
 * algorithm, and returns a structured route optimization result.
 *
 * Also provides CRUD for HubRoute records (admin-only) and a convenience
 * method to get the optimized route for a specific shipment based on its
 * origin/destination zones.
 */

import { prisma } from '../../lib/prisma';
import { NotFoundError, BadRequestError, ConflictError } from '../../errors';
import { notDeleted } from '../../utils/notDeleted';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { dijkstra, type AdjacencyList, type GraphEdge } from './dijkstra';
import { createAuditLog } from '../audit/audit.service';
import type { CreateRouteInput, UpdateRouteInput } from './route.schema';

// ── Graph builder ─────────────────────────────────────────────────────────────

/**
 * buildHubGraph — loads all active hubs and active routes from the database
 * and constructs an adjacency list representation for Dijkstra.
 *
 * Only active, non-soft-deleted hubs and active routes are included.
 * Inactive hubs are excluded entirely (they won't appear as nodes).
 * Inactive routes are excluded (their edges are removed from the graph).
 */
export async function buildHubGraph(): Promise<{
  graph: AdjacencyList;
  labels: Map<string, string>;
}> {
  // Fetch active hubs — these become graph vertices
  const hubs = await prisma.hub.findMany({
    where: { isActive: true, ...notDeleted() },
    select: { id: true, name: true },
  });

  // Fetch active routes — these become directed edges
  const routes = await prisma.hubRoute.findMany({
    where: {
      isActive: true,
      fromHub: { isActive: true, ...notDeleted() },
      toHub:   { isActive: true, ...notDeleted() },
    },
    select: {
      fromHubId: true,
      toHubId:   true,
      cost:      true,
      fromHub:   { select: { name: true } },
      toHub:     { select: { name: true } },
    },
  });

  // Build adjacency list
  const graph: AdjacencyList = new Map();
  const labels = new Map<string, string>();

  // Initialize all hubs as nodes (even if they have no outgoing edges)
  for (const hub of hubs) {
    graph.set(hub.id, []);
    labels.set(hub.id, hub.name);
  }

  // Add edges
  for (const route of routes) {
    const edges = graph.get(route.fromHubId);
    if (edges) {
      const edge: GraphEdge = {
        to: route.toHubId,
        cost: route.cost,
        toLabel: route.toHub.name,
      };
      edges.push(edge);
    }
  }

  return { graph, labels };
}

// ── Route optimization ───────────────────────────────────────────────────────

export interface OptimizedRouteResult {
  fromHubId: string;
  toHubId: string;
  fromHubName: string;
  toHubName: string;
  path: string[];
  pathLabels: string[];
  totalCost: number;
  segments: {
    from: string;
    to: string;
    fromLabel: string;
    toLabel: string;
    cost: number;
  }[];
  found: boolean;
  algorithm: string;
  optimizedAt: string;
  costUnit: string;
}

/**
 * optimizeRoute — finds the shortest (lowest-cost) route between two hubs.
 *
 * Loads the hub graph, runs Dijkstra, and returns a structured result.
 * If no path exists, returns found: false.
 */
export async function optimizeRoute(fromHubId: string, toHubId: string): Promise<OptimizedRouteResult> {
  const { graph, labels } = await buildHubGraph();

  // Validate that both hubs exist and are active
  if (!graph.has(fromHubId)) {
    throw new NotFoundError('Source hub not found or inactive.');
  }
  if (!graph.has(toHubId)) {
    throw new NotFoundError('Destination hub not found or inactive.');
  }

  const result = dijkstra(graph, labels, fromHubId, toHubId);

  return {
    fromHubId,
    toHubId,
    fromHubName: labels.get(fromHubId) ?? fromHubId,
    toHubName: labels.get(toHubId) ?? toHubId,
    path: result.path,
    pathLabels: result.pathLabels,
    totalCost: result.found ? result.totalCost : 0,
    segments: result.segments,
    found: result.found,
    algorithm: "Dijkstra's shortest path (binary min-heap)",
    optimizedAt: new Date().toISOString(),
    costUnit: 'relative cost units',
  };
}

/**
 * optimizeRouteForShipment — determines the origin and destination hubs
 * from a shipment's zones, then optimizes the route between them.
 *
 * The origin hub comes from the shipment's origin zone, and the destination
 * hub comes from the destination zone. If they're the same hub, the route
 * is trivial (no transit needed).
 */
export async function optimizeRouteForShipment(
  shipmentId: string,
  role: string,
  hubId?: string | null,
): Promise<OptimizedRouteResult & { shipmentId: string; trackingNumber: string }> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: {
      id: true,
      trackingNumber: true,
      originZone:      { select: { hub: { select: { id: true, name: true } } } },
      destinationZone: { select: { hub: { select: { id: true, name: true } } } },
    },
  });

  if (!shipment) throw new NotFoundError('Shipment not found.');

  // Hub-level access check for HUB_MANAGER
  if (role === 'HUB_MANAGER' && hubId) {
    // HUB_MANAGER can only optimize routes for shipments they can see
    const shipment2 = await prisma.shipment.findUnique({
      where: { id: shipmentId, deletedAt: null },
      select: { currentHubId: true, originZone: { select: { hubId: true } } },
    });
    if (!shipment2) throw new NotFoundError('Shipment not found.');
    // Allow if the shipment is at their hub OR originates from their hub's zone
    if (shipment2.currentHubId !== hubId && shipment2.originZone?.hubId !== hubId) {
      throw new NotFoundError('Shipment not found.');
    }
  }

  const originHub = shipment.originZone?.hub;
  const destHub = shipment.destinationZone?.hub;

  if (!originHub) {
    throw new BadRequestError('Shipment has no origin hub (origin zone has no assigned hub).');
  }
  if (!destHub) {
    throw new BadRequestError('Shipment has no destination hub (destination zone has no assigned hub).');
  }

  // Same hub — no transit needed
  if (originHub.id === destHub.id) {
    return {
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      fromHubId: originHub.id,
      toHubId: destHub.id,
      fromHubName: originHub.name,
      toHubName: destHub.name,
      path: [originHub.id],
      pathLabels: [originHub.name],
      totalCost: 0,
      segments: [],
      found: true,
      algorithm: "Dijkstra's shortest path (binary min-heap)",
      optimizedAt: new Date().toISOString(),
      costUnit: 'relative cost units',
    };
  }

  const route = await optimizeRoute(originHub.id, destHub.id);
  return {
    ...route,
    shipmentId: shipment.id,
    trackingNumber: shipment.trackingNumber,
  };
}

// ── HubRoute CRUD (ADMIN only) ────────────────────────────────────────────────

export async function listRoutes(params: { page: number; limit: number; isActive?: boolean }) {
  const { page, limit, isActive } = params;
  const where = {
    ...(isActive !== undefined && { isActive }),
    fromHub: { ...notDeleted() },
    toHub:   { ...notDeleted() },
  };

  const [routes, total] = await Promise.all([
    prisma.hubRoute.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...getPrismaSkipTake(page, limit),
      select: {
        id: true, fromHubId: true, toHubId: true, cost: true, isActive: true,
        createdAt: true, updatedAt: true,
        fromHub: { select: { name: true, code: true } },
        toHub:   { select: { name: true, code: true } },
      },
    }),
    prisma.hubRoute.count({ where }),
  ]);

  return { routes, meta: buildPaginationMeta(total, page, limit) };
}

export async function createRoute(input: CreateRouteInput, actorId: string) {
  // Validate both hubs exist and are active
  const [fromHub, toHub] = await Promise.all([
    prisma.hub.findUnique({ where: { id: input.fromHubId, ...notDeleted() }, select: { id: true, name: true } }),
    prisma.hub.findUnique({ where: { id: input.toHubId, ...notDeleted() }, select: { id: true, name: true } }),
  ]);
  if (!fromHub) throw new NotFoundError('Source hub not found.');
  if (!toHub)   throw new NotFoundError('Destination hub not found.');

  // Check for duplicate directed edge
  const existing = await prisma.hubRoute.findUnique({
    where: { fromHubId_toHubId: { fromHubId: input.fromHubId, toHubId: input.toHubId } },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(`A route from ${fromHub.name} to ${toHub.name} already exists.`);
  }

  const route = await prisma.hubRoute.create({
    data: {
      fromHubId: input.fromHubId,
      toHubId: input.toHubId,
      cost: input.cost,
      isActive: input.isActive,
    },
    select: {
      id: true, fromHubId: true, toHubId: true, cost: true, isActive: true,
      createdAt: true,
      fromHub: { select: { name: true, code: true } },
      toHub:   { select: { name: true, code: true } },
    },
  });

  void createAuditLog({
    actorId,
    action: 'HUB_UPDATED',
    resourceType: 'HubRoute',
    resourceId: route.id,
    after: { fromHub: fromHub.name, toHub: toHub.name, cost: input.cost },
  });

  return route;
}

export async function updateRoute(routeId: string, input: UpdateRouteInput) {
  const existing = await prisma.hubRoute.findUnique({
    where: { id: routeId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Route not found.');

  return prisma.hubRoute.update({
    where: { id: routeId },
    data: {
      ...(input.cost !== undefined && { cost: input.cost }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    select: {
      id: true, fromHubId: true, toHubId: true, cost: true, isActive: true,
      updatedAt: true,
      fromHub: { select: { name: true, code: true } },
      toHub:   { select: { name: true, code: true } },
    },
  });
}

export async function deleteRoute(routeId: string) {
  const existing = await prisma.hubRoute.findUnique({
    where: { id: routeId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Route not found.');

  await prisma.hubRoute.delete({ where: { id: routeId } });
}
