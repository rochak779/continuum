import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = ["Product", "How it Works", "Solutions", "Resources", "Pricing"];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 md:px-8">
        <Link to="/" className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" strokeWidth={2.2} />
          <span className="text-xl font-bold tracking-tight">Continuum</span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {navItems.map((item, i) => (
            <a
              key={item}
              href="#"
              className={
                i === 0
                  ? "border-b-2 border-primary pb-0.5 text-sm font-medium text-primary"
                  : "text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/auth"
            className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Login
          </Link>

          <Button asChild className="rounded-lg bg-primary-container px-5 py-2.5 font-medium hover:bg-primary">
            <Link to="/signup">Get Started</Link>
          </Button>

        </div>
      </div>
    </header>
  );
}
