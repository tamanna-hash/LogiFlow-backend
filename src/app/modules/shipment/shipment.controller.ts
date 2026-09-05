import type { Request, Response } from 'express';
import * as shipmentService from './shipment.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { shipmentListQuerySchema } from './shipment.schema';
import type { Role } from '@prisma/client';

export async function createShipment(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const shipment = await shipmentService.createShipment(req.body, user.id, user.email, user.firstName);
  sendCreated(res, shipment, 'Shipment created');
}

export async function listShipments(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const params = shipmentListQuerySchema.parse(req.query);
  const { shipments, meta } = await shipmentService.listShipments(
    user.role as Role, user.id, user.hubId, params,
  );
  sendSuccess(res, shipments, 'Shipments fetched', 200, meta);
}

export async function getShipment(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const shipment = await shipmentService.getShipmentById(req.params.id, user.role as Role, user.id, user.hubId);
  sendSuccess(res, shipment, 'Shipment fetched');
}

export async function updateShipment(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const shipment = await shipmentService.updateShipment(req.params.id, req.body, user.role as Role, user.id);
  sendSuccess(res, shipment, 'Shipment updated');
}

export async function cancelShipment(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  await shipmentService.cancelShipment(req.params.id, req.body.reason, user.role as Role, user.id);
  sendSuccess(res, null, 'Shipment cancelled');
}

export async function requestPickup(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const pickup = await shipmentService.requestPickup(req.params.id, req.body, user.role as Role, user.id);
  sendCreated(res, pickup, 'Pickup requested');
}

export async function getTracking(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const events = await shipmentService.getShipmentTracking(req.params.id, user.role as Role, user.id, user.hubId);
  sendSuccess(res, events, 'Tracking events fetched');
}

export async function initiateReturn(req: Request, res: Response): Promise<void> {
  await shipmentService.initiateReturn(req.params.id, req.body.reason, req.user!.id);
  sendSuccess(res, null, 'Return initiated');
}
