/**
 * apiClient.ts
 *
 * Enhanced API client with automatic token refresh on 401 errors.
 * This wraps the base fetch to handle token expiry gracefully.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002'

interface ApiClientOptions extends RequestInit {
  token?: string
  refreshToken?: string
  onRefresh?: (newToken: string) => void
  onRefreshFailed?: () => void
}

/**
 * Fetch with automatic token refresh on 401 (Unauthorized).
 * If the access token expires, attempts to refresh using the refresh token.
 */
export async function fetchWithTokenRefresh<T>(
  path: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const { token, refreshToken, onRefresh, onRefreshFailed, ...fetchOptions } = options

  const headers = new Headers(fetchOptions.headers || {})
  headers.set('Content-Type', 'application/json')

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers,
  })

  // If 401 (Unauthorized), try to refresh token
  if (response.status === 401 && refreshToken && onRefresh) {
    try {
      const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (!refreshResponse.ok) {
        onRefreshFailed?.()
        throw new Error('Token refresh failed')
      }

      const refreshData = await refreshResponse.json()
      const newAccessToken = refreshData.accessToken

      // Call the callback to update token in context
      onRefresh(newAccessToken)

      // Retry the original request with new token
      const retryHeaders = new Headers(fetchOptions.headers || {})
      retryHeaders.set('Content-Type', 'application/json')
      retryHeaders.set('Authorization', `Bearer ${newAccessToken}`)

      response = await fetch(`${API_URL}${path}`, {
        ...fetchOptions,
        headers: retryHeaders,
      })
    } catch (err) {
      onRefreshFailed?.()
      throw err
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }))
    if (response.status === 403 && path === '/inspect' && errorData.decision === 'block') {
      return errorData as T
    }
    throw new Error(errorData.error ?? `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}
