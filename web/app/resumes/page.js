'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSession } from '../_components/SessionProvider';
import ResumeSelection from '../_components/ResumeSelection';
import { interviewPath } from '../../lib/navigation.mjs';
import ResumeUpload from './ResumeUpload';
import ResumeDetails from './ResumeDetails';
import ResumeContext from './ResumeContext';
import SavedResumes from './SavedResumes';

export default function ResumesPage() {
  const session = useSession();
  const { user, savedResume, draftResume, resumeLinked, resumeVersion, discardDraft, restoreSession } = session;
  return <>
    <div className="page-heading"><h1>Resumes</h1><p>Upload and review your resume before practicing.</p></div>
    {session.restoreError && <div className="page-actions"><button type="button" onClick={restoreSession}>Retry session and resume</button></div>}
    {!user && !session.isRestoring && <p className="resume-caption">Already verified? <Link href="/access">Sign in with an email code</Link> to restore your saved resumes.</p>}
    <ResumeUpload {...session} />
    {draftResume && <>
      <ResumeDetails savedResume={draftResume} resumeLinked={false} headingId="draft-results-heading" />
      <div className="page-actions"><Link className="file-label" href="/access">Verify email and continue</Link><button type="button" onClick={discardDraft}>Dismiss draft</button></div>
      <p className="resume-caption">Your active resume is unchanged until this draft is verified. Dismissing hides the draft; it does not delete the stored upload.</p>
    </>}
    {user && <SavedResumes key={`${user.id}-${resumeVersion}`} selectedId={savedResume?.id} />}
    <Suspense fallback={<p role="status">Loading selected resume…</p>}>
      <ResumeSelection>
        {savedResume && <>
          <ResumeDetails savedResume={savedResume} resumeLinked={resumeLinked} />
          <div className="page-actions"><Link className="file-label" href={interviewPath(savedResume.id)}>Start or continue interview</Link></div>
        </>}
        {user && savedResume && resumeLinked && <ResumeContext key={`context-${savedResume.id}`} resumeId={savedResume.id} />}
      </ResumeSelection>
    </Suspense>
  </>;
}
