export default function InterviewHistoryEntry({ entry }) {
  return <details className="history-entry">
    <summary>
      <strong>{entry.kind === 'hr' ? 'HR' : 'Technical'} · {entry.score}/10</strong>
      <span className="history-question">{entry.question}</span>
      <span className="history-date">{new Date(entry.answered_at || entry.created_at).toLocaleString()}</span>
    </summary>
    <p className="preview-note">Resume: {entry.filename} · Difficulty: {entry.difficulty}</p>
    <h3>Question</h3>
    <p className="interview-question">{entry.question}</p>
    <h3>Your answer</h3>
    <p className="interview-feedback">{entry.answer}</p>
    <h3>Score: {entry.score}/10</h3>
    <h3>Feedback</h3>
    <p className="interview-feedback">{entry.feedback}</p>
    <p className="preview-note">Reference: {entry.id}</p>
  </details>;
}
