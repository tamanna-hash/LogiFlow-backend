# LogiFlow API Documentation

## Base URL
```
Development: http://localhost:5000/api/v1
Production:  https://logiflow-backend-ai0r.onrender.com/api/v1
```

## Authentication
Most endpoints require JWT authentication. Include the access token in the Authorization header:
```
Authorization: Bearer <your_access_token>
```

## Response Format
All responses follow this structure:
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... },
  "meta": { "page": 1, "limit": 10, "total": 100, "totalPages": 10 }
}
```

Error responses:
```json
{
  "success": false,
  "message": "Error description",
  "errors": [ ... ]
}
```

---

## 📋 Table of Contents
1. [Authentication](#authentication-endpoints)
2. [Users & Profile](#users--profile)
3. [Shipments](#shipments)
4. [Tracking (Public)](#tracking-public)
5. [Payments](#payments)
6. [Courier](#courier-endpoints)
7. [Hubs & Zones](#hubs--zones)
8. [Operations](#operations-endpoints)
9. [Pricing](#pricing)
10. [Notifications](#notifications)
11. [Admin](#admin-endpoints)

---

## Authentication Endpoints

### 1. Register (Step 1: Initiate)
**POST** `/auth/register`

Send OTP to email for registration.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+8801712345678"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "OTP sent to email",
  "data": {
    "email": "user@example.com",
    "expiresIn": 600
  }
}
```

---

### 2. Verify Email (Step 2: Complete Registration)
**POST** `/auth/verify-email`

Verify OTP and create account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "user": {
      "id": "cm...",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "CUSTOMER"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "ref_..."
    }
  }
}
```

---

### 3. Login
**POST** `/auth/login`

Authenticate with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "ref_..."
    }
  }
}
```

---

### 4. Refresh Token
**POST** `/auth/refresh`

Get new access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "ref_..."
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Token refreshed",
  "data": {
    "accessToken": "eyJ..."
  }
}
```

---

### 5. Logout
**POST** `/auth/logout`

Invalidate refresh token.

**Auth Required:** Yes

**Request Body:**
```json
{
  "refreshToken": "ref_..."
}
```

**Response:** `200 OK`

---

### 6. Google OAuth
**GET** `/auth/google`

Initiate Google OAuth flow (redirects to Google).

---

### 7. Google OAuth Callback
**GET** `/auth/google/callback`

Google redirects here after authentication.

---

### 8. Change Password
**PATCH** `/auth/change-password`

Change password for authenticated user.

**Auth Required:** Yes

**Request Body:**
```json
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass456!"
}
```

**Response:** `200 OK`

---

### 9. Set Password
**POST** `/auth/set-password`

Set password for Google OAuth users (first time).

**Auth Required:** Yes

**Request Body:**
```json
{
  "password": "NewPass123!"
}
```

**Response:** `200 OK`

---

## Users & Profile

### 1. Get Current User (Me)
**GET** `/users/me`

Get authenticated user's profile.

**Auth Required:** Yes

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "CUSTOMER",
    "phone": "+8801712345678",
    "avatarUrl": "https://...",
    "customerProfile": { ... },
    "courierProfile": null,
    "hubManagerProfile": null
  }
}
```

---

### 2. Update Profile
**PATCH** `/users/me`

Update authenticated user's profile (supports multipart/form-data for avatar upload).

**Auth Required:** Yes

**Request Body (JSON or FormData):**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phone": "+8801712345679"
}
```

Or with file upload:
```
FormData:
  - firstName: "John"
  - lastName: "Smith"
  - avatar: <file>
```

**Response:** `200 OK`

---

### 3. List Users (Admin)
**GET** `/users`

List all users with pagination.

**Auth Required:** Yes (ADMIN only)

**Query Parameters:**
- `page` (optional, default: 1)
- `limit` (optional, default: 10, max: 100)
- `role` (optional): CUSTOMER, COURIER, HUB_MANAGER, OPERATIONS_MANAGER, ADMIN
- `search` (optional): Search by name or email

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5
  }
}
```

---

### 4. Get User by ID (Admin)
**GET** `/users/:id`

Get specific user details.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`

---

### 5. Update User Role (Admin)
**PATCH** `/users/:id/role`

Update user's role.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "role": "COURIER"
}
```

