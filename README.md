# 🚚 LogiFlow — Courier & Logistics Management Platform

**LogiFlow** is a role-based Courier & Logistics Management Platform designed to manage the complete parcel delivery lifecycle — from customer registration and shipment booking to payment, courier pickup, multi-hub transfers, final delivery, tracking, and returns.

The backend is built with a strong focus on **security, role-based access control, business logic, payment verification, shipment state management, and scalable architecture**.

## 🔗 Live Links

* 🌐 **Live API:** `https://logiflow-backend-ai0r.onrender.com/`
* 📖 **API Documentation:** `https://documenter.getpostman.com/view/49731960/2sBYAxPV15`
* 💻 **Frontend:** `Working on it`
* 📦 **GitHub Repository:** `https://github.com/tamanna-hash/LogiFlow-backend`

---

## ✨ Key Features

### 🔐 Authentication & Security

* Email and password registration
* 6-digit OTP email verification
* OTP stored securely in Redis with 5-minute expiration
* Single-use OTP verification
* Email verification before login
* JWT access and refresh token authentication
* Refresh token rotation
* Logout with refresh-token revocation
* Revoke all sessions when changing password
* Google OAuth authentication
* Soft-deleted users are immediately blocked
* Role-based authorization
* Server-side validation with protected business rules

### 👥 Role-Based Access Control

LogiFlow provides five dedicated roles:

| Role                         | Responsibility                                                 |
| ---------------------------- | -------------------------------------------------------------- |
| 👤 **CUSTOMER**              | Create shipments, make payments, request pickup, track parcels |
| 🛵 **COURIER**               | Pickup and deliver assigned shipments                          |
| 🏢 **HUB_MANAGER**           | Manage shipments, couriers and transfers within their hub      |
| 👨‍💼 **OPERATIONS_MANAGER** | Manage logistics operations across all hubs                    |
| 👑 **ADMIN**                 | Complete system administration and management                  |

Each role has strictly controlled permissions to prevent unauthorized access.

---

## 📦 Shipment Management

Customers can:

* Calculate delivery pricing
* Create shipments
* View their shipments
* Search and filter shipments
* Use pagination
* View shipment details
* Edit recipient information before processing
* Cancel eligible shipments
* Request courier pickup after payment
* Track complete shipment history
* Track parcels publicly using a tracking number

### Shipment Lifecycle

```text
CREATED
   ↓
PICKUP_REQUESTED
   ↓
ASSIGNED
   ↓
PICKED_UP
   ↓
IN_TRANSIT
   ↓
AT_DESTINATION_HUB
   ↓
OUT_FOR_DELIVERY
   ↓
DELIVERED
```

If delivery fails:

```text
OUT_FOR_DELIVERY
       ↓
DELIVERY_FAILED
       ↓
Retry
       ↓
OUT_FOR_DELIVERY
```

After the maximum number of delivery attempts:

```text
DELIVERY_FAILED
       ↓
RETURN_INITIATED
       ↓
RETURNING
       ↓
RETURNED
```

The backend validates every transition, preventing invalid status jumps.

---

## 💳 bKash Payment Integration

LogiFlow integrates **bKash** for shipment payments.

Payment flow:

```text
Create Shipment
      ↓
Payment = PENDING
      ↓
Initiate bKash Payment
      ↓
Customer Completes Payment
      ↓
bKash Callback
      ↓
Server-side Payment Verification
      ↓
Payment = COMPLETED
      ↓
Shipment Can Request Pickup
```

### 🔒 Payment Security

The backend never trusts payment status received from the client.

Instead, payment confirmation is verified through the bKash server-side execution flow before updating the database.

---

## 💰 Dynamic Pricing

Customers can calculate delivery charges before creating a shipment.

Pricing can be based on configurable pricing rules such as:

* Delivery zone
* Parcel weight
* Shipment type
* Distance/route
* Other configured pricing factors

### Important Security Rule

The client cannot directly set the shipment price.

```text
Client Request
      ↓
Shipment Information
      ↓
Server-side Pricing Engine
      ↓
Calculated Price
      ↓
Database
```

