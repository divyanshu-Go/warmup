'use client';

import { useSession } from '../_components/SessionProvider';
import SessionGate from '../_components/SessionGate';
import InterviewHistory from './InterviewHistory';
import Link from 'next/link';
import { interviewSetupPath } from '../../lib/navigation.mjs';

export default function HistoryPage() {
  const { user, historyVersion, savedResume, resumeLinked, isSelectingResume } = useSession();
  return (
    <section className="history-page">
      <div className="section-heading library-heading"><div><h1>Your Practice History</h1><p>Revisit your answers, learn from feedback, and keep practicing.</p></div>
        {user && !isSelectingResume && <Link className="file-label" href={savedResume && resumeLinked ? interviewSetupPath(savedResume.id) : '/resumes'}>{savedResume && resumeLinked ? 'Start Practicing' : 'Choose a resume'}</Link>}
      </div>
      <SessionGate>
        {user && <InterviewHistory key={`history-${user.id}`} refreshKey={historyVersion} />}
      </SessionGate>
    </section>
  );
}
