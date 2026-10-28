export default function ResumeDetails({ savedResume, resumeLinked, headingId = 'results-heading', headingRef, children }) {
  const data = savedResume.parsed_data;
  const skills = data.skills || [];
  const experience = Array.isArray(data.experience) ? data.experience : data.experience ? [data.experience] : [];
  const education = data.education || [];
  return <section className={`surface library-resume-card${resumeLinked ? '' : ' draft-review'}`} aria-labelledby={headingId}>
    <div className="section-heading"><p className="eyebrow">{resumeLinked ? 'READY FOR YOUR NEXT INTERVIEW' : 'PARSED · NOT VERIFIED'}</p><span className="status-badge">{resumeLinked ? 'Active · Verified' : 'Draft · Needs verification'}</span></div>
    <div className="resume-card-title"><h2 id={headingId} ref={headingRef} tabIndex={-1}>{resumeLinked ? 'Active Resume' : 'Review your draft'}</h2><p className="resume-filename">{savedResume.filename}</p></div>
    {!resumeLinked && <p className="section-description">Check the extracted details before verifying the email shown below. This draft has not replaced your active resume.</p>}
    <dl className="resume-overview library-candidate"><div><dt>Candidate</dt><dd>{data.name || 'Not found'}</dd></div><div><dt>Email in resume</dt><dd>{data.email || 'Not found'}</dd></div><div><dt>Suggested difficulty</dt><dd>{data.difficulty_level || 'Not found'}</dd></div></dl>
    <div className="resume-summary-grid">
      <div><h3>Skills</h3>{skills.length ? <ul className="skill-tags">{skills.slice(0, 8).map((skill, index) => <li key={index}>{skill}</li>)}</ul> : <p>No skills were extracted.</p>}{skills.length > 8 && <p className="detail-hint">{skills.length - 8} more in the full details below.</p>}</div>
      <div><h3>Experience summary</h3><p className="experience-excerpt">{experience[0] || 'No experience was extracted.'}</p>{experience.length > 1 && <p className="detail-hint">{experience.length - 1} more {experience.length === 2 ? 'entry' : 'entries'} in the full details.</p>}</div>
    </div>
    <details className="resume-full-details"><summary>View all extracted details</summary>
      <h3>All skills</h3>{skills.length ? <ul>{skills.map((skill, index) => <li key={index}>{skill}</li>)}</ul> : <p>No skills found.</p>}
      <h3>Experience</h3>{experience.length ? <ul>{experience.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Not found.</p>}
      <h3>Education</h3>{education.length ? <ul>{education.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Not found.</p>}
      {savedResume.created_at && <p className="detail-hint">Uploaded {new Date(savedResume.created_at).toLocaleString()}</p>}
      <p className="detail-hint">Reference: {savedResume.id}</p>
    </details>
    {children && <div className="resume-card-actions">{children}</div>}
  </section>;
}
