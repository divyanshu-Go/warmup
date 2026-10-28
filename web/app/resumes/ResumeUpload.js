'use client';

export default function ResumeUpload({
  file, fileError, isUploading, savedResume, isRestoring, restoreError, user, fileInput, selectResume, uploadResume, onClose
}) {
  return (
    <section className="surface library-upload" aria-labelledby="upload-heading" aria-busy={isUploading}>
      <div className="section-heading"><div><p className="eyebrow">ADD TO YOUR LIBRARY</p><h2 id="upload-heading">Upload a resume</h2></div>{onClose && <button type="button" onClick={onClose} disabled={isUploading}>Close upload panel</button>}</div>
      <p id="resume-requirements" className="section-description">Choose a text-based PDF, up to 5 MB. Include your email address for verification. Scanned PDFs need OCR and aren’t supported.</p>
      <form onSubmit={uploadResume}>
        <label htmlFor="resume">Choose PDF resume</label>
        <input ref={fileInput} id="resume" type="file" accept=".pdf,application/pdf" onChange={selectResume} disabled={isUploading || isRestoring} required={!file} aria-invalid={!!fileError} aria-describedby={`resume-requirements${fileError ? ' resume-upload-error' : ''}`} />
        <p className="preview-note">Uploading sends the extracted text to Groq for parsing and saves the text and details in our database.</p>
        <button className="file-label" type="submit" disabled={!file || isUploading || isRestoring}>
          {isUploading ? 'Parsing and saving…' : 'Upload and parse resume'}
        </button>
      </form>
      <p className="selected-file" role="status">{file ? `Selected: ${file.name}` : 'No file selected'}</p>
      {fileError && <p id="resume-upload-error" className="error" role="alert">{fileError}{savedResume && ' Your active resume is unchanged.'} Choose another PDF or retry the upload.</p>}
      {isUploading && <p role="status">Extracting text and parsing your resume. This may take up to a minute. Keep this page open; your active resume stays unchanged.</p>}
      {isRestoring && <p role="status">Checking your session and saved resume…</p>}
      {restoreError && <p className="error" role="alert">{restoreError}</p>}
      {user && !savedResume && !isRestoring && !file && !restoreError && <p>No verified resume is linked yet. Upload and verify a resume to save it to your account.</p>}
    </section>
  );
}
