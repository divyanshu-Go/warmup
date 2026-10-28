'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { requestApi } from '../../lib/api';
import InterviewHistoryEntry from '../history/InterviewHistoryEntry';

export function PracticeActivity({ entries, hasMore, loading, error, onRefresh }) {
  const latest = entries[0];
  return <section className="surface dashboard-activity" aria-labelledby="recent-practice-heading" aria-busy={loading}>
    <div className="section-heading">
      <div><p className="eyebrow">YOUR PRACTICE</p><h2 id="recent-practice-heading">Recent answers</h2></div>
      <Link href="/history">View all history <span aria-hidden="true">↗</span></Link>
    </div>
    <p className="section-description">Your latest saved answers across all linked resumes. Open an answer to review its feedback.</p>
    {loading && <p className="state-message" role="status">Loading recent practice…</p>}
    {error && <div className="state-message"><p className="error" role="alert">{error}</p><button type="button" onClick={onRefresh} disabled={loading}>Retry recent practice</button></div>}
    {latest && <>
      {error && <p className="resume-caption">Showing previously loaded answers.</p>}
      <dl className="practice-summary">
        <div><dt>Recent answers</dt><dd>{entries.length} shown</dd><span>{hasMore ? 'More available in history' : 'All saved answers shown'}</span></div>
        <div><dt>Latest score</dt><dd>{latest.score}<small>/10</small></dd><span>{latest.kind === 'hr' ? 'HR' : 'Technical'} answer</span></div>
        <div><dt>Last practiced</dt><dd className="summary-date">{new Date(latest.answered_at || latest.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd><span>Most recent saved answer</span></div>
      </dl>
      {entries.map(entry => <InterviewHistoryEntry key={entry.id} entry={entry} />)}
    </>}
    {!loading && !error && !latest && <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">↗</span>
      <h3>Your first answer starts the story.</h3>
      <p>Complete a spoken answer to see your transcript, score and feedback here.</p>
    </div>}
  </section>;
}

export default function RecentPractice({ refreshKey }) {
  const [entries, setEntries] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);

  async function load() {
    const request = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const data = await requestApi('/api/interview/history?limit=3&offset=0');
      if (request !== requestVersion.current) return;
      setEntries(data.entries);
      setHasMore(data.has_more);
    } catch (err) {
      if (request !== requestVersion.current) return;
      if (err.status === 401) setEntries([]);
      setError(err instanceof TypeError ? 'Recent practice could not be loaded. Check your connection and retry.' : err.message);
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => { load(); return () => { requestVersion.current++; }; }, [refreshKey]);
  return <PracticeActivity entries={entries} hasMore={hasMore} loading={loading} error={error} onRefresh={load} />;
}