This prevents users from manipulating delivery charges.

---

## 🛵 Courier Management

Couriers can:

* View assigned shipments
* Filter assignments
* Accept assignments
* Reject assignments
* Toggle availability
* Confirm parcel pickup
* Complete deliveries
* Mark delivery failures
* Provide delivery failure reasons
* Upload optional delivery proof
* View completed-delivery earnings

Couriers can only perform actions on shipments assigned to them.

---

## 🏢 Hub Management

LogiFlow supports a multi-hub logistics system.

A **HUB_MANAGER** is strictly restricted to their assigned hub.

They can:

* View their hub
* View hub details
* View zones belonging to their hub
* View shipments currently at their hub
* Manage hub-level courier assignments
* Dispatch shipments to another hub
* Confirm shipment arrival

Example:

```text
Dhaka Hub
    ↓
Shipment dispatched
    ↓
IN_TRANSIT
    ↓
Comilla Hub
    ↓
Shipment arrived
    ↓
AT_DESTINATION_HUB
```

---

## 👨‍💼 Operations Management

The **OPERATIONS_MANAGER** has cross-hub operational visibility.

They can:

* View all shipments
* Search and filter shipments
* View shipment details
* Cancel eligible shipments
* Initiate returns
* Advance shipment status
* Manage couriers across hubs
* Assign couriers
* Cancel active assignments
* Update courier availability
* Create hub transfers
* Confirm hub arrivals
* View pricing rules
* View operational audit logs

However, they cannot manage user accounts, system finances, or administrative settings.

---

## 👑 Admin Management

The **ADMIN** has unrestricted system access.

### User Management

* View all users
* Search and filter users
* View user profiles
* Change user roles
* Soft-delete users
* Protect the last active administrator from being demoted or deleted

### Hub & Zone Management

* Create hubs
* Update hubs
* Deactivate hubs
* Create zones
* Update zones
* Deactivate zones

### Pricing Management

* Create pricing rules
* Update pricing rules
* Deactivate pricing rules

### Shipment Override

Admins can force a shipment status transition when necessary.

Every forced transition requires a reason and is recorded in the audit log.

### Payment Management

Admins can:

* View complete payment history
* View shipment-specific payment details
* Inspect bKash response information

### Analytics

The admin dashboard provides system-wide statistics such as:

* Total users
* Total shipments
* Revenue
* Deliveries today

---

## 📍 Shipment Tracking

Customers can track shipments through:

### Authenticated Tracking

```http
GET /api/v1/shipments/:id/tracking
```

Provides the complete shipment event timeline.

### Public Tracking

```http
GET /api/v1/tracking/:trackingNumber
```

No authentication is required.

Example tracking flow:

```text
Shipment Created
      ↓
Payment Completed
      ↓
Pickup Requested
      ↓
Courier Assigned
      ↓
Picked Up
      ↓
In Transit
      ↓
Destination Hub
      ↓
Out for Delivery
      ↓
Delivered
```

---

## 🔔 Notifications

Customers can:

* View notifications
* Mark individual notifications as read
* Mark all notifications as read

Notifications can be triggered by important shipment events such as courier assignment, shipment movement, delivery updates, and successful delivery.

---

## 🔐 Security Architecture

Security is one of the core parts of LogiFlow.

### Customer Isolation

Customers can only access their own shipments.

```text
shipment.customerId === req.user.id
```

### Courier Authorization

Before a courier performs a shipment action, the backend verifies an active courier assignment.

### Hub Isolation

Hub Managers cannot access shipments belonging to another hub.

The assigned hub is retrieved from the database instead of blindly trusting a hub ID from the JWT.

### State Validation

Shipment statuses are controlled through a predefined valid-transition map.

```text
CREATED → PICKUP_REQUESTED
PICKUP_REQUESTED → ASSIGNED
ASSIGNED → PICKED_UP
...
```

Invalid transitions are rejected automatically.

### Server-Side Pricing

Prices are calculated by the backend and cannot be supplied by the client.

### Server-Side Payment Verification

Payment completion is determined only after verifying the payment with bKash.

