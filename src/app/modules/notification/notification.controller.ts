import type { Request, Response } from 'express';
import * as notificationService from './notification.service';
import { sendSuccess } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import type { NotificationType } from '@prisma/client';

export async function getNotifications(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const isRead = req.query.isRead !== undefined ? req.query.isRead === 'true' : undefined;
  const type = req.query.type as NotificationType | undefined;
  const result = await notificationService.getUserNotifications(req.user!.id, { page, limit, isRead, type });
  sendSuccess(res, result.notifications, 'Notifications fetched', 200, result.meta);
}

export async function markRead(req: Request, res: Response): Promise<void> {
  await notificationService.markNotificationRead(String(req.params.id), req.user!.id);
  sendSuccess(res, null, 'Notification marked as read');
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  const count = await notificationService.markAllNotificationsRead(req.user!.id);
  sendSuccess(res, { updatedCount: count }, 'All notifications marked as read');
}
