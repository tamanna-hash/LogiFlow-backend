import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import userRoutes from '../modules/user/user.routes';
import hubRoutes from '../modules/hub/hub.routes';
import zoneRoutes from '../modules/zone/zone.routes';
import pricingRoutes from '../modules/pricing/pricing.routes';
import shipmentRoutes from '../modules/shipment/shipment.routes';
import trackingRoutes from '../modules/tracking/tracking.routes';
import courierRoutes from '../modules/courier/courier.routes';
import operationsRoutes from '../modules/operations/operations.routes';
import paymentRoutes from '../modules/payment/payment.routes';
import notificationRoutes from '../modules/notification/notification.routes';
import adminRoutes from '../modules/admin/admin.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/hubs', hubRoutes);
router.use('/zones', zoneRoutes);
router.use('/pricing', pricingRoutes);
router.use('/shipments', shipmentRoutes);
router.use('/tracking', trackingRoutes);
router.use('/courier', courierRoutes);
router.use('/operations', operationsRoutes);
router.use('/payments', paymentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

export default router;
