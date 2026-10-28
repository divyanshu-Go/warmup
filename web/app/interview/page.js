'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import ResumeSelection from '../_components/ResumeSelection';
import { useSession } from '../_components/SessionProvider';
import SessionGate from '../_components/SessionGate';
import SpokenInterview from './SpokenInterview';

export default function InterviewPage() {
  const { savedResume, answerSaved } = useSession();
  return (
    <>
      <div className="page-heading"><h1>Interview</h1><p>Technical and HR practice, one question at a time.</p></div>
      <SessionGate requireResume>
        <Suspense fallback={<p role="status">Loading selected resume…</p>}>
        <ResumeSelection>
        {savedResume && <>
          <p className="resume-caption">Resume: {savedResume.filename}</p>
          <SpokenInterview key={`interview-${savedResume.id}`} resumeId={savedResume.id} onAnswerSaved={answerSaved} />
          <p className="resume-caption">Leaving this page or refreshing loses unsaved recordings. Start the interview again to retrieve a pending question.</p>
          <div className="page-actions"><Link href="/resumes">Back to resumes</Link><Link href="/history">View history</Link></div>
        </>}
        </ResumeSelection>
        </Suspense>
      </SessionGate>
    </>
  );
}
