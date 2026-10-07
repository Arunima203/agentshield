'use client'

import { useState } from 'react'
import { useAuth } from '@/app/contexts/auth'
import { useRouter } from 'next/navigation'
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const { login, isLoading, error } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)

    if (!username.trim() || !password.trim()) {
      setLocalError('Please enter both username and password')
      return
    }

    try {
      await login(username, password)
      router.push('/')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-2 bg-blue-600 rounded-lg">
              <ShieldCheck size={32} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">AgentShield</h1>
          <p className="text-slate-400 text-sm mt-1">AI Agent Security Console</p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Security Login</h2>

          {/* Error Messages */}
          {(error || localError) && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-700/50 rounded-lg flex gap-3">
              <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error || localError}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin or operator"
                disabled={isLoading}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={isLoading}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  <ShieldCheck size={18} />
                  Sign In
                </>
              )}
            </button>
          </form>

          {/* Demo Credentials Info */}
          <div className="mt-6 pt-6 border-t border-slate-700">
            <p className="text-xs text-slate-400 mb-3 font-semibold">DEMO CREDENTIALS</p>
            <div className="space-y-2 text-xs">
              <div className="bg-slate-900/50 p-2 rounded cursor-pointer hover:bg-slate-700/50 transition-colors" onClick={() => { setUsername('admin'); setPassword('AgentShield29241') }}>
                <p className="text-slate-300"><span className="font-mono text-blue-400">admin</span> / <span className="font-mono text-blue-400">AgentShield29241</span> <span className="text-slate-500 text-xs ml-1">(click to fill)</span></p>
              </div>
              <div className="bg-slate-900/50 p-2 rounded cursor-pointer hover:bg-slate-700/50 transition-colors" onClick={() => { setUsername('operator'); setPassword('security-ops') }}>
                <p className="text-slate-300"><span className="font-mono text-blue-400">operator</span> / <span className="font-mono text-blue-400">security-ops</span> <span className="text-slate-500 text-xs ml-1">(click to fill)</span></p>
              </div>
            </div>
            <p className="text-slate-500 text-xs mt-3">
              ⚠️ These are demo credentials. In production, use a proper authentication backend.
            </p>
            <div className="mt-4 text-center">
              <p className="text-slate-400 text-sm">
                New user?{' '}
                <a href="/register" className="text-blue-400 hover:text-blue-300 font-medium">Create an account →</a>
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-slate-500 text-xs">
          <p>AgentShield v0.1 — AI Agent Security Layer</p>
          <p className="mt-1">Local development environment</p>
        </div>
      </div>
    </div>
  )
}
