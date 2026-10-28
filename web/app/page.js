'use client';

import Link from 'next/link';
import { useSession } from './_components/SessionProvider';
import RecentPractice from './_components/RecentPractice';
import { interviewPath } from '../lib/navigation.mjs';

export default function Home() {
  const { user, savedResume, draftResume, resumeLinked, isRestoring, restoreError, restoreSession, historyVersion, isSelectingResume } = useSession();

  if (isRestoring) return <section className="home-page" aria-busy="true">
    <div className="dashboard-heading"><p className="eyebrow">INTERVIEW PRACTICE</p><h1>Getting things ready.</h1><p role="status">Checking your session and saved resume…</p></div>
    <div className="surface state-message"><p>Your practice space will be ready in a moment.</p></div>
  </section>;

  if (restoreError) return <section className="home-page">
    <div className="dashboard-heading"><p className="eyebrow">LET’S GET YOU BACK</p><h1>We couldn’t load your practice space.</h1></div>
    <div className="surface state-message"><p className="error" role="alert">{restoreError}</p><button type="button" onClick={restoreSession}>Retry connection</button><Link href="/access?next=%2F">Go to sign in</Link></div>
  </section>;

  if (!user) return <section className="home-page welcome-page">
    <div className="welcome-intro">
      <p className="eyebrow">PREPARE WITH PURPOSE</p>
      <h1>Your experience.<br />Your next great answer.</h1>
      <p className="welcome-description">Practice technical and HR questions based on your resume. Answer out loud, get clear feedback, and walk into your next interview more prepared.</p>
      <div className="welcome-actions"><Link className="file-label" href="/resumes">Upload Resume <span aria-hidden="true">↗</span></Link><span>Text-based PDF · Up to 5 MB</span></div>
      <p className="welcome-sign-in">Practiced here before? <Link href="/access?next=%2F">Sign in with an email code</Link></p>
    </div>
    {draftResume && <div className="surface draft-notice"><div><strong>Your uploaded resume is ready to verify.</strong><p>{draftResume.filename}</p></div><Link href="/access?next=%2F">Continue verification <span aria-hidden="true">→</span></Link></div>}
    <ol className="onboarding-steps" aria-label="How interview practice works">
      <li><span className="step-number" aria-hidden="true">01</span><h2>Bring your experience</h2><p>Upload your resume and verify its email to save it to your account.</p></li>
      <li><span className="step-number" aria-hidden="true">02</span><h2>Practice out loud</h2><p>Listen to a question, record your answer, and submit when you’re ready.</p></li>
      <li><span className="step-number" aria-hidden="true">03</span><h2>Know what to improve</h2><p>Review your transcript, score and feedback. Come back and keep practicing.</p></li>
    </ol>
  </section>;

  const name = user.name?.trim().split(/\s+/)[0];
  const ready = savedResume && resumeLinked;
  const skills = savedResume?.parsed_data?.skills || [];
  return <section className="home-page">
    <div className="dashboard-heading"><p className="eyebrow">YOUR PRACTICE SPACE</p><h1>{name ? `Welcome back, ${name}.` : 'Welcome back.'}</h1><p>A little focused practice. A stronger next interview.</p></div>
    {draftResume && <div className="surface draft-notice"><div><strong>A new resume is waiting for verification.</strong><p>Your active resume stays available while you verify {draftResume.filename}.</p></div><Link href="/access?next=%2F">Verify email <span aria-hidden="true">→</span></Link></div>}
    <div className="dashboard-overview">
      <section className="surface active-resume-card" aria-labelledby="active-resume-heading">
        <div className="section-heading"><p className="eyebrow">ACTIVE RESUME</p>{ready && <span className="status-badge">Verified</span>}</div>
        {ready ? <>
          <h2 id="active-resume-heading">{savedResume.filename}</h2><p>Questions grounded in your skills and experience.</p>
          <dl className="resume-overview"><div><dt>Candidate</dt><dd>{savedResume.parsed_data.name || user.name || 'Not found in resume'}</dd></div><div><dt>Suggested difficulty</dt><dd>{savedResume.parsed_data.difficulty_level || 'Not available'}</dd></div></dl>
          {skills.length > 0 && <ul className="skill-tags" aria-label="Skills from your resume">{skills.slice(0, 5).map((skill, index) => <li key={index}>{skill}</li>)}{skills.length > 5 && <li>+{skills.length - 5} more</li>}</ul>}
          <Link className="text-action" href={`/resumes?resume=${encodeURIComponent(savedResume.id)}`}>View or change resume <span aria-hidden="true">→</span></Link>
        </> : <><h2 id="active-resume-heading">Add your first resume.</h2><p>Upload and verify a resume to get questions based on your experience.</p><Link className="file-label" href="/resumes">Upload Resume</Link></>}
      </section>
      <section className="practice-prompt" aria-labelledby="practice-prompt-heading">
        <span className="practice-symbol" aria-hidden="true">↗</span><p className="eyebrow">ONE ANSWER AT A TIME</p>
        <h2 id="practice-prompt-heading">Make your next answer<br />a little stronger.</h2><p>Technical and HR questions in one spoken interview. Listen, answer, then learn from your feedback.</p>
        {ready && !isSelectingResume ? <Link className="file-label" href={interviewPath(savedResume.id)}>Start Practicing <span aria-hidden="true">→</span></Link>
          : <p className="practice-prerequisite" role={isSelectingResume ? 'status' : undefined}>{isSelectingResume ? 'Loading your selected resume…' : 'Your interview will be ready after you verify a resume.'}</p>}
        {ready && <span className="practice-hint">Any pending question continues when you start.</span>}
      </section>
    </div>
    <RecentPractice key={user.id} refreshKey={historyVersion} />
  </section>;
}
