'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ResumeSelection from '../_components/ResumeSelection';
import { useSession } from '../_components/SessionProvider';
import SessionGate from '../_components/SessionGate';
import SpokenInterview from './SpokenInterview';

function Room() {
  const { savedResume, answerSaved, practiceMicrophone, setPracticeMicrophone } = useSession();
  const params = useSearchParams();
  if (!savedResume) return null;
  return <SpokenInterview key={`interview-${savedResume.id}`} resumeId={savedResume.id} resumeFilename={savedResume.filename}
    initialMicrophone={practiceMicrophone} autoStart={params.get('start') === '1'} onMicrophoneChange={setPracticeMicrophone} onAnswerSaved={answerSaved} />;
}

export default function InterviewPage() {
  const { user, savedResume, resumeLinked, isRestoring, restoreError } = useSession();
  const gated = !user || !savedResume || !resumeLinked || isRestoring || restoreError;
  return <div className="interview-room">
    {gated && <div className="dashboard-heading"><h1>Interview practice</h1><p>Use your verified resume for one combined technical and HR interview.</p></div>}
    <SessionGate requireResume><Suspense fallback={<p className="surface state-message" role="status">Loading selected resume…</p>}><ResumeSelection><Room /></ResumeSelection></Suspense></SessionGate>
  </div>;
}
