import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/permissions/server'
import { createClient } from '@/lib/supabase/server'
import { PermissionProvider } from '@/hooks/use-permissions'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import type { Module } from '@/types'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: modulesData } = await supabase
    .from('modules')
    .select('*')
    .order('sort_order')

  const modules: Module[] = (modulesData ?? []) as Module[]

  return (
    <PermissionProvider
      profile={user.profile}
      permissions={Array.from(user.permissions)}
    >
      <div className="min-h-screen bg-[#080808] text-white flex">
        <Sidebar modules={modules} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 p-6 overflow-auto">{children}</main>
        </div>
      </div>
    </PermissionProvider>
  )
}
