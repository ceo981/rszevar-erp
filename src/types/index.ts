export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'inventory_manager'
  | 'dispatcher'
  | 'customer_support'
  | 'wholesale_manager'
  | 'packing_staff'

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Operations Manager',
  inventory_manager: 'Inventory Manager',
  dispatcher: 'Dispatcher',
  customer_support: 'Customer Support',
  wholesale_manager: 'Wholesale Manager',
  packing_staff: 'Packing Staff',
}

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  department_id: string | null
  outlet_id: string | null
  hired_at: string | null
  created_at: string
  updated_at: string
}

export interface Module {
  key: string
  label: string
  icon: string
  sort_order: number
}

export interface Permission {
  key: string
  module_key: string
  action: string
  label: string
}
