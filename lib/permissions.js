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
    return { allowed: false, role: null, reason: 'Email missing — cannot verify permission' };
  }
  if (!permissionKey) {
    return { allowed: false, role: null, reason: 'Permission key missing' };
  }

  // 1. Look up role from profiles
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('email', email)
    .maybeSingle();

  if (profErr) {
    return { allowed: false, role: null, reason: `Profile lookup failed: ${profErr.message}` };
  }
  if (!profile) {
    return { allowed: false, role: null, reason: 'User profile not found' };
  }

  const role = profile.role;

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
    return { allowed: false, role, reason: `Permission lookup failed: ${rpErr.message}` };
  }

  if (rp) {
    return { allowed: true, role, reason: null };
  }

  return {
    allowed: false,
    role,
    reason: `Aapko '${permissionKey}' permission nahi hai. Apne admin se contact karein.`,
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
