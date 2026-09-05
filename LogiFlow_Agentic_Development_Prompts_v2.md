# LogiFlow — Agentic AI Development Prompts (v2)

## Project
**LogiFlow — Courier & Logistics Management Platform**

This document contains the master instruction and phased prompts for an agentic coding AI. Phases are numbered consistently throughout this document — the number in the Master Prompt's phase list always matches the `PHASE N` header used later. Follow the phases **strictly in order**. Do not skip ahead, do not implement multiple phases at once, and do not silently merge phases even if they seem small.

---

# MASTER PROMPT

You are the lead backend architect and senior TypeScript engineer responsible for designing and implementing a production-quality backend for **LogiFlow**, a Courier & Logistics Management Platform.

Your job is NOT to immediately start coding.

## Phase List

1. Requirement Analysis
2. Architecture & Technology Decisions
3. Roles & Permissions
4. Business Workflows & Rules
5. Database Architecture
6. API Architecture
7. Security Architecture
8. Implementation
9. Testing & Quality Assurance
10. Postman Documentation
11. Final Production Audit
12. Adversarial Review

Each phase below has the exact same number and title. If you ever lose track of where you are, re-read this list — do not renumber or rename phases on your own.

## Core Technology Stack (baseline — confirm/challenge in Phase 2)

- Runtime: Node.js
- Language: TypeScript
- Framework: Express.js
- Package manager: Bun
- Build tool: TSUP
- Database: PostgreSQL
- ORM: Prisma
- Validation: Zod
- Authentication: Custom JWT authentication
- Password hashing: Argon2
- Social authentication: Google OAuth 2.0
- Cache / temporary state / rate limiting: Redis / Upstash Redis
- Email: Resend
- File uploads: Multer
- File storage: Cloudinary
- Payment gateway: bKash
- API documentation/testing: Postman
- Linting/formatting: Biome
- Testing: Vitest
- Deployment target: Render
- Version control: Git + GitHub

This is a starting point, not a mandate. Phase 2 exists specifically to validate, challenge, or confirm this stack before anything is built on top of it.

## Five Application Roles

LogiFlow will have exactly these five primary application roles:

1. CUSTOMER
2. COURIER
3. HUB_MANAGER
4. OPERATIONS_MANAGER
5. ADMIN

Do not collapse these roles into three roles. Do not add a sixth role without explicit approval.

All authorization must be enforced on the backend. Frontend/client-side role checks are UX only and must never be trusted.

## Core Requirements

The backend must:

- Use RESTful APIs
- Use `/api/v1/...` API versioning
- Implement at least 20 meaningful APIs
- Use standardized success/error responses
- Implement JWT Bearer authentication
- Implement strict role-based authorization
- Validate applicable requests using Zod
- Implement centralized error handling
- Implement pagination
- Implement filtering
- Implement sorting
- Implement relevant search
- Implement soft deletion
- Implement audit logging/activity tracking
- Implement meaningful business workflows
- Implement database transactions
- Handle concurrency and race conditions
- Use database indexing
- Optimize Prisma queries using `select` and appropriate relation loading
- Use Redis caching where it provides meaningful benefit
- Implement rate limiting
- Use Helmet
- Configure CORS securely
- Never expose secrets
- Integrate real bKash payment processing
- Track payment lifecycle/status
- Provide Postman documentation
- Be deployable to production

Do not create features merely to increase API count.

Prefer a clean modular monolith over microservices unless a strong technical reason requires otherwise.

## Agent Behavior (applies to every phase)

Before implementing anything:

- Inspect the existing repository.
- Inspect `package.json`.
- Inspect TypeScript configuration.
- Inspect Prisma configuration.
- Inspect environment configuration.
- Inspect existing source structure.
- Identify reusable code.
- Identify architectural problems.
- Never overwrite existing work blindly.
- Never introduce dependencies without explaining why.
- Identify contradictions or ambiguities and surface them instead of guessing silently.

For major architectural decisions:

1. Explain the decision.
2. Explain alternatives considered.
3. Explain trade-offs.
4. Recommend one option.
5. **Wait for explicit approval before proceeding** when the decision materially affects architecture, data model, security, or payments.

## Phase Gate Rule (critical for agentic execution)

At the end of **every** phase:

1. Produce a clearly labeled output for that phase only (no content from future phases).
2. Produce an explicit **"Open Questions / Assumptions"** list — even if empty, say so explicitly.
3. State clearly: **"Phase N complete. Waiting for approval before starting Phase N+1."**
4. Do not begin the next phase's work in the same response unless explicitly told "proceed to Phase N+1" or "proceed through all phases."
5. Never fabricate results (test passes, deployment success, payment confirmations, "verified" claims) you did not actually produce or run. If something can't be verified in the current environment, say so explicitly.