**Response:** `200 OK`

---

### 6. Assign/Unassign Courier Hub (Admin)
**PATCH** `/users/:id/courier-hub`

Assign or unassign courier to a hub.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "hubId": "cm..." 
}
```

To unassign, set `hubId` to `null`.

**Response:** `200 OK`

---

### 7. Delete User (Admin)
**DELETE** `/users/:id`

Soft delete a user.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`

---

## Shipments

### 1. Create Shipment
**POST** `/shipments`

Create a new shipment.

**Auth Required:** Yes (CUSTOMER or ADMIN)

**Request Body:**
```json
{
  "senderName": "John Doe",
  "senderPhone": "+8801712345678",
  "senderAddress": "123 Street, Dhaka",
  "senderCity": "Dhaka",
  "recipientName": "Jane Smith",
  "recipientPhone": "+8801798765432",
  "recipientAddress": "456 Avenue, Chittagong",
  "recipientCity": "Chittagong",
  "deliveryType": "STANDARD",
  "packageType": "DOCUMENT",
  "declaredWeightKg": 0.5,
  "declaredValue": 1000,
  "fragile": false,
  "description": "Important documents"
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "message": "Shipment created",
  "data": {
    "id": "cm...",
    "trackingNumber": "LF-20261008-FA193830",
    "status": "PENDING_PAYMENT",
    "price": 150,
    ...
  }
}
```

---

### 2. List Shipments
**GET** `/shipments`

List shipments with filtering and pagination.

**Auth Required:** Yes

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10, max: 100)
- `status`: PENDING_PAYMENT, PAYMENT_CONFIRMED, PICKED_UP, AT_ORIGIN_HUB, IN_TRANSIT, AT_DESTINATION_HUB, OUT_FOR_DELIVERY, DELIVERED, DELIVERY_FAILED, RETURNED, CANCELLED
- `search`: Search by tracking number or recipient name

**Role-based filtering:**
- CUSTOMER: Own shipments only
- COURIER: Assigned shipments only
- HUB_MANAGER: Shipments at their hub only
- OPERATIONS_MANAGER/ADMIN: All shipments

**Response:** `200 OK`

---

### 3. Get Shipment by ID
**GET** `/shipments/:id`

Get shipment details.

**Auth Required:** Yes

**Response:** `200 OK`

---

### 4. Update Shipment
**PATCH** `/shipments/:id`

Update shipment details (before pickup).

**Auth Required:** Yes (CUSTOMER or ADMIN)

**Request Body:**
```json
{
  "recipientName": "Jane Doe",
  "recipientPhone": "+8801798765433",
  "recipientAddress": "New Address"
}
```

**Response:** `200 OK`

---

### 5. Cancel Shipment
**POST** `/shipments/:id/cancel`

Cancel a shipment.

**Auth Required:** Yes (CUSTOMER, OPERATIONS_MANAGER, or ADMIN)

**Request Body:**
```json
{
  "reason": "Customer changed mind"
}
```

**Response:** `200 OK`

---

### 6. Request Pickup
**POST** `/shipments/:id/pickup-request`

Request courier pickup for paid shipment.

**Auth Required:** Yes (CUSTOMER or ADMIN)

**Request Body:**
```json
{
  "pickupAddress": "123 Street, Dhaka",
  "pickupPhone": "+8801712345678",
  "preferredDate": "2026-10-10",
  "preferredTimeSlot": "MORNING",
  "notes": "Please call before arriving"
}
```

**Response:** `200 OK`

---

### 7. Get Shipment Tracking
**GET** `/shipments/:id/tracking`

Get tracking history and current status.

**Auth Required:** Yes

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "shipment": { ... },
    "events": [
      {
        "status": "PAYMENT_CONFIRMED",
        "timestamp": "2026-10-08T10:00:00Z",
        "location": "Dhaka",
        "notes": "Payment verified"
      },
      ...
    ]
  }
}
```

---

### 8. Initiate Return
**POST** `/shipments/:id/return`

Initiate return shipment process.

**Auth Required:** Yes (OPERATIONS_MANAGER or ADMIN)

**Request Body:**
```json
{
  "reason": "Delivery failed - recipient unavailable",
  "notes": "Attempted 3 times"
}
```

**Response:** `200 OK`

---

## Tracking (Public)

### 1. Public Tracking
**GET** `/tracking/:trackingNumber`

Track shipment by tracking number (no authentication required).

**Example:** `/tracking/LF-20261008-FA193830`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "trackingNumber": "LF-20261008-FA193830",
    "status": "IN_TRANSIT",
    "origin": "Dhaka",
    "destination": "Chittagong",
    "estimatedDelivery": "2026-10-12",
    "events": [...]
  }
}
```

