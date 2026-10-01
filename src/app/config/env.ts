import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  UPSTASH_REDIS_REST_URL: z.string().url('UPSTASH_REDIS_REST_URL must be a valid URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_CALLBACK_URL: z.string().url('GOOGLE_CALLBACK_URL must be a valid URL'),

  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),

  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  RESEND_FROM_EMAIL: z
    .string()
    .default('onboarding@resend.dev')
    .transform((value) => {
      const trimmed = value.trim();
      const wrapped = trimmed.match(/<([^>]+)>/);
      return (wrapped ? wrapped[1] : trimmed).trim();
    })
    .pipe(z.string().email()),

  // ── Email provider selection ─────────────────────────────────────────────────
  // EMAIL_PROVIDER=resend (default) | EMAIL_PROVIDER=gmail
  EMAIL_PROVIDER: z.enum(['resend', 'gmail']).default('resend'),

  // ── Gmail SMTP (required only when EMAIL_PROVIDER=gmail) ─────────────────────
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: z.string().default('true'),   // 'true' → TLS (port 465), 'false' → STARTTLS (port 587)
  SMTP_USER: z.string().optional(),          // Gmail address, e.g. yourapp@gmail.com
  SMTP_PASS: z.string().optional(),          // Gmail App Password (not your regular password)

  // ── Stripe (optional — server still starts without it) ───────────────────────
  // STRIPE_SECRET_KEY=sk_test_...   (never expose to browser)
  // STRIPE_PUBLISHABLE_KEY=pk_test_... (safe for browser, not required server-side)
  // STRIPE_WEBHOOK_SECRET=whsec_...  (from Stripe dashboard webhook settings)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  BKASH_BASE_URL: z.string().url('BKASH_BASE_URL must be a valid URL'),
  BKASH_USERNAME: z.string().min(1, 'BKASH_USERNAME is required'),
  BKASH_PASSWORD: z.string().min(1, 'BKASH_PASSWORD is required'),
  BKASH_APP_KEY: z.string().min(1, 'BKASH_APP_KEY is required'),
  BKASH_APP_SECRET: z.string().min(1, 'BKASH_APP_SECRET is required'),
  BKASH_CALLBACK_URL: z.string().url('BKASH_CALLBACK_URL must be a valid URL'),

  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL'),

  MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  const errors = parsed.error.flatten().fieldErrors;
  for (const [field, messages] of Object.entries(errors)) {
    console.error(`  ${field}: ${messages?.join(', ')}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
