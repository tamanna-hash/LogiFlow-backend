import { Router } from 'express';
import { rateLimiter } from '../../lib/rateLimiter';
import { sendSuccess } from '../../utils/response';
import { getPublicTracking } from './tracking.service';

const router = Router();

router.get('/:trackingNumber',
  rateLimiter('publicTracking'),
  async (req, res, next) => {
    try {
      const data = await getPublicTracking(String(req.params.trackingNumber));
      sendSuccess(res, data, 'Tracking information fetched');
    } catch (err) {
      next(err);
    }
  },
);

export default router;
