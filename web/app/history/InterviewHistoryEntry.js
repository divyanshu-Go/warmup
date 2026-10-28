import Link from 'next/link';

export default function InterviewHistoryEntry({ entry }) {
  const date = entry.answered_at || entry.created_at;
  const validDate = date && !Number.isNaN(new Date(date).getTime());
  return <details className="history-entry">
    <summary>
      <span className="history-answer-heading"><span className="status-badge">{entry.kind === 'hr' ? 'HR' : entry.kind === 'technical' ? 'Technical' : 'Question'}</span><strong className="history-score">{entry.score}<small>/10</small></strong></span>
      <span className="history-question">{entry.question}</span>
      <span className="history-answer-meta"><span>{entry.filename || 'Resume name unavailable'}</span>{validDate ? <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleString()}</time> : <span>Date unavailable</span>}<span className="history-feedback-toggle"><span className="when-closed">View feedback ↓</span><span className="when-open">Hide feedback ↑</span></span></span>
    </summary>
    <div className="history-answer-details">
      <h3>Full question</h3>
      <p className="interview-question">{entry.question}</p>
      <div className="feedback-columns">
        <div><h3>Your transcribed answer</h3><p className="interview-feedback">{entry.answer}</p></div>
        <div><h3>Score: {entry.score}/10</h3><h3>Feedback</h3><p className="interview-feedback">{entry.feedback}</p></div>
      </div>
      <div className="history-answer-footer">
        <span>Resume: {entry.filename || 'Name unavailable'}{entry.difficulty ? ` · Difficulty: ${entry.difficulty}` : ''}</span>
        <span>Answer reference: {entry.id}</span>
        {entry.resume_id && <><span>Resume reference: {entry.resume_id}</span><Link className="text-action" href={`/resumes?resume=${encodeURIComponent(entry.resume_id)}`}>View this resume in your library →</Link></>}
      </div>
    </div>
  </details>;
}
