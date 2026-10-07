import type { AssignmentType, ShipmentStatus } from '../../generated/prisma';
import type { PrismaTx } from '../types/prisma';
import { ConflictError, BadRequestError } from '../errors';

/** Claim the expected state inside the same transaction as its related writes. */
export async function claimShipment(tx: PrismaTx, id: string, status: ShipmentStatus) {
  const result = await tx.shipment.updateMany({
    where: { id, status, deletedAt: null }, data: { updatedAt: new Date() },
  });
  if (result.count !== 1) throw new ConflictError('Shipment changed. Refresh and try again.');
}

export function assignmentReversal(type: AssignmentType, status: ShipmentStatus): ShipmentStatus {
  const states: Record<AssignmentType, [ShipmentStatus, ShipmentStatus]> = {
    PICKUP: ['ASSIGNED', 'PICKUP_REQUESTED'],
    DELIVERY: ['OUT_FOR_DELIVERY', 'AT_DESTINATION_HUB'],
    RETURN: ['RETURNING', 'RETURN_INITIATED'],
  };
  const [expected, previous] = states[type];
  if (status !== expected) throw new BadRequestError('This assignment can no longer be reversed.');
  return previous;
}

export async function releaseCourier(tx: PrismaTx, id: string) {
  const active = await tx.courierAssignment.count({ where: { courierProfileId: id, status: 'ACTIVE' } });
  await tx.courierProfile.update({ where: { id }, data: { availability: active ? 'ON_DELIVERY' : 'AVAILABLE' } });
}
