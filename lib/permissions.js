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
