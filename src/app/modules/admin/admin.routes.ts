import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { sendSuccess } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import { buildPaginationMeta } from '../../utils/pagination';
import { getSystemStats, getAuditLogList } from './admin.service';
import type { AuditAction } from '@prisma/client';

const router = Router();
router.use(authenticate);

router.get('/stats', authorize('ADMIN'), async (_req, res, next) => {
  try {
    const stats = await getSystemStats();
    sendSuccess(res, stats, 'Statistics fetched');
  } catch (err) { next(err); }
});

router.get('/audit-logs', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const { logs, total } = await getAuditLogList({
      page, limit,
      action: req.query.action as AuditAction | undefined,
      actorId: req.query.actorId as string | undefined,
      resourceType: req.query.resourceType as string | undefined,
      resourceId: req.query.resourceId as string | undefined,
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
    });
    sendSuccess(res, logs, 'Audit logs fetched', 200, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/audit-logs/operational', authorize('OPERATIONS_MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const { logs, total } = await getAuditLogList({
      page, limit,
      action: req.query.action as AuditAction | undefined,
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
      operationalOnly: true,
    });
    sendSuccess(res, logs, 'Operational audit logs fetched', 200, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

export default router;
