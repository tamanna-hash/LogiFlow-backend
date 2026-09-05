import type { Request, Response } from 'express';
import * as paymentService from './payment.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import { env } from '../../config/env';

export async function initiatePayment(req: Request, res: Response): Promise<void> {
  const result = await paymentService.initiatePayment(req.body.shipmentId, req.user!.id);
  sendCreated(res, result, 'Payment initiated');
}

/**
 * bKash callback — browser redirect, not a JSON API.
 * Must always redirect (never return JSON) because bKash opens this in a browser.
 */
export async function bkashCallback(req: Request, res: Response): Promise<void> {
  const paymentID = req.query.paymentID as string;

  if (!paymentID) {
    res.redirect(`${env.FRONTEND_URL}/payment/failure?reason=missing_payment_id`);
    return;
  }

  try {
    const result = await paymentService.handleBkashCallback(paymentID);
    if (result.success) {
      res.redirect(`${env.FRONTEND_URL}/payment/success?paymentID=${paymentID}`);
    } else {
      res.redirect(`${env.FRONTEND_URL}/payment/failure?reason=${encodeURIComponent(result.message)}`);
    }
  } catch {
    res.redirect(`${env.FRONTEND_URL}/payment/failure?reason=processing_error`);
  }
}

export async function getPaymentByShipment(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user!.role === 'ADMIN';
  const payment = await paymentService.getPaymentByShipment(req.params.shipmentId, req.user!.id, isAdmin);
  sendSuccess(res, payment, 'Payment fetched');
}

export async function listPayments(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const { payments, meta } = await paymentService.listPayments({
    page, limit,
    status: req.query.status as string | undefined,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
    search: req.query.search as string | undefined,
  });
  sendSuccess(res, payments, 'Payments fetched', 200, meta);
}
