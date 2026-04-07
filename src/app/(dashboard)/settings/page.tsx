import Link from 'next/link'
import { getCurrentUser, hasPermission } from '@/lib/permissions/server'
import { redirect } from 'next/navigation'
import { Shield, Users, SlidersHorizontal } from 'lucide-react'

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!hasPermission(user, 'settings.view')) {
    return <p className="text-zinc-400">You don't have access to settings.</p>
  }

  const cards = [
    {
      href: '/settings/roles',
      title: 'Roles & Permissions',
      desc: 'Control what each role can access',
      icon: Shield,
      perm: 'settings.roles',
    },
    {
      href: '/users',
      title: 'Users',
      desc: 'Add, edit, deactivate team members',
      icon: Users,
      perm: 'settings.edit',
    },
    {
      href: '/settings/general',
      title: 'General',
      desc: 'Store info, API keys, integrations',
      icon: SlidersHorizontal,
      perm: 'settings.edit',
    },
  ]

  const allowed = cards.filter((c) => hasPermission(user, c.perm))

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
      <p className="text-zinc-500 mb-6">Configure your ERP</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allowed.map((c) => {
          const Icon = c.icon
          return (
            <Link
              key={c.href}
              href={c.href}
              className="bg-zinc-900 border border-zinc-800 hover:border-[#c9a96e]/40 rounded-xl p-5 transition group"
            >
              <Icon className="w-6 h-6 text-[#c9a96e] mb-3" />
              <h3 className="text-white font-semibold group-hover:text-[#c9a96e] transition">
                {c.title}
              </h3>
              <p className="text-sm text-zinc-500 mt-1">{c.desc}</p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
