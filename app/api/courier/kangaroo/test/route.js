import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const username = process.env.KANGAROO_USERNAME;
  const password = process.env.KANGAROO_PASSWORD;

  const result = {
    env_check: {
      username_set: !!username,
      username_value: username || 'NOT SET',
      password_set: !!password,
    },
  };

  // Test auth
  try {
    const res = await fetch('https://api.kangaroo.pk/auth/login', {
      method: 'POST',
      headers: {
        'Client-Service': 'kangaroo',
        'Auth-Key': 'kangaroo',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const text = await res.text();
    result.auth_test = {
      http_status: res.status,
      response_length: text.length,
      response_preview: text.slice(0, 300),
    };
  } catch (e) {
    result.auth_test = { error: e.message };
  }

  return NextResponse.json(result);
}
