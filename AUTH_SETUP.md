# AgentShield Authentication Setup

## Overview

Basic authentication has been added to the AgentShield dashboard. The system now requires login before accessing any dashboard features.

## Architecture

### Components

1. **`app/contexts/auth.tsx`** - Auth context and hooks
   - `AuthProvider` - Wraps the entire app with auth state
   - `useAuth()` - Hook to access auth state and methods
   - Session persistence to localStorage (24-hour expiry)
   - Demo credentials for local development

2. **`app/login/page.tsx`** - Login page
   - Username/password form
   - Error handling and display
   - Loading states
   - Demo credentials display
   - Dark theme UI

3. **`app/components/ProtectedRoute.tsx`** - Route protection
   - Redirects unauthenticated users to `/login`
   - Shows loading state while checking auth
   - Prevents flash of unprotected content

4. **`app/layout.tsx`** - Updated to wrap app with AuthProvider
   - Enables auth context for all pages

5. **`app/page.tsx`** - Updated dashboard
   - Now wrapped with ProtectedRoute
   - Header shows username and logout button
   - Logout clears session and redirects to login

## Demo Credentials

For local development, use these credentials:

| Username | Password |
|----------|----------|
| `admin` | `AgentShield2024!` |
| `operator` | `security-ops` |

## How It Works

### Login Flow

1. User visits `http://localhost:3000`
2. ProtectedRoute checks if authenticated
3. If not authenticated, redirects to `/login`
4. User enters credentials
5. Auth context validates against demo credentials
6. On success, session stored in localStorage
7. User redirected to dashboard
8. ProtectedRoute allows access

### Session Persistence

- Session stored in `localStorage` under `agentshield_session`
- Session includes: `username`, `createdAt`, `token`
- Sessions expire after 24 hours
- Refresh page: session restored from localStorage
- Close browser: session persists (24-hour expiry)

### Logout Flow

1. User clicks logout button (LogOut icon in header)
2. Session cleared from localStorage
3. User redirected to `/login`
4. Next access to dashboard routes shows login page

## Files Modified/Created

```
app/
├── contexts/
│   └── auth.tsx (new)
├── components/
│   └── ProtectedRoute.tsx (new)
├── login/
│   └── page.tsx (new)
├── layout.tsx (updated)
├── page.tsx (updated)
└── ...
```

## Testing the Auth System

### Test 1: Login with Valid Credentials
1. Navigate to `http://localhost:3000`
2. Should redirect to `/login`
3. Enter: username `admin`, password `AgentShield2024!`
4. Click "Sign In"
5. Should redirect to dashboard showing username "admin" in header

### Test 2: Invalid Credentials
1. On login page, enter wrong password
2. Click "Sign In"
3. Error message should appear: "Invalid username or password"

### Test 3: Logout
1. After logging in, click LogOut icon in header
2. Should redirect to `/login`
3. Session cleared from localStorage

### Test 4: Session Persistence
1. Log in with valid credentials
2. Refresh the page
3. Dashboard should still load (session restored)
4. Username should still appear in header

### Test 5: Protected Routes
1. Open browser dev tools (F12)
2. Go to Console tab
3. Clear session: `localStorage.removeItem('agentshield_session')`
4. Refresh page
5. Should redirect to `/login`

## Security Notes

⚠️ **Development Only**

This is a basic client-side authentication system for **local development and demo purposes only**. 

For production deployment:

1. **Move auth to backend** - Validate credentials on server with bcrypt hashing
2. **Use secure tokens** - JWT or session-based auth with httpOnly cookies
3. **HTTPS only** - Never send credentials over HTTP
4. **Rate limiting** - Prevent brute-force attacks on login endpoint
5. **User management** - Proper user database, not hardcoded credentials
6. **Audit logging** - Log all login/logout events with timestamps and user IDs
7. **Multi-factor authentication** - Consider 2FA for approval operations

## Environment Variables

Current setup uses localStorage for session management. In production, you may want to:

- Add `NEXT_PUBLIC_AUTH_BACKEND_URL` for backend auth endpoint
- Add `NEXT_PUBLIC_SESSION_TIMEOUT_MS` for custom session duration
- Add `NEXT_PUBLIC_MFA_ENABLED` to toggle MFA

## Next Steps for Production

1. ✅ Basic auth prevents unauthorized dashboard access
2. ⏳ Integrate with backend authentication API
3. ⏳ Add user database and role-based access control (RBAC)
4. ⏳ Implement JWT tokens with signature verification
5. ⏳ Add password reset flow
6. ⏳ Implement multi-factor authentication
7. ⏳ Set up audit logging for all auth events

## Troubleshooting

### Login page not showing
- Check if `/login/page.tsx` exists
- Verify AuthProvider is in `app/layout.tsx`
- Clear browser cache and localStorage

### Session not persisting
- Check browser's localStorage is enabled
- Verify session key is `agentshield_session`
- Check browser console for errors

### Redirect loops
- Verify ProtectedRoute component is in `app/components/`
- Check that page.tsx is wrapped with ProtectedRoute
- Clear localStorage and try again

---

**Status**: ✅ Authentication system is ready for local development and testing.
