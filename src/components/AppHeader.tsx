import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, LogIn, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const mockUsers = [
  {
    id: "teacher-emily",
    name: "Ms. Emily",
    email: "emily@kidtokai.com",
    picture: "https://api.dicebear.com/7.x/adventurer/svg?seed=emily",
  },
  {
    id: "parent-alex",
    name: "Mr. Alex",
    email: "alex@kidtokai.com",
    picture: "https://api.dicebear.com/7.x/adventurer/svg?seed=alex",
  },
];

export function AppHeader() {
  const { user, signInWithMock, signOut, googleClientId } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Auto-close sign-in dialog once a user is authenticated (Google or mock)
  useEffect(() => {
    if (user && dialogOpen) setDialogOpen(false);
  }, [user, dialogOpen]);


  // Trigger Google button rendering when Dialog opens
  useEffect(() => {
    if (!dialogOpen || !googleClientId) return;

    let buttonRendered = false;
    const renderInterval = setInterval(() => {
      const btnDiv = document.getElementById("google-signin-btn-dialog");
      const google = (window as any).google;
      if (btnDiv && google?.accounts?.id) {
        google.accounts.id.renderButton(btnDiv, {
          theme: "outline",
          size: "large",
          width: 280,
          text: "signin_with",
          shape: "pill",
        });
        buttonRendered = true;
        clearInterval(renderInterval);
      }
    }, 100);

    return () => clearInterval(renderInterval);
  }, [dialogOpen, googleClientId]);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/60">
      <div className="mx-auto max-w-6xl px-3 sm:px-4 h-16 flex items-center justify-between gap-2 sm:gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0 min-w-0" aria-label="KidTok Classroom home">
          <img
            src="/kidtok-logo.webp"
            alt="KidTok"
            width={120}
            height={36}
            className="h-8 sm:h-9 w-auto"
          />
          <span className="hidden sm:inline-flex items-center rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wider px-2 py-0.5">
            Classroom
          </span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-6 shrink-0 min-w-0">
          <nav className="flex items-center gap-0.5 sm:gap-1 text-sm font-semibold min-w-0">
            <NavLink to="/">Create</NavLink>
            <NavLink to="/library">Library</NavLink>
            <NavLink to="/about">About</NavLink>
          </nav>

          <div className="h-6 w-[1px] bg-border/60 hidden sm:block" />

          {/* User Auth Controls */}
          {user ? (
            <div className="relative shrink-0">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 rounded-full hover:bg-secondary p-1 transition cursor-pointer"
                aria-label={`Account menu for ${user.name}`}
              >
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarImage src={user.picture} alt={user.name} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {user.name[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden md:inline text-xs font-bold pr-1">{user.name}</span>
              </button>
              
              {dropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setDropdownOpen(false)} 
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-card border border-border/80 rounded-2xl shadow-lg p-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="px-3 py-2 text-[11px] font-bold text-muted-foreground border-b border-border/40">
                      Logged in as <span className="font-extrabold text-foreground block truncate">{user.name}</span>
                    </div>
                    <Link
                      to="/self-improvement"
                      onClick={() => setDropdownOpen(false)}
                      className="w-full text-left px-3 py-2.5 text-xs font-bold text-primary hover:bg-primary/10 rounded-xl transition flex items-center gap-2 cursor-pointer mt-1"
                    >
                      <Sparkles className="h-4 w-4 text-primary animate-pulse" /> AI Self‑Improvement
                    </Link>
                    <button
                      onClick={() => {
                        signOut();
                        setDropdownOpen(false);
                      }}
                      className="w-full text-left px-3 py-2.5 text-xs font-bold text-destructive hover:bg-destructive/10 rounded-xl transition flex items-center gap-2 cursor-pointer mt-1"
                    >
                      <LogOut className="h-4 w-4" /> Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => setDialogOpen(true)}
              aria-label="Sign in"
              className="inline-flex items-center gap-1.5 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-200 text-xs font-extrabold px-2.5 sm:px-3.5 py-2 rounded-full cursor-pointer shrink-0"
            >
              <LogIn className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden xs:inline sm:inline">Sign In</span>
              <span className="xs:hidden sm:hidden">In</span>
            </button>
          )}
        </div>
      </div>

      {/* Modern, kid-friendly authentication Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md bg-card border-2 border-border rounded-3xl p-6 sm:p-8">
          <DialogHeader className="flex flex-col items-center text-center space-y-2">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-1">
              <Sparkles className="h-6 w-6 animate-pulse" />
            </div>
            <DialogTitle className="text-2xl font-extrabold tracking-tight">
              Create your library
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground max-w-[280px]">
              Sign in to keep your custom cartoons isolated and safe in your private classroom library.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4 w-full">
            {/* Google GSI Standard Button container */}
            {googleClientId ? (
              <div id="google-signin-btn-dialog" className="min-h-[44px] flex items-center justify-center" />
            ) : (
              <div className="p-3.5 border-2 border-dashed border-amber-500/30 bg-amber-500/10 rounded-2xl text-center max-w-[280px]">
                <p className="text-[11px] font-extrabold text-amber-600 dark:text-amber-400">
                  ⚠️ Live Google Login is waiting for a Client ID!
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-normal font-medium">
                  To activate real Google Sign-In, please set the <strong>GOOGLE_CLIENT_ID</strong> secret in Lovable, or <strong>VITE_GOOGLE_CLIENT_ID</strong> in your local <code>.env</code> file.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 w-full max-w-[280px] py-1">
              <div className="h-[1px] bg-border/60 flex-1" />
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                Or developer bypass
              </span>
              <div className="h-[1px] bg-border/60 flex-1" />
            </div>

            {/* Quick Mock Developer Selector */}
            <div className="grid grid-cols-2 gap-3 w-full max-w-[320px]">
              {mockUsers.map((mu) => (
                <button
                  key={mu.id}
                  onClick={() => {
                    signInWithMock(mu);
                    setDialogOpen(false);
                  }}
                  className="flex flex-col items-center justify-center p-3 border-2 border-border/80 rounded-2xl bg-background/50 hover:border-primary hover:bg-primary/5 transition-all text-center group cursor-pointer"
                >
                  <img
                    src={mu.picture}
                    alt={mu.name}
                    className="w-12 h-12 rounded-full mb-1 bg-muted border border-border group-hover:scale-105 transition-transform"
                  />
                  <span className="text-xs font-bold text-foreground">{mu.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {mu.id.startsWith("teacher") ? "Teacher" : "Parent"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
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

