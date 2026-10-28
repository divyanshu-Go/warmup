'use client';

import { useEffect, useRef, useState } from 'react';
import { requestApi } from '../../lib/api';
import InterviewHistoryEntry from './InterviewHistoryEntry';

export default function InterviewHistory({ refreshKey }) {
  const [entries, setEntries] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestRequest = useRef(0);

  async function loadHistory(offset = 0) {
    const request = ++latestRequest.current;
    setLoading(true);
    setError('');
    if (offset === 0) {
      setEntries([]);
      setHasMore(false);
    }
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
        setError('Your session has expired. Reload the page and verify your email again.');
      } else {
        setError(err instanceof TypeError ? 'Unable to reach the API. Please retry Refresh.' : err.message);
      }
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
    return () => { latestRequest.current++; };
  }, [refreshKey]);

  return (
    <section className="upload-card results" aria-labelledby="history-heading">
      <h2 id="history-heading">Interview history</h2>
      <p>Review your completed answers from all your linked resumes, newest first.</p>
      <button type="button" onClick={() => loadHistory()} disabled={loading}>Refresh history</button>
      {loading && <p role="status">Loading interview history…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!loading && !error && entries.length === 0 && <p>No completed answers yet. Submit an interview recording to see your saved feedback here.</p>}
      {entries.map(entry => <InterviewHistoryEntry key={entry.id} entry={entry} />)}
      {entries.length > 0 && <p>{entries.length} saved answers shown.</p>}
      {hasMore && <button className="file-label" type="button" onClick={() => loadHistory(nextOffset)} disabled={loading}>Load more</button>}
    </section>
  );
}
