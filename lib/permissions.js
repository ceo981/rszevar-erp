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
// frontend doAction helper). For those routes, we look up the actor's role
// via profiles, then check role_permissions directly.
//
// May 9 2026 fix — Robust matching:
//   1. Trim email (whitespace bugs)
//   2. Use ILIKE (case-insensitive) — auth.user.email aati hai lowercase mein,
//      but profiles.email kabhi kabhi capitalized stored hoti hai
//   3. .limit(1) to handle dup rows gracefully
//   4. Diagnostic error messages — agar lookup fail ho, exact reason batao
//      taa-ke debug aasaan ho (e.g. dikhata hai konsa email try kiya)
//   5. Console logs for server-side visibility
//
// Returns: { allowed: boolean, role: string|null, reason: string|null }
//
// Caller pattern:
//   const supabase = createServerClient();
//   const check = await checkPermissionByEmail(supabase, performed_by_email, 'orders.return_restock');
//   if (!check.allowed) {
//     return NextResponse.json({ success: false, error: check.reason }, { status: 403 });
//   }
// ============================================================================
export async function checkPermissionByEmail(supabase, email, permissionKey) {
  if (!email) {
    return { allowed: false, role: null, reason: 'Email missing — frontend ne performed_by_email nahi bheji. Logout/login try karein.' };
  }
  if (!permissionKey) {
    return { allowed: false, role: null, reason: 'Permission key missing (developer error)' };
  }

  const cleanEmail = String(email).trim();
  if (!cleanEmail) {
    return { allowed: false, role: null, reason: 'Email khali hai (whitespace only)' };
  }

  // 1. Look up role from profiles — case-insensitive via ILIKE.
  //    .limit(1) handles dup rows gracefully (shouldn't happen but defensive).
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('role, email')
    .ilike('email', cleanEmail)
    .limit(1);

  if (profErr) {
    console.error('[checkPermissionByEmail] profile lookup error:', profErr.message);
    return { allowed: false, role: null, reason: `Profile lookup DB error: ${profErr.message}` };
  }

  const profile = (profiles && profiles.length > 0) ? profiles[0] : null;

  if (!profile) {
    console.warn(`[checkPermissionByEmail] No profile found for email: "${cleanEmail}". Permission key requested: ${permissionKey}`);
    return {
      allowed: false,
      role: null,
      reason: `Profile not found for email '${cleanEmail}'. Admin se kaho ke /users page se aapka profile setup kare.`,
    };
  }

  const role = profile.role;
  if (!role) {
    return {
      allowed: false,
      role: null,
      reason: `Profile mila lekin role assigned nahi hai (email: ${cleanEmail}). Admin se role assign karwao.`,
    };
  }

  // 2. Super admin always has all permissions (mirrors client-side `can()`)
  if (role === 'super_admin') {
    return { allowed: true, role, reason: null };
  }

  // 3. Check role_permissions for the specific grant
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
