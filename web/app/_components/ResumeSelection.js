'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from './SessionProvider';

export default function ResumeSelection({ children }) {
  const id = useSearchParams().get('resume');
  const { user, savedResume, isRestoring, chooseResume, isSelectingResume, resumeError } = useSession();
  useEffect(() => {
    if (id && user && !isRestoring && savedResume?.id !== id) chooseResume(id);
  }, [id, user?.id, isRestoring, chooseResume]);

  if (id && user && !isRestoring && (savedResume?.id !== id || isSelectingResume)) {
    return <section className="upload-card">
      {resumeError ? <><p className="error" role="alert">{resumeError}</p><button type="button" onClick={() => chooseResume(id)}>Retry loading resume</button><p><Link href="/resumes">Back to current resume</Link></p></>
        : <p role="status">Loading selected resume…</p>}
    </section>;
  }
  return children;
}
