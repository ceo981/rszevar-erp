'use client'

import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ROLE_LABELS, type UserRole, type Module, type Permission } from '@/types'
import { Check, Loader2, Lock } from 'lucide-react'

interface RolePerm {
  role: UserRole
  permission_key: string
}

export function RolesMatrix({
  roles,
  modules,
  permissions,
  initialRolePerms,
}: {
  roles: UserRole[]
  modules: Module[]
  permissions: Permission[]
  initialRolePerms: RolePerm[]
}) {
  // Map: "role::permission_key" -> true if granted
  const buildMap = (rps: RolePerm[]) => {
    const m = new Map<string, boolean>()
    rps.forEach((rp) => m.set(`${rp.role}::${rp.permission_key}`, true))
    return m
  }

  const [grants, setGrants] = useState(() => buildMap(initialRolePerms))
  const [saving, setSaving] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [filter, setFilter] = useState('')

  const supabase = createClient()

  const toggle = async (role: UserRole, permKey: string) => {
    // super_admin cannot be edited (safety)
    if (role === 'super_admin') return

    const mapKey = `${role}::${permKey}`
    const wasChecked = grants.get(mapKey) === true
    setSaving(mapKey)

    // Optimistic update
    const next = new Map(grants)
    if (wasChecked) next.delete(mapKey)
    else next.set(mapKey, true)
    setGrants(next)

    try {
      if (wasChecked) {
        const { error } = await supabase
          .from('role_permissions')
          .delete()
          .eq('role', role)
          .eq('permission_key', permKey)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('role_permissions')
          .insert({ role, permission_key: permKey })
        if (error) throw error
      }
    } catch (err) {
      // Rollback
      const rollback = new Map(grants)
      setGrants(rollback)
      alert('Failed to save: ' + (err as Error).message)
    } finally {
      setSaving(null)
      startTransition(() => {})
    }
  }

  // Group permissions by module
  const permsByModule = new Map<string, Permission[]>()
  permissions.forEach((p) => {
    if (!permsByModule.has(p.module_key)) permsByModule.set(p.module_key, [])
    permsByModule.get(p.module_key)!.push(p)
  })

  const visibleModules = modules.filter((m) => {
    if (!filter) return true
    return (
      m.label.toLowerCase().includes(filter.toLowerCase()) ||
      permsByModule
        .get(m.key)
        ?.some((p) => p.label.toLowerCase().includes(filter.toLowerCase()))
    )
  })

  return (
    <div>
      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search modules or permissions..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a96e] text-sm"
        />
      </div>

      {/* Matrix */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 border-b border-zinc-800">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider sticky left-0 bg-zinc-950 z-10 min-w-[240px]">
                  Permission
                </th>
                {roles.map((role) => (
                  <th
                    key={role}
                    className="px-3 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider text-center min-w-[110px]"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span>{ROLE_LABELS[role]}</span>
                      {role === 'super_admin' && (
                        <Lock className="w-3 h-3 text-zinc-600" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleModules.map((mod) => {
                const modPerms = (permsByModule.get(mod.key) ?? []).filter(
                  (p) =>
                    !filter ||
                    p.label.toLowerCase().includes(filter.toLowerCase()) ||
                    mod.label.toLowerCase().includes(filter.toLowerCase())
                )
                if (modPerms.length === 0) return null
                return (
                  <>
                    <tr
                      key={`mod-${mod.key}`}
                      className="bg-zinc-950/50 border-t border-zinc-800"
                    >
                      <td
                        colSpan={roles.length + 1}
                        className="px-4 py-2 text-[11px] font-bold text-[#c9a96e] uppercase tracking-widest sticky left-0 bg-zinc-950/50"
                      >
                        {mod.label}
                      </td>
                    </tr>
                    {modPerms.map((perm) => (
                      <tr
                        key={perm.key}
                        className="border-t border-zinc-800/50 hover:bg-zinc-800/30"
                      >
                        <td className="px-4 py-2.5 text-zinc-300 sticky left-0 bg-zinc-900 group-hover:bg-zinc-800/30">
                          <div className="text-sm">{perm.label}</div>
                          <div className="text-[10px] text-zinc-600 font-mono">
                            {perm.key}
                          </div>
                        </td>
                        {roles.map((role) => {
                          const mapKey = `${role}::${perm.key}`
                          const granted = grants.get(mapKey) === true
                          const isSaving = saving === mapKey
                          const locked = role === 'super_admin'
                          return (
                            <td
                              key={role}
                              className="px-3 py-2.5 text-center"
                            >
                              <button
                                onClick={() => toggle(role, perm.key)}
                                disabled={locked || isSaving}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center mx-auto transition ${
                                  granted
                                    ? 'bg-[#c9a96e] border-[#c9a96e]'
                                    : 'bg-transparent border-zinc-700 hover:border-zinc-500'
                                } ${
                                  locked
                                    ? 'opacity-40 cursor-not-allowed'
                                    : 'cursor-pointer'
                                }`}
                              >
                                {isSaving ? (
                                  <Loader2 className="w-3 h-3 text-black animate-spin" />
                                ) : granted ? (
                                  <Check className="w-4 h-4 text-black" strokeWidth={3} />
                                ) : null}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-xs text-zinc-500 flex items-center gap-2">
        <Lock className="w-3 h-3" />
        <span>Super Admin has all permissions by default and cannot be modified.</span>
      </div>
    </div>
  )
}
