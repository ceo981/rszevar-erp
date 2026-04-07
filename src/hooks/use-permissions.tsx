'use client'

import { createContext, useContext, ReactNode } from 'react'
import type { Profile } from '@/types'

interface PermissionContextValue {
  profile: Profile
  permissions: string[]
  can: (key: string) => boolean
  canAny: (keys: string[]) => boolean
}

const PermissionContext = createContext<PermissionContextValue | null>(null)

export function PermissionProvider({
  children,
  profile,
  permissions,
}: {
  children: ReactNode
  profile: Profile
  permissions: string[]
}) {
  const set = new Set(permissions)
  const isSuper = profile.role === 'super_admin'

  const can = (key: string) => isSuper || set.has(key)
  const canAny = (keys: string[]) => isSuper || keys.some((k) => set.has(k))

  return (
    <PermissionContext.Provider value={{ profile, permissions, can, canAny }}>
      {children}
    </PermissionContext.Provider>
  )
}

export function usePermissions() {
  const ctx = useContext(PermissionContext)
  if (!ctx) throw new Error('usePermissions must be used inside PermissionProvider')
  return ctx
}

// Convenience wrapper: <Can permission="orders.edit">...</Can>
export function Can({
  permission,
  anyOf,
  children,
  fallback = null,
}: {
  permission?: string
  anyOf?: string[]
  children: ReactNode
  fallback?: ReactNode
}) {
  const { can, canAny } = usePermissions()
  const allowed = permission ? can(permission) : anyOf ? canAny(anyOf) : false
  return <>{allowed ? children : fallback}</>
}
