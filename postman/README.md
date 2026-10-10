# LogiFlow — Postman API Documentation

## Files

| File | Description |
|---|---|
| `LogiFlow.postman_collection.json` | Complete API collection (84 endpoints, 13 folders) |
| `LogiFlow.postman_environment.json` | Environment variables (baseUrl, tokens, IDs) |

---

## Import Instructions

1. Open **Postman**
2. Click **Import** → drag both JSON files in at the same time
3. Select **LogiFlow API Environment** from the environment dropdown (top-right corner)
4. You're ready — see the **Quick Start** section below

---

## Quick Start

```
Register → Verify Email → all subsequent requests use the saved token automatically
```

1. Open folder **01 — Authentication**
2. Run **Register (Step 1)** — enter your email and password, OTP is sent to your inbox
3. Run **Verify Email (Step 2)** — enter the 6-digit OTP from your email
4. `accessToken`, `refreshToken`, and `userId` are automatically saved to the environment
5. All protected requests use `{{accessToken}}` via the collection-level bearer token

> Tip: When the access token expires (15 min), run **Refresh Token** to get a new one without re-logging in.

---

## Base URLs

| Environment | URL |
|---|---|
| **Development** | `http://localhost:5000/api/v1` |
| **Production** | `https://logiflow-backend-ai0r.onrender.com/api/v1` |

To switch: update `{{baseUrl}}` in the environment variables panel.

---

## Authentication

The API uses **JWT Bearer token** authentication:

```
Authorization: Bearer <accessToken>
```

The collection is configured to send this automatically via the collection-level bearer auth. You do not need to add the header manually to each request.

**Token lifetime:**
- Access token: 15 minutes (short-lived)
- Refresh token: 7 days (rotated on use — old token is immediately revoked)

**Cookie support:** The backend also accepts the access token via HTTP-only cookie (`accessToken`). In Postman, the bearer header approach is used.

---

## Folder Structure

| # | Folder | Endpoints | Description |
|---|---|---|---|
| 01 | Authentication | 7 | Register (OTP), Verify, Login, Refresh, Logout, Change/Set Password, Google OAuth |
| 02 | Users & Profile | 7 | Get/Update own profile, Admin user management, courier hub assignment |
| 03 | Hubs & Zones | 16 | Hub CRUD, destinations, transfers, manager assignment, zones |
| 04 | Pricing | 5 | Calculate price, manage pricing rules |
| 05 | Shipments | 8 | Create, list, get, update, cancel, pickup request, tracking, return |
| 06 | Public Tracking | 1 | Track by tracking number — no auth required |
| 07 | Payments | 7 | bKash initiate/callback, Stripe checkout/webhook/verify, list payments |
| 08 | Courier | 9 | Assignments (list, get, accept, reject), availability, pickup, delivery, earnings |
| 09 | Operations | 6 | List/assign/cancel assignments, status override, courier management |
| 10 | Notifications | 3 | List, mark read, mark all read |
| 11 | Admin | 3 | System stats, full audit logs, operational audit logs |
| 12 | Happy Path | 12 | End-to-end workflow from registration to delivery |
| 13 | Security & Edge Cases | 9 | 401/403/400/409/429 scenarios, health check |

**Total: 93 requests across 13 folders**

---

## Environment Variables

| Variable | Set By | Description |
|---|---|---|
| `baseUrl` | Manual | API base URL (default: `http://localhost:5000/api/v1`) |
| `accessToken` | Auto (Login / Verify Email) | JWT access token |
| `refreshToken` | Auto (Login / Verify Email) | Refresh token |
| `userId` | Auto (Login / Verify Email) | Authenticated user ID |
| `shipmentId` | Auto (Create Shipment) | Created shipment ID |
| `trackingNumber` | Auto (Create Shipment) | Generated tracking number |
| `paymentId` | Auto (Initiate Payment) | Payment record ID |
| `hubId` | Auto (Create Hub) | Origin hub ID |
| `destHubId` | Manual | Destination hub ID (set after creating second hub) |
| `transferId` | Auto (Create Hub Transfer) | Hub transfer ID |
| `zoneId` | Auto (Create Zone) | Zone ID |
| `pricingRuleId` | Auto (Create Pricing Rule) | Pricing rule ID |
| `assignmentId` | Auto (Assign Courier) | Assignment ID |
| `courierProfileId` | Manual | Courier profile ID (from `/users/me` as a courier) |
| `notificationId` | Auto (Get Notifications) | First notification ID |

