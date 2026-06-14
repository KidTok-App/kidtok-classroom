## Goal
1. Make the sign-in gate actually block generation with a visible modal — the previous toast+event approach can be missed and the user reports generation still proceeded.
2. Reorganize the mobile header into a hamburger menu so the "Classroom" badge and nav stay visible and Sign In never overflows.

## Changes

### 1. Hard sign-in gate (`src/routes/index.tsx`)
- Add local state `signInPromptOpen` and render a shadcn `<Dialog>` directly in the page (so the gate is owned by the gated screen, not coupled to AppHeader's dialog timing).
- Dialog content: title "Sign in to create cartoons", short body explaining why (cartoons are saved to your account and personalized per child), two CTAs:
  - **Sign in** → closes this dialog and dispatches `kidtok:open-signin` so the header's auth dialog opens.
  - **Cancel** → just closes.
- In `submit()`, if `!user`: `setSignInPromptOpen(true)` and `return` (no toast, no event). Sample-topic buttons already route through `submit()` so they inherit the gate. Belt-and-suspenders: also short-circuit `onSubmit` form handler when `!user`.
- Keep the existing "Sign in to generate" main button behavior, but route its click to `setSignInPromptOpen(true)` instead of dispatching the event directly, for consistency.

### 2. Mobile header as a menu (`src/components/AppHeader.tsx`)
At `< sm` breakpoint, replace the inline nav + Sign-In button with a single hamburger button that opens a shadcn `<Sheet>` from the right. The sheet contains:
- Greeting line ("Signed in as …" or "Not signed in").
- Nav links: Create, Library, About (closing the sheet on tap).
- When signed in: AI Self-Improvement link + Sign Out.
- When signed out: a full-width **Sign In** button that opens the existing auth dialog (`setDialogOpen(true)`) and closes the sheet.

Desktop (`≥ sm`) keeps the current inline nav + avatar/Sign-In button untouched. The "Classroom" badge becomes visible at all widths on mobile by moving it next to the logo inside the always-visible left cluster (only the nav collapses, not the badge).

Implementation notes:
- Use `@/components/ui/sheet` (already in the shadcn set).
- `useState` for `mobileMenuOpen`. `sm:hidden` for the hamburger trigger; `hidden sm:flex` for the existing nav cluster.
- No changes to auth logic, route tree, or backend.

### 3. Self-improvement page (`src/routes/self-improvement.tsx`)
No changes — the signed-out CTA there already exists from the previous turn.

## Out of scope
- Server-side auth enforcement (already enforced by agent-service).
- Bottom-tab navigation, redesign of the auth dialog, route guards.

## Verification
- Signed out on mobile (360px): header shows logo + Classroom pill + hamburger. Tapping hamburger opens a sheet with Create / Library / About / Sign In. No element overflows.
- Signed out, type a topic and press the topic chip or main button → a dialog appears titled "Sign in to create cartoons"; no `POST /episodes` is sent (verify in Network).
- Tapping **Sign in** in the gate opens the existing auth dialog. After signing in, retrying generation works as before.
- Signed-in desktop view unchanged.
