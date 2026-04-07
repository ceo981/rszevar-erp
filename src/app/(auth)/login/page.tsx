import { LoginForm } from './login-form'

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080808] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-[#c9a96e] tracking-wider">
            RS ZEVAR
          </h1>
          <p className="text-zinc-400 mt-2 text-sm tracking-widest">ERP SYSTEM</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-1">Sign in</h2>
          <p className="text-sm text-zinc-500 mb-6">
            Welcome back. Enter your credentials.
          </p>
          <LoginForm />
        </div>

        <p className="text-center text-xs text-zinc-600 mt-6">
          © {new Date().getFullYear()} RS ZEVAR · Internal Use Only
        </p>
      </div>
    </div>
  )
}
