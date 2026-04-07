import { getCurrentUser } from '@/lib/permissions/server'
import { ROLE_LABELS } from '@/types'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) return null

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-white mb-1">
        Welcome, {user.profile.full_name}
      </h1>
      <p className="text-zinc-500 mb-6">
        {ROLE_LABELS[user.profile.role]} · RS ZEVAR ERP
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Role</p>
          <p className="text-lg text-white font-semibold mt-1">
            {ROLE_LABELS[user.profile.role]}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Permissions
          </p>
          <p className="text-lg text-white font-semibold mt-1">
            {user.permissions.size} granted
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Status</p>
          <p className="text-lg text-green-400 font-semibold mt-1">Active</p>
        </div>
      </div>

      <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">
          Your permissions
        </h3>
        <div className="flex flex-wrap gap-2">
          {Array.from(user.permissions)
            .sort()
            .map((p) => (
              <span
                key={p}
                className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded border border-zinc-700"
              >
                {p}
              </span>
            ))}
        </div>
      </div>
    </div>
  )
}