---

## Payments

### 1. Initiate bKash Payment
**POST** `/payments/bkash/initiate`

Create bKash payment for shipment.

**Auth Required:** Yes (CUSTOMER or ADMIN)

**Request Body:**
```json
{
  "shipmentId": "cm..."
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "message": "bKash payment initiated",
  "data": {
    "paymentId": "cm...",
    "bkashURL": "https://tokenized.sandbox.bka.sh/v1.2.0-beta/...",
    "amount": 150
  }
}
```

---

### 2. bKash Callback
**GET** `/payments/bkash/callback`

bKash redirects here after payment (public, no auth).

**Query Parameters:**
- `paymentID`
- `status`

---

### 3. Create Stripe Checkout
**POST** `/payments/stripe/checkout`

Create Stripe checkout session.

**Auth Required:** Yes (CUSTOMER or ADMIN)

**Request Body:**
```json
{
  "shipmentId": "cm..."
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "message": "Stripe checkout created",
  "data": {
    "paymentId": "cm...",
    "checkoutUrl": "https://checkout.stripe.com/...",
    "sessionId": "cs_..."
  }
}
```

---

### 4. Stripe Webhook
**POST** `/payments/stripe/webhook`

Stripe webhook for payment events (public, no auth).

---

### 5. Get Payment by Shipment
**GET** `/payments/shipment/:shipmentId`

Get payment status for a shipment.

**Auth Required:** Yes

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "shipmentId": "cm...",
    "provider": "STRIPE",
    "status": "COMPLETED",
    "amount": 150,
    "currency": "BDT",
    "transactionId": "pi_...",
    "completedAt": "2026-10-08T10:05:00Z"
  }
}
```

---

### 6. Verify Stripe Payment
**POST** `/payments/stripe/verify/:shipmentId`

Manually verify Stripe payment status.

**Auth Required:** Yes (CUSTOMER or ADMIN)

**Response:** `200 OK`

---

### 7. List All Payments (Admin)
**GET** `/payments`

List all payments with pagination.

**Auth Required:** Yes (ADMIN only)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `status`: PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED
- `provider`: BKASH, STRIPE

**Response:** `200 OK`

---

## Courier Endpoints

### 1. Get Assignments
**GET** `/courier/assignments`

Get courier's assignments with filtering.

**Auth Required:** Yes (COURIER)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `status`: PENDING, ACCEPTED, IN_PROGRESS, COMPLETED, REJECTED, CANCELLED
- `type`: PICKUP, DELIVERY

**Response:** `200 OK`

---

### 2. Get Assignment Details
**GET** `/courier/assignments/:id`

Get specific assignment details.

**Auth Required:** Yes (COURIER)

**Response:** `200 OK`

---

### 3. Accept Assignment
**PATCH** `/courier/assignments/:id/accept`

Accept an assignment.

**Auth Required:** Yes (COURIER)

**Response:** `200 OK`

---

### 4. Reject Assignment
**PATCH** `/courier/assignments/:id/reject`

Reject an assignment.

**Auth Required:** Yes (COURIER)

**Request Body:**
```json
{
  "reason": "Vehicle breakdown"
}
```

**Response:** `200 OK`

---

### 5. Update Availability
**PATCH** `/courier/availability`

Update courier availability status.

**Auth Required:** Yes (COURIER)

**Request Body:**
```json
{
  "availability": "AVAILABLE"
}
```

Values: `AVAILABLE`, `ON_DUTY`, `OFF_DUTY`

**Response:** `200 OK`

---

### 6. Confirm Pickup
**POST** `/courier/shipments/:shipmentId/pickup-confirm`

Confirm shipment pickup from sender.

**Auth Required:** Yes (COURIER)

**Response:** `200 OK`

---

### 7. Record Delivery
**POST** `/courier/shipments/:shipmentId/deliver`

Record successful delivery (with proof image).

**Auth Required:** Yes (COURIER)

**Request Body (multipart/form-data):**
```
FormData:
  - recipientName: "John Doe"
  - proofImage: <file>
  - notes: "Delivered successfully"
