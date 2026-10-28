'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { requestApi } from '../../lib/api';

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

  return <section className="upload-card results" aria-labelledby="saved-resumes-heading">
    <h2 id="saved-resumes-heading">Saved resumes</h2>
    <p>Choose the resume to review and use for your combined interview.</p>
    <button type="button" onClick={() => load()} disabled={loading}>Refresh resumes</button>
    {loading && <p role="status">Loading saved resumes…</p>}
    {error && <><p className="error" role="alert">{error}</p><button type="button" onClick={() => load(failedOffset.current)} disabled={loading}>Retry</button></>}
    {!loading && !error && !resumes.length && <p>No linked resumes yet. Upload and verify a resume to save it here.</p>}
    <ul>{resumes.map(resume => <li key={resume.id}>
      <Link href={`/resumes?resume=${encodeURIComponent(resume.id)}`} aria-current={selectedId === resume.id ? 'true' : undefined}>{resume.filename}</Link>
      {selectedId === resume.id && <strong> · Active</strong>}
      <span className="history-date">{new Date(resume.created_at).toLocaleString()}</span>
    </li>)}</ul>
    {hasMore && <button type="button" className="file-label" onClick={() => load(resumes.length)} disabled={loading}>Load more resumes</button>}
  </section>;
}
