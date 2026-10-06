'use client'

import { useAuth } from '@/app/contexts/auth'
import { useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002'

interface FetchOptions extends RequestInit {
  skipAuth?: boolean
}

/**
 * Hook to make authenticated API requests with JWT token.
 * Automatically adds Authorization header with Bearer token.
 */
export function useAuthenticatedFetch() {
  const { accessToken, refreshToken } = useAuth()

  const fetchWithAuth = useCallback(
    async <T,>(path: string, options: FetchOptions = {}): Promise<T> => {
      const { skipAuth = false, ...fetchOptions } = options

      const headers = new Headers(fetchOptions.headers || {})

      // Add JWT token if available and not skipped
      if (accessToken && !skipAuth) {
        headers.set('Authorization', `Bearer ${accessToken}`)
      }

      const response = await fetch(`${API_URL}${path}`, {
        ...fetchOptions,
        headers,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(errorData.error || `Request failed: ${response.status}`)
      }

      return response.json() as Promise<T>
    },
    [accessToken]
  )

  return { fetchWithAuth, accessToken, refreshToken }
}
