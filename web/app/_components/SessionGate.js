'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from './SessionProvider';

function GateContent({ children, requireResume }) {
  const { user, savedResume, draftResume, resumeLinked, isRestoring, restoreError, restoreSession } = useSession();
  const pathname = usePathname();
  const params = useSearchParams();
  const next = encodeURIComponent(pathname + (params.size ? `?${params}` : ''));

  if (isRestoring) return <p className="upload-card" role="status">Checking your session and saved resume…</p>;
  if (restoreError) return <section className="upload-card"><p className="error" role="alert">{restoreError}</p><button type="button" onClick={restoreSession}>Retry session and resume</button></section>;
  if (!user || (requireResume && (!savedResume || !resumeLinked))) {
    return <section className="upload-card">
      <h2>{user ? 'Verify a resume to continue' : 'Email verification required'}</h2>
      <p>{draftResume ? 'Verify the email from your uploaded resume to continue.' : user ? 'Upload and verify a resume to start practicing.' : 'Sign in to restore your saved resumes and interview feedback.'}</p>
      <Link className="file-label" href={!user || draftResume ? `/access?next=${next}` : '/resumes'}>{draftResume ? 'Verify email' : user ? 'Upload resume' : 'Sign in'}</Link>
    </section>;
  }
  return children;
}

export default function SessionGate(props) {
  return <Suspense fallback={<p role="status">Checking access…</p>}><GateContent {...props} /></Suspense>;
}
