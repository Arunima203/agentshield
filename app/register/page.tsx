'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, AlertCircle, Loader2, Check } from 'lucide-react'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002'

export default function RegisterPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [role, setRole] = useState('operator')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Registration failed')
      setSuccess(true)
      setTimeout(() => router.push('/login'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
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
          <p className="text-slate-400 text-sm mt-1">Create your account</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Create Account</h2>

          {success && (
            <div className="mb-4 p-3 bg-green-900/20 border border-green-700/50 rounded-lg flex gap-3">
              <Check size={20} className="text-green-500 flex-shrink-0" />
              <p className="text-green-300 text-sm">Account created! Redirecting to login...</p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-700/50 rounded-lg flex gap-3">
              <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Choose a username"
                disabled={loading || success}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Role</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                disabled={loading || success}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="operator">Operator — can approve/reject tool calls</option>
                <option value="auditor">Auditor — read-only access to logs</option>
                <option value="agent">Agent — submit tool calls for inspection</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                disabled={loading || success}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                disabled={loading || success}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={loading || success}
              className="w-full mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            >
              {loading ? <><Loader2 size={18} className="animate-spin" /> Creating account...</> : <><ShieldCheck size={18} /> Create Account</>}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-700 text-center">
            <p className="text-slate-400 text-sm">
              Already have an account?{' '}
              <a href="/login" className="text-blue-400 hover:text-blue-300 font-medium">Sign in</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
