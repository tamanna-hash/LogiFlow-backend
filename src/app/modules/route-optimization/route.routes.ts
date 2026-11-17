import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import {
  optimizeRouteQuerySchema,
  createRouteSchema,
  updateRouteSchema,
  shipmentIdParamSchema,
} from './route.schema';
import * as controller from './route.controller';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

/**
 * GET /api/v1/routes/optimize?fromHubId=X&toHubId=Y
 * Find the lowest-cost route between two hubs.
 * Auth: OPERATIONS_MANAGER, HUB_MANAGER, ADMIN
 */
router.get(
  '/optimize',
  authorize('OPERATIONS_MANAGER', 'HUB_MANAGER', 'ADMIN'),
  validateRequest({ query: optimizeRouteQuerySchema }),
  controller.optimize,
);

/**
 * GET /api/v1/routes/shipments/:shipmentId/optimized-route
 * Find the optimal route for a specific shipment based on its origin/destination hubs.
 * Auth: OPERATIONS_MANAGER, HUB_MANAGER, ADMIN
 * Hub scoping enforced inside the service for HUB_MANAGER.
 */
router.get(
  '/shipments/:shipmentId/optimized-route',
  authorize('OPERATIONS_MANAGER', 'HUB_MANAGER', 'ADMIN'),
  validateRequest({ params: shipmentIdParamSchema }),
  controller.optimizeForShipment,
);

/**
 * GET /api/v1/routes
 * List all hub routes (paginated). ADMIN only.
 */
router.get(
  '/',
  authorize('ADMIN'),
  controller.listRoutes,
);

/**
 * POST /api/v1/routes
 * Create a new hub route. ADMIN only.
 */
router.post(
  '/',
  authorize('ADMIN'),
  validateRequest({ body: createRouteSchema }),
  controller.createRoute,
);

/**
 * PATCH /api/v1/routes/:id
 * Update route cost or active status. ADMIN only.
 */
router.patch(
  '/:id',
  authorize('ADMIN'),
  validateRequest({ params: idParam, body: updateRouteSchema }),
  controller.updateRoute,
);

/**
 * DELETE /api/v1/routes/:id
 * Delete a route. ADMIN only.
 */
router.delete(
  '/:id',
  authorize('ADMIN'),
  validateRequest({ params: idParam }),
  controller.deleteRoute,
);

export default router;
