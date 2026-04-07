import { redirect } from 'next/navigation'
import { getCurrentUser, hasPermission } from '@/lib/permissions/server'
import { createClient } from '@/lib/supabase/server'
import { RolesMatrix } from './roles-matrix'
import type { UserRole } from '@/types'

export default async function RolesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!hasPermission(user, 'settings.roles')) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
        <p className="text-zinc-400">
          Only Super Admin can manage roles and permissions.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  const [{ data: modules }, { data: permissions }, { data: rolePerms }] =
    await Promise.all([
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('permissions').select('*'),
      supabase.from('role_permissions').select('*'),
    ])

  const ALL_ROLES: UserRole[] = [
    'super_admin',
    'admin',
    'manager',
    'inventory_manager',
    'dispatcher',
    'customer_support',
    'wholesale_manager',
    'packing_staff',
  ]

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">
          Roles & Permissions
        </h1>
        <p className="text-zinc-500">
          Tick/untick to control what each role can access. Changes save instantly.
        </p>
      </div>

      <RolesMatrix
        roles={ALL_ROLES}
        modules={modules ?? []}
        permissions={permissions ?? []}
        initialRolePerms={rolePerms ?? []}
      />
    </div>
  )
}
