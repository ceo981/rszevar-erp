# RS ZEVAR ERP — Setup Guide (Phase 1: Auth + RBAC)

## 🎯 Kya Naya Hai

Aapke existing ERP mai ab **login system aur role-based permissions** add ho gaye hain:

- ✅ **Login page** — bina login ke koi kuch nahi dekh sakta
- ✅ **Permission-based sidebar** — har user ko sirf apne modules dikhte hain
- ✅ **Users page** — team members ke roles badlo, activate/deactivate karo
- ✅ **Roles & Perms page** — checkboxes se kisi bhi role ki permissions badlo, code change zaroorat nahi
- ✅ **User info + Logout** — sidebar ke neeche

**Aapka purana sab kaam bilkul intact hai** — Orders, Courier, Accounts, Analytics, etc. Bas auth layer upar se lagi hai.

---

## 📦 Setup Steps (Windows)

### 1. Purana code replace karo

1. Apna purana `rszevar-erp` folder ka backup le lo (optional, safety ke liye)
2. Is zip ki saari files apne `rszevar-erp` folder mai extract karo
3. Agar koi file "Replace?" poochhe to **"Replace all"** karo

### 2. `.env.local` file banao

VS Code mai `rszevar-erp` folder kholo. Root level pe (jahan `package.json` hai) ek nayi file banao: **`.env.local`**

Andar ye paste karo:

```
NEXT_PUBLIC_SUPABASE_URL=https://xsynkcgjvbrbwnwcakqn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YAHAN_PASTE_KARO
SUPABASE_SERVICE_ROLE_KEY=YAHAN_PASTE_KARO
SHOPIFY_STORE_DOMAIN=rszevar.myshopify.com
SHOPIFY_ACCESS_TOKEN=YAHAN_PASTE_KARO
```

**Keys kahan se laao:**
- Supabase keys: Supabase Dashboard → Project Settings → API
  - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY`
- Shopify token: Shopify Admin → Apps → Develop apps → aapki app → API credentials

**Save karo** (Ctrl+S).

### 3. Dependencies install karo

VS Code mai **Terminal → New Terminal** (upar menu se).

Terminal mai ye chalao:

```
npm install
```

5-10 minute lagenge. Saare packages download honge.

### 4. Run karo

Terminal mai:

```
npm run dev
```

Kuch der baad ye dikhega:

```
▲ Next.js 15.0.3
- Local:  http://localhost:3000
✓ Ready in 2.3s
```

Browser mai kholo: **http://localhost:3000**

Login page dikhega. Login karo with:
- Email: `ceo@rszevar.com`
- Password: (jo Supabase mai set kiya tha)

Aapka pura ERP dikh jayega (Dashboard, Orders, Courier, etc.) — upar se auth aa chuka hai. ✅

### 5. Roles & Permissions try karo

1. Sidebar mai **Roles & Perms** module dikhega (sirf super_admin ko)
2. Click karo
3. Upar role tabs hain — koi bhi role select karo (jaise "Dispatcher")
4. Neeche modules dikhenge — checkboxes se permissions on/off karo
5. Har toggle **instantly save** hota hai Supabase mai ✅

---

## 🆕 Naye Team Members Kaise Add Karein

1. Supabase Dashboard → **Authentication → Users → Add user → Create new user**
2. Email + password daalo, **Auto Confirm User** tick karo
3. Phir ERP mai login karke **Users** module pe jao
4. Naye user ko role assign karo (dropdown se)
5. Done ✅

Ab wo user login karke apne role ke hisab se modules dekh sakta hai.

---

## 🚀 Vercel pe Deploy

1. Git mai commit karo:
   ```
   git add .
   git commit -m "Add auth + RBAC"
   git push
   ```
2. Vercel auto-deploy kar dega
3. **IMPORTANT:** Vercel Dashboard → Your Project → Settings → **Environment Variables** mai ye saare add karo:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SHOPIFY_STORE_DOMAIN`
   - `SHOPIFY_ACCESS_TOKEN`
4. Redeploy karo (Deployments tab → latest → Redeploy)

---

## 📁 Kya Kya Naya File Hai

```
lib/
├── supabase.js              ← PURANA (API routes ke liye, as-is)
├── supabase/                ← NAYA folder
│   ├── client.js            ← Browser auth client
│   ├── server.js            ← Server auth client
│   └── middleware.js        ← Session refresh
├── permissions.js           ← NAYA — getCurrentUser helper
└── shopify.js               ← PURANA

middleware.js                ← NAYA — root auth guard

app/
├── page.js                  ← UPDATED — auth + permission filter
├── login/                   ← NAYA
│   ├── page.js
│   └── login-form.js
├── users/                   ← NAYA — team management
│   └── page.js
├── roles/                   ← NAYA — permissions matrix ⭐
│   └── page.js
├── api/auth/signout/        ← NAYA
│   └── route.js
└── (baaki sab purana waise hi hai)
```

---

## ❗ Common Issues

**"Module not found: @supabase/ssr"**
→ `npm install` chalao

**Login page khulta hi nahi**
→ `.env.local` file sahi jagah hai? (root mai, `package.json` ke saath)

**Login ke baad bhi /login pe wapas aata hai**
→ Supabase Dashboard → Authentication → Users → aapka user active hai na?

**Sidebar mai sirf Dashboard dikhta hai**
→ Profile mai role `super_admin` set hai? SQL se check karo:
```sql
select email, role from profiles where email = 'ceo@rszevar.com';
```

---

## ✅ Verify Sab Theek Hai

Login ke baad sidebar mai ye dikhna chahiye (super_admin ke liye):
- Dashboard, Orders, Inventory, Accounts, Courier, Courier Sync, Customers, Complaints, Reports, Wholesale, Settings, **Users**, **Roles & Perms**, Team, Analytics
- Sidebar ke neeche aapka naam + role + logout button (⏻)

Agar kisi aur role se login karo to sirf us role ke permissions wale modules dikhne chahiye.
