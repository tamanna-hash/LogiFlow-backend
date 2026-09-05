import type { Request, Response } from 'express';
import * as hubService from './hub.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import { z } from 'zod';

export async function createHub(req: Request, res: Response): Promise<void> {
  const hub = await hubService.createHub(req.body, req.user!.id);
  sendCreated(res, hub, 'Hub created');
}

export async function listHubs(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
  const search = req.query.search as string | undefined;

  // HUB_MANAGER sees only their own hub
  const hubId = req.user!.role === 'HUB_MANAGER' ? req.user!.hubId ?? undefined : undefined;

  const { hubs, meta } = await hubService.listHubs({ page, limit, isActive, search, hubId });
  sendSuccess(res, hubs, 'Hubs fetched', 200, meta);
}

export async function getHub(req: Request, res: Response): Promise<void> {
  const hub = await hubService.getHubById(req.params.id);
  sendSuccess(res, hub, 'Hub fetched');
}

export async function updateHub(req: Request, res: Response): Promise<void> {
  const hub = await hubService.updateHub(req.params.id, req.body, req.user!.id);
  sendSuccess(res, hub, 'Hub updated');
}

export async function deactivateHub(req: Request, res: Response): Promise<void> {
  await hubService.deactivateHub(req.params.id, req.user!.id);
  sendSuccess(res, null, 'Hub deactivated');
}

export async function createTransfer(req: Request, res: Response): Promise<void> {
  const transfer = await hubService.createHubTransfer(
    req.params.hubId, req.body, req.user!.id, req.user!.role, req.user!.hubId,
  );
  sendCreated(res, transfer, 'Hub transfer created');
}

export async function confirmArrival(req: Request, res: Response): Promise<void> {
  await hubService.confirmHubTransferArrival(
    req.params.hubId, req.params.transferId, req.user!.id, req.user!.role, req.user!.hubId,
  );
  sendSuccess(res, null, 'Arrival confirmed');
}

// Zone controllers
export async function createZone(req: Request, res: Response): Promise<void> {
  const zone = await hubService.createZone(req.body, req.user!.id);
  sendCreated(res, zone, 'Zone created');
}

export async function listZones(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const hubId = req.query.hubId as string | undefined;
  const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
  const { zones, meta } = await hubService.listZones({ hubId, isActive, page, limit });
  sendSuccess(res, zones, 'Zones fetched', 200, meta);
}

export async function updateZone(req: Request, res: Response): Promise<void> {
  const zone = await hubService.updateZone(req.params.id, req.body, req.user!.id);
  sendSuccess(res, zone, 'Zone updated');
}

export async function deleteZone(req: Request, res: Response): Promise<void> {
  await hubService.deleteZone(req.params.id, req.user!.id);
  sendSuccess(res, null, 'Zone deactivated');
}
