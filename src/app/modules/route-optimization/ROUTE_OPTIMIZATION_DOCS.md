# Hub Route Optimization Module — Day 4

**Module path:** `src/app/modules/route-optimization/`  
**API base:** `/api/v1/routes/`  
**Migration:** `prisma/migrations/20261115000000_add_hub_routes/`

---

## Overview

The route optimization module models the LogiFlow hub network as a weighted directed graph and uses Dijkstra's shortest-path algorithm to find the lowest-cost route between any two hubs.

**What this is:**
- A route *recommendation* system. It computes the theoretical optimal path.
- Deterministic: identical input always produces identical output.
- Explainable: each segment's cost is explicit in the response.

**What this is not:**
- A real-time navigation system (no GPS, no traffic, no road distances).
- An automatic shipment mover. It never modifies shipment status or creates tracking events.
- A replacement for the existing manual hub-transfer workflow.

---

## Graph Representation

| Concept | Logistics meaning |
|---|---|
| Vertex (node) | A hub (`Hub` model, active, non-deleted) |
| Directed edge | A `HubRoute` record — one allowed transportation connection |
| Edge weight | `HubRoute.cost` — a positive floating-point composite weight |
| Adjacency list | `Map<hubId, { to: hubId, cost: number }[]>` |

The graph is **directed**: a route from Hub A to Hub B does not imply a route from B to A. Bidirectional connections require two `HubRoute` records.

---

## Cost Model

**Selected: Fixed transportation cost (unitless composite weight).**

Each `HubRoute.cost` is a positive number configured by an admin. It represents the relative effort or expense of moving a shipment along that connection — it is not currency, kilometres, or minutes.

| Why this model |
|---|
| Deterministic — same input always produces the same result |
| Explainable — operations teams understand "5 is cheaper than 12" |
| Admin-configurable — costs can be tuned to reflect real operational priorities without schema changes |
| No dependency on real-world data that doesn't yet exist in the system |

**Future extension:** When actual travel times or distances are available, they can be integrated by updating `cost` values or adding new weighted fields. The algorithm does not change.

---

## Algorithm — Dijkstra's Shortest Path

### Implementation

File: `dijkstra.ts`

Uses a binary min-heap priority queue (`min-heap.ts`) for efficient node extraction.

```
Time:  O((V + E) log V)
Space: O(V + E)
```

Where V = number of active hubs and E = number of active routes.

For the current LogiFlow network (3 hubs, ~6 routes), this is effectively O(1). The implementation is correct for networks of any size.

### Algorithm steps

1. Set `dist[source] = 0`, all others = Infinity.
2. Insert source into the min-heap with priority 0.
3. Extract the node with the smallest known distance.
4. Skip if already visited (stale heap entry).
5. For each outgoing edge from this node, compute `newDist = dist[current] + edge.cost`.
6. If `newDist < dist[neighbour]`, update and push to heap.
7. Exit early when the destination node is finalized.
8. Reconstruct the path by following predecessor references backward from destination to source.

### Edge case handling

| Case | Behaviour |
|---|---|
| Source = destination | Returns immediately: path = [source], cost = 0, segments = [] |
| Unknown source/destination | Returns `found: false` |
| No path | Returns `found: false` |
| Disconnected graph | Returns `found: false` for unreachable nodes |
| Negative edge weight | Throws `GraphError` (Dijkstra requires non-negative weights) |
| Inactive hubs | Excluded from graph construction — not reachable |
| Inactive routes | Excluded from edge list — cannot be traversed |
| Zero-cost edge | Supported — results in a path that traverses the free connection |
| Duplicate edges | Both are relaxed; the cheaper one wins |

---

## Database Changes

### New: `prisma/schema/route.prisma`

**New model: `HubRoute`** (`@@map("hub_routes")`)

| Field | Type | Notes |
|---|---|---|
| `id` | `String` (cuid) | PK |
| `fromHubId` | `String` | FK → `Hub.id` |
| `toHubId` | `String` | FK → `Hub.id` |
| `cost` | `Float` | Positive weight, default 1 |
| `isActive` | `Boolean` | Soft-disable without deletion |
| `createdAt` | `DateTime` | Auto-set |
| `updatedAt` | `DateTime` | Auto-updated |

Constraints: `@@unique([fromHubId, toHubId])` — one directed edge per pair.  
Indexes: `fromHubId`, `toHubId`, `isActive`.

### Modified: `prisma/schema/hub.prisma`
Added `routesFrom HubRoute[] @relation("RouteFromHub")` and `routesTo HubRoute[] @relation("RouteToHub")`.

---

