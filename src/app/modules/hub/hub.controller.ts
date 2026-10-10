import { AuthorizationError } from '../../errors';
import { zoneQuerySchema, transferQuerySchema } from '../../utils/querySchemas';
import type { Request, Response } from 'express';
import * as hubService from './hub.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';

export async function createHub(req: Request, res: Response): Promise<void> {
  const hub = await hubService.createHub(req.body, req.user!.id);
  sendCreated(res, hub, 'Hub created');
}

export async function listHubs(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
  const search = req.query.search as string | undefined;
  const hubId = req.user!.role === 'HUB_MANAGER' ? req.user!.hubId ?? undefined : undefined;
  const { hubs, meta } = await hubService.listHubs({ page, limit, isActive, search, hubId });
  sendSuccess(res, hubs, 'Hubs fetched', 200, meta);
}

export async function getHub(req: Request, res: Response): Promise<void> {
  if (req.user!.role === 'HUB_MANAGER' && req.user!.hubId !== String(req.params.id)) throw new AuthorizationError();
  const hub = await hubService.getHubById(String(req.params.id));
  sendSuccess(res, hub, 'Hub fetched');
}

export async function updateHub(req: Request, res: Response): Promise<void> {
  const hub = await hubService.updateHub(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, hub, 'Hub updated');
}

export async function deactivateHub(req: Request, res: Response): Promise<void> {
  await hubService.deactivateHub(String(req.params.id), req.user!.id);
  sendSuccess(res, null, 'Hub deactivated');
}

export async function createTransfer(req: Request, res: Response): Promise<void> {
  const transfer = await hubService.createHubTransfer(
    String(req.params.hubId), req.body, req.user!.id, req.user!.role, req.user!.hubId,
  );
  sendCreated(res, transfer, 'Hub transfer created');
}

export async function confirmArrival(req: Request, res: Response): Promise<void> {
  await hubService.confirmHubTransferArrival(
    String(req.params.hubId), String(req.params.transferId), req.user!.id, req.user!.role, req.user!.hubId,
  );
  sendSuccess(res, null, 'Arrival confirmed');
}

export async function createZone(req: Request, res: Response): Promise<void> {
  const zone = await hubService.createZone(req.body, req.user!.id);
  sendCreated(res, zone, 'Zone created');
}

export async function listZones(req: Request, res: Response): Promise<void> {
  const { page, limit, hubId, isActive: requestedActive } = zoneQuerySchema.parse(req.query);
  const isActive = req.user!.role === 'CUSTOMER' ? true : requestedActive;
  const { zones, meta } = await hubService.listZones({ hubId, isActive, page, limit });
  sendSuccess(res, zones, 'Zones fetched', 200, meta);
}

export async function updateZone(req: Request, res: Response): Promise<void> {
  const zone = await hubService.updateZone(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, zone, 'Zone updated');
}

export async function deleteZone(req: Request, res: Response): Promise<void> {
  await hubService.deleteZone(String(req.params.id), req.user!.id);
  sendSuccess(res, null, 'Zone deactivated');
}

export async function destinations(req: Request, res: Response): Promise<void> {
 const { page, limit } = paginationSchema.parse(req.query);
 const { hubs, meta } = await hubService.listHubs({ page, limit, isActive: true });
 sendSuccess(res, hubs.map(h => ({ id: h.id, name: h.name, city: h.city })), 'Destination hubs fetched', 200, meta);
}
export async function listTransfers(req: Request, res: Response): Promise<void> {
 const hubId = String(req.params.hubId);
 if (req.user!.role === 'HUB_MANAGER' && req.user!.hubId !== hubId) throw new AuthorizationError();
 const { transfers, meta } = await hubService.listTransfers(hubId, transferQuerySchema.parse(req.query));
 sendSuccess(res, transfers, 'Transfers fetched', 200, meta);
}

// ── Hub Manager Assignment ────────────────────────────────────────────────────

export async function getHubManager(req: Request, res: Response): Promise<void> {
  const hub = await hubService.getHubWithManager(String(req.params.id));
  sendSuccess(res, hub, 'Hub manager fetched');
}

export async function assignHubManager(req: Request, res: Response): Promise<void> {
  const hub = await hubService.assignHubManager(
    String(req.params.id),
    req.body.userId,
    req.user!.id,
  );
  sendSuccess(res, hub, 'Hub Manager assigned successfully');
}

export async function removeHubManager(req: Request, res: Response): Promise<void> {
  await hubService.removeHubManager(String(req.params.id), req.body.userId, req.user!.id);
  sendSuccess(res, null, 'Hub Manager removed successfully');
}

export async function listUnassignedManagers(_req: Request, res: Response): Promise<void> {
  const managers = await hubService.listUnassignedHubManagers();
  sendSuccess(res, managers, 'Unassigned Hub Managers fetched');
}

// ── Courier Hub Assignment ────────────────────────────────────────────────────

export async function assignCourierHub(req: Request, res: Response): Promise<void> {
  await hubService.assignCourierHub(
    String(req.params.userId),
    req.body.hubId,    // null = unassign
    req.user!.id,
  );
  sendSuccess(res, null, req.body.hubId ? 'Courier assigned to hub' : 'Courier unassigned from hub');
}

export async function listHubCouriers(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const { couriers, meta } = await hubService.getCouriersByHub(String(req.params.id), { page, limit });
  sendSuccess(res, couriers, 'Hub couriers fetched', 200, meta);
}
