'use client';

import { useSession } from '../_components/SessionProvider';
import SessionGate from '../_components/SessionGate';
import InterviewHistory from './InterviewHistory';

export default function HistoryPage() {
  const { user, historyVersion } = useSession();
  return (
    <>
      <div className="page-heading"><h1>History</h1><p>Your saved questions, answers and feedback.</p></div>
      <SessionGate>
        {user && <InterviewHistory key={`history-${user.id}`} refreshKey={historyVersion} />}
      </SessionGate>
    </>
  );
}
