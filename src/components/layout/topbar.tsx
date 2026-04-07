'use client'

import { usePermissions } from '@/hooks/use-permissions'
import { LogOut } from 'lucide-react'
import { ROLE_LABELS } from '@/types'

export function Topbar() {
  const { profile } = usePermissions()

  return (
    <header className="h-14 border-b border-zinc-900 bg-zinc-950/50 backdrop-blur px-6 flex items-center justify-between">
      <div />
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm text-white">{profile.full_name}</p>
          <p className="text-xs text-zinc-500">{ROLE_LABELS[profile.role]}</p>
        </div>
        <div className="w-9 h-9 rounded-full bg-[#c9a96e]/20 border border-[#c9a96e]/30 flex items-center justify-center text-[#c9a96e] text-sm font-semibold">
          {profile.full_name?.charAt(0).toUpperCase() ?? '?'}
        </div>
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-lg transition"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </form>
      </div>
    </header>
  )
}