```

**Response:** `200 OK`

---

### 8. Record Delivery Failure
**POST** `/courier/shipments/:shipmentId/delivery-failed`

Record failed delivery attempt.

**Auth Required:** Yes (COURIER)

**Request Body:**
```json
{
  "failureReason": "RECIPIENT_UNAVAILABLE",
  "notes": "Called 3 times, no answer"
}
```

Failure reasons: `RECIPIENT_UNAVAILABLE`, `INCORRECT_ADDRESS`, `REFUSED`, `OTHER`

**Response:** `200 OK`

---

### 9. Get Earnings
**GET** `/courier/earnings`

Get courier earnings summary.

**Auth Required:** Yes (COURIER)

**Query Parameters:**
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "totalEarnings": 5000,
    "completedDeliveries": 50,
    "thisMonth": 1200,
    "breakdown": [...]
  }
}
```

---

## Hubs & Zones

### 1. List Hub Destinations
**GET** `/hubs/destinations`

Get all active hubs (for transfer dropdown).

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "cm...",
      "name": "Dhaka Main Hub",
      "city": "Dhaka"
    },
    ...
  ]
}
```

---

### 2. Create Hub
**POST** `/hubs`

Create a new hub.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "name": "Dhaka Main Hub",
  "code": "DHK-01",
  "address": "123 Main St, Dhaka",
  "city": "Dhaka",
  "phone": "+8801712345678"
}
```

**Response:** `201 Created`

---

### 3. List Hubs
**GET** `/hubs`

List all hubs with filtering.

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `isActive`: true/false
- `search`: Search by name or city

**Response:** `200 OK`

---

### 4. Get Hub by ID
**GET** `/hubs/:id`

Get hub details.

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Response:** `200 OK`

---

### 5. Update Hub
**PATCH** `/hubs/:id`

Update hub details.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "name": "Dhaka Central Hub",
  "phone": "+8801712345679"
}
```

**Response:** `200 OK`

---

### 6. Deactivate Hub
**DELETE** `/hubs/:id`

Deactivate a hub.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`

---

### 7. Create Hub Transfer
**POST** `/hubs/:hubId/transfers`

Transfer shipment to another hub.

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Request Body:**
```json
{
  "shipmentId": "cm...",
  "toHubId": "cm...",
  "estimatedArrival": "2026-10-10T14:00:00Z",
  "notes": "Express transfer"
}
```

**Response:** `201 Created`

---

### 8. Confirm Hub Transfer Arrival
**PATCH** `/hubs/:hubId/transfers/:transferId/arrive`

Confirm shipment arrived at destination hub.

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Response:** `200 OK`

---

### 9. List Hub Transfers
**GET** `/hubs/:hubId/transfers`

List transfers for a hub.

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `status`: PENDING, IN_TRANSIT, ARRIVED, CANCELLED

**Response:** `200 OK`

---

### 10. List Unassigned Hub Managers
**GET** `/hubs/unassigned-managers`

Get users with HUB_MANAGER role not assigned to any hub.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`

---

### 11. Get Hub Manager
**GET** `/hubs/:id/manager`

Get hub manager details.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`

---

### 12. Assign Hub Manager
**PUT** `/hubs/:id/manager`

Assign a hub manager to a hub.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "userId": "cm..."
}
```

**Response:** `200 OK`

---

### 13. Remove Hub Manager
**DELETE** `/hubs/:id/manager`

Remove hub manager from a hub.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "userId": "cm..."
}
```

**Response:** `200 OK`

---

### 14. List Hub Couriers
**GET** `/hubs/:id/couriers`

List all couriers assigned to a hub.

**Auth Required:** Yes (HUB_MANAGER or ADMIN)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)

**Response:** `200 OK`

---

### 15. Create Zone
**POST** `/zones`

