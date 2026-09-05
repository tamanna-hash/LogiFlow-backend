// Re-export Prisma enums for use throughout the application.
// This prevents importing directly from @prisma/client everywhere,
// making future ORM migrations easier.

export {
  Role,
  ShipmentStatus,
  PaymentStatus,
  DeliveryType,
  ParcelType,
  CourierAvailability,
  AssignmentStatus,
  AssignmentType,
  PickupRequestStatus,
  HubTransferStatus,
  DeliveryAttemptStatus,
  DeliveryFailureReason,
  NotificationType,
  AuditAction,
} from '@prisma/client';

// ── Allowed status transitions (state machine) ──────────────────────────────

import { type ShipmentStatus as SS } from '@prisma/client';

export const VALID_TRANSITIONS: Record<SS, SS[]> = {
  CREATED: ['PICKUP_REQUESTED', 'CANCELLED'],
  PICKUP_REQUESTED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'PICKUP_REQUESTED', 'CANCELLED'],
  PICKED_UP: ['AT_ORIGIN_HUB'],
  AT_ORIGIN_HUB: ['IN_TRANSIT'],
  IN_TRANSIT: ['AT_DESTINATION_HUB'],
  AT_DESTINATION_HUB: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERED: [],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'RETURN_INITIATED'],
  CANCELLED: [],
  RETURN_INITIATED: ['RETURNING'],
  RETURNING: ['RETURNED'],
  RETURNED: [],
};

export function isValidTransition(from: SS, to: SS): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// Terminal states — no further transitions allowed
export const TERMINAL_STATUSES: SS[] = ['DELIVERED', 'CANCELLED', 'RETURNED'];

// States in which a CUSTOMER can cancel their own shipment
export const CUSTOMER_CANCELLABLE_STATUSES: SS[] = ['CREATED', 'PICKUP_REQUESTED'];

// States in which a CUSTOMER can still edit shipment fields
export const CUSTOMER_EDITABLE_STATUSES: SS[] = ['CREATED'];

// States where courier assignment is allowed
export const ASSIGNABLE_STATUSES: SS[] = ['PICKUP_REQUESTED', 'AT_DESTINATION_HUB', 'RETURN_INITIATED'];
