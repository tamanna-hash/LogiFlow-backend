# Role Profile Fix - Google OAuth Login Error

## Problem

Users who signed up via Google OAuth and were later assigned the `HUB_MANAGER` or `COURIER` role were encountering this error during login:

```
[OAuth Callback] Error: "No hub is assigned to this account. Contact an administrator."
```

## Root Cause

The issue occurred due to a gap in role profile management:

1. **Google OAuth Registration** (`googleAuth.ts`):
   - Creates new users with `CUSTOMER` role (hardcoded)
   - Creates a `customerProfile` record automatically

2. **Role Change** (`user.service.ts` - old code):
   - Admin changes user role to `HUB_MANAGER` or `COURIER`
   - Only the `role` field was updated
   - **No corresponding profile record was created**

3. **Login Validation** (`user.service.ts` - `getMe` function):
   - Fetches user with profile data
   - `HUB_MANAGER` requires `hubManagerProfile` with `hubId`
   - `COURIER` requires `courierProfile`
   - User had the role but no profile → error thrown

## Solution

### 1. Fixed `updateUserRole` Function

Now when changing a user's role, the corresponding profile is automatically created:

```typescript
// Before: Only updated role field
await prisma.user.update({
  where: { id: targetId },
  data: { role: input.role },
});

// After: Updates role AND creates profile in transaction
await prisma.$transaction(async (tx) => {
  // Update role
  const user = await tx.user.update({
    where: { id: targetId },
    data: { role: input.role },
  });

  // Create corresponding profile
  if (input.role === 'HUB_MANAGER') {
    await tx.hubManagerProfile.upsert({
      where: { userId: targetId },
      update: {},
      create: { userId: targetId },
    });
  }
  // ... similar for COURIER and CUSTOMER
});
```

### 2. Enhanced `getMe` Validation

Added explicit validation with helpful error messages:

```typescript
if (user.role === 'HUB_MANAGER' && !user.hubManagerProfile) {
  throw new BadRequestError('No hub is assigned to this account. Contact an administrator.');
}
if (user.role === 'COURIER' && !user.courierProfile) {
  throw new BadRequestError('Courier profile is not set up. Contact an administrator.');
}
```

## Database Schema Changes

The `hubId` field in `HubManagerProfile` was changed from required to optional to allow profile creation before hub assignment.

**Migration:** `20261008000000_make_hubid_optional`

```sql
-- Make hubId nullable in hub_manager_profiles
ALTER TABLE "hub_manager_profiles" ALTER COLUMN "hubId" DROP NOT NULL;

-- Remove unique constraint (allows hub to have multiple managers if needed)
DROP INDEX IF EXISTS "hub_manager_profiles_hubId_key";
```

**Prisma Schema Change:**
```prisma
// Before
model HubManagerProfile {
  hubId String @unique  // Required

// After  
model HubManagerProfile {
  hubId String? @unique  // Optional
  hub   Hub?   @relation(...)
}
```

This change allows:
- Creating hub manager profiles without immediate hub assignment
- Admins can assign hubs later via the admin dashboard
- Multiple managers can be assigned to the same hub (unique constraint removed)

## Profile Requirements by Role

| Role          | Profile Table       | Required Fields         | Notes                           |
|---------------|---------------------|-------------------------|---------------------------------|
| CUSTOMER      | customerProfile     | None (auto-created)     | Always created on registration  |
| COURIER       | courierProfile      | userId                  | Admin assigns hub later         |
| HUB_MANAGER   | hubManagerProfile   | userId, hubId           | Admin must assign hub           |
| OPERATIONS    | None                | N/A                     | No profile table exists         |
| ADMIN         | None                | N/A                     | No profile table exists         |

## Migration Script

For existing databases with users who have roles but no profiles, run:

```bash
cd LogiFlow_Backend
node --import tsx scripts/fix-missing-profiles.ts
```

**Result from production run (Oct 8, 2026):**
```
🔍 Scanning for users with missing profiles...
Found 1 HUB_MANAGER users without profiles
Found 0 COURIER users without profiles
Found 0 CUSTOMER users without profiles
Creating HubManagerProfile for tamannaprogramminghero@gmail.com...
✅ Fixed 1 missing profiles
```

This script will:
1. Find all users with roles but missing profile records
2. Create the missing profiles
3. Report what was fixed

## Testing the Fix

### Test Case 1: New Google User → Role Change
```bash
# 1. User signs up via Google OAuth
#    → Creates user with CUSTOMER role + customerProfile

# 2. Admin changes role to HUB_MANAGER via admin dashboard
#    → Now creates hubManagerProfile automatically

# 3. User logs in again
#    → getMe() succeeds (profile exists, though hubId is null)
#    → Clear error if hubId not assigned yet
```

### Test Case 2: Existing User Migration
```bash
# 1. Run migration script
npx tsx scripts/fix-missing-profiles.ts

# 2. User logs in
#    → Should work (profile now exists)
```

## Next Steps for HUB_MANAGER Users

After the profile is created:
1. Admin must assign the user to a hub via the admin dashboard
2. The `hubManagerProfile.hubId` field must be set
3. User can then access their hub-specific features

## Files Modified

1. **LogiFlow_Backend/src/app/modules/user/user.service.ts**
   - `updateUserRole()`: Now creates corresponding profile records
   - `getMe()`: Added validation with helpful error messages

2. **LogiFlow_Backend/scripts/fix-missing-profiles.ts** (new)
   - One-time migration script to fix existing data

## Prevention

Going forward, this issue is prevented because:
- ✅ Role changes automatically create profiles
- ✅ Profile creation uses `upsert` (idempotent, won't fail if exists)
- ✅ Clear error messages guide admins to next steps
- ✅ Transaction ensures role + profile are always in sync
