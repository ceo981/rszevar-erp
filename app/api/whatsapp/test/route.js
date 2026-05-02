/**
 * POST /api/whatsapp/test
 * =======================
 * Sends Meta's pre-approved 'hello_world' template to a phone number.
 * Used by admin to verify WhatsApp Business API setup is working.
 *
 * SECURITY (May 2026):
 *   /api/whatsapp/* is exempted from middleware auth (Meta webhook needs that).
 *   Pehle is route ko anyone hit kar sakta tha — `{phone: "923XXXXXXXXX"}` POST
 *   karke Meta ki paid template message quota burn ho sakti thi, aur RS ZEVAR
 *   ke business number se unsolicited "hello_world" template victims ko jata
 *   tha (impersonation + spam). Ab session-based auth + super_admin role check.
 *
 *   Yeh route sirf super_admin (Abdul) ke liye hai — diagnostic/setup tool hai.
 *   Regular staff ko Meta API health check karne ki zaroorat nahi.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';
import { sendTemplate } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    // ── SECURITY FIX (May 2026) — Auth + super_admin only ─────────────────
    const authClient = await createAuthClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || profile.is_active === false) {
      return NextResponse.json(
        { success: false, error: 'Account not active' },
        { status: 403 }
      );
    }

    if (String(profile.role) !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Sirf super_admin yeh test route call kar sakte hain' },
        { status: 403 }
      );
    }

    const { phone } = await request.json();
    if (!phone) {
      return NextResponse.json(
        { success: false, error: 'Phone required' },
        { status: 400 }
      );
    }

    // Send hello_world template (pre-approved by Meta)
    const result = await sendTemplate(phone, 'hello_world', [], 'en_US');

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
