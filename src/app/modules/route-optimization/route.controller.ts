import type { Request, Response } from 'express';
import { sendSuccess, sendCreated } from '../../utils/response';
import * as routeService from './route.service';
import {
  optimizeRouteQuerySchema,
  createRouteSchema,
  updateRouteSchema,
  type ShipmentIdParam,
} from './route.schema';
import { paginationSchema } from '../../utils/pagination';

// ── Route optimization ────────────────────────────────────────────────────────

/**
 * GET /api/v1/routes/optimize?fromHubId=X&toHubId=Y
 */
export async function optimize(req: Request, res: Response): Promise<void> {
  const query = optimizeRouteQuerySchema.parse(req.query);
  const result = await routeService.optimizeRoute(query.fromHubId, query.toHubId);
  sendSuccess(res, result, result.found ? 'Optimal route found.' : 'No route found between the specified hubs.');
}

/**
 * GET /api/v1/routes/shipments/:shipmentId/optimized-route
 */
export async function optimizeForShipment(req: Request, res: Response): Promise<void> {
  const { shipmentId } = req.params as unknown as ShipmentIdParam;
  const role = req.user!.role;
  const hubId = req.user!.hubId ?? null;
  const result = await routeService.optimizeRouteForShipment(shipmentId, role, hubId);
  sendSuccess(res, result, result.found ? 'Optimal route found.' : 'No route found.');
}

// ── HubRoute management (ADMIN) ───────────────────────────────────────────────

/**
 * GET /api/v1/routes
 */
export async function listRoutes(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;
  const result = await routeService.listRoutes({ page, limit, isActive });
  sendSuccess(res, result.routes, 'Routes retrieved.', 200, result.meta);
}

/**
 * POST /api/v1/routes
 */
export async function createRoute(req: Request, res: Response): Promise<void> {
  const input = createRouteSchema.parse(req.body);
  const route = await routeService.createRoute(input, req.user!.id);
  sendCreated(res, route, 'Route created.');
}

/**
 * PATCH /api/v1/routes/:id
 */
export async function updateRoute(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as { id: string };
  const input = updateRouteSchema.parse(req.body);
  const route = await routeService.updateRoute(id, input);
  sendSuccess(res, route, 'Route updated.');
}

/**
 * DELETE /api/v1/routes/:id
 */
export async function deleteRoute(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as { id: string };
  await routeService.deleteRoute(id);
  sendSuccess(res, null, 'Route deleted.');
}