## API Endpoints

### `GET /api/v1/routes/optimize`

Find the lowest-cost route between two hubs.

**Auth:** `OPERATIONS_MANAGER`, `HUB_MANAGER`, `ADMIN`  
**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `fromHubId` | cuid | Source hub ID |
| `toHubId` | cuid | Destination hub ID (must differ from fromHubId) |

**Response (HTTP 200):**
```json
{
  "data": {
    "fromHubId": "...", "fromHubName": "Dhaka Central Hub",
    "toHubId": "...", "toHubName": "Chattogram Port Hub",
    "path": ["hub_id_A", "hub_id_B", "hub_id_C"],
    "pathLabels": ["Dhaka Central Hub", "Cumilla Regional Hub", "Chattogram Port Hub"],
    "totalCost": 12,
    "segments": [
      { "from": "hub_id_A", "to": "hub_id_B", "fromLabel": "Dhaka Central Hub", "toLabel": "Cumilla Regional Hub", "cost": 5 },
      { "from": "hub_id_B", "to": "hub_id_C", "fromLabel": "Cumilla Regional Hub", "toLabel": "Chattogram Port Hub", "cost": 7 }
    ],
    "found": true,
    "algorithm": "Dijkstra's shortest path (binary min-heap)",
    "optimizedAt": "2026-11-15T...",
    "costUnit": "relative cost units"
  }
}
```

If no route exists: `found: false`, empty `path` and `segments`.

---

### `GET /api/v1/routes/shipments/:shipmentId/optimized-route`

Find the optimal route for a specific shipment based on its origin/destination zones.

**Auth:** `OPERATIONS_MANAGER`, `HUB_MANAGER`, `ADMIN`  
**Hub scoping:** `HUB_MANAGER` sees only shipments at their hub or originating from their zone.  
**Returns:** Same as `/optimize`, plus `shipmentId` and `trackingNumber`.

---

### `GET /api/v1/routes`

List all hub routes (paginated). **Admin only.**

**Query:** `page`, `limit`, `isActive` (`true`/`false`)

---

### `POST /api/v1/routes`

Create a new directed hub route. **Admin only.**

**Body:** `{ fromHubId, toHubId, cost, isActive? }`

---

### `PATCH /api/v1/routes/:id`

Update route cost or active status. **Admin only.**

**Body:** `{ cost?, isActive? }`

---

### `DELETE /api/v1/routes/:id`

Delete a route. Existing shipment history is unaffected. **Admin only.**

---

## To Activate (Initial Setup)

After running the migration, an admin must add `HubRoute` records via the API or the Route Network page at `/dashboard/admin/routes`.

Suggested initial routes for the seeded hubs (bidirectional):

```
POST /api/v1/routes  { fromHubId: <dhaka_id>, toHubId: <cumilla_id>, cost: 5 }
POST /api/v1/routes  { fromHubId: <cumilla_id>, toHubId: <dhaka_id>, cost: 5 }
POST /api/v1/routes  { fromHubId: <dhaka_id>, toHubId: <ctg_id>, cost: 12 }
POST /api/v1/routes  { fromHubId: <ctg_id>, toHubId: <dhaka_id>, cost: 12 }
POST /api/v1/routes  { fromHubId: <cumilla_id>, toHubId: <ctg_id>, cost: 7 }
POST /api/v1/routes  { fromHubId: <ctg_id>, toHubId: <cumilla_id>, cost: 7 }
```

With these routes, the optimal path from Dhaka to Chattogram is:  
**Dhaka → Cumilla → Chattogram** (cost 12) rather than **Dhaka → Chattogram** (cost 12 direct).  
If a direct Dhaka→Chattogram route is added with cost > 12, the algorithm will correctly prefer the indirect route.

---

## Known Limitations

1. **No geographic coordinates.** Hub nodes have no lat/lng — the frontend displays a hub-to-hub timeline, not a map.
2. **Admin-configured costs only.** Costs do not automatically reflect real travel times, distances, or fuel costs. They must be tuned manually.
3. **No caching.** Each `GET /routes/optimize` call rebuilds the graph from the database. For the current scale (3 hubs), this is fast. At larger scale, a 60-second Redis cache (invalidated on route create/update/delete) would be appropriate.
4. **Route recommendation only.** The optimizer never modifies shipment status or creates hub transfers automatically.
5. **Directed graph only.** A route from A to B does not imply a route from B to A.

---

## Testing

```bash
npm test -- --reporter=verbose dijkstra
```

19 tests in `src/tests/unit/dijkstra.test.ts`. Covers all algorithm paths and MinHeap operations.
