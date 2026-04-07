'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePermissions } from '@/hooks/use-permissions'
import type { Module } from '@/types'
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Package,
  Tag,
  Users,
  Building2,
  Boxes,
  MessageCircle,
  BarChart3,
  PackageCheck,
  Settings,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Package,
  Tag,
  Users,
  Building2,
  Boxes,
  MessageCircle,
  BarChart3,
  PackageCheck,
  Settings,
}

// Module key → its "view" permission key (what's needed to see the link)
const MODULE_PERM: Record<string, string> = {
  dashboard: 'dashboard.view',
  orders: 'orders.view',
  courier: 'courier.view',
  inventory: 'inventory.view',
  products: 'products.view',
  customers: 'customers.view',
  vendors: 'vendors.view',
  wholesale: 'wholesale.view',
  whatsapp: 'whatsapp.view',
  reports: 'reports.view',
  packing: 'packing.view',
  settings: 'settings.view',
}

const MODULE_HREF: Record<string, string> = {
  dashboard: '/dashboard',
  orders: '/orders',
  courier: '/courier',
  inventory: '/inventory',
  products: '/products',
  customers: '/customers',
  vendors: '/vendors',
  wholesale: '/wholesale',
  whatsapp: '/whatsapp',
  reports: '/reports',
  packing: '/packing',
  settings: '/settings',
}

export function Sidebar({ modules }: { modules: Module[] }) {
  const pathname = usePathname()
  const { can, profile } = usePermissions()

  const visible = modules.filter((m) => {
    const perm = MODULE_PERM[m.key]
    return perm ? can(perm) : false
  })

  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-900 flex flex-col">
      <div className="px-6 py-5 border-b border-zinc-900">
        <h1 className="text-xl font-bold text-[#c9a96e] tracking-wider">
          RS ZEVAR
        </h1>
        <p className="text-xs text-zinc-500 tracking-widest mt-0.5">ERP</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visible.map((m) => {
          const Icon = ICON_MAP[m.icon] ?? LayoutDashboard
          const href = MODULE_HREF[m.key] ?? '/'
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={m.key}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                active
                  ? 'bg-[#c9a96e]/10 text-[#c9a96e] border border-[#c9a96e]/20'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{m.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-zinc-900">
        <p className="text-xs text-zinc-500 truncate">{profile.full_name}</p>
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mt-0.5">
          {profile.role.replace('_', ' ')}
        </p>
      </div>
    </aside>
  )
}
