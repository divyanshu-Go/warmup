'use client';

import { useEffect, useRef, useState } from 'react';
import EmailVerification from './EmailVerification';
import ResumeContext from './ResumeContext';
import SpokenInterview from './SpokenInterview';
import InterviewHistory from './InterviewHistory';
import { apiUrl, requestApi } from './api';

export default function Home() {
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [apiStatus, setApiStatus] = useState('Checking connection…');
  const [isUploading, setIsUploading] = useState(false);
  const [savedResume, setSavedResume] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [user, setUser] = useState(null);
  const [resumeLinked, setResumeLinked] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState('');
  const fileInput = useRef(null);

  useEffect(() => {
    let active = true;
    async function restoreResume() {
      try {
        const session = await requestApi('/api/auth/me');
        if (!active) return;
        setUser(session.user);
        const data = await requestApi('/api/resumes/latest');
        if (!active) return;
        setSavedResume(data.resume);
        setResumeLinked(!!data.resume);
      } catch (error) {
        if (!active) return;
        if (error.status === 401) {
          setUser(null);
          setSavedResume(null);
          setResumeLinked(false);
        } else {
          setRestoreError('Unable to restore your resume. Check the API connection and reload the page.');
        }
      } finally {
        if (active) setIsRestoring(false);
      }
    }
    restoreResume();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        const response = await fetch(apiUrl('/health'), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Health check failed');
        const data = await response.json();
        if (data.status !== 'ok') throw new Error('Unexpected health response');
        setApiStatus('API connected');
      } catch {
        if (!controller.signal.aborted) {
          setApiStatus('API unavailable. Start FastAPI and reload this page.');
        }
      }
    }

    checkApi();
    return () => controller.abort();
  }, []);

  function selectResume(event) {
    const selected = event.target.files?.[0];
    setFileError('');
    setSavedResume(null);
    setResumeLinked(false);
    setFile(null);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setFileError('Please choose a PDF resume.');
      event.target.value = '';
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      setFileError('Please choose a PDF no larger than 5 MB.');
      event.target.value = '';
      return;
    }
    setFile(selected);
  }

  async function uploadResume(event) {
    event.preventDefault();
    if (!file || isUploading || isRestoring) return;
    setIsUploading(true);
    setFileError('');
    setSavedResume(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const data = await requestApi('/api/resumes', body);
      setSavedResume(data);
    } catch (error) {
      setFileError(error instanceof TypeError ? 'Unable to reach the API. Check that FastAPI is running.' : error.message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleVerified(verifiedUser) {
    setUser(verifiedUser);
    setResumeLinked(true);
    setRestoreError('');
  }

  function handleSignOut() {
    setUser(null);
    setSavedResume(null);
    setResumeLinked(false);
    setFile(null);
    setFileError('');
    setRestoreError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/">Interview Practice</a>
        <span className="step">Start with your resume</span>
      </header>

      <section className="intro">
        <p className="eyebrow">YOUR EXPERIENCE. YOUR NEXT INTERVIEW.</p>
        <h1>A little practice.<br />A more confident you.</h1>
        <p className="description">
          Start with your resume, then practice answering technical and HR
          questions out loud, with feedback to help you prepare.
        </p>
      </section>

      <section className="upload-card" aria-labelledby="upload-heading">
        <span className="document-icon" aria-hidden="true">↑</span>
        <h2 id="upload-heading">Upload your resume</h2>
        <p>Choose a text-based PDF, up to 5 MB.</p>
        <form onSubmit={uploadResume}>
          <label htmlFor="resume">Choose PDF resume</label>
          <input ref={fileInput} id="resume" type="file" accept=".pdf,application/pdf" onChange={selectResume} disabled={isUploading || isRestoring} required />
          <p className="preview-note">Uploading sends the extracted text to Groq for parsing and saves the text and details in our database.</p>
          <button className="file-label" type="submit" disabled={!file || isUploading || isRestoring || !!savedResume}>
            {isUploading ? 'Parsing and saving…' : savedResume ? 'Resume saved' : 'Upload and parse resume'}
          </button>
        </form>
        <p className="selected-file" role="status">{file ? `Selected: ${file.name}` : 'No file selected'}</p>
        {fileError && <p className="error" role="alert">{fileError}</p>}
        {isUploading && <p role="status">This may take up to a minute. Please keep this page open.</p>}
        {isRestoring && <p role="status">Checking your session and saved resume…</p>}
        {restoreError && <p className="error" role="alert">{restoreError}</p>}
        {user && !savedResume && !isRestoring && !file && !restoreError && <p>No verified resume is linked yet. Upload and verify a resume to save it to your account.</p>}
      </section>

      {savedResume && (
        <section className="upload-card results" aria-labelledby="results-heading">
          <h2 id="results-heading">{resumeLinked ? 'Your saved resume' : 'Your resume is saved'}</h2>
          <p role="status">{resumeLinked ? 'This resume is linked to your verified account.' : 'Text and extracted details saved successfully.'}</p>
          <dl>
            <dt>Filename</dt><dd>{savedResume.filename}</dd>
            <dt>Name</dt><dd>{savedResume.parsed_data.name || 'Not found'}</dd>
            <dt>Email</dt><dd>{savedResume.parsed_data.email || 'Not found'}</dd>
            <dt>Suggested difficulty</dt><dd>{savedResume.parsed_data.difficulty_level}</dd>
          </dl>
          <h3>Skills</h3>
          <ul>{savedResume.parsed_data.skills.map((skill, index) => <li key={index}>{skill}</li>)}</ul>
          {!savedResume.parsed_data.skills.length && <p>No skills found.</p>}
          <h3>Experience</h3>
          {Array.isArray(savedResume.parsed_data.experience)
            ? <ul>{savedResume.parsed_data.experience.map((item, index) => <li key={index}>{item}</li>)}</ul>
            : <p>{savedResume.parsed_data.experience || 'Not found'}</p>}
          <h3>Education</h3>
          <ul>{savedResume.parsed_data.education.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {!savedResume.parsed_data.education.length && <p>Not found.</p>}
          <p className="preview-note">Reference: {savedResume.id}</p>
          <p>{resumeLinked ? 'Your resume will be restored when you return while signed in. Your combined spoken interview is ready below.' : 'Verify your email below to link this resume to your account.'}</p>
        </section>
      )}

      <EmailVerification key={`verification-${savedResume?.id || 'session'}`} resume={savedResume}
        user={user} linked={resumeLinked} loading={isRestoring || isUploading}
        onVerified={handleVerified} onSignOut={handleSignOut} />

      {user && savedResume && resumeLinked && <ResumeContext key={`context-${savedResume.id}`} resumeId={savedResume.id} />}

      {user && savedResume && resumeLinked && <SpokenInterview key={`interview-${savedResume.id}`} resumeId={savedResume.id}
        onAnswerSaved={() => setHistoryVersion(version => version + 1)} />}

      {user && <InterviewHistory key={`history-${user.id}`} refreshKey={historyVersion} />}

      <ol className="journey" aria-label="Interview preparation steps">
        <li><span>01</span> Upload resume</li>
        <li><span>02</span> Practice speaking</li>
        <li><span>03</span> Review feedback</li>
      </ol>
      <footer><p role="status">{apiStatus}</p></footer>
    </main>
  );
}
