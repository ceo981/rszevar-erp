import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request) {
  // Public API routes bypass auth (used by storefront for order tracking)
  // + the storefront chat widget JS (served to rszevar.com from /rsz-chat.js)
  if (
    request.nextUrl.pathname.startsWith('/api/public') ||
    request.nextUrl.pathname === '/rsz-chat.js'
  ) {
    return NextResponse.next();
  }

  // ─── Vercel Cron bypass (JUN 2026) ────────────────────────────────────────
  // Vercel cron requests ke paas login cookie nahi hota, isliye auth middleware
  // unhe /login pe 307 redirect kar deta tha aur sync/cron handler chalta hi
  // nahi tha. Vercel cron har request ke saath `Authorization: Bearer <CRON_SECRET>`
  // bhejta hai (jab CRON_SECRET env var set ho). Agar woh secret valid hai to
  // auth bypass karo — target route handler khud dobara secret verify karke
  // decide karta hai ke sync chalana hai ya read-only stats dena hai.
  // Secret hi gate hai, isliye yeh secure hai (cookie ki zarurat nahi).
  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    request.headers.get('authorization') === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
