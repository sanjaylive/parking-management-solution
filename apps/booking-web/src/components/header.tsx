'use client';
import Link from 'next/link';
import { useAuth } from './auth';

export function Header() {
  const { me, ready, requireLogin, logout } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-extrabold"><span className="grid size-9 place-items-center rounded-xl bg-grad text-white">P</span>Park2All</Link>
        <nav className="ml-auto flex items-center gap-2 text-sm font-semibold">
          {ready && me?.profileComplete ? (
            <>
              <Link href="/bookings" className="rounded-xl px-3 py-2 hover:bg-surface-2">My bookings</Link>
              <button onClick={logout} className="rounded-xl px-3 py-2 text-muted hover:bg-surface-2 hover:text-text">Sign out</button>
            </>
          ) : ready ? (
            <button onClick={() => requireLogin()} className="rounded-xl bg-grad px-4 py-2 text-white">Sign in</button>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
