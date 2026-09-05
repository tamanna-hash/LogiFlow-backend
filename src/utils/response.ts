import type { Response } from 'express';
import type { FieldError } from '../errors';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SuccessResponse<T = unknown> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorResponse {
  success: false;
  message: string;
  errors: FieldError[];
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Operation successful',
  statusCode = 200,
  meta?: PaginationMeta,
): Response {
  const body: SuccessResponse<T> = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T, message = 'Created successfully'): Response {
  return sendSuccess(res, data, message, 201);
}

export function sendError(
  res: Response,
  message: string,
  statusCode = 500,
  errors: FieldError[] = [],
): Response {
  const body: ErrorResponse = { success: false, message, errors };
  return res.status(statusCode).json(body);
}
