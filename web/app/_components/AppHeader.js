'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from './SessionProvider';

export default function AppHeader() {
  const { user, isRestoring, isUploading, authBusy, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await signOut();
      router.push('/');
    } catch (err) {
      setError(err instanceof TypeError ? 'Unable to reach the API.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 10v4m4-8v12m4-14v16m4-11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </span>
        <span>Interview Practice</span>
      </Link>
      <nav className="site-nav" aria-label="Main navigation">
        {[['/', 'Dashboard'], ['/resumes', 'Resumes'], ['/history', 'History']].map(([href, label]) => (
          <Link key={href} href={href} aria-current={pathname === href ? 'page' : href === '/' && pathname === '/interview' ? 'location' : undefined}>{label}</Link>
        ))}
      </nav>
      <div className="account-controls">
        {isRestoring ? <span role="status">Checking session…</span> : user ? <>
          <span className="account-email">{user.email}</span>
          <button type="button" onClick={logout} disabled={busy || isUploading || authBusy}>{busy ? 'Signing out…' : 'Sign out'}</button>
        </> : <Link href="/access?next=%2F" aria-current={pathname === '/access' ? 'page' : undefined}>Sign in</Link>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </header>
  );
}
