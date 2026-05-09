import { createClient } from './supabase/server';

// Server-side: get current user with profile + permissions
export async function getCurrentUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  const { data: perms } = await supabase
    .from('my_permissions')
    .select('permission_key');

  const permissions = new Set((perms || []).map((p) => p.permission_key));

  return {
    id: user.id,
    email: user.email || profile.email || '',
    profile,
    permissions,
  };
}

export function hasPermission(user, key) {
  if (!user) return false;
  if (user.profile.role === 'super_admin') return true;
  return user.permissions.has(key);
}

// ============================================================================
// May 8 2026 — Email-based permission check (for routes that don't use
// session auth and instead receive `performed_by_email` in the request body).
//
// Use case: API routes like /api/orders/return-restock, /api/orders/status,
// /api/orders/cancel that get the actor's email from the JSON body (set by
// frontend doAction helper). For those routes, we look up the actor's role,
// then check role_permissions directly.
//
// May 9 2026 — Major fix: SSR auth FIRST, email fallback.
//   Reason: profiles.email column may be NULL for some users — the canonical
//   link is `profiles.id = auth.users.id` (UUID), not email. AppShell uses
//   ID lookup (works), but my old helper used email lookup (fails when email
//   column is empty in profiles).
//
// New strategy:
//   1. Try session cookies via SSR client → get auth user ID → lookup profile
//      by id (most reliable, matches AppShell pattern)
//   2. If SSR fails (no session), fall back to email lookup (for service
//      contexts like cron jobs, server-to-server calls)
//   3. If both fail, return clear diagnostic error
//
// The function still accepts `email` param so the call signature doesn't break.
// Email is used as fallback identification when SSR auth isn't available.
//
// Note: this function uses TWO clients:
//   - SSR client (from cookies): only to get the auth.uid()
//   - Caller's supabase client (service role): for actual profile + perm queries
//
// Returns: { allowed: boolean, role: string|null, reason: string|null }
// ============================================================================
export async function checkPermissionByEmail(supabase, email, permissionKey) {
  if (!permissionKey) {
    return { allowed: false, role: null, reason: 'Permission key missing (developer error)' };
  }

  let profile = null;
  let lookupMethod = null;

  // ── Strategy 1: SSR auth → user.id → profile by id (canonical) ─────────────
  try {
    const ssr = await createClient();
    const { data: { user: authUser } } = await ssr.auth.getUser();
    if (authUser?.id) {
      const { data: p, error: pErr } = await supabase
        .from('profiles')
        .select('id, role, email')
        .eq('id', authUser.id)
        .maybeSingle();
      if (!pErr && p) {
        profile = p;
        lookupMethod = 'ssr_auth_id';
      }
    }
  } catch (e) {
    // SSR may fail outside request context — safe to fall through
    console.warn('[checkPermissionByEmail] SSR auth lookup skipped:', e.message);
  }

  // ── Strategy 2: Fallback to email-based lookup (case-insensitive) ──────────
  if (!profile && email) {
    const cleanEmail = String(email).trim();
    if (cleanEmail) {
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, role, email')
        .ilike('email', cleanEmail)
        .limit(1);

      if (profErr) {
        console.error('[checkPermissionByEmail] email lookup error:', profErr.message);
      } else if (profiles && profiles.length > 0) {
        profile = profiles[0];
        lookupMethod = 'email_ilike';
      }
    }
  }

  // ── Both strategies failed ────────────────────────────────────────────────
  if (!profile) {
    console.warn(
      `[checkPermissionByEmail] No profile found. email="${email || '(none)'}" permission="${permissionKey}". ` +
      `SSR auth and email-fallback both failed. Check that profile row exists with matching auth.user.id.`
    );
    return {
      allowed: false,
      role: null,
      reason: 'Permission verify nahi ho saka — session expire hua ho ya profile linked nahi. Logout/login try karo, phir bhi error aaye to admin se contact karo.',
    };
  }

  const role = profile.role;
  if (!role) {
    return {
      allowed: false,
      role: null,
      reason: `Profile mila (${lookupMethod}) lekin role assigned nahi hai. Admin se /users page se role assign karwao.`,
    };
  }

  // Super admin always has all permissions (mirrors client-side `can()`)
  if (role === 'super_admin') {
    return { allowed: true, role, reason: null };
  }

  // Check role_permissions for the specific grant
  const { data: rp, error: rpErr } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role', role)
    .eq('permission_key', permissionKey)
    .maybeSingle();

  if (rpErr) {
    console.error('[checkPermissionByEmail] role_permissions lookup error:', rpErr.message);
    return { allowed: false, role, reason: `Permission lookup DB error: ${rpErr.message}` };
  }

  if (rp) {
    return { allowed: true, role, reason: null };
  }

  return {
    allowed: false,
    role,
    reason: `Aapko (role: ${role}) '${permissionKey}' permission nahi hai. CEO se /roles page se grant karwao.`,
  };
}

// Labels for UI
export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Operations Manager',
  inventory_manager: 'Inventory Manager',
  dispatcher: 'Dispatcher',
  customer_support: 'Customer Support',
  wholesale_manager: 'Wholesale Manager',
  packing_staff: 'Packing Staff',
};

export const ALL_ROLES = [
  'super_admin',
  'admin',
  'manager',
  'inventory_manager',
  'dispatcher',
  'customer_support',
  'wholesale_manager',
  'packing_staff',
];
