'use client';
import { createContext, useContext } from 'react';

export const UserContext = createContext({
  profile: null,
  userEmail: null,
  userRole: null,
  isSuperAdmin: false,
  canViewFinancial: false,
  // Shared-login support:
  activeUser: null,        // { id, name } when a packer picked themselves on a shared phone
  setActiveUser: () => {}, // call to change "who is using the phone"
  // Single source of truth for "who did this action" — use this for logs.
  performer: 'Staff',
});

export function useUser() {
  return useContext(UserContext);
}
