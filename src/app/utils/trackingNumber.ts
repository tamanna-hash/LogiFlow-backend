import { prisma } from '../config/database';

/**
 * Generates a unique tracking number in format: LF-YYYYMMDD-XXXXXXXX
 * e.g. LF-20260905-A3F7B2C1
 * Checks DB for uniqueness and retries up to 5 times (statistically safe with 8 hex chars = 4 billion combos)
 */
export async function generateTrackingNumber(): Promise<string> {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.random().toString(16).substring(2, 10).toUpperCase().padEnd(8, '0');
    const trackingNumber = `LF-${datePart}-${randomPart}`;

    const existing = await prisma.shipment.findUnique({
      where: { trackingNumber },
      select: { id: true },
    });

    if (!existing) return trackingNumber;
  }

  throw new Error('Failed to generate unique tracking number after maximum attempts');
}
