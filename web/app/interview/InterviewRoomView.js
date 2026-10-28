'use client';

import Link from 'next/link';
import { interviewSetupPath } from '../../lib/navigation.mjs';

export default function InterviewRoomView({ state, actions, previewRef, feedbackRef }) {
  const { currentQuestion, questionMeta, evaluationResult, isLoading, operation, isRecording, isPreparing, isStopping,
    recording, recordingUrl, recordingSeconds, transcript, microphones, selectedMicrophone, activeMicrophone,
    inputVolume, hasInputSignal, useVoice, isSpeaking, isVoiceLoading, voiceError, error, resumeId, resumeFilename } = state;
  const feedback = !!evaluationResult;
  const busy = isLoading || isPreparing || isStopping;
  const step = feedback ? 3 : recording && !isRecording && !isPreparing ? 2 : isRecording || isPreparing ? 1 : 0;
  const steps = ['Listen', 'Record', 'Review', 'Feedback'];
  const timer = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`;

  return <>
    <div className="room-topbar"><div><p className="eyebrow">FOCUSED PRACTICE</p><h1>Combined spoken interview</h1><p className="room-resume">Resume: {resumeFilename || 'Your selected resume'}</p></div><Link className="text-action room-exit" href="/">Exit practice <span aria-hidden="true">↗</span></Link></div>
    <ol className="interview-steps" aria-label="Answer workflow">{steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={index < step ? 'is-complete' : ''}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>
    <div className={`room-grid${feedback ? ' has-feedback' : ''}`}>
      <section className="surface question-card" aria-labelledby="question-heading" aria-busy={isLoading && operation === 'question'}>
        <div className="section-heading"><p className="eyebrow">{currentQuestion ? 'CURRENT QUESTION' : 'ONE QUESTION AT A TIME'}</p>{questionMeta && <span className="status-badge">{questionMeta.kind === 'hr' ? 'HR' : 'Technical'}{questionMeta.difficulty ? ` · ${questionMeta.difficulty}` : ''}</span>}</div>
        <h2 id="question-heading">{currentQuestion ? 'Think it through. Then speak.' : 'Ready when you are.'}</h2>
        {currentQuestion ? <p className="room-question">{currentQuestion}</p> : <>
          <p className="section-description">Start to retrieve a pending question or get the next question for this resume.</p>
          <button className="file-label" type="button" onClick={actions.fetchNewQuestion} disabled={isLoading}>{isLoading ? 'Getting question…' : error ? 'Retry question' : 'Start Interview'}</button>
          <p><Link href={interviewSetupPath(resumeId)}>Check your setup first</Link></p>
        </>}
        <div className="question-audio-controls">
          <label className="voice-setting"><input type="checkbox" checked={useVoice} disabled={busy || isRecording} onChange={actions.toggleVoice} />Read questions aloud</label>
          {currentQuestion && <button type="button" onClick={actions.speakQuestion} disabled={busy || isRecording}>{isVoiceLoading ? 'Stop loading voice' : isSpeaking ? 'Stop speaking' : 'Speak question'}</button>}
        </div>
        <p className="detail-hint">Question voice: Autumn. The text stays available if audio cannot play.</p>
        {isVoiceLoading && <p role="status">Preparing question audio…</p>}
        {voiceError && <p className="error" role="alert">{voiceError}</p>}
        {currentQuestion && !feedback && <p className="question-guidance">Take a moment to plan your answer. Recording begins only when you choose Start Recording.</p>}
      </section>

      {currentQuestion && !feedback && <section className="surface recording-card" aria-labelledby="recording-heading">
        <p className="eyebrow">{step === 2 ? 'REVIEW BEFORE SUBMITTING' : 'YOUR SPOKEN ANSWER'}</p><h2 id="recording-heading">{step === 2 ? 'Listen back. Make it yours.' : 'When you’re ready, speak.'}</h2>
        <p className="section-description">Up to 5 minutes. Stopping creates a preview; it does not submit your answer.</p>
        <label htmlFor="interview-microphone">Microphone</label>
        <select className="context-input" id="interview-microphone" value={selectedMicrophone} disabled={busy || isRecording} onChange={actions.changeMicrophone}>
          <option value="">System default microphone</option>{microphones.map((microphone, index) => <option key={microphone.deviceId} value={microphone.deviceId}>{microphone.label || `Microphone ${index + 1}`}</option>)}
        </select>
        {activeMicrophone && <p className="detail-hint">Input: {activeMicrophone}</p>}
        <meter className="microphone-level" min="0" max="1" value={Math.min(1, inputVolume * 8)} aria-label="Microphone input level" />
        <p className="mic-readiness" role="status">{isRecording ? hasInputSignal ? 'Sound detected. Keep speaking.' : 'No sound yet. Check your input meter and microphone mute.' : 'The input meter moves while recording.'}</p>
        <div className={`recording-status${isRecording ? ' is-recording' : ''}`}><span>{isPreparing ? 'Opening microphone' : isStopping ? 'Finishing recording' : isRecording ? 'Recording' : recording ? 'Recording ready' : 'Not recording'}</span><time aria-label="Recording length">{timer}</time><small>/ 5:00</small></div>
        {recordingUrl && <audio ref={previewRef} className="recording-preview" controls src={recordingUrl} onPlay={actions.previewPlaying} aria-label="Your recorded answer" />}
        <div className="room-actions">
          <button className={recording && !isRecording ? '' : 'file-label'} type="button" onClick={isRecording ? actions.stopRecording : actions.startRecording} disabled={busy}>{isPreparing ? 'Opening microphone…' : isStopping ? 'Finishing recording…' : isRecording ? 'Stop Recording' : recording ? 'Record Again' : 'Start Recording'}</button>
          {recording && !isRecording && <button className="file-label" type="button" onClick={actions.submitRecording} disabled={busy}>{isLoading && operation === 'submit' ? 'Submitting…' : error ? 'Retry Submission' : 'Submit Recording'}</button>}
        </div>
        <p className="detail-hint">Submitting sends this recording for transcription and scoring. You can record again before a successful submission.</p>
      </section>}
    </div>
    {isLoading && <p className="surface state-message" role="status">{operation === 'submit' ? 'Uploading, transcribing and evaluating your answer. Keep this page open. Do not submit again.' : 'Getting your interview question…'}</p>}
    {error && <div className="surface room-error"><p className="error" role="alert">{error}</p>{recording && !feedback && <p>The recording is still available on this page. Retry the same submission, or record again if your previous answer was not saved. Leaving discards the local audio.</p>}</div>}
    {transcript && !feedback && <section className="surface transcript-recovery"><h2>Your transcribed answer</h2><p className="interview-feedback">{transcript}</p><p className="detail-hint">Feedback has not been confirmed. Retry Submission keeps the same recording; saved results are reused where available.</p></section>}
    {feedback && <section className="surface feedback-panel" aria-labelledby="feedback-heading">
      <div className="section-heading"><div><p className="eyebrow">ANSWER SAVED</p><h2 id="feedback-heading" ref={feedbackRef} tabIndex={-1}>A clearer next step.</h2></div><div className="answer-score" aria-label={`Score: ${evaluationResult.score} out of 10`}>{evaluationResult.score}<span>/10</span></div></div>
      <div className="feedback-columns"><div><h3>Your transcribed answer</h3><p className="interview-feedback">{transcript || evaluationResult.answer}</p></div><div><h3>Feedback</h3><p className="interview-feedback">{evaluationResult.feedback}</p></div></div>
      {recordingUrl && <details className="resume-full-details"><summary>Replay this recording</summary><audio ref={previewRef} className="recording-preview" controls src={recordingUrl} onPlay={actions.previewPlaying} aria-label="Your recorded answer" /><p className="detail-hint">Audio is available only on this page; history saves text and feedback.</p></details>}
      <div className="room-actions"><button className="file-label" type="button" onClick={actions.fetchNewQuestion} disabled={isLoading}>{isLoading ? 'Getting next question…' : 'Next Question'}</button><Link className="text-action" href="/history">View History <span aria-hidden="true">→</span></Link></div>
      <p className="detail-hint">Transcript, score and feedback saved. Reference: {evaluationResult.id}</p>
    </section>}
    <p className="room-save-note">Unsaved audio exists only on this page. A pending question can be retrieved after leaving; unsaved recordings cannot be recovered.</p>
  </>;
}
