import { Link } from "@tanstack/react-router";
import { StarSparkle } from "./StarSparkle";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-background/85 border-b border-border">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="text-sunshine group-hover:rotate-12 transition-transform">
            <StarSparkle size={32} />
          </span>
          <span className="font-display font-extrabold text-xl tracking-tight">
            KidTok <span className="text-primary">Classroom</span>
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
      className="px-3 py-2 rounded-full text-foreground/70 hover:text-foreground hover:bg-accent transition-colors"
      activeProps={{ className: "px-3 py-2 rounded-full bg-primary text-primary-foreground" }}
      activeOptions={{ exact: to === "/" }}
    >
      {children}
    </Link>
  );
}
