import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  const { data } = await supabase
    .from('erp_settings')
    .select('key, value, category');

  const settings = {};
  for (const row of data || []) {
    if (!settings[row.category]) settings[row.category] = {};
    settings[row.category][row.key] = row.value;
  }

  return NextResponse.json({ success: true, settings });
}

export async function POST(request) {
  const { settings } = await request.json();

  for (const [category, keys] of Object.entries(settings)) {
    for (const [key, value] of Object.entries(keys)) {
      await supabase.from('erp_settings').upsert({
        key,
        value: String(value || ''),
        category,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
  }

  return NextResponse.json({ success: true });
}
