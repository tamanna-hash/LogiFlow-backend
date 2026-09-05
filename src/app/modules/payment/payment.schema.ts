import { z } from 'zod';

export const initiatePaymentSchema = z.object({
  shipmentId: z.string().cuid('Invalid shipment ID'),
});