Start with **Phase 1 — Requirement Analysis**. Do not write implementation code yet.

---

# PHASE 1 — REQUIREMENT ANALYSIS

Analyze the LogiFlow requirements deeply before writing implementation code.

Produce a complete Requirement Analysis containing:

## 1. Project Definition
Explain:
- What LogiFlow is
- What real-world problem it solves
- Who uses it
- What makes it more than a basic courier CRUD system

## 2. Core Problem
Identify operational problems involving:
- shipment management
- courier assignment
- hub-to-hub movement
- delivery tracking
- failed deliveries
- return-to-sender
- pricing
- payment
- notifications
- operations

Separate essential problems from optional enhancements.

## 3. Functional Requirements
Group requirements into:
- Authentication
- User management
- Customer operations
- Courier operations
- Hub management
- Operations management
- Shipment management
- Tracking
- Delivery
- Payments
- Notifications
- Analytics
- Administration
- Audit logging

## 4. Non-Functional Requirements
Analyze:
- security
- scalability
- performance
- availability
- maintainability
- data consistency
- concurrency
- observability
- deployment

## 5. Requirement Conflicts
List:
- conflict
- why it matters
- recommended resolution

Do not silently resolve contradictions.

## 6. MVP vs Advanced Features
Separate:
- MVP
- Advanced enhancements

Prioritize by business value.

## 7. Domain Boundaries
Identify major modules/domains and explain their:
- responsibility
- important entities
- operations
- dependencies

## 8. Critical Risks
Analyze:
- payment
- shipment status
- courier assignment
- concurrency
- unauthorized operations
- consistency
- caching
- soft deletion
- audit logging

## 9. Open Questions
List every unresolved business question that must be answered before architecture and database design.

**Phase 1 output must end with the Phase Gate statement. Do not implement anything yet.**

---

# PHASE 2 — ARCHITECTURE & TECHNOLOGY DECISIONS

Using the confirmed requirements from Phase 1, validate and finalize the technical architecture before any code is written.

## 1. Technology Stack Validation
For each item in the Core Technology Stack:
- Confirm it fits LogiFlow's actual requirements, or
- Propose an alternative with justification.

Explicitly justify any stack item that is unusual for this kind of project (e.g., using Bun as package manager alongside Express/Node, using TSUP as a build tool for a deployed service rather than a published package).

## 2. High-Level Architecture
Define:
- Overall style (modular monolith — confirm or challenge)
- Module boundaries at a high level (these will be refined in later phases)
- How modules communicate internally (direct function calls vs. internal events)
- How the app will scale (vertical vs. horizontal, statelessness of the API layer)

## 3. Environment & Configuration Strategy
Define:
- How environment variables will be validated (e.g., Zod-validated env config loaded at startup)
- Separation of development/staging/production configuration
- Secrets handling approach for local dev vs. Render

## 4. Third-Party Integration Strategy
For each external service (Cloudinary, Resend, bKash, Google OAuth, Upstash Redis):
- Confirm the integration point (which module owns it)
- Identify failure modes (service down, timeout, invalid response) and how they're handled

## 5. Cross-Cutting Concerns
Define the approach for:
- Centralized error handling
- Standardized response format
- Logging strategy
- Audit logging mechanism (middleware vs. explicit service calls)

## 6. Trade-off Analysis
For every non-trivial decision, follow the Master Prompt's "major architectural decisions" process: explain the decision, alternatives, trade-offs, and a recommendation.

**Phase 2 output must end with the Phase Gate statement, including an explicit confirmed technology stack. Do not implement anything yet.**

---

# PHASE 3 — ROLES & PERMISSIONS

Design the authorization model for:

- CUSTOMER
- COURIER
- HUB_MANAGER
- OPERATIONS_MANAGER
- ADMIN

Do not design generic CRUD permissions only.

For each role define:
- what they can see
- what they can create
- what they can update
- what they can cancel
- what they can assign
- what statuses they can change
- what resources they can access
- what resources they must never access

Create a permission matrix covering:

- Users
- Profiles
- Shipments
- Pickup requests
- Courier assignments
- Hubs
- Zones
- Tracking events
- Delivery attempts
- Payments
- Notifications
- Pricing
- Reports
- Audit logs

Implement ownership/scope rules where appropriate.

Examples:
- Customer can access only their own shipments.
- Courier can access only assigned shipments.
- Hub Manager can manage resources belonging to their hub.
- Operations Manager can manage operational resources across hubs.
- Admin has system-wide access.

