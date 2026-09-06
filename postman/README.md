# LogiFlow — Postman Documentation

## Files

| File | Description |
|---|---|
| `LogiFlow.postman_collection.json` | Full API collection (61 endpoints, 12 folders) |
| `LogiFlow.postman_environment.json` | Environment variables (baseUrl, tokens, IDs) |

## Import Instructions

1. Open Postman
2. Click **Import** → drag both JSON files in
3. Select the **LogiFlow API Environment** from the environment dropdown (top right)
4. Run **Register** or **Login** — test scripts auto-populate `accessToken` and `refreshToken`

## Folder Structure

| # | Folder | Endpoints |
|---|---|---|
| 1 | Authentication | Register, Login, Refresh, Logout, Google OAuth, Change Password |
| 2 | Users & Profile | Get Me, Update Me, List Users, Get User, Update Role, Delete User |
| 3 | Shipments | Create, List, Get, Update, Cancel, Request Pickup, Track, Initiate Return |
| 4 | Public Tracking | Public tracking by tracking number (no auth) |
| 5 | Payments | Initiate bKash, bKash Callback info, Get by Shipment, List All |
| 6 | Courier | Assignments, Accept/Reject, Availability, Confirm Pickup, Deliver, Fail, Earnings |
| 7 | Hubs & Zones | Create/List/Get/Update/Deactivate Hub, Transfers, Create/List Zones |
| 8 | Operations | Assign Courier, Cancel Assignment, Force Status, List Couriers, Update Availability |
| 9 | Pricing | Calculate, Create/List/Update/Deactivate Rules |
| 10 | Notifications | List, Mark Read, Mark All Read |
| 11 | Admin | Stats, Audit Logs, Operational Audit Logs |
| 12 | Complete Happy Path | 12-step end-to-end workflow |

## Environment Variables

| Variable | Set By | Description |
|---|---|---|
| `baseUrl` | Manual | API base URL (`http://localhost:3000/api/v1`) |
| `accessToken` | Auto (Login/Register) | JWT access token |
| `refreshToken` | Auto (Login/Register) | Opaque refresh token |
| `userId` | Auto (Login/Register) | Authenticated user ID |
| `shipmentId` | Auto (Create Shipment) | Created shipment ID |
| `trackingNumber` | Auto (Create Shipment) | Generated tracking number |
| `paymentId` | Auto (Initiate Payment) | Payment record ID |
| `hubId` | Auto (Create Hub) | Hub ID |
| `zoneId` | Auto (Create Zone) | Zone ID |
| `pricingRuleId` | Auto (Create Rule) | Pricing rule ID |
| `assignmentId` | Auto (Assign Courier) | Assignment ID |
| `courierProfileId` | Manual | Courier profile ID |
| `notificationId` | Manual | Notification ID |

## Role-Based Testing

To test different roles:
1. Register users with different roles (use Admin panel to change roles after registering)
2. Log in as each role
3. The collection includes tests that verify 403/401 responses for unauthorized access

## bKash Payment Testing

1. Set `BKASH_BASE_URL` in `.env` to sandbox URL
2. Run **Initiate bKash Payment** → copy the `bkashURL` from response
3. Open the URL in a browser → complete payment on bKash sandbox
4. Server callback processes automatically → check **Get Payment by Shipment** to verify status

## Happy Path (Folder 12)

Run all 12 steps in order for a complete end-to-end workflow:
- Steps 1-5: Customer creates account, books shipment, pays
- Steps 6-7: Operations assigns courier, courier picks up
- Steps 8-9: Hub transfer to destination
- Steps 10-11: Delivery courier assigned, delivers
- Step 12: Public tracking shows DELIVERED status
