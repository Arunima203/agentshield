'use client'

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'

interface AuthContextType {
  username: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isLoading: boolean
  error: string | null
  accessToken: string | null
  refreshToken: string | null
  setAccessToken: (token: string) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('agentshield_auth')
    if (stored) {
      try {
        const session = JSON.parse(stored)
        // Validate session isn't stale (7 days for refresh token expiry)
        const sessionAge = Date.now() - session.createdAt
        if (sessionAge < 7 * 24 * 60 * 60 * 1000) {
          setUsername(session.username)
          setAccessToken(session.accessToken)
          setRefreshToken(session.refreshToken)
        } else {
          localStorage.removeItem('agentshield_auth')
        }
      } catch {
        localStorage.removeItem('agentshield_auth')
      }
    }
    setIsLoading(false)
  }, [])

  // Setup token refresh timer (refresh 1 minute before expiry)
  useEffect(() => {
    if (!refreshToken) return

    const refreshInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })

        if (!response.ok) {
          // Refresh failed, clear auth
          logout()
          return
        }

        const data = await response.json()
        const newAccessToken = data.accessToken

        // Update access token and storage
        setAccessToken(newAccessToken)
        const stored = localStorage.getItem('agentshield_auth')
        if (stored) {
          const session = JSON.parse(stored)
          session.accessToken = newAccessToken
          localStorage.setItem('agentshield_auth', JSON.stringify(session))
        }
      } catch (err) {
        console.error('Token refresh failed:', err)
        // Continue operation, will fail when trying to use expired token
      }
    }, 14 * 60 * 1000) // Refresh every 14 minutes (token valid for 15)

    return () => clearInterval(refreshInterval)
  }, [refreshToken])

  const login = useCallback(async (user: string, pass: string) => {
    setError(null)
    setIsLoading(true)

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Login failed')
      }

      const data = await response.json()

      // Store session
      const session = {
        username: data.user.username,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        createdAt: Date.now(),
      }
      localStorage.setItem('agentshield_auth', JSON.stringify(session))
      setUsername(data.user.username)
      setAccessToken(data.accessToken)
      setRefreshToken(data.refreshToken)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('agentshield_auth')
    setUsername(null)
    setAccessToken(null)
    setRefreshToken(null)
    setError(null)
  }, [])

  const updateAccessToken = useCallback((newToken: string) => {
    setAccessToken(newToken)
    const stored = localStorage.getItem('agentshield_auth')
    if (stored) {
      const session = JSON.parse(stored)
      session.accessToken = newToken
      localStorage.setItem('agentshield_auth', JSON.stringify(session))
    }
  }, [])

  return (
    <AuthContext.Provider value={{ username, isAuthenticated: !!username, login, logout, isLoading, error, accessToken, refreshToken, setAccessToken: updateAccessToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
