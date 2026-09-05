import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import * as controller from './pricing.controller';
import { createPricingRuleSchema, updatePricingRuleSchema, calculatePriceSchema } from './pricing.schema';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

router.post('/rules', authorize('ADMIN'), validateRequest({ body: createPricingRuleSchema }), controller.createRule);
router.get('/rules', authorize('OPERATIONS_MANAGER', 'ADMIN'), controller.listRules);
router.patch('/rules/:id', authorize('ADMIN'), validateRequest({ params: idParam, body: updatePricingRuleSchema }), controller.updateRule);
router.delete('/rules/:id', authorize('ADMIN'), validateRequest({ params: idParam }), controller.deleteRule);
router.post('/calculate', authorize('CUSTOMER', 'OPERATIONS_MANAGER', 'ADMIN'), validateRequest({ body: calculatePriceSchema }), controller.calculatePrice);

export default router;
