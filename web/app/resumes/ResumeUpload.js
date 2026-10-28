'use client';

export default function ResumeUpload({
  file, fileError, isUploading, savedResume, isRestoring, restoreError, user, fileInput, selectResume, uploadResume
}) {
  return (
    <section className="upload-card" aria-labelledby="upload-heading">
      <span className="document-icon" aria-hidden="true">↑</span>
      <h2 id="upload-heading">Upload your resume</h2>
      <p>Choose a text-based PDF, up to 5 MB.</p>
      <form onSubmit={uploadResume}>
        <label htmlFor="resume">Choose PDF resume</label>
        <input ref={fileInput} id="resume" type="file" accept=".pdf,application/pdf" onChange={selectResume} disabled={isUploading || isRestoring} required={!file} />
        <p className="preview-note">Uploading sends the extracted text to Groq for parsing and saves the text and details in our database.</p>
        <button className="file-label" type="submit" disabled={!file || isUploading || isRestoring}>
          {isUploading ? 'Parsing and saving…' : 'Upload and parse resume'}
        </button>
      </form>
      <p className="selected-file" role="status">{file ? `Selected: ${file.name}` : 'No file selected'}</p>
      {fileError && <p className="error" role="alert">{fileError}</p>}
      {isUploading && <p role="status">This may take up to a minute. Please keep this page open.</p>}
      {isRestoring && <p role="status">Checking your session and saved resume…</p>}
      {restoreError && <p className="error" role="alert">{restoreError}</p>}
      {user && !savedResume && !isRestoring && !file && !restoreError && <p>No verified resume is linked yet. Upload and verify a resume to save it to your account.</p>}
    </section>
  );
}
