import { Link } from "@tanstack/react-router";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/60">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="KidTok Classroom home">
          <img
            src="/kidtok-logo.webp"
            alt="KidTok"
            width={120}
            height={36}
            className="h-9 w-auto"
          />
          <span className="hidden sm:inline-flex items-center rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wider px-2 py-0.5">
            Classroom
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm font-semibold">
          <NavLink to="/">Create</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="px-3 py-2 rounded-full text-foreground/70 hover:text-foreground hover:bg-secondary transition-colors"
      activeProps={{ className: "px-3 py-2 rounded-full bg-primary text-primary-foreground" }}
      activeOptions={{ exact: to === "/" }}
    >
      {children}
    </Link>
  );
}