---

## Role-Based Testing

The API enforces role-based access control. To test different roles:

1. **Admin**: Register → use Admin panel (or DB) to change role → Login again
2. **Courier**: Register → Admin changes role to COURIER → Login
3. **Hub Manager**: Register → Admin changes role to HUB_MANAGER → Admin assigns hub → Login
4. **Operations Manager**: Register → Admin changes role to OPERATIONS_MANAGER → Login

After changing roles, always **Login again** to get a new token with the updated role.

**Common permission errors:**
- `401 Unauthorized` — missing token, expired token, or unverified email
- `403 Forbidden` — valid token but insufficient role

---

## API Modules Overview

### Authentication (`/auth`)
Two-step OTP registration flow. Email must be verified before login. Tokens use rotation — reusing an old refresh token revokes the session. Google OAuth is browser-only.

### Users & Profile (`/users`)
Any authenticated user can view and update their own profile (including avatar upload). Admins can list, view, change roles, and soft-delete users. Role-specific profile fields (courier vehicle info, customer address) are included.

### Hubs & Zones (`/hubs`, `/zones`)
Hubs are physical logistics centers. Zones are delivery areas linked to hubs. Hub managers see only their own hub. The `/hubs/destinations` endpoint returns all active hubs for the transfer dropdown.

### Pricing (`/pricing`)
Price is always calculated server-side — the client cannot set a price. Rules can be global (null zone IDs) or zone-specific. More specific rules take priority.

### Shipments (`/shipments`)
Full lifecycle management. Results are automatically scoped by role. Shipment status follows a strict state machine.

**Shipment status flow:**
```
CREATED → PICKUP_REQUESTED → ASSIGNED → PICKED_UP →
AT_ORIGIN_HUB → IN_TRANSIT → AT_DESTINATION_HUB →
OUT_FOR_DELIVERY → DELIVERED
                           ↘ DELIVERY_FAILED → RETURN_INITIATED → RETURNING → RETURNED
                    ↘ CANCELLED (from early statuses)
```

### Public Tracking (`/tracking`)
No authentication required. Returns status and events only — never exposes personal data (phone numbers, addresses). Rate-limited to 20 req/min per IP.

### Payments (`/payments`)
Two providers supported:
- **bKash**: `POST /payments/bkash/initiate` → open `bkashURL` in browser → bKash calls callback automatically
- **Stripe**: `POST /payments/stripe/checkout` → open `checkoutUrl` in browser → Stripe fires webhook automatically

For local Stripe testing without the webhook, use `POST /payments/stripe/verify/:shipmentId` as a fallback.

### Courier (`/courier`)
Couriers manage their own assignments. Only `AVAILABLE` and `UNAVAILABLE` can be set manually. `ON_DELIVERY` is system-managed.

**Delivery failure reasons:** `NO_ONE_HOME` | `ADDRESS_NOT_FOUND` | `REFUSED_BY_RECIPIENT` | `DAMAGED_IN_TRANSIT` | `OTHER`

### Operations (`/operations`)
Operational staff (HUB_MANAGER, OPERATIONS_MANAGER, ADMIN) create and manage courier assignments. The status override endpoint allows correcting shipment state manually.

### Notifications (`/notifications`)
In-app notifications scoped to the authenticated user. `meta.unreadCount` is returned with every listing response.

### Admin (`/admin`)
System statistics and full audit logs. Operational audit logs are also visible to OPERATIONS_MANAGER.

---

## Pagination

All list endpoints support:

| Param | Default | Max | Description |
|---|---|---|---|
| `page` | 1 | — | Page number |
| `limit` | 10 | 100 | Results per page |

Response `meta` object:
```json
{
  "page": 1,
  "limit": 10,
  "total": 87,
  "totalPages": 9
}
```

