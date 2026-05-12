'use client';
import { createContext, useContext } from 'react';

// ============================================================================
// RS ZEVAR ERP — UserContext
// ----------------------------------------------------------------------------
// Provides current user, profile, role, AND granular permission checks to
// every client component via useUser().
//
// May 2 2026 — Added `permissions` (Set<string>) and `can(key)` helper for
// the granular DB-driven permission system. Components can now do:
//
//   const { can, isSuperAdmin } = useUser();
//   if (can('orders.cancel')) { ... }
//
// `can()` automatically returns true for super_admin without DB lookup.
// AppShell populates the actual values; this file just declares the shape.
// ============================================================================

export const UserContext = createContext({
  profile: null,
  userEmail: null,
  userRole: null,
  isSuperAdmin: false,
  canViewFinancial: false,

  // ── Granular permissions (May 2 2026) ─────────────────────────────────────
  // Set of permission keys the current user has, e.g.
  // new Set(['orders.view', 'orders.cancel', 'inventory.view'])
  permissions: new Set(),

  // can(key) — primary permission check. Always use this in components
  // instead of poking permissions.has() directly. Reasons:
  //   • super_admin auto-bypasses (returns true for everything)
  //   • Future auditing / logging hooks can be added in one place
  //   • Defaults to false safely if context not yet hydrated
  //
  // Examples:
  //   can('orders.cancel')       → bool
  //   can('inventory.edit_cost') → bool
  //
  // The default implementation here returns false so a component that
  // accidentally renders before AppShell hydrates fails CLOSED (safe default).
  can: () => false,

  // Shared-login support:
  activeUser: null,        // { id, name } when a packer picked themselves on a shared phone
  setActiveUser: () => {}, // call to change "who is using the phone"

  // Single source of truth for "who did this action" — use this for logs.
  performer: 'Staff',
});

export function useUser() {
  return useContext(UserContext);
}

// Convenience hook: useCan() — pull just the can() function.
// Use this when a component only needs perm checks, not the full user object.
//
// Example:
//   const can = useCan();
//   {can('orders.dispatch') && <DispatchButton />}
export function useCan() {
  return useContext(UserContext).can;
}
