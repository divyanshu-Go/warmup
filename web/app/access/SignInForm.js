'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { requestApi } from '../../lib/api';
import { useSession } from '../_components/SessionProvider';

export default function SignInForm({ onVerified }) {
  const { authBusy, setAuthBusy } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event) {
    event.preventDefault();
    if (busy || authBusy || cooldown) return;
    setBusy(true);
    setError('');
    try {
      const result = await requestApi('/api/auth/sign-in/send-code', { email: email.trim() });
      setEmail(email.trim().toLowerCase());
      setSent(true);
      setCode('');
      setCooldown(60);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof TypeError ? 'Unable to reach the API. Please retry.' : err.message);
    } finally { setBusy(false); }
  }

  async function verify(event) {
    event.preventDefault();
    if (busy || authBusy) return;
    setAuthBusy(true);
    setBusy(true);
    setError('');
    try {
      const data = await requestApi('/api/auth/sign-in/verify-code', { email, code });
      await onVerified(data.user);
    } catch (err) {
      setError(err instanceof TypeError ? 'Unable to reach the API. Please retry.' : err.message);
    } finally { setBusy(false); setAuthBusy(false); }
  }

  return <section className="upload-card" aria-labelledby="sign-in-heading">
    <h2 id="sign-in-heading">Sign in with an email code</h2>
    <p>Use the email you previously verified. No password is needed.</p>
    <form onSubmit={sendCode}>
      <label htmlFor="sign-in-email">Email address</label>
      <input className="context-input" id="sign-in-email" type="email" autoComplete="email" maxLength={254}
        value={email} onChange={event => setEmail(event.target.value)} required disabled={busy || sent || authBusy} />
      <button className="file-label" disabled={busy || authBusy || cooldown > 0} type="submit">
        {busy ? 'Please wait…' : cooldown ? `Resend in ${cooldown}s` : sent ? 'Resend code' : 'Send sign-in code'}
      </button>
    </form>
    {sent && <>
      <button type="button" disabled={busy || authBusy} onClick={() => { setSent(false); setCode(''); setMessage(''); setError(''); }}>Use another email</button>
      <form onSubmit={verify}>
        <label htmlFor="sign-in-code">Six-digit email code</label>
        <input className="code-input" id="sign-in-code" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} required disabled={busy || authBusy} />
        <button className="file-label" type="submit" disabled={busy || authBusy || code.length !== 6}>Verify and sign in</button>
      </form>
      <p>Codes expire in 10 minutes and allow five attempts. Only the latest sign-in code works.</p>
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p>First visit? <Link href="/resumes">Upload a resume</Link> to create your account through email verification.</p>
  </section>;
}
