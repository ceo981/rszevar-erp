# Phase 7 — Chunk 3: Tags Management + Notifications + Business Rules Integration

## ⚡ This is the big one

After this chunk:
- **Tags tab** — add/edit/disable/delete tags from UI, filter dropdown auto-updates
- **Notifications tab** — email/WhatsApp alert preferences (future hooks)
- **Business rules ACTUALLY ENFORCED** — toggles in Business Rules tab now affect code behavior
- **Sync windows from settings** — change "Shopify sync window" from 3 → 7 days in settings, next sync uses the new value

---

## What changes

### 1. `lib/shopify.js` — `transformOrder` is now ASYNC
- Reads `business_rules` from settings
- Reads matching tag definitions from `tag_definitions` table
- Applies auto-actions respecting toggles (walkin_auto_deliver, auto_confirm_paid, etc.)
- Kangaroo courier override now comes from tag_definitions, not hardcoded

### 2. `lib/shopify-webhook.js` — updated to `await transformOrder()`
- **Critical:** Without this, webhooks would silently break after Chunk 3 (would insert Promise objects instead of order data)
- Also reads locked_statuses from settings

### 3. `app/api/shopify/sync/route.js` — reads sync window from settings
- `rules.shopify_sync_window_days` now drives how far back to fetch
- `rules.locked_statuses` drives what can't be overwritten

### 4. `app/api/courier/leopards/sync-status/route.js` — reads Leopards window
- `rules.leopards_sync_window_days` drives date range
- Cron uses this automatically too

### 5. New `lib/tags.js`
- Cached (60s) read/write for tag definitions
- `matchTagDefinitions(tags)` returns matched definitions
- Used by transformOrder to apply auto-actions

### 6. New `/api/settings/tags` — full CRUD
- GET → list tags
- POST → create (super_admin)
- PUT → update (super_admin)
- DELETE → delete (super_admin, blocks core tags)

### 7. Updated `app/settings/page.js`
- Tags tab with full UI (add form, edit, enable/disable, delete, protected core tags)
- Notifications tab wired (reuses existing SettingRow component)

---

## Files

```
settings-chunk3/
├── migrations/
│   └── settings-chunk3.sql                                ← run in Supabase
├── lib/
│   ├── tags.js                                            ← NEW
│   ├── shopify.js                                         ← REPLACES existing
│   └── shopify-webhook.js                                 ← REPLACES existing (CRITICAL)
├── app/
│   ├── api/
│   │   ├── settings/tags/route.js                         ← NEW
│   │   ├── shopify/sync/route.js                          ← REPLACES existing
│   │   └── courier/leopards/sync-status/route.js          ← REPLACES existing
│   └── settings/page.js                                   ← REPLACES existing
└── README.md
```

**1 SQL + 7 code files (2 new, 5 replacements)**

---

## ⚠️ IMPORTANT: Setup Order Matters

Follow these steps **exactly in order** — some steps depend on others.

### Step 1: Run SQL migration FIRST
Supabase → SQL Editor → paste `migrations/settings-chunk3.sql` → Run.

Verify:
```sql
SELECT tag_key, category FROM tag_definitions ORDER BY sort_order;
-- Should show 7 tags: wholesale, international, walkin, kangaroo, postex, leopards, order_confirmed

SELECT key FROM erp_settings_v2 WHERE category = 'notifications';
-- Should show 7 notification keys
```

### Step 2: Replace files (ALL AT ONCE, not one by one)
Extract zip → copy all files into project. The following must all go in together because they depend on each other:

- **NEW:** `lib/tags.js`
- **REPLACE:** `lib/shopify.js`
- **REPLACE:** `lib/shopify-webhook.js`
- **NEW:** `app/api/settings/tags/route.js`
- **REPLACE:** `app/api/shopify/sync/route.js`
- **REPLACE:** `app/api/courier/leopards/sync-status/route.js`
- **REPLACE:** `app/settings/page.js`

**Do not skip `lib/shopify-webhook.js`** — if you push the new `lib/shopify.js` without this file, Shopify webhooks will silently break.

### Step 3: Commit + push (one commit)
```bash
git add lib/tags.js lib/shopify.js lib/shopify-webhook.js app/api/settings/tags app/api/shopify/sync app/api/courier/leopards/sync-status app/settings/page.js
git commit -m "Phase 7 Chunk 3: Tags management + notifications + business rules integration"
git push
```

### Step 4: Test after deploy

**Test 1 — Settings page still works:**
Open `/settings`. All previous tabs should still work (Store, Business Rules, Shopify diagnostics, Leopards diagnostics, System Health, Audit Log).

**Test 2 — Tags tab:**
Click 🏷️ Tags tab. You should see 7 tags (wholesale, international, walkin, kangaroo, postex, leopards, order_confirmed) with "core" badge on 5 of them.

**Test 3 — Create a custom tag:**
Click "+ New Tag". Fill in:
- tag_key: `vip`
- label: `⭐ VIP Customer`
- category: custom
- color: `#fbbf24`
Click Create. Should appear in the list.

**Test 4 — Notifications tab:**
Should show 7 toggles/fields. Try toggling "Email Notifications Enabled" → Save → reload → verify persisted.

**Test 5 — Business rules actually enforced:**
Go to Business Rules tab → turn OFF "Walk-in → Auto Delivered" → Save. Then in Shopify, tag a new test order with `walkin`. Wait for webhook. Check ERP — order should NOT be auto-delivered anymore (stays pending). Turn it back ON to restore normal behavior.

**Test 6 — Webhook still works (MOST IMPORTANT):**
Create any test order in Shopify. Webhook should hit ERP within 5 seconds and create the order successfully. Check `/orders` page.

If Test 6 fails, the issue is in `lib/shopify-webhook.js`. Check Vercel logs for webhook errors.

**Test 7 — Sync from Shopify still works:**
Click "Sync from Shopify" button on orders page. Should complete normally with a message like "5 orders synced".

**Test 8 — Sync window from settings:**
Go to Business Rules → change "Shopify Sync Window (days)" to `7` → Save. Next sync should fetch 7 days instead of 3. (You can verify in the Vercel logs or from the sync response's `sync_window_days` field.)

---

## Rollback

If webhooks break or anything major goes wrong:
```bash
git revert HEAD
git push
```

SQL migration is safe to keep — only adds tables/seeds.

---

## Notes & limitations

- **Cache TTL is 60s** — after saving a business rule, it takes up to 60 seconds for the change to propagate to sync routes. Webhooks trigger cache refresh naturally.
- **Custom tags auto-action**: The form UI in Tags tab doesn't expose `auto_action` JSON editing yet — you create tags with empty auto_action and can set it later via API if needed. Core tags have their auto_action pre-seeded.
- **Notifications are preference-only**: The toggles save to DB but **no code actually sends emails yet**. That's a future phase. We're setting up the config so when we add email service, it just reads these settings.
- **tag_key cannot be changed after creation** (by design — prevents orphaning existing tagged orders).
- **Filter dropdown on orders page still uses hardcoded wholesale/international/walkin/kangaroo.** In a future chunk we can make it fully dynamic from `tag_definitions`, but that's not critical right now.
