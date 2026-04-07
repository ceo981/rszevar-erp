'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ROLE_LABELS, type Profile, type UserRole } from '@/types'
import { Power, Loader2 } from 'lucide-react'

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

export function UsersTable({
  initialProfiles,
}: {
  initialProfiles: Profile[]
}) {
  const [profiles, setProfiles] = useState(initialProfiles)
  const [busy, setBusy] = useState<string | null>(null)
  const supabase = createClient()

  const updateRole = async (id: string, role: UserRole) => {
    setBusy(id)
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) alert('Failed: ' + error.message)
    else setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, role } : p)))
    setBusy(null)
  }

  const toggleActive = async (id: string, current: boolean) => {
    setBusy(id)
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: !current })
      .eq('id', id)
    if (error) alert('Failed: ' + error.message)
    else
      setProfiles((prev) =>
        prev.map((p) => (p.id === id ? { ...p, is_active: !current } : p))
      )
    setBusy(null)
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/50">
        <p className="text-xs text-zinc-500">
          To add a new user: Supabase → Authentication → Users → Add User. Phir
          yahan role set kr dena.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-zinc-950 text-xs uppercase text-zinc-500">
          <tr>
            <th className="text-left px-5 py-3">Name</th>
            <th className="text-left px-5 py-3">Email</th>
            <th className="text-left px-5 py-3">Role</th>
            <th className="text-center px-5 py-3">Status</th>
            <th className="text-right px-5 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {profiles.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center py-8 text-zinc-500">
                No users yet.
              </td>
            </tr>
          )}
          {profiles.map((p) => (
            <tr key={p.id} className="border-t border-zinc-800">
              <td className="px-5 py-3 text-white font-medium">
                {p.full_name ?? '—'}
              </td>
              <td className="px-5 py-3 text-zinc-400">{p.email ?? '—'}</td>
              <td className="px-5 py-3">
                <select
                  value={p.role}
                  onChange={(e) => updateRole(p.id, e.target.value as UserRole)}
                  disabled={busy === p.id}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-[#c9a96e]"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-5 py-3 text-center">
                {p.is_active ? (
                  <span className="text-xs bg-green-950 text-green-400 px-2 py-1 rounded border border-green-900">
                    Active
                  </span>
                ) : (
                  <span className="text-xs bg-red-950 text-red-400 px-2 py-1 rounded border border-red-900">
                    Inactive
                  </span>
                )}
              </td>
              <td className="px-5 py-3 text-right">
                <button
                  onClick={() => toggleActive(p.id, p.is_active)}
                  disabled={busy === p.id}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition"
                >
                  {busy === p.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Power className="w-3 h-3" />
                  )}
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
