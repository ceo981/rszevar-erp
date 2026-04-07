import LoginForm from './login-form';

export const metadata = {
  title: 'Login — RS ZEVAR ERP',
};

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 36,
              fontWeight: 700,
              color: 'var(--gold)',
              letterSpacing: 4,
            }}
          >
            RS ZEVAR
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text3)',
              letterSpacing: 3,
              marginTop: 4,
            }}
          >
            ERP SYSTEM
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 32,
            boxShadow: 'var(--shadow)',
          }}
        >
          <h2
            style={{
              fontSize: 18,
              color: 'var(--text)',
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Sign in
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text3)',
              marginBottom: 24,
            }}
          >
            Welcome back. Enter your credentials.
          </p>
          <LoginForm />
        </div>

        <p
          style={{
            textAlign: 'center',
            fontSize: 10,
            color: 'var(--text3)',
            marginTop: 24,
            letterSpacing: 1,
          }}
        >
          © {new Date().getFullYear()} RS ZEVAR · Internal Use Only
        </p>
      </div>
    </div>
  );
}
