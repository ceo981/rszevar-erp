'use client';
import { createContext, useContext } from 'react';

export const UserContext = createContext({
  profile: null,
  isSuperAdmin: false,
  canViewFinancial: false,
  userRole: null,
});

export function useUser() {
  return useContext(UserContext);
}
