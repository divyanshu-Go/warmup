'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { requestApi } from '../../lib/api';

export function SavedResumeList({ resumes, selectedId }) {
  return <ul className="saved-resume-list">{resumes.map(resume => {
    const active = selectedId === resume.id;
    return <li key={resume.id} className={`saved-resume-row${active ? ' is-active' : ''}`}>
      <span className="resume-file-mark" aria-hidden="true">PDF</span>
      <div className="saved-resume-name"><strong>{resume.filename}</strong><span className="history-date">{resume.created_at ? `Uploaded ${new Date(resume.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Upload date unavailable'}</span></div>
      {active && <span className="status-badge">Active</span>}
      <Link className="resume-select-action" href={`/resumes?resume=${encodeURIComponent(resume.id)}`} aria-current={active ? 'true' : undefined} aria-label={`${active ? 'View' : 'Use'} resume: ${resume.filename}`}>{active ? 'View resume' : 'Use resume'}<span aria-hidden="true">→</span></Link>
    </li>;
  })}</ul>;
}

export default function SavedResumes({ selectedId }) {
  const [resumes, setResumes] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const failedOffset = useRef(0);
  const latestRequest = useRef(0);

  async function load(offset = 0) {
    const request = ++latestRequest.current;
    failedOffset.current = offset;
    setLoading(true);
    setError('');
    try {
      const data = await requestApi(`/api/resumes?limit=10&offset=${offset}`);
      if (request !== latestRequest.current) return;
      setResumes(previous => offset === 0 ? data.resumes : [...previous, ...data.resumes.filter(item => !previous.some(existing => existing.id === item.id))]);
      setHasMore(data.has_more);
    } catch (err) {
      if (request === latestRequest.current) setError(err instanceof TypeError ? 'Unable to reach the API. Please retry.' : err.message);
    } finally { if (request === latestRequest.current) setLoading(false); }
  }

  useEffect(() => { load(); return () => { latestRequest.current++; }; }, []);

  return <section className="surface saved-resumes-section" aria-labelledby="saved-resumes-heading" aria-busy={loading}>
    <div className="section-heading"><div><h2 id="saved-resumes-heading">Saved Resumes</h2><p className="section-description">Select a resume to make it the starting point for your practice.</p></div><button type="button" onClick={() => load()} disabled={loading}>Refresh resumes</button></div>
    {loading && <p role="status">Loading saved resumes…</p>}
    {error && <><p className="error" role="alert">{error}</p><button type="button" onClick={() => load(failedOffset.current)} disabled={loading}>Retry</button></>}
    {!loading && !error && !resumes.length && <div className="empty-state"><h3>Your library starts here.</h3><p>Upload and verify a resume to save it to your account.</p></div>}
    <SavedResumeList resumes={resumes} selectedId={selectedId} />
    {hasMore && <button type="button" className="file-label" onClick={() => load(resumes.length)} disabled={loading}>Load more resumes</button>}
  </section>;
}
