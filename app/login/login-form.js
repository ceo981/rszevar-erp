'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  };

  const inputStyle = {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border2)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
    color: 'var(--text)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: 'var(--text3)',
    marginBottom: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: 500,
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div
          style={{
            background: 'var(--red-dim)',
            border: '1px solid var(--red)',
            color: 'var(--red)',
            padding: '10px 12px',
            borderRadius: 'var(--radius)',
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ceo@rszevar.com"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          style={inputStyle}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          background: 'var(--gold)',
          color: '#000',
          border: 'none',
          borderRadius: 'var(--radius)',
          padding: '11px',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'inherit',
          cursor: loading ? 'not-allowed' : 'pointer',
          letterSpacing: 1,
          textTransform: 'uppercase',
          opacity: loading ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