Notifications also include `meta.unreadCount`.

---

## Rate Limits

| Endpoint(s) | Limit |
|---|---|
| `POST /auth/register`, `POST /auth/verify-email` | 5 requests / 15 minutes |
| `POST /auth/login`, `GET /auth/google` | 10 requests / 15 minutes |
| `PATCH /auth/change-password`, `POST /auth/set-password` | 5 requests / 15 minutes |
| `POST /payments/bkash/initiate`, `/stripe/checkout`, `/stripe/verify/*` | rate-limited (paymentInitiate bucket) |
| `GET /tracking/:trackingNumber` | 20 requests / minute |
| All other API routes | general unauthenticated bucket |

Rate-limited responses return `429 Too Many Requests` with a `Retry-After` header.

---

## Common Errors

| Status | Meaning | Common Causes |
|---|---|---|
| `400` | Validation failed | Missing required field, invalid enum, wrong format |
| `401` | Unauthorized | No token, expired token, unverified email, account deleted/suspended |
| `403` | Forbidden | Token valid but role not permitted for this endpoint |
| `404` | Not found | Resource doesn't exist or not accessible to this user |
| `409` | Conflict | Duplicate email, hub code already exists |
| `422` | Unprocessable | Business rule violation (e.g. cancel an already-delivered shipment) |
| `429` | Rate limited | Too many requests — check `Retry-After` header |
| `503` | Service unavailable | Email/payment provider not configured |

---

## Happy Path (Folder 12)

Run all 12 steps in order for a complete end-to-end walkthrough.

**Prerequisites (set up first using folders 03–04):**
1. Create a Hub (origin) → `{{hubId}}` auto-set
2. Create a second Hub (destination) → copy its ID into `{{destHubId}}` manually
3. Create a Zone → `{{zoneId}}` auto-set
4. Create a Pricing Rule
5. Create a courier user → Admin assigns courier to origin hub → copy `courierProfileId` into `{{courierProfileId}}`

**Workflow:**
- Steps 1–2: Customer registers and verifies email
- Step 3: Customer creates shipment
- Step 4: Customer initiates bKash payment (open URL in browser)
- Step 5: Customer requests pickup (after payment completes)
- Step 6: Operations assigns pickup courier (login as OPS)
- Step 7: Courier confirms pickup (login as COURIER)
- Step 8: Hub manager dispatches to destination hub (login as HUB)
- Step 9: Destination hub confirms arrival (login as DEST HUB manager)
- Step 10: Operations assigns delivery courier (login as OPS)
- Step 11: Courier records delivery (login as COURIER)
- Step 12: Public tracking confirms DELIVERED status (no login)

---

## bKash Payment Testing

1. Set `BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta` in `.env`
2. Run **Initiate bKash Payment** → copy `bkashURL` from response
3. Open the URL in a browser → complete payment on bKash sandbox (use sandbox credentials)
4. bKash automatically calls the callback → server verifies with bKash → shipment payment completes
5. Run **Get Payment by Shipment** to verify `status: COMPLETED`

---

## Stripe Payment Testing (Local)

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Run: `stripe listen --forward-to localhost:5000/api/v1/payments/stripe/webhook`
3. Run **Initiate Stripe Checkout** → open `checkoutUrl` in browser → use test card `4242 4242 4242 4242`
4. Stripe CLI forwards webhook event → payment completes automatically
5. Without Stripe CLI: use **Verify Stripe Payment (manual fallback)** after completing checkout

---

## Notes on Missing / Not Implemented

All endpoints documented here are fully implemented and tested against the actual route files. No placeholder or fictional endpoints are included.

The following are **intentionally not in Postman** (browser-only flows):
- `GET /auth/google` — initiates Google OAuth redirect, must be opened in a browser
- `GET /auth/google/callback` — Google redirects here automatically after consent
- `GET /payments/bkash/callback` — included for informational purposes only; bKash calls this automatically
- `POST /payments/stripe/webhook` — Stripe calls this automatically; documented but not meant to be run manually

---

*Last updated: October 8, 2026 — v3, reflecting all current routes*
