import { redirect } from 'next/navigation'
import { getCurrentUser, hasPermission } from '@/lib/permissions/server'
import { createClient } from '@/lib/supabase/server'
import { UsersTable } from './users-table'
import type { Profile } from '@/types'

export default async function UsersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!hasPermission(user, 'settings.edit')) {
    return <p className="text-zinc-400">Access denied.</p>
  }

  const supabase = await createClient()
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Team Members</h1>
        <p className="text-zinc-500">Manage user accounts and roles</p>
      </div>

      <UsersTable initialProfiles={(profiles ?? []) as Profile[]} />
    </div>
  )
}
