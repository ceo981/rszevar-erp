# RS ZEVAR ERP v2.0

Enterprise Resource Planning System for RS ZEVAR — Live Shopify Connected

## Deployment Guide (Vercel)

### Step 1: GitHub Pe Upload
1. GitHub pe `ceo981/rszevar-erp` repo kholo
2. Purani files delete karo (index.html, README.md)
3. Ye saari files upload karo (drag & drop)

### Step 2: Vercel Environment Variables
Vercel Dashboard → rszevar-erp → Settings → Environment Variables

Add these 5 variables:
```
NEXT_PUBLIC_SUPABASE_URL     = https://xsynkcgjvbrbwnwcakqn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = (your anon key starting with eyJ...)
SUPABASE_SERVICE_ROLE_KEY     = (your service_role key - SECRET)
SHOPIFY_STORE_DOMAIN          = rszevar.myshopify.com
SHOPIFY_ACCESS_TOKEN          = (your Shopify access token)
```

### Step 3: Redeploy
Vercel → Deployments → Latest → Redeploy

## Tech Stack
- Next.js 14 (App Router)
- Supabase (PostgreSQL)
- Shopify Admin API
- Vercel (Hosting)
