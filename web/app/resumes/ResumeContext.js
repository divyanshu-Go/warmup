'use client';

import { useState } from 'react';
import { requestApi } from '../../lib/api';

export default function ResumeContext({ resumeId, embedded = false }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search(event) {
    event.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await requestApi(`/api/resumes/${resumeId}/context`, { query: query.trim() });
      setResult(data);
    } catch (err) {
      setError(err instanceof TypeError ? 'Unable to reach the API.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={embedded ? 'resume-search-body' : 'upload-card results'} aria-labelledby="context-heading">
      <h2 id="context-heading">Find relevant resume passages</h2>
      <p>Search a topic to see which parts of your resume could support an interview answer.</p>
      <form onSubmit={search}>
        <label htmlFor="context-query">Question or topic</label>
        <input className="context-input" id="context-query" type="text" value={query}
          onChange={event => setQuery(event.target.value)} placeholder="e.g. projects using Python"
          maxLength={500} required disabled={busy} />
        <button className="file-label" type="submit" disabled={busy || !query.trim()}>
          {busy ? 'Finding passages…' : 'Find passages'}
        </button>
      </form>
      {busy && <p role="status">The first search prepares your resume context and may take longer while the local model downloads.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <>
        <p role="status">{result.matches.length} relevant passages found.</p>
        {result.matches.map(match => <blockquote className="context-match" key={match.chunk}>{match.text}</blockquote>)}
        {!result.matches.length && <p>No readable context was found for this resume.</p>}
        <p className="preview-note">These are passages from your resume. The combined interview uses this same resume context.</p>
      </>}
    </section>
  );
}
