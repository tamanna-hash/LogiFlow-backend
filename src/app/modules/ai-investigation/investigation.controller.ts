import type { Request, Response } from 'express';
import { sendCreated } from '../../utils/response';
import { investigateShipment } from './investigation.service';
import type { InvestigateRequest, InvestigationRole } from './investigation.schema';
import type { ShipmentIdParam } from '../shipment-risk/risk.schema';

/**
 * POST /api/v1/ai/shipments/:shipmentId/investigate
 * Trigger an AI investigation for a shipment.
 *
 * Access control:
 *  - authenticate (via router.use)
 *  - authorize (OPERATIONS_MANAGER, HUB_MANAGER, ADMIN — via route definition)
 *  - hub-level scoping enforced inside investigation.service → context builder
 */
export async function investigate(req: Request, res: Response): Promise<void> {
  const { shipmentId } = req.params as unknown as ShipmentIdParam;
  const { question }   = req.body as InvestigateRequest;
  const role   = req.user!.role as InvestigationRole;
  const hubId  = req.user!.hubId ?? null;

  const report = await investigateShipment(shipmentId, question, role, hubId);
  sendCreated(res, report, 'Investigation complete.');
}
