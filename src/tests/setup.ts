import { vi } from 'vitest';

// Mock environment variables for tests — prevents real service connections
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/logiflow_test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_that_is_at_least_32_chars_long';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_that_is_at_least_32_chars_long';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock_redis_token';
process.env.GOOGLE_CLIENT_ID = 'mock_google_client_id';
process.env.GOOGLE_CLIENT_SECRET = 'mock_google_client_secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/v1/auth/google/callback';
process.env.CLOUDINARY_CLOUD_NAME = 'mock_cloud';
process.env.CLOUDINARY_API_KEY = 'mock_key';
process.env.CLOUDINARY_API_SECRET = 'mock_secret';
process.env.RESEND_API_KEY = 're_mock_key';
process.env.BKASH_BASE_URL = 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
process.env.BKASH_USERNAME = 'mock_bkash_user';
process.env.BKASH_PASSWORD = 'mock_bkash_pass';
process.env.BKASH_APP_KEY = 'mock_app_key';
process.env.BKASH_APP_SECRET = 'mock_app_secret';
process.env.BKASH_CALLBACK_URL = 'http://localhost:3000/api/v1/payments/bkash/callback';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.MAX_DELIVERY_ATTEMPTS = '3';

// Mock Prisma globally — all tests use mocked DB unless explicitly testing DB layer
vi.mock('../app/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    refreshToken: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    shipment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    payment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    courierProfile: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    courierAssignment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    hub: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    zone: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    pricingRule: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    notification: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    pickupRequest: { create: vi.fn(), updateMany: vi.fn() },
    shipmentTrackingEvent: { create: vi.fn(), findMany: vi.fn() },
    hubTransfer: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    deliveryAttempt: { create: vi.fn(), count: vi.fn() },
    customerProfile: { create: vi.fn(), upsert: vi.fn() },
    hubManagerProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

// Mock Redis
vi.mock('../app/lib/redis', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), ttl: vi.fn() },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  CacheKeys: {
    tracking: (n: string) => `tracking:${n}`,
    shipmentTracking: (id: string) => `shipment:tracking:${id}`,
    pricingCalc: (k: string) => `pricing:calc:${k}`,
    adminStats: () => 'admin:stats',
    bkashIdToken: () => 'bkash:idToken',
    bkashRefreshToken: () => 'bkash:refreshToken',
  },
}));

// Mock Resend
vi.mock('../app/lib/resend', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  shipmentCreatedEmail: vi.fn().mockReturnValue('<html>'),
  paymentConfirmedEmail: vi.fn().mockReturnValue('<html>'),
  courierAssignedEmail: vi.fn().mockReturnValue('<html>'),
  deliveredEmail: vi.fn().mockReturnValue('<html>'),
  deliveryFailedEmail: vi.fn().mockReturnValue('<html>'),
  outForDeliveryEmail: vi.fn().mockReturnValue('<html>'),
}));

// Mock Cloudinary
vi.mock('../app/lib/cloudinary', () => ({
  uploadToCloudinary: vi.fn().mockResolvedValue('https://res.cloudinary.com/mock/image.jpg'),
  deleteFromCloudinary: vi.fn().mockResolvedValue(undefined),
}));
