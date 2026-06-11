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

  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