Create a delivery zone.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "name": "Mirpur Zone",
  "code": "DHK-MIR",
  "hubId": "cm...",
  "description": "Mirpur area coverage"
}
```

**Response:** `201 Created`

---

### 16. List Zones
**GET** `/zones`

List all zones.

**Auth Required:** Yes (or PUBLIC for customers)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `hubId`: Filter by hub
- `isActive`: true/false (customers only see active)

**Response:** `200 OK`

---

### 17. Update Zone
**PATCH** `/zones/:id`

Update zone details.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "name": "Mirpur Extended Zone",
  "description": "Updated coverage area"
}
```

**Response:** `200 OK`

---

### 18. Delete Zone
**DELETE** `/zones/:id`

Deactivate a zone.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`

---

## Operations Endpoints

### 1. Create Assignment
**POST** `/operations/assignments`

Assign courier to a shipment.

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Request Body:**
```json
{
  "shipmentId": "cm...",
  "courierProfileId": "cm...",
  "type": "PICKUP"
}
```

Type: `PICKUP` or `DELIVERY`

**Response:** `201 Created`

---

### 2. List Assignments
**GET** `/operations/assignments`

List all assignments.

**Auth Required:** Yes (OPERATIONS_MANAGER or ADMIN)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `status`: PENDING, ACCEPTED, IN_PROGRESS, COMPLETED, REJECTED, CANCELLED
- `type`: PICKUP, DELIVERY

**Response:** `200 OK`

---

### 3. Cancel Assignment
**PATCH** `/operations/assignments/:id/cancel`

Cancel an assignment.

**Auth Required:** Yes (OPERATIONS_MANAGER or ADMIN)

**Request Body:**
```json
{
  "reason": "Courier unavailable"
}
```

**Response:** `200 OK`

---

### 4. Update Shipment Status
**PATCH** `/operations/shipments/:id/status`

Force update shipment status (admin override).

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Request Body:**
```json
{
  "status": "AT_DESTINATION_HUB"
}
```

**Response:** `200 OK`

---

### 5. List Couriers
**GET** `/operations/couriers`

List all couriers with filtering.

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `availability`: AVAILABLE, ON_DUTY, OFF_DUTY
- `hubId`: Filter by hub

**Response:** `200 OK`

---

### 6. Update Courier Availability
**PATCH** `/operations/couriers/:courierProfileId/availability`

Update courier's availability status (admin).

**Auth Required:** Yes (HUB_MANAGER, OPERATIONS_MANAGER, or ADMIN)

**Request Body:**
```json
{
  "availability": "AVAILABLE"
}
```

**Response:** `200 OK`

---

## Pricing

### 1. Calculate Price
**POST** `/pricing/calculate`

Calculate shipping price (public, no auth).

**Request Body:**
```json
{
  "originCity": "Dhaka",
  "destinationCity": "Chittagong",
  "deliveryType": "STANDARD",
  "weightKg": 2.5,
  "declaredValue": 5000
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "price": 250,
    "basePrice": 150,
    "weightCharge": 75,
    "insuranceCharge": 25,
    "breakdown": [...]
  }
}
```

---

### 2. Create Pricing Rule
**POST** `/pricing/rules`

Create a new pricing rule.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "name": "Dhaka to Chittagong Standard",
  "originCity": "Dhaka",
  "destinationCity": "Chittagong",
  "deliveryType": "STANDARD",
  "basePrice": 150,
  "perKgRate": 30,
  "insuranceRate": 0.5
}
```

**Response:** `201 Created`

---

### 3. List Pricing Rules
**GET** `/pricing/rules`

List all pricing rules.

**Auth Required:** Yes (ADMIN only)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `isActive`: true/false
- `deliveryType`: STANDARD, EXPRESS, SAME_DAY

**Response:** `200 OK`

---

### 4. Update Pricing Rule
**PATCH** `/pricing/rules/:id`

Update a pricing rule.

**Auth Required:** Yes (ADMIN only)

**Request Body:**
```json
{
  "basePrice": 175,
  "perKgRate": 35
}
```

**Response:** `200 OK`

---

### 5. Deactivate Pricing Rule
**DELETE** `/pricing/rules/:id`

Deactivate a pricing rule.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`

---

## Notifications

### 1. List Notifications
**GET** `/notifications`

Get user's notifications.

**Auth Required:** Yes

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)
- `isRead`: true/false
- `type`: SHIPMENT_CREATED, PAYMENT_COMPLETED, COURIER_ASSIGNED, OUT_FOR_DELIVERY, DELIVERED, DELIVERY_FAILED

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "unreadCount": 5
  }
}
```

