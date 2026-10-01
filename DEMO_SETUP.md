# LogiFlow — Demo Setup Guide

Complete first-time setup guide for running the backend locally with a full demo environment.

---

## Prerequisites

- Node.js 20+
- npm
- PostgreSQL 14+ (or a hosted instance — Supabase, Neon, or Render Postgres all work)
- Upstash Redis account (free tier is fine)
- One of: Resend API key **or** a Gmail account with 2-Step Verification enabled

---

## 1. Clone and install

```bash
cd LogiFlow_Backend
npm install
```

---

## 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | ✅ | Min 32 chars, generate with `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | ✅ | Min 32 chars, different from access secret |
| `UPSTASH_REDIS_REST_URL` | ✅ | From Upstash dashboard |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | From Upstash dashboard |
| `RESEND_API_KEY` | ✅ (if using Resend) | From resend.com |
| `CLOUDINARY_CLOUD_NAME` | ✅ | From cloudinary.com |
| `CLOUDINARY_API_KEY` | ✅ | From cloudinary.com |
| `CLOUDINARY_API_SECRET` | ✅ | From cloudinary.com |
| `GOOGLE_CLIENT_ID` | ✅ | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | ✅ | From Google Cloud Console |
| `BKASH_*` | ✅ | From bKash sandbox portal |
| `FRONTEND_URL` | ✅ | e.g. `http://localhost:3000` |
| `STRIPE_SECRET_KEY` | Optional | Only needed to test Stripe payments |

---

## 3. Run database migrations

```bash
npm run db:migrate:prod
```

Or for development (creates migration history):
```bash
npm run db:migrate
```

---

## 4. Seed demo data

```bash
npm run db:seed
```

This creates a complete demo environment. It is **safe to rerun** — uses upserts throughout.

**What gets created:**
- 3 hubs (Dhaka, Cumilla, Chattogram)
- 5 delivery zones
- 13 users across all 5 roles
- 4 pricing rules
- 13 shipments in various lifecycle states
- Tracking events, payments, assignments, transfers, notifications, audit logs

---

## 5. Demo accounts

All demo accounts use the same password: **`Demo@LogiFlow2026`**

| Role | Email |
|---|---|
| ADMIN | admin@demo.logiflow.app |
| OPERATIONS_MANAGER | ops@demo.logiflow.app |
| HUB_MANAGER (Dhaka) | hub.dhaka@demo.logiflow.app |
| HUB_MANAGER (CTG) | hub.ctg@demo.logiflow.app |
| COURIER | courier1@demo.logiflow.app |
| COURIER | courier2@demo.logiflow.app |
| CUSTOMER | customer1@demo.logiflow.app |
| CUSTOMER | customer2@demo.logiflow.app |

All demo accounts have `isEmailVerified: true` — they bypass the OTP flow and can log in directly.

---

## 6. Demo tracking numbers (public tracking)

Test the public `/api/v1/tracking/:trackingNumber` endpoint without logging in:

| Tracking number | Status |
|---|---|
| `LF-20260901-DEMO0001` | CREATED (awaiting payment) |
| `LF-20260901-DEMO0002` | PICKUP_REQUESTED |
| `LF-20260901-DEMO0005` | IN_TRANSIT |
| `LF-20260901-DEMO0006` | AT_DESTINATION_HUB |
| `LF-20260901-DEMO0007` | OUT_FOR_DELIVERY |
| `LF-20260901-DEMO0008` | DELIVERED |
| `LF-20260901-DEMO0009` | DELIVERY_FAILED |

---

## 7. Start the development server

```bash
npm run dev
```

Server starts at `http://localhost:3000`.

Health check: `GET http://localhost:3000/health`

---

## 8. Email setup options

### Option A: Resend (recommended for development)

1. Sign up at [resend.com](https://resend.com)
2. Create an API key
3. Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY=re_...` in `.env`
4. Sandbox mode (`onboarding@resend.dev`) only delivers to your Resend account email

### Option B: Gmail SMTP

1. Enable 2-Step Verification on your Google account:
   Google Account → Security → 2-Step Verification
2. Create an App Password:
   Google Account → Security → 2-Step Verification → App passwords
   Select "Mail" and your device → generates a 16-char password
3. Set in `.env`:
   ```
   EMAIL_PROVIDER=gmail
   SMTP_USER=yourapp@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop   # 16-char App Password (spaces optional)
   ```
4. Gmail sending limits: ~500 emails/day on free accounts. Use Resend or SendGrid for production.

---

## 9. Stripe setup (optional)

### Test mode setup

1. Create a free account at [dashboard.stripe.com](https://dashboard.stripe.com)
2. Go to Developers → API keys → copy `sk_test_...` and `pk_test_...`
3. Set in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

### Webhook setup for local development

Install the Stripe CLI:
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Windows (scoop)
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe

# Or download from https://github.com/stripe/stripe-cli/releases
```

Login and forward webhooks to your local server:
```bash
stripe login
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook
```

Copy the webhook signing secret shown (starts with `whsec_`) and set:
```
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Production webhook setup

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-backend.onrender.com/api/v1/payments/stripe/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `checkout.session.expired`
4. Copy the signing secret to your production `STRIPE_WEBHOOK_SECRET`

### Test payment cards

| Card number | Result |
|---|---|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 9995` | Declined (insufficient funds) |
| `4000 0025 0000 3155` | Requires 3D Secure |

Use any future expiry, any CVC, any ZIP.

---

## 10. Reset and refresh demo data

The seed is idempotent — rerunning it updates passwords and statuses but does not delete unrelated data:

```bash
npm run db:seed
```

To clear demo data specifically (manual — the seed does not auto-delete):
```sql
-- Delete demo users (cascades to profiles, notifications, refresh tokens)
DELETE FROM users WHERE email LIKE '%@demo.logiflow.app';

-- Delete demo shipments (cascades to items, tracking events, payments, etc.)
DELETE FROM shipments WHERE tracking_number LIKE 'LF-20260901-DEMO%';
```

Then re-seed:
```bash
npm run db:seed
```

---

## 11. Deployment (Render)

The `render.yaml` in the root configures the Render web service.

Required environment variables to set in Render dashboard (sync: false):
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `EMAIL_PROVIDER` + relevant SMTP or Resend keys
- `BKASH_*` variables
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (if using Stripe)
- `FRONTEND_URL` — must match your deployed Vercel frontend URL (for CORS)

After deploying, seed the database:
```bash
# Using Render shell or a local connection to the production DB
NODE_ENV=development npm run db:seed
```
