# RS ZEVAR ERP — Phase 1: Auth + RBAC

Complete login + role-based permissions system with database-driven access control.

## 🎯 Kya Banaya Hai

- **Login page** (Supabase Auth)
- **Middleware** — protected routes, auto-redirect
- **Dynamic sidebar** — har user ko sirf apne permissions ke modules dikhte hain
- **Roles & Permissions matrix** — checkbox se on/off, database se control (code change zaroorat nahi)
- **Users management** — team members ke roles badlo, activate/deactivate
- **Dashboard shell** with topbar + user info + logout

## 📦 Setup Steps

### 1. Repo mai copy kro

Is folder ki saari files apne `rszevar-erp` repo mai merge kro. Agar conflict ho to dono side ka code dekh ke merge karna.

### 2. Dependencies install

```bash
npm install
```

Ya agar aap apne existing repo mai merge kr rhe ho, sirf ye missing packages install kro:

```bash
npm install @supabase/ssr @supabase/supabase-js lucide-react clsx tailwind-merge
```

### 3. Environment variables

`.env.local` file banao root mai:

```
NEXT_PUBLIC_SUPABASE_URL=https://xsynkcgjvbrbwnwcakqn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_anon_key>
```

Supabase Dashboard → Project Settings → API se anon key copy kro.

### 4. Database ready hai?

Aapne already ye SQL run kr liya hai Supabase pe:
- ✅ `profiles` table (with `id`, `email` columns)
- ✅ `user_role` enum (8 roles)
- ✅ `modules` table (12 modules)
- ✅ `permissions` table (33 permissions)
- ✅ `role_permissions` table (seeded)
- ✅ `has_permission()` function + `my_permissions` view
- ✅ RLS policies
- ✅ `ceo@rszevar.com` super_admin user

### 5. Run

```bash
npm run dev
```

Browser kholo → `http://localhost:3000` → automatically `/login` redirect hoga.

Login kro with:
- Email: `ceo@rszevar.com`
- Password: (jo Supabase mai set kiya tha)

Dashboard pe aa jayenge. ✅

### 6. Deploy to Vercel

```bash
git add .
git commit -m "Phase 1: Auth + RBAC"
git push
```

Vercel auto-deploy ho jayega. Vercel Dashboard mai Environment Variables add krna na bhoolna:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 🗂️ Folder Structure

```
src/
├── middleware.ts                          # Auth guard + session refresh
├── app/
│   ├── layout.tsx                         # Root HTML
│   ├── page.tsx                           # → redirects to /dashboard
│   ├── globals.css                        # Tailwind + custom styles
│   ├── (auth)/
│   │   └── login/
│   │       ├── page.tsx                   # Login page
│   │       └── login-form.tsx             # Form (client)
│   ├── (dashboard)/
│   │   ├── layout.tsx                     # Shell: sidebar + topbar
│   │   ├── dashboard/page.tsx             # Home
│   │   ├── users/
│   │   │   ├── page.tsx                   # Users list
│   │   │   └── users-table.tsx            # Edit roles UI
│   │   └── settings/
│   │       ├── page.tsx                   # Settings hub
│   │       └── roles/
│   │           ├── page.tsx               # Roles & Permissions
│   │           └── roles-matrix.tsx       # ⭐ Checkbox matrix
│   └── api/auth/signout/route.ts          # POST /api/auth/signout
├── lib/
│   ├── supabase/
│   │   ├── client.ts                      # Browser client
│   │   ├── server.ts                      # Server Component client
│   │   └── middleware.ts                  # Middleware client
│   └── permissions/
│       └── server.ts                      # getCurrentUser() helper
├── hooks/
│   └── use-permissions.tsx                # <Can> wrapper + usePermissions()
├── components/layout/
│   ├── sidebar.tsx                        # Dynamic menu from DB
│   └── topbar.tsx                         # User info + logout
└── types/
    └── index.ts                           # TS types
```

## 🔐 Kaise Kaam Krta Hai (Permission System)

### Roles (8)
1. `super_admin` — Abdul (CEO) — sab kuch, **locked**
2. `admin` — Second-in-command — sab except role management
3. `manager` — Operations (Sharjeel)
4. `inventory_manager` — Stock (Abrar)
5. `dispatcher` — Courier (Adil)
6. `customer_support` — Support (Salman)
7. `wholesale_manager` — Wholesale (Farhan)
8. `packing_staff` — Packing team

### Permissions (33)
Format: `module.action` — jaise `orders.view`, `orders.edit`, `courier.book`, `settings.roles`.

### Flow
1. User login kare → middleware session check kre
2. `(dashboard)/layout.tsx` mai `getCurrentUser()` call hota hai
3. Profile + permissions fetch hote hain from `my_permissions` view
4. Sab pages mai `<PermissionProvider>` ke through milte hain
5. Components mai `usePermissions()` ya `<Can permission="orders.edit">` use kro

### Access badalna (aapka main use case)

**Scenario:** Aapko Dispatcher (Adil) se `courier.cancel` permission hatani hai.

**Old way:** Code mai hardcoded array tha, deploy krna padta.

**New way:**
1. Login as super_admin
2. Sidebar → Settings → Roles & Permissions
3. "Dispatcher" tab select kro
4. "Courier" module mai "Cancel Parcel" ka checkbox **uncheck** kro
5. Done ✅ — Adil jab next time login krega, cancel button hi nahi dikhega

Koi code change, koi deploy nahi. Pure database-driven.

## 🧪 Component Usage Examples

### Hide a button based on permission (client component)
```tsx
'use client'
import { Can } from '@/hooks/use-permissions'

<Can permission="orders.delete">
  <button>Delete Order</button>
</Can>
```

### Check permission in a server component
```tsx
import { getCurrentUser, hasPermission } from '@/lib/permissions/server'

const user = await getCurrentUser()
if (!hasPermission(user, 'reports.export')) {
  return <p>Access denied</p>
}
```

### Conditional rendering with usePermissions
```tsx
'use client'
import { usePermissions } from '@/hooks/use-permissions'

const { can } = usePermissions()
return can('whatsapp.send') ? <SendButton /> : null
```

## 🚀 Next Phases

- **Phase 2:** Shopify 2-way sync (webhooks + cron)
- **Phase 3:** Settings → General (API keys, courier configs, WhatsApp config)
- **Phase 4:** WhatsApp API automation

## 📝 Notes

- **Super Admin** role matrix mai locked hai — accidentally khud ko lockout se bachane ke liye
- **Admin** role ko bhi `settings.roles` nahi mila hai — sirf super_admin hi permissions change kr sakta hai
- Modules enabled/disabled toggle agar chahiye to bhi ye same pattern extend ho sakta hai
- Agle phase mai naye modules add krne ke liye sirf `modules` + `permissions` table mai rows insert krni hongi
