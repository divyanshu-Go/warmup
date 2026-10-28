export default function ResumeDetails({ savedResume, resumeLinked, headingId = 'results-heading' }) {
  return (
    <section className="upload-card results" aria-labelledby={headingId}>
      <h2 id={headingId}>{resumeLinked ? 'Your saved resume' : 'Your resume is saved'}</h2>
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
      <p>{resumeLinked ? 'Your resume will be restored when you return while signed in. Open Interview to start or continue practicing.' : 'Continue to email verification to link this resume to your account.'}</p>
    </section>
  );
}
