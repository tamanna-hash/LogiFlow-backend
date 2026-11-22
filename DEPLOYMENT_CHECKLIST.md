# 🚀 LogiFlow Deployment Checklist — Days 1–4

This checklist ensures all Day 1–4 features are production-ready before deploying to Render.

---

## ✅ Pre-Deployment Verification

### 1. Code Quality & Type Safety
- [x] `npm run type-check` — 0 TypeScript errors (backend)
- [x] `npm run type-check` — 0 TypeScript errors (frontend)
- [x] `npm run lint` — no ESLint/Biome errors
- [x] `npm test` — 312+ tests passing (4 pre-existing failures are OK)
- [x] `npm run build` — backend builds successfully (tsup → dist/server.js)
- [x] `npm run build` — frontend builds successfully (Next.js production bundle)

### 2. Database Integrity
- [x] `npx prisma validate` — schema is valid
- [x] All migrations applied locally: `npm run db:migrate:prod`
- [x] Migrations are purely additive (no DROP TABLE or destructive ALTER statements)
- [x] Migration files:
  - [x] `20261114000000_add_shipment_risk_assessment`
  - [x] `20261115000000_add_hub_routes`
- [x] Seed script runs without errors: `npm run db:seed`

### 3. Environment Variables — Production Render Service
Ensure these are set in your Render dashboard under **Environment**:

#### ✅ Required (existing)
- `DATABASE_URL` — PostgreSQL connection string with SSL
- `NODE_ENV=production`
- `PORT` — Render auto-assigns
- `JWT_ACCESS_SECRET` — 64+ char random string
- `JWT_REFRESH_SECRET` — different 64+ char random string
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `FRONTEND_URL` — your Vercel deployment URL
- `RESEND_API_KEY` or Gmail SMTP credentials
- `EMAIL_PROVIDER=resend` or `gmail`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `BKASH_*` credentials (username, password, app key, app secret, callback URL)
- `MAX_DELIVERY_ATTEMPTS=3`

#### ⚠️ NEW — Days 1–4 Additions
- **`GEMINI_API_KEY`** (optional but recommended)
  - Get from: https://aistudio.google.com/app/apikey (free tier, no credit card)
  - Format: `AIzaSy...`
  - If not set, AI investigation endpoint returns `503 Service Unavailable`
  - **Security:** Server-side only — never expose via `NEXT_PUBLIC_*`

- **`EMAIL_PROVIDER=resend`** (was missing from render.yaml)
  - Set explicitly if using Resend (default)

- **`DEMO_DOMAIN=demo.logiflow.app`** (optional)
  - Restricts demo accounts to read-only operations
  - Omit if you want demo accounts to have full write access

### 4. Frontend Environment Variables — Vercel
Ensure these are set in your Vercel project settings:

#### ✅ Required (existing)
- `NEXT_PUBLIC_API_BASE_URL` — your Render backend URL
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — browser-safe Maps JavaScript API key
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` — production map ID

#### ✅ Confirmed NOT needed on frontend
- ❌ `OPENAI_API_KEY` — **NEVER** add this to frontend env vars
- ❌ Any `STRIPE_SECRET_KEY` or `BKASH_*` secrets — backend only

---

## 🔧 Deployment Steps

### Step 1: Push to Git
```bash
git add .
git commit -m "feat: Days 1-4 — risk engine, AI investigation, route optimization"
git push origin main
```

### Step 2: Deploy Backend (Render)
1. Go to your Render dashboard → **LogiFlow Backend** service
2. **Environment** tab → verify all new env vars are set (see checklist above)
3. **Manual Deploy** → Deploy latest commit
4. Wait for build logs:
   - ✅ `npm ci` completes
   - ✅ `npm run build` produces `dist/server.js`
   - ✅ Migrations apply: `npm run db:migrate:prod`
   - ✅ Server starts on assigned port
5. Health check: `https://your-backend.onrender.com/health` → `{ status: 'ok' }`

### Step 3: Verify Database Migrations on Production
```bash
# Option A: Via Render shell (dashboard → Shell tab)
npx prisma migrate status --schema=./prisma/schema

# Should show:
# ✅ 20261114000000_add_shipment_risk_assessment (applied)
# ✅ 20261115000000_add_hub_routes (applied)

# Option B: Check tables exist via Prisma Studio (locally with prod DB URL)
DATABASE_URL="postgresql://..." npx prisma studio
# Verify tables: shipment_risk_assessments, hub_routes
```

### Step 4: Seed Production Data (First Deployment Only)
```bash
# If this is the first deployment with Days 1-4:
npm run db:seed

# Seeder creates:
# - 3 demo hubs (Dhaka, Cumilla, Chattogram)
# - 6 hub routes (Dhaka→Cumilla, Cumilla→Chattogram, etc.)
# - 3 sample shipments with risk assessments
# - All demo accounts (admin@demo.logiflow.app, etc.)
```

