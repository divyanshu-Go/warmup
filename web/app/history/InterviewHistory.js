'use client';

import { useEffect, useRef, useState } from 'react';
import { requestApi } from '../../lib/api';
import InterviewHistoryEntry from './InterviewHistoryEntry';

// The API is paginated and supplies no lifetime totals or server-side filters.
export function HistoryResults({ entries, hasMore, loading, error, resumeFilter = '', kindFilter = '', onResumeFilter, onKindFilter, onClearFilters, onRefresh, onRetry, onLoadMore }) {
  const resumeSelect = useRef(null);
  const resumes = [...new Map(entries.map(entry => [entry.resume_id, entry.filename])).entries()];
  const filtered = entries.filter(entry => (!resumeFilter || entry.resume_id === resumeFilter) && (!kindFilter || entry.kind === kindFilter));
  const scores = entries.map(entry => entry.score).filter(score => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10);
  const latestDate = entries[0]?.answered_at || entries[0]?.created_at;
  const validDate = latestDate && !Number.isNaN(new Date(latestDate).getTime());
  return <section className="surface history-content" aria-labelledby="history-heading" aria-busy={loading}>
    <div className="section-heading"><div><h2 id="history-heading">Saved answers</h2><p className="section-description">Technical and HR answers across your linked resumes, newest first.</p></div><button type="button" onClick={onRefresh} disabled={loading}>Refresh history</button></div>
    {entries.length > 0 && <>
      <dl className="practice-summary">
        <div><dt>Loaded answers</dt><dd>{entries.length}</dd><span>{hasMore ? 'Older answers available below' : 'All saved answers loaded'}</span></div>
        {scores.length > 0 && <div><dt>Average loaded score</dt><dd>{(scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1)}<small>/10</small></dd><span>Based on {scores.length} saved {scores.length === 1 ? 'score' : 'scores'}</span></div>}
        {validDate && <div><dt>Last practiced</dt><dd className="summary-date">{new Date(latestDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd><span>Latest loaded answer</span></div>}
      </dl>
      <p className="detail-hint">Summary covers all loaded answers, before filters. It is not a lifetime performance report.</p>
    </>}
    {(entries.length > 0 || resumeFilter || kindFilter) && <div className="history-filters">
      <label htmlFor="history-resume">Resume<select ref={resumeSelect} id="history-resume" className="context-input" value={resumeFilter} onChange={event => onResumeFilter(event.target.value)} aria-describedby="history-filter-scope"><option value="">All loaded resumes</option>{resumeFilter && !resumes.some(([id]) => id === resumeFilter) && <option value={resumeFilter}>Previously selected resume</option>}{resumes.map(([id, name]) => <option key={id} value={id}>{name || 'Unnamed resume'}{resumes.filter(([, filename]) => filename === name).length > 1 ? ` · ${id.slice(0, 8)}` : ''}</option>)}</select></label>
      <label htmlFor="history-kind">Question type<select id="history-kind" className="context-input" value={kindFilter} onChange={event => onKindFilter(event.target.value)} aria-describedby="history-filter-scope"><option value="">All types</option><option value="technical">Technical</option><option value="hr">HR</option></select></label>
      {(resumeFilter || kindFilter) && <button type="button" onClick={() => { onClearFilters(); resumeSelect.current?.focus(); }}>Clear filters</button>}
      <p id="history-filter-scope" className="detail-hint">Filters apply to loaded answers only. Load more to include older answers.</p>
    </div>}
    {loading && <p className="state-message" role="status">Loading interview history…</p>}
    {error && <div className="history-error"><p className="error" role="alert">{error}</p>{entries.length > 0 && <p className="detail-hint">Previously loaded answers remain available. They may not include your latest activity.</p>}<button type="button" onClick={onRetry} disabled={loading}>Retry history request</button></div>}
    {!loading && !error && entries.length === 0 && <div className="empty-state"><h3>Your first answer starts here.</h3><p>Complete and submit a spoken answer to save its transcript, score and feedback. Choose Start Practicing above to begin.</p></div>}
    {entries.length > 0 && <>
      <p className="history-result-count" role="status">{filtered.length} of {entries.length} loaded answers shown.</p>
      {!filtered.length && <div className="empty-state"><h3>No loaded answers match.</h3><p>Clear the filters{hasMore ? ' or load more to check older answers' : ''}.</p></div>}
      {filtered.map(entry => <InterviewHistoryEntry key={entry.id} entry={entry} />)}
    </>}
    {hasMore && <div className="history-pagination"><p className="detail-hint">Older answers may include other resumes and question types.</p><button type="button" onClick={onLoadMore} disabled={loading}>Load more answers</button></div>}
  </section>;
}

export default function InterviewHistory({ refreshKey }) {
  const [entries, setEntries] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resumeFilter, setResumeFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const failedOffset = useRef(0);
  const latestRequest = useRef(0);

  async function loadHistory(offset = 0) {
    const request = ++latestRequest.current;
    failedOffset.current = offset;
    setLoading(true);
    setError('');
    try {
      const data = await requestApi(`/api/interview/history?limit=10&offset=${offset}`);
      if (request !== latestRequest.current) return;
      setEntries(previous => {
        if (offset === 0) return data.entries;
        const known = new Set(previous.map(entry => entry.id));
        return [...previous, ...data.entries.filter(entry => !known.has(entry.id))];
      });
      setHasMore(data.has_more);
      setNextOffset(offset + data.entries.length);
    } catch (err) {
      if (request !== latestRequest.current) return;
      if (err.status === 401) {
        setEntries([]);
        setHasMore(false);
        setError('Your session has expired. Sign in again to view your history.');
      } else {
        setError(err instanceof TypeError ? 'Unable to load history. Check your connection and retry.' : err.message);
      }
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
    return () => { latestRequest.current++; };
  }, [refreshKey]);

  return <HistoryResults entries={entries} hasMore={hasMore} loading={loading} error={error}
    resumeFilter={resumeFilter} kindFilter={kindFilter} onResumeFilter={setResumeFilter} onKindFilter={setKindFilter}
    onClearFilters={() => { setResumeFilter(''); setKindFilter(''); }} onRefresh={() => loadHistory()}
    onRetry={() => loadHistory(failedOffset.current)} onLoadMore={() => loadHistory(nextOffset)} />;
}
