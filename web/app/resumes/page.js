'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from '../_components/SessionProvider';
import ResumeSelection from '../_components/ResumeSelection';
import { interviewSetupPath } from '../../lib/navigation.mjs';
import ResumeUpload from './ResumeUpload';
import ResumeDetails from './ResumeDetails';
import ResumeContext from './ResumeContext';
import SavedResumes from './SavedResumes';

function ResumeSearch({ resumeId }) {
  const requestedId = useSearchParams().get('resume');
  const { isSelectingResume } = useSession();
  if (isSelectingResume || (requestedId && requestedId !== resumeId)) return null;
  return <details className="surface resume-search">
    <summary><span><strong>Search this resume</strong><span className="search-description">Find passages to help you prepare an answer.</span></span><span className="search-toggle" aria-hidden="true">+</span></summary>
    <ResumeContext resumeId={resumeId} embedded />
  </details>;
}

function ResumeLibrary({ session }) {
  const { user, savedResume, draftResume, resumeLinked, resumeVersion, discardDraft, isUploading, fileError, file } = session;
  const active = !!user && !!savedResume && resumeLinked;
  const [uploadOpen, setUploadOpen] = useState(!active && !draftResume);
  const panelRef = useRef(null);
  const draftHeading = useRef(null);
  const activeHeading = useRef(null);
  const previousDraft = useRef(draftResume?.id);
  const focusPanel = useRef(false);

  useEffect(() => {
    if (fileError || isUploading) setUploadOpen(true);
  }, [fileError, isUploading]);

  useEffect(() => {
    if (draftResume?.id && draftResume.id !== previousDraft.current) {
      setUploadOpen(false);
      draftHeading.current?.focus();
    }
    previousDraft.current = draftResume?.id;
  }, [draftResume?.id]);

  useEffect(() => {
    if (uploadOpen && focusPanel.current) {
      panelRef.current?.focus();
      focusPanel.current = false;
    }
  }, [uploadOpen]);

  function openUpload() {
    focusPanel.current = true;
    setUploadOpen(true);
    if (uploadOpen) { panelRef.current?.focus(); focusPanel.current = false; }
  }

  function dismissDraft() {
    discardDraft();
    if (active) activeHeading.current?.focus();
    else openUpload();
  }

  return <>
    <div className="library-heading section-heading">
      <div><p className="eyebrow">RESUME LIBRARY</p><h1>Your Resumes</h1><p>Choose your experience. Make it the starting point for your next interview.</p></div>
      {(active || draftResume) && <button type="button" onClick={openUpload} aria-expanded={uploadOpen} aria-controls="resume-upload-panel" disabled={isUploading}>Upload another resume <span aria-hidden="true">↑</span></button>}
    </div>
    {!user && <p className="library-sign-in">Already practiced here? <Link href="/access?next=%2Fresumes">Sign in with an email code</Link> to see your saved resumes.</p>}

    <Suspense fallback={<p className="surface state-message" role="status">Loading selected resume…</p>}>
      <ResumeSelection>
        {active ? <ResumeDetails savedResume={savedResume} resumeLinked headingRef={activeHeading}>
          <Link className="file-label" href={interviewSetupPath(savedResume.id)}>Start Practicing <span aria-hidden="true">→</span></Link>
          <p>Your combined technical and HR interview uses this resume.</p>
        </ResumeDetails> : <section className="surface library-empty" aria-labelledby="no-active-heading">
          <span className="empty-state-mark" aria-hidden="true">↑</span><div><h2 id="no-active-heading">No active resume yet</h2><p>{draftResume ? 'Your draft is ready for review. Verify its email below to make it active.' : 'Upload a resume and verify its email to start practicing with questions based on your experience.'}</p></div>
        </section>}
      </ResumeSelection>
    </Suspense>

    {draftResume && <ResumeDetails savedResume={draftResume} resumeLinked={false} headingId="draft-results-heading" headingRef={draftHeading}>
      {draftResume.parsed_data.email ? <Link className="file-label" href="/access?next=%2Fresumes">Verify Email &amp; Continue <span aria-hidden="true">→</span></Link>
        : <><p className="error" role="alert">No email was found in this resume. Upload a corrected PDF containing your email to continue verification.</p><button type="button" onClick={openUpload}>Upload corrected PDF</button></>}
      <button type="button" onClick={dismissDraft}>Dismiss Draft</button>
      <p>Your active resume is unchanged until this draft is verified. Dismissing hides the draft; it does not delete the stored upload.</p>
    </ResumeDetails>}

    {user && <SavedResumes key={`${user.id}-${resumeVersion}`} selectedId={savedResume?.id} />}

    <div id="resume-upload-panel" className="library-upload-panel" ref={panelRef} tabIndex={-1} hidden={!uploadOpen}>
      <ResumeUpload {...session} onClose={active || draftResume ? () => setUploadOpen(false) : undefined} />
    </div>
    {!uploadOpen && (file || fileError) && <p className="library-sign-in">{fileError ? 'Your upload needs attention.' : `Selected file: ${file.name}.`} <button type="button" onClick={openUpload}>Return to upload</button></p>}

    {active && <Suspense fallback={<p role="status">Loading resume search…</p>}>
      <ResumeSearch key={`search-${savedResume.id}`} resumeId={savedResume.id} />
    </Suspense>}
  </>;
}

export default function ResumesPage() {
  const session = useSession();
  return <div className="resume-library">
    {session.isRestoring ? <><div className="dashboard-heading"><h1>Your Resumes</h1><p>Getting your library ready.</p></div><p className="surface state-message" role="status">Checking your session and saved resume…</p></>
      : session.restoreError ? <><div className="dashboard-heading"><h1>Your Resumes</h1></div><div className="surface state-message"><p className="error" role="alert">{session.restoreError}</p><button type="button" onClick={session.restoreSession}>Retry session and resume</button></div></>
      : <ResumeLibrary key={session.user?.id || 'guest'} session={session} />}
  </div>;
}