⚠️ **Important:** The seeder is idempotent — safe to run multiple times. It checks for existing records before inserting.

### Step 5: Deploy Frontend (Vercel)
1. Vercel auto-deploys from `main` branch (if connected to GitHub)
2. Or manually: `vercel --prod`
3. Wait for build:
   - ✅ `npm run build` succeeds
   - ✅ All 5 new dashboard routes render without errors
4. Verify new pages load:
   - `/dashboard/admin/risk`
   - `/dashboard/admin/route-optimization`
   - `/dashboard/admin/routes`
   - `/dashboard/operations/risk`
   - `/dashboard/operations/route-optimization`

### Step 6: Smoke Test — Critical Paths
Use Postman or `curl` to verify:

#### 6.1 Risk Engine
```bash
# Login as admin
POST /api/v1/auth/login
{
  "email": "admin@demo.logiflow.app",
  "password": "LogiFlow2024!"
}
# → Save accessToken

# Risk overview
GET /api/v1/risk/overview
Authorization: Bearer <accessToken>
# → Should return { low: N, medium: N, high: N }

# List assessments
GET /api/v1/risk/assessments?page=1&limit=10
Authorization: Bearer <accessToken>
# → Should return paginated assessments
```

#### 6.2 AI Investigation (if OPENAI_API_KEY is set)
```bash
# Get a shipmentId from risk assessments
POST /api/v1/investigation/shipments/<shipmentId>/investigate
Authorization: Bearer <accessToken>
{
  "question": "Why is this shipment at risk?"
}
# → Should return structured AI report with findings + recommendations
```

**If OPENAI_API_KEY is NOT set:**
```bash
# Same request should return:
{
  "success": false,
  "message": "AI investigation is not configured. Set OPENAI_API_KEY."
}
# HTTP 503
```

#### 6.3 Route Optimization
```bash
# Get hub IDs from seed output or /api/v1/hubs
GET /api/v1/routes/optimize?fromHubId=<dhakaId>&toHubId=<ctgId>
Authorization: Bearer <accessToken>
# → Should return { found: true, path: [...], totalCost: 12, pathNames: [...] }

# List all routes
GET /api/v1/routes?page=1&limit=10
Authorization: Bearer <accessToken>
# → Should return paginated hub routes
```

#### 6.4 Frontend Dashboard
1. Login as `admin@demo.logiflow.app` / `LogiFlow2024!`
2. Navigate to `/dashboard/admin/risk`
   - ✅ Risk overview cards render
   - ✅ Assessment table loads
3. Navigate to `/dashboard/admin/route-optimization`
   - ✅ Hub dropdowns populate
   - ✅ "Find Route" returns a path
4. Navigate to `/dashboard/admin/routes`
   - ✅ Route table loads
   - ✅ Can create a new route (e.g., Dhaka → Sylhet, cost 10)

---

## 🧪 Post-Deployment Testing

### Automated Tests (CI/CD)
- **Backend:** 312+ tests pass on every deploy
- **Frontend:** Next.js build verifies all pages are statically analyzable

### Manual Regression Tests
1. **Risk Engine:**
   - Create a new shipment → verify it gets a risk assessment within 1 minute
   - Update shipment to `DELIVERY_FAILED` → risk score should increase

2. **AI Investigation:**
   - Investigate a high-risk shipment → verify report includes official risk score
   - Try to investigate as `HUB_MANAGER` for a shipment at another hub → should return 404

3. **Route Optimization:**
   - Query route from Hub A → Hub C via intermediate Hub B
   - Verify cost is sum of edge weights
   - Mark a route `isActive=false` → verify it's excluded from Dijkstra

4. **Hub Scoping (HUB_MANAGER role):**
   - Login as `hub.dhaka@demo.logiflow.app`
   - Risk overview should only show shipments at Dhaka hub
   - Route optimization should work (no hub scoping)
   - AI investigation should only work for Dhaka hub shipments

---

## 🔒 Security Verification

### Before Going Live
- [ ] `OPENAI_API_KEY` is set in Render (not in frontend env vars)
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are production-grade (64+ chars)
- [ ] Database URL uses SSL (`?sslmode=require`)
- [ ] All payment secrets (`STRIPE_SECRET_KEY`, `BKASH_*`) are server-side only
- [ ] Google OAuth callback URL matches production backend domain
- [ ] Rate limiting is active (Upstash Redis configured)
- [ ] CORS `origin` whitelist includes only `FRONTEND_URL`
- [ ] No `.env` files committed to Git (check `.gitignore`)