### Soft Delete Protection

Soft-deleted users are blocked from authenticated requests.

### OTP Protection

Verified OTPs are immediately removed from Redis, making them single-use.

---

## 📝 Audit Logging

Important system operations are recorded in audit logs.

Audit information can include:

* Actor/user
* Action
* Resource
* Resource ID
* Previous state
* New state
* Reason
* Timestamp
* Operational events

This provides accountability and makes sensitive administrative actions traceable.

---

## 🧑‍💻 Technology Stack

### Backend

* **Node.js**
* **Express.js**
* **TypeScript**
* **Prisma ORM**
* **PostgreSQL**

### Authentication & Security

* **JWT**
* **Refresh Token Rotation**
* **Google OAuth**
* **OTP Email Verification**
* **Redis**

### External Services

* **Resend** — transactional email / OTP delivery
* **bKash** — payment processing
* **Cloudinary** — image and avatar storage
* **Redis / Upstash** — OTP and temporary data storage

### Development & API Testing

* **Postman**
* **Prisma Studio**
* **Biome**
* **TypeScript**
* **Git & GitHub**

---

## 🏗️ High-Level Architecture

```text
                    ┌─────────────────┐
                    │    Frontend     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Express API   │
                    └────────┬────────┘
                             │
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
        Authentication    Services       Middleware
             │               │               │
             ▼               ▼               ▼
          Redis          PostgreSQL       RBAC/Auth
             │               │
             │               │
       ┌─────┴─────┐   ┌─────┴─────────┐
       ▼           ▼   ▼               ▼
     Resend      OAuth Prisma       Business Logic
                   │
                   ▼
                 bKash
                   │
                   ▼
              Payment System
```

---

## 🔄 Complete Business Flow

```text
Register
   ↓
OTP Verification
   ↓
Account Created
   ↓
Login
   ↓
Calculate Delivery Price
   ↓
Create Shipment
   ↓
Create Pending Payment
   ↓
bKash Payment
   ↓
Server-side Verification
   ↓
Pickup Request
   ↓
Courier Assignment
   ↓
Courier Pickup
   ↓
Hub Transfer
   ↓
Destination Hub Arrival
   ↓
Delivery Assignment
   ↓
Out for Delivery
   ↓
       ┌───────────────┐
       │               │
       ▼               ▼
   Delivered      Delivery Failed
                       ↓
                    Retry
                       ↓
                  Max Attempts
                       ↓
                    Return
```

---

## 📂 Project Structure

```text
src/
├── app/
│   ├── modules/
│   │   ├── auth/
│   │   ├── user/
│   │   ├── shipment/
│   │   ├── courier/
│   │   ├── hub/
│   │   ├── payment/
│   │   ├── pricing/
│   │   ├── notification/
│   │   └── audit/
│   │
│   ├── middleware/
│   ├── routes/
│   ├── utils/
│   ├── config/
│   └── app.ts
│
├── server.ts
│
prisma/
├── schema.prisma
└── migrations/

scripts/
.env
.gitignore
package.json
tsconfig.json
```

---

## ⚙️ Environment Variables

Create a `.env` file and configure the required environment variables.

```env
DATABASE_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

REDIS_URL=
REDIS_TOKEN=

RESEND_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

BKASH_APP_KEY=
BKASH_APP_SECRET=
BKASH_USERNAME=
BKASH_PASSWORD=
BKASH_BASE_URL=
```

> Never commit `.env`, API keys, tokens, credentials, or service-account files to GitHub.

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPO_URL
cd logiflow-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file and add the required credentials.

### 4. Generate Prisma Client

```bash
npx prisma generate
```

### 5. Run database migrations

```bash
npx prisma migrate deploy
```

For local development:

```bash
npx prisma migrate dev
```

### 6. Start development server

```bash
npm run dev
```

The API should now be available at:

```text
http://localhost:5000
```

---

## 📡 API Overview

### Authentication

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/verify-email
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
PATCH  /api/v1/auth/change-password
GET    /api/v1/auth/google
```

### Customer

```text
GET    /api/v1/users/me
PATCH  /api/v1/users/me