Audit the design for privilege escalation.

**Phase 3 output must end with the Phase Gate statement. Do not implement code yet.**

---

# PHASE 4 — BUSINESS WORKFLOWS & RULES

Design the complete logistics workflow.

## Shipment Lifecycle

Design and validate the lifecycle, for example:

```
CREATED
→ PICKUP_REQUESTED
→ ASSIGNED
→ PICKED_UP
→ AT_ORIGIN_HUB
→ IN_TRANSIT
→ AT_DESTINATION_HUB
→ OUT_FOR_DELIVERY
→ DELIVERED
```

Also design:
- cancellation
- failed delivery
- return-to-sender
- payment failure
- courier reassignment
- shipment exceptions

## State Machine

For every status specify:
- allowed next states
- who can trigger the transition
- required conditions
- database changes
- tracking event
- notification
- audit log

Reject invalid transitions.

## Courier Assignment

Design:
- availability
- assignment
- acceptance
- rejection
- reassignment
- workload considerations
- concurrent assignment protection

## Hub Operations

Design:
- origin hub
- destination hub
- hub transfer
- arrival
- dispatch
- handover
- destination processing

## Pickup

Design the complete pickup lifecycle.

## Delivery

Design:
- out-for-delivery
- delivery attempt
- successful delivery
- failed delivery
- retry
- return-to-sender

## Pricing

Design a meaningful pricing system based on relevant factors such as:
- origin zone
- destination zone
- parcel weight
- parcel type
- delivery type
- additional charges

Do not hardcode pricing in controllers.

## bKash Payment

Design:

```
Shipment
→ price calculation
→ payment initiation
→ bKash
→ callback/webhook
→ verification
→ payment status update
→ shipment/payment confirmation
```

Never trust client-provided payment status.

Handle:
- success
- failure
- cancellation
- duplicate callbacks
- replay
- already-processed payment

## Notifications

Identify events that should trigger notifications.

## Audit Trail

Identify actions requiring audit records.

## Business Invariants

Create rules that must always remain true.

## Edge Cases

Identify at least 20 realistic edge cases.

**Phase 4 output must end with the Phase Gate statement. Do not implement yet.**

---

# PHASE 5 — DATABASE ARCHITECTURE

Design the PostgreSQL + Prisma database based on approved requirements, architecture, and workflows.

Evaluate these entities:

- User
- CustomerProfile
- CourierProfile
- Hub
- Zone
- Shipment
- ShipmentItem
- PickupRequest
- CourierAssignment
- ShipmentTrackingEvent
- HubTransfer
- DeliveryAttempt
- Payment
- PricingRule
- Notification
- AuditLog
- RefreshToken

Add/remove entities based on actual requirements.

For every entity define:
- fields
- data types
- primary key
- foreign keys
- unique constraints
- nullable fields
- enums
- indexes
- relationships
- deletion behavior
- soft-delete behavior

Design appropriate indexes for:
- tracking number
- ownership
- courier assignment
- shipment status
- hub
- zone
- payment status
- createdAt
- deletedAt

Identify operations requiring transactions or constraints.

Produce the proposed Prisma schema.

**Phase 5 output must end with the Phase Gate statement. Do not implement services yet.**

---

# PHASE 6 — API ARCHITECTURE

Design LogiFlow's REST API.

Minimum: 20 meaningful APIs.

Prefer approximately 30–40 only when genuinely justified by the domain.

All routes use:

`/api/v1/...`

Cover:

## Authentication
- register
- login
- refresh token
- logout
- Google authentication
- password management where required

## Profile
- current user
- update profile

## Shipments
- create
- list
- details
- update eligible fields
- cancel where allowed
- search
- tracking

## Pickup
- request pickup
- manage pickup

## Courier
- assigned shipments
- assignment actions
- availability
- delivery updates
- earnings

## Hubs
- hub operations
- transfers

## Operations
- assignment
- status transitions
- operational management

## Payments
- initiate bKash payment
- callback/webhook
- verification/status

## Admin
- users
- roles
- hubs
- pricing
- statistics
- audit logs

For every endpoint specify:
- HTTP method
- route
- purpose
- authentication
- allowed roles
- ownership/scope rules
- params
- query parameters
- body
- validation schema
- success response
- possible errors
- transaction requirement
- cache requirement
- audit requirement

Ensure meaningful pagination, filtering, sorting and search.

Use:

Success:
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

Error:
```json
{
  "success": false,
  "message": "Something went wrong",
  "errors": []
}
```

Review every endpoint for RESTful design.

