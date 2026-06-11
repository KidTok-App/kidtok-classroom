## Problem
After a successful Google sign-in, the "Create your library" dialog stays open. The user has to click the X to dismiss it. The mock-user buttons close the dialog manually in their `onClick`, but the Google flow completes asynchronously inside `AuthProvider` (GSI callback → `setUser`), so nothing tells the dialog to close.

## Fix
In `src/components/AppHeader.tsx`, add a `useEffect` that watches `user` from `useAuth()`. As soon as `user` becomes truthy while `dialogOpen` is true, call `setDialogOpen(false)`.

```tsx
useEffect(() => {
  if (user && dialogOpen) setDialogOpen(false);
}, [user, dialogOpen]);
```

That covers both paths (Google + mock) with one source of truth, and avoids touching `auth.tsx`.

No other changes needed.