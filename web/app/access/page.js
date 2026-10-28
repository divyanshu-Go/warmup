'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '../_components/SessionProvider';
import { safeReturnPath } from '../../lib/navigation.mjs';
import EmailVerification from './EmailVerification';
import SignInForm from './SignInForm';

function AccessContent() {
  const { user, draftResume, isRestoring, isUploading, restoreError, handleVerified, handleSignOut } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const destination = safeReturnPath(params.get('next'));

  async function verified(verifiedUser, resume = null) {
    await handleVerified(verifiedUser, resume);
    router.push(destination);
  }

  return <>
    <div className="page-heading"><h1>Account access</h1><p>Sign in with an email code, or verify a new resume. No password is needed.</p></div>
    {params.get('expired') === '1' && <p className="resume-caption" role="status">Your session expired. Sign in again to continue. Unsaved recordings are not retained or submitted automatically.</p>}
    {isRestoring ? <p className="upload-card" role="status">Checking your session and saved resume…</p>
      : <>
        {restoreError && <p className="upload-card error" role="alert">{restoreError}</p>}
        {!user && !draftResume && <SignInForm onVerified={verified} />}
        {(draftResume || user) && <EmailVerification key={`verification-${draftResume?.id || 'session'}`} resume={draftResume}
          user={user} linked={!draftResume && !!user} loading={isUploading}
          onVerified={verifiedUser => verified(verifiedUser, draftResume)} onSignOut={handleSignOut} />}
        <div className="page-actions"><Link href={user ? destination : '/resumes'}>{user ? 'Continue' : 'Upload or review resume'}</Link></div>
      </>}
  </>;
}

export default function AccessPage() {
  return <Suspense fallback={<p role="status">Loading account access…</p>}><AccessContent /></Suspense>;
}
