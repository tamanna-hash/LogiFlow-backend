# LogiFlow Backend

Node.js/Express REST API for LogiFlow — a courier and logistics management platform for Bangladesh.

---

## Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express |
| Database | PostgreSQL + Prisma ORM |
| Cache / Rate limits | Upstash Redis |
| Auth | JWT (HS256) — access + opaque refresh tokens |
| Email | Resend (default) or Gmail SMTP via Nodemailer |
| Payments | bKash (tokenized checkout) + Stripe Checkout |
| Uploads | Cloudinary |
| OAuth | Google OAuth 2.0 via Passport |
| Validation | Zod |
| Testing | Vitest |
| Build | tsup |

---

## Quick start

```bash
npm install
cp .env.example .env    # fill in required variables
npm run db:migrate:prod  # apply migrations
npm run db:seed          # seed demo data
npm run dev              # start dev server
```

See [DEMO_SETUP.md](./DEMO_SETUP.md) for the full first-time setup guide.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm test` | Run unit tests |
| `npm run type-check` | TypeScript type check |
| `npm run lint` | ESLint + Biome lint |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Create + apply dev migration |
| `npm run db:migrate:prod` | Apply pending migrations (production-safe) |
| `npm run db:seed` | Seed demo data (idempotent) |
| `npm run db:seed:demo` | Alias for db:seed |
| `npm run db:studio` | Open Prisma Studio |

---

## API base URL

```
/api/v1
```

Health check: `GET /health`

---

## Authentication

**Scheme:** Bearer token

```
Authorization: Bearer <access_token>
```

- Access token: JWT (15 min default), payload `{ sub: userId, role }`
- Refresh token: opaque hex string, 7-day TTL, stored hashed in DB
- Token refresh: `POST /api/v1/auth/refresh` with `{ refreshToken }` in body
- Logout: `POST /api/v1/auth/logout` — revokes the provided refresh token

---

## Roles

| Role | Description |
|---|---|
| `CUSTOMER` | Create/track/pay for shipments |
| `COURIER` | Accept assignments, pick up, deliver |
| `HUB_MANAGER` | Manage own hub's shipments and couriers |
| `OPERATIONS_MANAGER` | Cross-hub oversight, assign couriers, update statuses |
| `ADMIN` | Full platform access |

---

## Payment providers

### bKash (existing)
1. `POST /api/v1/payments/bkash/initiate` — returns `bkashURL`
2. Redirect browser to `bkashURL`
3. bKash redirects to backend callback
4. Backend verifies via bKash `executepayment` API
5. Backend redirects to `FRONTEND_URL/payment/success?shipmentId=<id>` or `.../failure?shipmentId=<id>`

### Stripe Checkout (new)
1. `POST /api/v1/payments/stripe/checkout` — returns `checkoutUrl`
2. Redirect browser to `checkoutUrl`
3. Stripe redirects to `FRONTEND_URL/payment/success?shipmentId=<id>` or `.../failure?shipmentId=<id>`
4. Stripe sends webhook `POST /api/v1/payments/stripe/webhook` (raw body required)
5. Backend verifies signature, updates payment/shipment status atomically

---

## Email providers

Controlled by `EMAIL_PROVIDER` environment variable:

- `EMAIL_PROVIDER=resend` (default) — Resend API
- `EMAIL_PROVIDER=gmail` — Gmail SMTP via Nodemailer (requires App Password)

Both providers use the same send interface in `src/app/lib/mailer.ts`.

---

## Database schema

Key models: `User`, `Shipment`, `ShipmentItem`, `ShipmentTrackingEvent`, `Payment`, `CourierAssignment`, `DeliveryAttempt`, `Hub`, `Zone`, `HubTransfer`, `PickupRequest`, `PricingRule`, `Notification`, `AuditLog`, `RefreshToken`

Migrations are in `prisma/migrations/`.

---

## Demo accounts

After running `npm run db:seed`:

| Role | Email | Password |
|---|---|---|
| ADMIN | admin@demo.logiflow.app | Demo@LogiFlow2026 |
| OPERATIONS_MANAGER | ops@demo.logiflow.app | Demo@LogiFlow2026 |
| HUB_MANAGER | hub.dhaka@demo.logiflow.app | Demo@LogiFlow2026 |
| HUB_MANAGER | hub.ctg@demo.logiflow.app | Demo@LogiFlow2026 |
| COURIER | courier1@demo.logiflow.app | Demo@LogiFlow2026 |
| CUSTOMER | customer1@demo.logiflow.app | Demo@LogiFlow2026 |

Demo tracking numbers for public tracking: `LF-20260901-DEMO0001` through `LF-20260901-DEMO0013`

---

## Testing

```bash
npm test                # run all unit tests
npm run test:coverage   # with coverage report
```

107+ tests covering: auth service, payment service (bKash + Stripe), pricing, shipment state machine, JWT, validation, pagination, and email provider selection.

---

## Security notes

- Passwords hashed with Argon2id
- Refresh tokens stored as Argon2id hashes, never plaintext
- JWT signed with HS256, verified on every authenticated request
- bKash: server-side `executepayment` verification — browser redirects are never trusted
- Stripe: webhook signature verified with `stripe.webhooks.constructEvent()` using raw body
- No secrets in responses — password hashes, tokens, and OTPs are never returned
- Rate limiting on login, register, OTP, payment initiation, and public tracking
