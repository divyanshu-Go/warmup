'use client';

import { useState } from 'react';
import { requestApi } from './api';

export default function EmailVerification({ resume, user, linked, loading, onVerified, onSignOut }) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function sendCode() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await requestApi('/api/auth/send-code', { resume_id: resume.id });
      setSent(true);
      setCode('');
      setMessage(`Code sent to ${data.email}. It expires in 10 minutes.`);
    } catch (err) {
      setError(err instanceof TypeError ? 'Unable to reach the API.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await requestApi('/api/auth/verify-code', { resume_id: resume.id, code });
      onVerified(data.user);
      setCode('');
      setMessage('Email verified. Your resume is linked to your account.');
    } catch (err) {
      setError(err instanceof TypeError ? 'Unable to reach the API.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await requestApi('/api/auth/logout', {});
      onSignOut();
      setSent(false);
      setMessage('Signed out.');
    } catch (err) {
      setError(err instanceof TypeError ? 'Unable to reach the API.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!resume && !user && !error) return null;

  return (
    <section className="upload-card" aria-labelledby="verification-heading">
      <h2 id="verification-heading">{linked ? 'Email verified' : 'Your account'}</h2>
      {user && <p>Signed in as <strong>{user.email}</strong>.</p>}
      {resume && !linked && (
        resume.parsed_data.email ? <>
          <p>Verify <strong>{resume.parsed_data.email}</strong> to link this resume to your account. Your account is created automatically if needed.</p>
          <button className="file-label" type="button" onClick={sendCode} disabled={busy}>
            {busy ? 'Please wait…' : sent ? 'Resend code' : 'Send verification code'}
          </button>
          {sent && <form onSubmit={verifyCode}>
            <label htmlFor="verification-code">Six-digit email code</label>
            <input id="verification-code" className="code-input" value={code}
              onChange={event => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
              maxLength={6} required disabled={busy} />
            <button className="file-label" type="submit" disabled={busy || code.length !== 6}>Verify and continue</button>
            <p className="preview-note">Five attempts per code. Wait 60 seconds before resending. Only the latest code works.</p>
          </form>}
        </> : <p>No email was found. Upload a resume containing your email address to verify it.</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {user && <button type="button" onClick={signOut} disabled={busy || loading}>Sign out</button>}
    </section>
  );
}