### Audit Trail
- [ ] All risk assessments are logged to `shipment_risk_assessments` table
- [ ] AI investigations create audit logs (action: `RISK_ASSESSMENT_CREATED` or custom)
- [ ] Route creation/update/delete creates audit logs (action: `HUB_UPDATED`)

---

## 📊 Monitoring & Alerts (Post-Deploy)

### Key Metrics to Watch
1. **Risk Engine:**
   - Query latency for `/api/v1/risk/overview` (should be <100ms with Redis cache)
   - Number of HIGH risk shipments (alert if >10% of total)

2. **AI Investigation:**
   - OpenAI API latency (expect 2-5 seconds per investigation)
   - 503 errors (indicates missing `OPENAI_API_KEY`)
   - Token usage (track costs via OpenAI dashboard)

3. **Route Optimization:**
   - Dijkstra execution time (should be <10ms for 3-hub network)
   - 404 errors on `/api/v1/routes/optimize` (indicates missing routes in DB)

4. **Database:**
   - `shipment_risk_assessments` table growth rate (~1 row per shipment per day)
   - `hub_routes` table size (stable — changes only via admin CRUD)

### Error Tracking
Set up Sentry or similar to catch:
- Unhandled promise rejections in investigation service
- Prisma query timeouts on risk overview (N+1 pattern at scale)
- OpenAI rate limit errors (429)

---

## 🐛 Known Issues & Workarounds

### Issue 1: N+1 Query in `getRiskOverview`
**Symptom:** Slow response time for risk overview when shipment count exceeds 100  
**Impact:** LOW (current scale: 3 hubs, ~10 shipments)  
**Workaround:** 2-minute Redis cache reduces query frequency  
**Fix:** Replace `Promise.all` + `findFirst` loop with raw SQL lateral join or materialized view (planned for Day 6+)

### Issue 2: Pre-existing Test Failures
**Symptom:** 4 tests fail in `hub.assignment.service.test.ts` and `stripe.service.test.ts`  
**Impact:** NONE — failures pre-date Days 1-4, do not affect Days 1-4 features  
**Status:** Tracked separately, not blocking deployment

### Issue 3: OpenAI Rate Limits
**Symptom:** 429 errors from OpenAI API during load testing  
**Impact:** MEDIUM — AI investigations fail temporarily  
**Workaround:** Exponential backoff + retry (3 attempts, 1s → 2s → 4s)  
**Prevention:** Use GPT-4.0-mini for lower cost + higher rate limits

---

## 🎯 Rollback Plan

If critical issues arise post-deploy:

### Option 1: Revert Code
```bash
git revert <commit_hash>
git push origin main
# Render auto-deploys the reverted code
```

### Option 2: Revert Database Migrations (DESTRUCTIVE — Last Resort)
```bash
# Only if Days 1-4 migrations cause corruption (unlikely — they're additive)
npx prisma migrate resolve --rolled-back 20261115000000_add_hub_routes
npx prisma migrate resolve --rolled-back 20261114000000_add_shipment_risk_assessment

# Then re-apply previous migrations
npm run db:migrate:prod
```

⚠️ **Warning:** Rolling back migrations will **delete** the `shipment_risk_assessments` and `hub_routes` tables and all their data. Only do this if the entire deployment is broken beyond repair.

### Option 3: Feature Flag (Future)
For Day 6+, consider adding a feature flag system to disable Days 1-4 features without code revert:
```env
FEATURE_RISK_ENGINE_ENABLED=false
FEATURE_AI_INVESTIGATION_ENABLED=false
FEATURE_ROUTE_OPTIMIZATION_ENABLED=false
```

---

## ✅ Final Checklist

Before marking deployment complete:

- [ ] Backend health check returns 200
- [ ] Frontend homepage loads without errors
- [ ] Admin can login and access all 3 new admin dashboards
- [ ] Operations Manager can access 2 new operations dashboards
- [ ] Risk overview returns data (not empty)
- [ ] AI investigation returns structured report (if OPENAI_API_KEY set) or 503 (if not set)
- [ ] Route optimization finds a valid path between any two hubs
- [ ] Hub-scoped access works (HUB_MANAGER sees only their hub's shipments)
- [ ] No new Sentry errors in the first 24 hours
- [ ] Database migration status shows all migrations applied

---

## 📞 Support

If deployment issues occur:
1. Check Render logs: Dashboard → Logs tab
2. Check Vercel logs: Vercel Dashboard → Deployments → Logs
3. Verify env vars: Render → Environment, Vercel → Settings → Environment Variables
4. Database connection: Test with `npx prisma studio` locally using production `DATABASE_URL`
5. OpenAI issues: Check https://status.openai.com

**Deployment Date:** _[Insert date here after successful deployment]_  
**Deployed By:** _[Your name]_  
**Commit SHA:** _[git rev-parse HEAD]_