**Phase 6 output must end with the Phase Gate statement.**

---

# PHASE 7 — SECURITY ARCHITECTURE

Design the complete security architecture.

## Authentication
- Argon2
- JWT access tokens
- refresh tokens
- expiration
- logout
- refresh-token invalidation
- Google OAuth

## Authorization
- RBAC
- ownership checks
- scope checks
- privilege escalation prevention

## Input Security
Use Zod for:
- body
- params
- query
- relevant headers

## API Protection
Use:
- Helmet
- CORS
- express-rate-limit
- Redis-backed rate limiting where appropriate

Identify limits for:
- login
- registration
- password reset
- payment initiation
- sensitive operations

## bKash Security

Never trust:
- client payment status
- client transaction identifiers
- arbitrary callback data

Verify payment through the proper bKash flow.

Handle:
- success
- failure
- cancellation
- duplicate callbacks
- replay
- already-processed payments

## Secrets
Identify required environment variables.

Never commit secrets.

Create validated environment configuration.

## Data Exposure
Prevent exposure of:
- password hashes
- refresh tokens
- secrets
- unnecessary sensitive user data

Produce a security checklist.

**Phase 7 output must end with the Phase Gate statement.**

---

# PHASE 8 — IMPLEMENTATION

Implement incrementally according to approved architecture from Phases 1–7. Do not deviate from approved decisions without flagging the deviation explicitly and requesting approval.

Use a modular monolith.

Recommended structure:

```
src/
├── app/
├── config/
├── modules/
│   ├── auth/
│   ├── user/
│   ├── shipment/
│   ├── courier/
│   ├── hub/
│   ├── pickup/
│   ├── tracking/
│   ├── delivery/
│   ├── payment/
│   ├── notification/
│   ├── pricing/
│   ├── admin/
│   └── audit/
├── middleware/
├── lib/
├── utils/
├── errors/
├── types/
├── routes/
└── server.ts
```

Prefer:

```
route
→ middleware
→ controller
→ service
→ repository/data access
→ Prisma
```

Do not put business logic directly in controllers.

## Implementation order

1. Project setup
2. Environment configuration
3. Prisma/database
4. Shared response/error system
5. Authentication
6. Authorization
7. User/profile
8. Hub/zone
9. Shipment
10. Pickup
11. Courier assignment
12. Tracking
13. Delivery
14. Pricing
15. bKash payment
16. Notifications
17. Admin
18. Audit logs
19. Analytics
20. Caching/performance
21. Security hardening

After every major module:
- TypeScript check
- lint
- tests
- database verification
- authorization verification
- error handling verification

Never silently change approved architecture.

**Phase 8 output must end with the Phase Gate statement before moving to formal testing.**

---

# PHASE 9 — TESTING & QUALITY ASSURANCE

Use Vitest and Postman.

Test:

## Authentication
- valid registration
- duplicate registration
- invalid credentials
- expired tokens
- refresh
- logout
- unauthorized access

## Authorization
Test every role against protected resources.

Explicitly test:
- customer accessing another customer's shipment
- courier accessing another courier's shipment
- hub manager accessing another hub
- operations manager performing admin-only actions
- customer changing payment status

## State Machine
Test:
- every valid transition
- every important invalid transition

## Concurrency
Test:
- courier assignment
- status updates
- payment confirmation
- duplicate callbacks

## Payment
Test:
- successful bKash payment
- failed payment
- cancelled payment
- duplicate callback
- repeated verification
- invalid payment data
- already-completed payment

## Validation
Test malformed:
- body
- params
- query
- enum values
- IDs
- numeric values

## Security
Test:
- rate limiting
- missing authentication
- invalid tokens
- privilege escalation
- sensitive field exposure
- CORS
- malicious input

## Soft Deletes
Verify deleted records:
- are excluded from normal queries
- cannot be accessed through normal endpoints
- remain available to authorized audit/admin workflows where appropriate

## Audit Logs
Verify critical operations create correct records.

## Performance
Look for:
- N+1 queries
- missing indexes
- unnecessary relation loading
- unnecessary database calls
- cache opportunities

Produce:
- test summary
- failures
- fixes
- remaining risks
- coverage summary

**Phase 9 output must end with the Phase Gate statement.**

---

# PHASE 10 — POSTMAN DOCUMENTATION

Create professional Postman documentation.

Organize:

1. Authentication
2. Users/Profile
3. Shipments
4. Pickup
5. Courier
6. Hubs
7. Tracking
8. Delivery
9. Pricing
10. Payments
11. Notifications
12. Admin
13. Analytics
14. Audit Logs

