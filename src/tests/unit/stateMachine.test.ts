import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  VALID_TRANSITIONS,
  TERMINAL_STATUSES,
  CUSTOMER_CANCELLABLE_STATUSES,
} from '../../app/types/enums';
import type { ShipmentStatus } from '../../../generated/prisma';

describe('State Machine — isValidTransition', () => {

  // ── Valid transitions ──────────────────────────────────────────────────────

  it('CREATED → PICKUP_REQUESTED is valid', () => {
    expect(isValidTransition('CREATED', 'PICKUP_REQUESTED')).toBe(true);
  });

  it('CREATED → CANCELLED is valid', () => {
    expect(isValidTransition('CREATED', 'CANCELLED')).toBe(true);
  });

  it('PICKUP_REQUESTED → ASSIGNED is valid', () => {
    expect(isValidTransition('PICKUP_REQUESTED', 'ASSIGNED')).toBe(true);
  });

  it('ASSIGNED → PICKED_UP is valid', () => {
    expect(isValidTransition('ASSIGNED', 'PICKED_UP')).toBe(true);
  });

  it('PICKED_UP → AT_ORIGIN_HUB is valid', () => {
    expect(isValidTransition('PICKED_UP', 'AT_ORIGIN_HUB')).toBe(true);
  });

  it('AT_ORIGIN_HUB → IN_TRANSIT is valid', () => {
    expect(isValidTransition('AT_ORIGIN_HUB', 'IN_TRANSIT')).toBe(true);
  });

  it('IN_TRANSIT → AT_DESTINATION_HUB is valid', () => {
    expect(isValidTransition('IN_TRANSIT', 'AT_DESTINATION_HUB')).toBe(true);
  });

  it('AT_DESTINATION_HUB → OUT_FOR_DELIVERY is valid', () => {
    expect(isValidTransition('AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY')).toBe(true);
  });

  it('OUT_FOR_DELIVERY → DELIVERED is valid', () => {
    expect(isValidTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
  });

  it('OUT_FOR_DELIVERY → DELIVERY_FAILED is valid', () => {
    expect(isValidTransition('OUT_FOR_DELIVERY', 'DELIVERY_FAILED')).toBe(true);
  });

  it('DELIVERY_FAILED → OUT_FOR_DELIVERY (retry) is valid', () => {
    expect(isValidTransition('DELIVERY_FAILED', 'OUT_FOR_DELIVERY')).toBe(true);
  });

  it('DELIVERY_FAILED → RETURN_INITIATED is valid', () => {
    expect(isValidTransition('DELIVERY_FAILED', 'RETURN_INITIATED')).toBe(true);
  });

  it('RETURN_INITIATED → RETURNING is valid', () => {
    expect(isValidTransition('RETURN_INITIATED', 'RETURNING')).toBe(true);
  });

  it('RETURNING → RETURNED is valid', () => {
    expect(isValidTransition('RETURNING', 'RETURNED')).toBe(true);
  });

  // ── Invalid transitions ────────────────────────────────────────────────────

  it('DELIVERED → any status is invalid (terminal state)', () => {
    const allStatuses = Object.keys(VALID_TRANSITIONS) as ShipmentStatus[];
    for (const s of allStatuses) {
      expect(isValidTransition('DELIVERED', s)).toBe(false);
    }
  });

  it('CANCELLED → any status is invalid (terminal state)', () => {
    const allStatuses = Object.keys(VALID_TRANSITIONS) as ShipmentStatus[];
    for (const s of allStatuses) {
      expect(isValidTransition('CANCELLED', s)).toBe(false);
    }
  });

  it('RETURNED → any status is invalid (terminal state)', () => {
    const allStatuses = Object.keys(VALID_TRANSITIONS) as ShipmentStatus[];
    for (const s of allStatuses) {
      expect(isValidTransition('RETURNED', s)).toBe(false);
    }
  });

  it('CREATED → DELIVERED is invalid (skipping states)', () => {
    expect(isValidTransition('CREATED', 'DELIVERED')).toBe(false);
  });

  it('CREATED → OUT_FOR_DELIVERY is invalid (skipping states)', () => {
    expect(isValidTransition('CREATED', 'OUT_FOR_DELIVERY')).toBe(false);
  });

  it('PICKED_UP → DELIVERED is invalid (skipping states)', () => {
    expect(isValidTransition('PICKED_UP', 'DELIVERED')).toBe(false);
  });

  it('AT_DESTINATION_HUB → DELIVERED is invalid', () => {
    expect(isValidTransition('AT_DESTINATION_HUB', 'DELIVERED')).toBe(false);
  });

  // ── Terminal states ────────────────────────────────────────────────────────

  it('terminal statuses are DELIVERED, CANCELLED, RETURNED', () => {
    expect(TERMINAL_STATUSES).toContain('DELIVERED');
    expect(TERMINAL_STATUSES).toContain('CANCELLED');
    expect(TERMINAL_STATUSES).toContain('RETURNED');
    expect(TERMINAL_STATUSES).toHaveLength(3);
  });

  // ── Customer cancellable states ────────────────────────────────────────────

  it('customer can cancel in CREATED and PICKUP_REQUESTED only', () => {
    expect(CUSTOMER_CANCELLABLE_STATUSES).toContain('CREATED');
    expect(CUSTOMER_CANCELLABLE_STATUSES).toContain('PICKUP_REQUESTED');
    expect(CUSTOMER_CANCELLABLE_STATUSES).not.toContain('ASSIGNED');
    expect(CUSTOMER_CANCELLABLE_STATUSES).not.toContain('PICKED_UP');
    expect(CUSTOMER_CANCELLABLE_STATUSES).not.toContain('DELIVERED');
  });
});