POST   /api/v1/pricing/calculate

POST   /api/v1/shipments
GET    /api/v1/shipments
GET    /api/v1/shipments/:id
PATCH  /api/v1/shipments/:id
POST   /api/v1/shipments/:id/cancel
POST   /api/v1/shipments/:id/pickup-request

GET    /api/v1/shipments/:id/tracking
GET    /api/v1/tracking/:trackingNumber

POST   /api/v1/payments/bkash/initiate
GET    /api/v1/payments/shipment/:id

GET    /api/v1/notifications
PATCH  /api/v1/notifications/:id/read
PATCH  /api/v1/notifications/read-all
```

### Courier

```text
GET    /api/v1/courier/assignments
PATCH  /api/v1/courier/assignments/:id/accept
PATCH  /api/v1/courier/assignments/:id/reject

PATCH  /api/v1/courier/availability

POST   /api/v1/courier/shipments/:id/pickup-confirm
POST   /api/v1/courier/shipments/:id/deliver
POST   /api/v1/courier/shipments/:id/delivery-failed

GET    /api/v1/courier/earnings
```

### Hub & Operations

```text
GET    /api/v1/hubs
GET    /api/v1/hubs/:id
GET    /api/v1/zones

POST   /api/v1/hubs/:hubId/transfers
PATCH  /api/v1/hubs/:hubId/transfers/:id/arrive

GET    /api/v1/operations/couriers
POST   /api/v1/operations/assignments
PATCH  /api/v1/operations/assignments/:id/cancel
```

### Admin

```text
GET    /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id/role
DELETE /api/v1/users/:id

POST   /api/v1/hubs
PATCH  /api/v1/hubs/:id
DELETE /api/v1/hubs/:id

POST   /api/v1/zones
PATCH  /api/v1/zones/:id
DELETE /api/v1/zones/:id

POST   /api/v1/pricing/rules
PATCH  /api/v1/pricing/rules/:id
DELETE /api/v1/pricing/rules/:id

GET    /api/v1/payments
GET    /api/v1/payments/shipment/:id

GET    /api/v1/admin/stats
GET    /api/v1/admin/audit-logs
```

---

## 🧠 Important Business Rules

| Rule                                    | Implementation                        |
| --------------------------------------- | ------------------------------------- |
| Customer sees only own shipments        | Customer ownership verification       |
| Courier acts only on assigned shipments | Active assignment verification        |
| Hub Manager sees only their hub         | Database-based hub scoping            |
| Shipment states cannot be skipped       | Valid transition map                  |
| Client cannot manipulate price          | Server-side pricing                   |
| Client cannot fake payment              | bKash server-side verification        |
| Deleted users cannot access API         | Authentication-time DB check          |
| OTP cannot be reused                    | Redis OTP deletion after verification |
| Last Admin cannot be removed            | Admin protection logic                |
| Admin overrides require justification   | Reason + audit log                    |

---

## 📈 Future Improvements

Possible future enhancements include:

* Real-time shipment tracking
* WebSocket-based courier location updates
* SMS notifications
* Advanced delivery analytics
* Route optimization
* Automated courier assignment
* Delivery zone optimization
* Customer reviews and ratings
* Invoice generation
* Advanced reporting
* Mobile application for couriers
* Automated retry and return workflows

---

## 💙 A Note from the Developer

Hello! I'm **Tamanna**.

Building **LogiFlow** gave me the opportunity to strengthen my understanding of backend development, RESTful API design, authentication, role-based access control, database modeling, multi-hub logistics, shipment state management, and secure payment integration with **bKash**.

Through this project, I also explored real-world backend challenges such as server-side price calculation, payment verification, OTP-based email authentication, refresh-token rotation, courier assignment, shipment tracking, audit logging, and enforcing strict business rules across different user roles.

I believe great software is built through continuous learning, curiosity, and persistence. Thank you for taking the time to explore my work, and I hope you find **LogiFlow** useful and interesting!

Thank you for checking out this project! ❤️


## 📄 License

This project is licensed under the **MIT License**.
