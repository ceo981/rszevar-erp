import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types'

export interface CurrentUser {
  id: string
  email: string
  profile: Profile
  permissions: Set<string>
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Fetch profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  // Fetch permissions from view
  const { data: perms } = await supabase
    .from('my_permissions')
    .select('permission_key')

  const permissions = new Set<string>(
    (perms ?? []).map((p) => p.permission_key as string)
  )

  return {
    id: user.id,
    email: user.email ?? profile.email ?? '',
    profile: profile as Profile,
    permissions,
  }
}

export function hasPermission(user: CurrentUser | null, key: string): boolean {
  if (!user) return false
  // super_admin always yes (belt + suspenders)
  if (user.profile.role === 'super_admin') return true
  return user.permissions.has(key)
}

export function hasAnyPermission(
  user: CurrentUser | null,
  keys: string[]
): boolean {
  if (!user) return false
  if (user.profile.role === 'super_admin') return true
  return keys.some((k) => user.permissions.has(k))
}