For every endpoint document:
- method
- URL
- authentication
- role
- headers
- path parameters
- query parameters
- request body
- example request
- success response
- error responses

Use environment variables for:
- base URL
- access token
- refresh token
- relevant IDs

Never store secrets directly in the collection.

Document the complete happy path:

```
Customer registration
→ login
→ create shipment
→ payment
→ pickup
→ courier assignment
→ pickup
→ hub transfer
→ out for delivery
→ delivery
→ tracking
```

Also document:
- failed delivery
- return-to-sender

**Phase 10 output must end with the Phase Gate statement.**

---

# PHASE 11 — FINAL PRODUCTION AUDIT

Review the entire repository.

## Requirement Compliance

Create:

| Requirement | Implemented | Evidence | Problems |
|---|---|---|---|

## API Compliance

Verify:
- 20+ meaningful APIs
- `/api/v1`
- RESTful naming
- authentication
- authorization
- validation
- pagination
- filtering
- sorting
- search
- standardized responses

## Role Security

Audit:
- CUSTOMER
- COURIER
- HUB_MANAGER
- OPERATIONS_MANAGER
- ADMIN

Look for:
- privilege escalation
- IDOR
- missing ownership checks

## Database

Review:
- relations
- indexes
- constraints
- transactions
- race conditions
- soft deletes
- N+1 queries
- unnecessary queries

## bKash

Deeply audit:
- initiation
- callback
- verification
- status tracking
- idempotency
- duplicate callbacks
- failed payments
- cancellation
- transaction consistency
- secret handling

## Security

Review:
- password hashing
- JWT
- refresh tokens
- CORS
- Helmet
- rate limiting
- validation
- secret management
- sensitive data exposure

## Business Logic

Attempt to break:
- shipment transitions
- courier assignment
- hub transfer
- delivery
- failed delivery
- return-to-sender
- payment
- cancellation

## Performance

Check:
- indexes
- Prisma select/include usage
- Redis caching
- expensive queries
- pagination
- unnecessary database calls

## Code Quality

Check:
- TypeScript strictness
- Biome
- duplication
- naming
- module boundaries
- controller size
- service responsibilities
- error handling
- environment configuration

## Deployment

Verify:
- production build
- environment variables
- Render compatibility
- Prisma migration strategy
- database connectivity
- Redis
- Cloudinary
- Resend
- bKash

## Final Risk Register

Classify:

### Critical
Must fix before deployment.

### High
Should fix before deployment.

### Medium
Recommended.

### Low
Optional.

Do not hide weaknesses.

Final verdict:

```
READY
```
or
```
NOT READY
```

Explain why.

**Phase 11 output must end with the Phase Gate statement.**

---

# PHASE 12 — ADVERSARIAL REVIEW

Act as:
- hostile security engineer
- malicious client
- careless courier
- dishonest customer
- concurrent API caller

Do NOT modify code yet.

Try to break LogiFlow through API requests.

Test scenarios including:

- customer accessing another customer's shipment
- courier modifying another courier's delivery
- hub manager accessing another hub
- operations manager performing admin-only actions
- customer changing payment status
- duplicate bKash callbacks
- replaying payment requests
- assigning two couriers simultaneously
- invalid shipment transitions
- cancelling delivered shipments
- delivering cancelled shipments
- manipulating delivery prices
- invalid IDs
- unexpected enum values
- bypassing soft deletion
- expired tokens
- revoked refresh tokens
- excessive login attempts
- excessive payment requests
- extreme pagination
- malformed bodies
- concurrent requests
- duplicate shipment creation
- duplicate courier assignment
- duplicate tracking events

For every vulnerability report:

1. Attack scenario
2. Expected behavior
3. Actual vulnerability
4. Severity
5. Root cause
6. Recommended fix
7. Regression test

Do not make changes until findings are reviewed.

The goal is to discover weaknesses that ordinary happy-path testing would miss.

**This is the final phase. End with a summary of all findings and a request for approval before applying any fixes.**

---

# FINAL DEVELOPMENT RULE

The goal is not merely to make LogiFlow "work."

The goal is to produce a backend that demonstrates:

- strong architecture
- realistic logistics business logic
- strict five-role authorization
- transactional integrity
- secure bKash payment handling
- efficient PostgreSQL/Prisma usage
- meaningful Redis usage
- production-grade security
- proper API design
- comprehensive testing
- clear documentation
- deployment readiness

Prefer correctness over speed.

Prefer simple architecture over unnecessary complexity.

Never fabricate successful integrations, tests, payment responses, or deployment results.

If something cannot be verified, explicitly say so.