---

### 2. Mark Notification as Read
**PATCH** `/notifications/:id/read`

Mark a notification as read.

**Auth Required:** Yes

**Response:** `200 OK`

---

### 3. Mark All Notifications as Read
**PATCH** `/notifications/read-all`

Mark all user's notifications as read.

**Auth Required:** Yes

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "5 notifications marked as read"
}
```

---

## Admin Endpoints

### 1. Get System Stats
**GET** `/admin/stats`

Get system statistics dashboard.

**Auth Required:** Yes (ADMIN only)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "totalUsers": 1250,
    "totalShipments": 5430,
    "totalRevenue": 815000,
    "activeShipments": 142,
    "deliveredToday": 89,
    "pendingPayments": 23,
    "usersByRole": {
      "CUSTOMER": 1000,
      "COURIER": 200,
      "HUB_MANAGER": 20,
      "OPERATIONS_MANAGER": 10,
      "ADMIN": 20
    },
    "shipmentsByStatus": {...},
    "revenueByMonth": [...]
  }
}
```

---

### 2. Get Audit Logs
**GET** `/admin/audit-logs`

Get system audit logs (all actions).

**Auth Required:** Yes (ADMIN only)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 50)
- `action`: CREATE, UPDATE, DELETE, LOGIN, LOGOUT, PAYMENT, STATUS_CHANGE, etc.
- `userId`: Filter by user
- `startDate`: ISO date string
- `endDate`: ISO date string

**Response:** `200 OK`

---

### 3. Get Operational Audit Logs
**GET** `/admin/audit-logs/operational`

Get operational audit logs (shipments, assignments, etc.).

**Auth Required:** Yes (OPERATIONS_MANAGER or ADMIN)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 50)
- `entityType`: SHIPMENT, ASSIGNMENT, HUB_TRANSFER, PAYMENT
- `entityId`: Specific entity ID
- `startDate`: ISO date string
- `endDate`: ISO date string

**Response:** `200 OK`

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/auth/register` | 5 requests / 15 minutes |
| `/auth/verify-email` | 5 requests / 15 minutes |
| `/auth/login` | 10 requests / 15 minutes |
| `/auth/google` | 10 requests / 15 minutes |
| `/tracking/:trackingNumber` | 20 requests / minute |

---

## Error Codes

| Status | Description |
|--------|-------------|
| `400` | Bad Request - Invalid input |
| `401` | Unauthorized - Missing or invalid token |
| `403` | Forbidden - Insufficient permissions |
| `404` | Not Found - Resource doesn't exist |
| `409` | Conflict - Duplicate or constraint violation |
| `422` | Unprocessable Entity - Validation failed |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error |
| `503` | Service Unavailable |

---

## Common Enums

### Shipment Status
```
PENDING_PAYMENT
PAYMENT_CONFIRMED
PICKED_UP
AT_ORIGIN_HUB
IN_TRANSIT
AT_DESTINATION_HUB
OUT_FOR_DELIVERY
DELIVERED
DELIVERY_FAILED
RETURNED
CANCELLED
```

### Delivery Type
```
STANDARD
EXPRESS
SAME_DAY
```

### Package Type
```
DOCUMENT
PARCEL
FRAGILE
```

### User Role
```
CUSTOMER
COURIER
HUB_MANAGER
OPERATIONS_MANAGER
ADMIN
```

### Courier Availability
```
AVAILABLE
ON_DUTY
OFF_DUTY
```

### Assignment Status
```
PENDING
ACCEPTED
IN_PROGRESS
COMPLETED
REJECTED
CANCELLED
```

### Payment Status
```
PENDING
PROCESSING
COMPLETED
FAILED
REFUNDED
```

### Payment Provider
```
BKASH
STRIPE
```

---

## Postman Collection

A complete Postman collection with all endpoints is available in the `/postman` directory:
- `LogiFlow.postman_collection.json` - All endpoints
- `LogiFlow.postman_environment.json` - Environment variables

Import both files into Postman to get started quickly!

---

## Support

For issues or questions:
- Documentation: This file
- Postman Collection: `/postman` directory
- Backend Repository: LogiFlow_Backend

---

**Last Updated:** October 8, 2026
**API Version:** v1
