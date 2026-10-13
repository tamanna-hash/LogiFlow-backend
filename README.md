# 🚚 LogiFlow — Backend API

**LogiFlow** is Bangladesh's intelligent courier and logistics management platform. This is the backend REST API powering the entire platform — authentication, shipment lifecycle, payments, multi-hub logistics, courier management, real-time tracking, and admin operations.

![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Express](https://img.shields.io/badge/Express-4-black?logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma-blue?logo=postgresql)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🔗 Live Links

| Resource | URL |
|----------|-----|
| 🌐 **Live API** | [https://logiflow-backend-ai0r.onrender.com](https://logiflow-backend-ai0r.onrender.com) |
| ❤️ **Health Check** | [/health](https://logiflow-backend-ai0r.onrender.com/health) |
| 📖 **Postman Docs** | [Postman Collection](https://documenter.getpostman.com/view/49731960/2sBYAxPV15) |
| 💻 **Frontend** | [https://logiflow-hash.vercel.app](https://logiflow-hash.vercel.app) |
| 🐙 **GitHub** | [LogiFlow Backend](https://github.com/tamanna-hash/LogiFlow-backend) |

---

## 🛠️ Technology Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20 + TypeScript (strict) |
| **Framework** | Express 4 |
| **Database** | PostgreSQL + Prisma ORM |
| **Cache / Rate Limits** | Upstash Redis (HTTP-based) |
| **Authentication** | JWT HS256 — access + opaque refresh tokens |
| **OAuth** | Google OAuth 2.0 via Passport |
| **Email** | Resend (default) or Gmail SMTP via Nodemailer |
| **Payments** | bKash tokenized checkout + Stripe Checkout |
| **File Uploads** | Cloudinary |
| **Validation** | Zod |
| **Testing** | Vitest (107+ tests) |
| **Build** | tsup |
| **Linting** | ESLint + Biome |

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in all required variables (see Environment Variables section)

# Apply database migrations
npm run db:migrate:prod

# Seed demo data
npm run db:seed

# Start development server
npm run dev
```

API is available at `http://localhost:5000/api/v1`

---

## 📜 Available Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm test` | Run all unit tests |
| `npm run test:coverage` | Tests with coverage report |
| `npm run type-check` | TypeScript type check |
| `npm run lint` | ESLint + Biome lint |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Create + apply dev migration |
| `npm run db:migrate:prod` | Apply pending migrations (production-safe) |
| `npm run db:seed` | Seed demo data (idempotent) |
| `npm run db:studio` | Open Prisma Studio |

---

## ⚙️ Environment Variables

```env
# ── Application ──────────────────────────────────────
NODE_ENV=production
PORT=5000

# ── Database ─────────────────────────────────────────
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/logiflow?sslmode=require

# ── JWT ──────────────────────────────────────────────
JWT_ACCESS_SECRET=your_64_char_random_string
JWT_REFRESH_SECRET=your_other_64_char_random_string
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── Upstash Redis ─────────────────────────────────────
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_token

# ── Google OAuth ──────────────────────────────────────
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=https://logiflow-backend-ai0r.onrender.com/api/v1/auth/google/callback

# ── Email (Resend default) ────────────────────────────
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_your_api_key
RESEND_FROM_EMAIL=noreply@yourdomain.com

# ── Email (Gmail SMTP alternative) ───────────────────
# EMAIL_PROVIDER=gmail
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=465
# SMTP_SECURE=true
# SMTP_USER=yourapp@gmail.com
# SMTP_PASS=your_16_char_app_password

# ── Cloudinary ────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ── bKash ─────────────────────────────────────────────
BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta
BKASH_USERNAME=your_bkash_username
BKASH_PASSWORD=your_bkash_password
BKASH_APP_KEY=your_bkash_app_key
BKASH_APP_SECRET=your_bkash_app_secret
BKASH_CALLBACK_URL=https://logiflow-backend-ai0r.onrender.com/api/v1/payments/bkash/callback

# ── Stripe ────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_signing_secret

# ── Frontend ──────────────────────────────────────────
FRONTEND_URL=https://logiflow-hash.vercel.app

# ── Business Rules ────────────────────────────────────
MAX_DELIVERY_ATTEMPTS=3
```

---

## 📁 Project Structure

```
src/
├── app/
│   ├── config/
│   │   └── env.ts                # Zod-validated env config
│   │
│   ├── errors/
│   │   ├── AppError.ts           # Base error class
│   │   ├── HttpErrors.ts         # 400, 401, 403, 404, 409, 503...
│   │   └── index.ts
│   │
│   ├── lib/
│   │   ├── prisma.ts             # Prisma client singleton
│   │   ├── redis.ts              # Upstash Redis + CacheKeys
│   │   ├── jwt.ts                # signAccessToken, generateRefreshToken
│   │   ├── argon2.ts             # hashPassword, verifyPassword, hashToken
│   │   ├── mailer.ts             # sendEmail (Resend / Gmail)
│   │   ├── resend.ts             # Resend email templates
│   │   ├── nodemailer.ts         # Gmail SMTP transport
│   │   ├── cloudinary.ts         # Image upload helpers
│   │   ├── stripe.ts             # Stripe SDK wrapper (optional)
│   │   ├── googleAuth.ts         # Passport Google strategy
│   │   └── rateLimiter.ts        # Upstash Redis rate limiter
│   │
│   ├── middleware/
│   │   ├── checkAuth.ts          # JWT bearer / cookie auth
│   │   ├── validateRequest.ts    # Zod body/query/param validation
│   │   ├── globalErrorHandler.ts # Centralized error formatting
│   │   ├── notFound.ts           # 404 catch-all
│   │   └── demoGuard.ts          # Read-only enforcement for demo accounts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.routes.ts
│   │   │   └── auth.schema.ts
│   │   │
│   │   ├── user/
│   │   │   ├── user.controller.ts
│   │   │   ├── user.service.ts
│   │   │   ├── user.routes.ts
│   │   │   └── user.schema.ts
│   │   │
│   │   ├── shipment/
│   │   ├── courier/
│   │   ├── hub/
│   │   ├── payment/
│   │   ├── pricing/
│   │   ├── notification/
│   │   ├── operations/
│   │   └── audit/
│   │
│   ├── routes/
│   │   └── index.ts              # Mount all module routers
│   │
│   ├── types/
│   │   ├── index.ts              # Shared TypeScript types
│   │   ├── enums.ts              # Re-exports from Prisma
│   │   └── prisma.ts             # PrismaTx type
│   │
│   └── utils/
│       ├── response.ts           # sendSuccess, sendCreated helpers
│       └── pagination.ts         # Page/limit parsing
│
├── app.ts                        # Express app setup (CORS, middleware, routes)
├── server.ts                     # HTTP server entry point
│
├── tests/
│   ├── unit/                     # Vitest unit tests
│   └── setup.ts                  # Test setup + mocks
│
prisma/
├── schema/                       # Split Prisma schema files
│   ├── schema.prisma             # Generator + datasource
│   ├── user.prisma
│   ├── shipment.prisma
│   ├── payment.prisma
│   ├── hub.prisma
│   ├── assignment.prisma
│   ├── pricing.prisma
│   ├── notification.prisma
│   ├── audit.prisma
│   └── enums.prisma
├── migrations/                   # Migration history
└── seed.ts                       # Demo data seeder

scripts/
├── postgenerate.ts               # Post-generate Prisma hooks
└── fix-missing-profiles.ts       # Utility script
```

---

## 👥 Roles & Permissions

| Role | Description |
|------|-------------|
| `CUSTOMER` | Create shipments, pay, request pickup, track parcels |
| `COURIER` | Accept assignments, confirm pickup, record delivery |
| `HUB_MANAGER` | Manage shipments + transfers at their assigned hub |
| `OPERATIONS_MANAGER` | Cross-hub oversight, assign couriers, update statuses |
| `ADMIN` | Full platform access — users, hubs, pricing, analytics |

---

## 🔐 Authentication

**Scheme:** JWT Bearer token

```
Authorization: Bearer <access_token>
```

| Token | Expiry | Storage |
|-------|--------|---------|
| Access token | 15 minutes | Client localStorage |
| Refresh token | 7 days | DB (hashed with Argon2id) |

**Token refresh:** `POST /api/v1/auth/refresh` with `{ refreshToken }` in body  
**Logout:** `POST /api/v1/auth/logout` — revokes the provided refresh token  
**Password change:** revokes ALL refresh tokens (forces re-login on all devices)

---

## 📡 API Reference

### Base URLs
```
Development:  http://localhost:5000/api/v1
Production:   https://logiflow-backend-ai0r.onrender.com/api/v1
```

### Response Format
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... },
  "meta": { "page": 1, "limit": 10, "total": 100, "totalPages": 10 }
}
```

```json
{
  "success": false,
  "message": "Error description",
  "errors": [ { "field": "email", "message": "Invalid email" } ]
}
```

---

### 🔑 Authentication Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/register` | ❌ | Step 1: Send OTP to email |
| `POST` | `/auth/verify-email` | ❌ | Step 2: Verify OTP → create account + issue tokens |
| `POST` | `/auth/login` | ❌ | Login with email + password |
| `POST` | `/auth/refresh` | ❌ | Refresh access token |
| `POST` | `/auth/logout` | ✅ | Revoke refresh token |
| `GET` | `/auth/google` | ❌ | Initiate Google OAuth |
| `GET` | `/auth/google/callback` | ❌ | Google OAuth callback |
| `PATCH` | `/auth/change-password` | ✅ | Change password (authenticated) |
| `POST` | `/auth/set-password` | ✅ | Set password (Google-only users) |
| `POST` | `/auth/forgot-password` | ❌ | Request password reset email |
| `POST` | `/auth/reset-password` | ❌ | Reset password with token |

**Register — Step 1:**
```json
POST /auth/register
{
  "firstName": "Tamanna",
  "lastName": "Ahmed",
  "email": "tamanna@example.com",
  "password": "SecurePass123!",
  "phone": "+8801712345678"
}
```

**Verify Email — Step 2:**
```json
POST /auth/verify-email
{
  "email": "tamanna@example.com",
  "otp": "123456"
}
→ Returns: { user, accessToken, refreshToken }
```

**Login:**
```json
POST /auth/login
{
  "email": "tamanna@example.com",
  "password": "SecurePass123!"
}
→ Returns: { user, accessToken, refreshToken }
```

**Forgot Password:**
```json
POST /auth/forgot-password
{ "email": "tamanna@example.com" }
→ Always returns 200 (prevents email enumeration)
```

**Reset Password:**
```json
POST /auth/reset-password
{
  "token": "128-char-hex-from-email-link",
  "newPassword": "NewSecurePass456!"
}
```

---

### 👤 User Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `GET` | `/users/me` | ✅ | Any | Get own profile |
| `PATCH` | `/users/me` | ✅ | Any | Update profile + avatar upload |
| `GET` | `/users` | ✅ | ADMIN | List all users (paginated) |
| `GET` | `/users/:id` | ✅ | ADMIN | Get user by ID |
| `PATCH` | `/users/:id/role` | ✅ | ADMIN | Change user role |
| `PATCH` | `/users/:id/courier-hub` | ✅ | ADMIN | Assign courier to hub |
| `DELETE` | `/users/:id` | ✅ | ADMIN | Soft delete user |

---

### 📦 Shipment Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/shipments` | ✅ | CUSTOMER, ADMIN | Create shipment |
| `GET` | `/shipments` | ✅ | Any | List shipments (role-filtered) |
| `GET` | `/shipments/:id` | ✅ | Any | Get shipment details |
| `PATCH` | `/shipments/:id` | ✅ | CUSTOMER, ADMIN | Update shipment |
| `POST` | `/shipments/:id/cancel` | ✅ | CUSTOMER, OPS, ADMIN | Cancel shipment |
| `POST` | `/shipments/:id/pickup-request` | ✅ | CUSTOMER, ADMIN | Request courier pickup |
| `GET` | `/shipments/:id/tracking` | ✅ | Any | Get tracking history |
| `POST` | `/shipments/:id/return` | ✅ | OPS, ADMIN | Initiate return |

**Create Shipment:**
```json
POST /shipments
{
  "senderName": "Arif Hasan",
  "senderPhone": "+8801712345678",
  "senderAddress": "House 5, Road 12, Dhanmondi",
  "senderCity": "Dhaka",
  "originZoneId": "cm...",
  "recipientName": "Rubel Chowdhury",
  "recipientPhone": "+8801811234567",
  "recipientAddress": "Panchlaish, Chattogram",
  "recipientCity": "Chattogram",
  "destinationZoneId": "cm...",
  "deliveryType": "STANDARD",
  "parcelType": "REGULAR",
  "declaredWeightKg": 2.5
}
→ Returns: { id, trackingNumber: "LF-20261012-XXXXXXXX", status: "CREATED", price: 110 }
```

**Shipment Status Flow:**
```
CREATED → PICKUP_REQUESTED → ASSIGNED → PICKED_UP
    → AT_ORIGIN_HUB → IN_TRANSIT → AT_DESTINATION_HUB
    → OUT_FOR_DELIVERY → DELIVERED

On failure:
OUT_FOR_DELIVERY → DELIVERY_FAILED → (retry) → OUT_FOR_DELIVERY
                                   → (max attempts) → RETURN_INITIATED → RETURNING → RETURNED
```

---

### 🌐 Public Tracking

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/tracking/:trackingNumber` | ❌ | Track by tracking number |

```
GET /tracking/LF-20261012-DEMO0001
→ Returns timeline of shipment events, status, origin/destination
```

---

### 💳 Payment Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/payments/bkash/initiate` | ✅ | Initiate bKash payment → returns `bkashURL` |
| `GET` | `/payments/bkash/callback` | ❌ | bKash server callback (verify + update DB) |
| `POST` | `/payments/stripe/checkout` | ✅ | Create Stripe Checkout → returns `checkoutUrl` |
| `POST` | `/payments/stripe/verify/:shipmentId` | ✅ | Manually verify Stripe session |
| `POST` | `/payments/stripe/webhook` | ❌ | Stripe webhook (raw body, signature verified) |
| `GET` | `/payments/shipment/:shipmentId` | ✅ | Get payment for a shipment |
| `GET` | `/payments` | ✅ ADMIN | List all payments |

**bKash Flow:**
```
POST /payments/bkash/initiate { shipmentId }
→ { bkashURL } → redirect browser → bKash completes
→ GET /payments/bkash/callback (server-to-server)
→ Backend verifies with bKash executepayment API
→ Redirects to FRONTEND_URL/payment/success?shipmentId=...
```

**Stripe Flow:**
```
POST /payments/stripe/checkout { shipmentId }
→ { checkoutUrl } → redirect browser → Stripe Checkout
→ POST /payments/stripe/webhook (Stripe → backend)
→ Backend verifies signature → updates DB
→ Redirects to FRONTEND_URL/payment/success?shipmentId=...
```

---

### 🛵 Courier Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/courier/assignments` | ✅ COURIER | List own assignments |
| `GET` | `/courier/assignments/:id` | ✅ COURIER | Get assignment details |
| `PATCH` | `/courier/assignments/:id/accept` | ✅ COURIER | Accept assignment |
| `PATCH` | `/courier/assignments/:id/reject` | ✅ COURIER | Reject assignment |
| `PATCH` | `/courier/availability` | ✅ COURIER | Update availability status |
| `POST` | `/courier/shipments/:id/pickup-confirm` | ✅ COURIER | Confirm parcel pickup |
| `POST` | `/courier/shipments/:id/deliver` | ✅ COURIER | Record delivery (+ proof image) |
| `POST` | `/courier/shipments/:id/delivery-failed` | ✅ COURIER | Record delivery failure |
| `GET` | `/courier/earnings` | ✅ COURIER | View earnings summary |

---

### 🏢 Hub Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `GET` | `/hubs/destinations` | ✅ | HUB_MGR, OPS, ADMIN | Get all active hubs |
| `GET` | `/hubs/unassigned-managers` | ✅ | ADMIN | Users with HUB_MANAGER role, not yet assigned |
| `POST` | `/hubs` | ✅ | ADMIN | Create hub |
| `GET` | `/hubs` | ✅ | HUB_MGR, OPS, ADMIN | List hubs |
| `GET` | `/hubs/:id` | ✅ | HUB_MGR, OPS, ADMIN | Get hub details |
| `PATCH` | `/hubs/:id` | ✅ | ADMIN | Update hub |
| `DELETE` | `/hubs/:id` | ✅ | ADMIN | Deactivate hub |
| `GET` | `/hubs/:id/manager` | ✅ | ADMIN | Get hub manager |
| `PUT` | `/hubs/:id/manager` | ✅ | ADMIN | Assign hub manager |
| `DELETE` | `/hubs/:id/manager` | ✅ | ADMIN | Remove hub manager |
| `GET` | `/hubs/:id/couriers` | ✅ | HUB_MGR, ADMIN | List hub couriers |
| `POST` | `/hubs/:hubId/transfers` | ✅ | HUB_MGR, OPS, ADMIN | Create hub transfer |
| `PATCH` | `/hubs/:hubId/transfers/:id/arrive` | ✅ | HUB_MGR, OPS, ADMIN | Confirm arrival |
| `GET` | `/hubs/:hubId/transfers` | ✅ | HUB_MGR, OPS, ADMIN | List hub transfers |

---

### 🗺️ Zone Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/zones` | ✅ | ADMIN | Create zone |
| `GET` | `/zones` | ✅ | Any | List zones |
| `PATCH` | `/zones/:id` | ✅ | ADMIN | Update zone |
| `DELETE` | `/zones/:id` | ✅ | ADMIN | Deactivate zone |

---

### ⚙️ Operations Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `POST` | `/operations/assignments` | ✅ | OPS, ADMIN | Assign courier to shipment |
| `GET` | `/operations/assignments` | ✅ | OPS, ADMIN | List all assignments |
| `PATCH` | `/operations/assignments/:id/cancel` | ✅ | OPS, ADMIN | Cancel assignment |
| `PATCH` | `/operations/shipments/:id/status` | ✅ | HUB_MGR, OPS, ADMIN | Force update status |
| `GET` | `/operations/couriers` | ✅ | HUB_MGR, OPS, ADMIN | List couriers |
| `PATCH` | `/operations/couriers/:id/availability` | ✅ | OPS, ADMIN | Update courier availability |

---

### 💰 Pricing Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/pricing/calculate` | ✅ | Calculate shipping cost |
| `POST` | `/pricing/rules` | ✅ ADMIN | Create pricing rule |
| `GET` | `/pricing/rules` | ✅ ADMIN | List pricing rules |
| `PATCH` | `/pricing/rules/:id` | ✅ ADMIN | Update pricing rule |
| `DELETE` | `/pricing/rules/:id` | ✅ ADMIN | Deactivate pricing rule |

---

### 🔔 Notification Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/notifications` | ✅ | Get user notifications |
| `PATCH` | `/notifications/:id/read` | ✅ | Mark notification read |
| `PATCH` | `/notifications/read-all` | ✅ | Mark all notifications read |

---

### 👑 Admin Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/admin/stats` | ✅ ADMIN | System-wide stats dashboard |
| `GET` | `/admin/audit-logs` | ✅ ADMIN | All audit logs |
| `GET` | `/admin/audit-logs/operational` | ✅ OPS, ADMIN | Operational audit logs |

**Stats response includes:** total users, total shipments, revenue, active shipments, delivered today, shipments by status, users by role, revenue by month.

---

## 🔄 Business Workflows

### Complete Shipment Lifecycle

```
Customer registers → verifies email → logs in
    ↓
GET /pricing/calculate (optional — check cost)
    ↓
POST /shipments (status: CREATED, payment: PENDING)
    ↓
POST /payments/bkash/initiate OR /payments/stripe/checkout
    ↓
[Payment gateway → server callback → payment verified]
    ↓
POST /shipments/:id/pickup-request (status: PICKUP_REQUESTED)
    ↓
POST /operations/assignments { type: "PICKUP" }
    ↓  (status: ASSIGNED)
PATCH /courier/assignments/:id/accept
    ↓
POST /courier/shipments/:id/pickup-confirm (status: PICKED_UP)
    ↓
PATCH /operations/shipments/:id/status { status: "AT_ORIGIN_HUB" }
    ↓
POST /hubs/:hubId/transfers { toHubId, shipmentId } (status: IN_TRANSIT)
    ↓
PATCH /hubs/:hubId/transfers/:id/arrive (status: AT_DESTINATION_HUB)
    ↓
POST /operations/assignments { type: "DELIVERY" }
    ↓  (status: OUT_FOR_DELIVERY)
POST /courier/shipments/:id/deliver (status: DELIVERED) ✅
```

### Password Reset Workflow

```
POST /auth/forgot-password { email }
    ↓
Email sent with reset link (token hashed in Redis, 1-hour TTL)
    ↓
User clicks link → /reset-password?token=...
    ↓
POST /auth/reset-password { token, newPassword }
    ↓
Token verified → password updated → all sessions revoked
```

---

## 🔒 Security Architecture

| Rule | Implementation |
|------|----------------|
| Passwords hashed | Argon2id (never stored plaintext) |
| Refresh tokens hashed | Argon2id in DB, raw value only sent to client once |
| JWT verification | On every authenticated request |
| Customer isolation | `shipment.customerId === req.user.id` enforced |
| Courier authorization | Active assignment verified before any courier action |
| Hub isolation | Hub Manager's hub loaded from DB, never trusted from JWT |
| State machine | Invalid status transitions rejected automatically |
| Server-side pricing | Client cannot set shipment price |
| Payment verification | Never trust redirect — bKash/Stripe verified server-side |
| Soft delete blocking | Deleted users blocked at authentication middleware |
| OTP single-use | Deleted from Redis immediately after verification |
| Admin protection | Last active admin cannot be demoted or deleted |
| Reset token single-use | Deleted from Redis after successful reset |
| Demo guard | `@demo.logiflow.app` accounts are read-only in production |

---

## 🗃️ Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /auth/register` | 5 req / 15 min |
| `POST /auth/verify-email` | 5 req / 15 min |
| `POST /auth/login` | 10 req / 15 min |
| `GET /auth/google` | 10 req / 15 min |
| `POST /auth/forgot-password` | 5 req / 15 min |
| `POST /auth/reset-password` | 5 req / 15 min |
| `PATCH /auth/change-password` | 5 req / 15 min |
| `GET /tracking/:trackingNumber` | 20 req / min |

---

## 🎭 Demo Accounts

After running `npm run db:seed`:

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@demo.logiflow.app | Demo@LogiFlow2026 |
| OPERATIONS_MANAGER | ops@demo.logiflow.app | Demo@LogiFlow2026 |
| HUB_MANAGER | hub.dhaka@demo.logiflow.app | Demo@LogiFlow2026 |
| HUB_MANAGER | hub.ctg@demo.logiflow.app | Demo@LogiFlow2026 |
| COURIER | courier1@demo.logiflow.app | Demo@LogiFlow2026 |
| CUSTOMER | customer1@demo.logiflow.app | Demo@LogiFlow2026 |

Demo tracking numbers: `LF-20260901-DEMO0001` through `LF-20260901-DEMO0013`

---

## 🧪 Testing

```bash
# Run all unit tests
npm test

# With coverage report
npm run test:coverage
```

**107+ tests** covering: auth service, payment service (bKash + Stripe), pricing engine, shipment state machine, JWT helpers, Zod validation, pagination, email provider selection, and webhook signature verification.

---

## 🚀 Production Deployment (Render)

**Required environment variables on Render:**

```env
NODE_ENV=production
DATABASE_URL=...
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://logiflow-backend-ai0r.onrender.com/api/v1/auth/google/callback
FRONTEND_URL=https://logiflow-hash.vercel.app
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
BKASH_APP_KEY=...  (+ other bKash vars)
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
CLOUDINARY_CLOUD_NAME=...  (+ other Cloudinary vars)
MAX_DELIVERY_ATTEMPTS=3
```

**Keep alive:** Use [UptimeRobot](https://uptimerobot.com) to ping `GET /health` every 14 minutes — prevents Render free tier from sleeping.

---

## 🔧 HTTP Status Codes

| Status | Meaning |
|--------|---------|
| `200` | OK |
| `201` | Created |
| `400` | Bad Request — validation failed |
| `401` | Unauthorized — missing or invalid token |
| `403` | Forbidden — insufficient role |
| `404` | Not Found |
| `409` | Conflict — duplicate or constraint violation |
| `429` | Too Many Requests — rate limited |
| `500` | Internal Server Error |
| `503` | Service Unavailable — external service down |

---

## 📬 Postman Collection

A complete, pre-configured Postman collection with 96 requests across 13 folders:

- `postman/LogiFlow.postman_collection.json`
- `postman/LogiFlow.postman_environment.json`

Import both into Postman. The environment is pre-configured with the production URL. Test scripts auto-populate variables like `accessToken`, `shipmentId`, `trackingNumber` etc.

---

## 📄 License

MIT License

---

## 💙 A Note from the Developer

Hello! I'm **Tamanna**.

Building LogiFlow gave me the opportunity to strengthen my understanding of backend development — RESTful API design, JWT authentication with refresh token rotation, role-based access control, database modeling with Prisma, multi-hub logistics architecture, shipment state machine validation, secure payment integration with both bKash and Stripe, OTP-based email verification, Google OAuth with account auto-linking, password reset with Redis-backed tokens, and comprehensive audit logging.

Every design decision — from server-side price calculation to Argon2id password hashing, from hub isolation to single-use OTP deletion — was made with security and correctness in mind.

I believe great software is built through continuous learning, curiosity, and persistence. Thank you for taking the time to explore LogiFlow. I hope you find it well-structured and interesting!

Thank you for checking out this project! ❤️
