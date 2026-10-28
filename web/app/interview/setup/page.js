'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSession } from '../../_components/SessionProvider';
import SessionGate from '../../_components/SessionGate';
import ResumeSelection from '../../_components/ResumeSelection';
import { interviewPath } from '../../../lib/navigation.mjs';
import { MIN_INPUT_LEVEL, monitorMicrophone } from '../microphone.mjs';
import { createMicrophoneCheck } from '../microphoneCheck.mjs';

function Preparation() {
  const { savedResume, practiceMicrophone = '', setPracticeMicrophone } = useSession();
  const [devices, setDevices] = useState([]);
  const [state, setState] = useState('idle');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState('');
  const checker = useRef(null);
  const mounted = useRef(false);
  const attempt = useRef(0);

  async function refreshDevices() {
    try {
      const available = await navigator.mediaDevices?.enumerateDevices();
      if (mounted.current) setDevices((available || []).filter(device => device.kind === 'audioinput' && device.deviceId && !['default', 'communications'].includes(device.deviceId)));
    } catch { /* The default microphone remains selectable when labels are hidden. */ }
  }

  useEffect(() => {
    mounted.current = true;
    checker.current = createMicrophoneCheck({
      getUserMedia: options => navigator.mediaDevices.getUserMedia(options), monitor: monitorMicrophone,
    }, value => {
      if (!mounted.current) return;
      setLevel(value);
      if (value >= MIN_INPUT_LEVEL) setHeard(true);
    });
    refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => {
      mounted.current = false;
      attempt.current++;
      checker.current?.dispose();
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
    };
  }, []);

  async function checkMicrophone() {
    const request = ++attempt.current;
    setState('opening'); setError(''); setHeard(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Recording needs a supported browser on localhost or HTTPS.');
      const started = await checker.current.start(practiceMicrophone);
      if (!mounted.current || request !== attempt.current || !started) return;
      setState('listening');
      refreshDevices();
    } catch (err) {
      if (!mounted.current || request !== attempt.current) return;
      setState('idle'); setLevel(0);
      setError(err.name === 'NotAllowedError' ? 'Microphone access was denied. Allow access in your browser’s site settings, then retry.'
        : err.name === 'NotFoundError' ? 'No microphone was found. Connect one and retry.'
        : err.name === 'OverconstrainedError' ? 'That microphone is unavailable. Choose System default or another input.' : err.message);
    }
  }

  function stopCheck() {
    attempt.current++;
    const detected = checker.current.stop();
    setHeard(detected); setState(detected ? 'ready' : 'idle'); setLevel(0);
  }

  if (!savedResume) return null;
  const checking = state === 'opening' || state === 'listening';
  return <div className="interview-setup-grid">
    <section className="surface setup-overview" aria-labelledby="setup-resume-heading">
      <p className="eyebrow">YOUR STARTING POINT</p><h2 id="setup-resume-heading">{savedResume.filename}</h2>
      <p>{savedResume.parsed_data.name || 'Your verified resume'}</p>
      <dl className="setup-facts"><div><dt>Interview format</dt><dd>Combined technical + HR</dd></div><div><dt>Suggested difficulty</dt><dd>{savedResume.parsed_data.difficulty_level || 'Not available'}</dd></div><div><dt>How it works</dt><dd>One question, one spoken answer, then feedback.</dd></div></dl>
      <Link className="text-action" href={`/resumes?resume=${encodeURIComponent(savedResume.id)}`}>Change resume <span aria-hidden="true">→</span></Link>
      <p className="preview-note">A pending question for this resume continues when you start. There is no timed test or fixed question total.</p>
    </section>
    <section className="surface setup-microphone" aria-labelledby="setup-mic-heading">
      <div className="section-heading"><h2 id="setup-mic-heading">Make sure we can hear you.</h2>{heard && <span className="status-badge">Sound detected</span>}</div>
      <p className="section-description">Choose your input and speak a few words. This check stays on your device; it does not record or upload an answer.</p>
      <label htmlFor="setup-microphone">Microphone</label>
      <select className="context-input" id="setup-microphone" value={practiceMicrophone} disabled={checking} onChange={event => { setPracticeMicrophone(event.target.value); setState('idle'); setHeard(false); setError(''); }}>
        <option value="">System default microphone</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
      </select>
      <meter className="microphone-level" min="0" max="1" value={Math.min(1, level * 8)} aria-label="Microphone check input level" />
      <p className="mic-readiness" role="status">{state === 'opening' ? 'Waiting for microphone permission…' : state === 'listening' ? heard ? 'Sound detected. Your microphone is on; stop the check when ready.' : 'Microphone is on. Speak and watch the input meter.' : heard ? 'Sound was detected. Recording checks the input again.' : 'Ready to check your microphone.'}</p>
      <div className="room-actions">{checking ? <button type="button" onClick={stopCheck}>Stop microphone check</button> : <button type="button" onClick={checkMicrophone}>Check microphone</button>}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="preview-note">Allow microphone access when asked. If the meter stays still, check hardware mute and system input volume. The check is optional; permission is required when you record.</p>
    </section>
    <div className="setup-start"><Link className="file-label" href={`${interviewPath(savedResume.id)}&start=1`}>Start Interview <span aria-hidden="true">→</span></Link><p>Question audio and microphone recording stay under your control.</p></div>
  </div>;
}

export default function SetupPage() {
  return <section className="interview-setup"><div className="dashboard-heading"><p className="eyebrow">BEFORE YOU BEGIN</p><h1>A moment to get ready.</h1><p>Your resume. Your microphone. One focused practice session.</p></div>
    <SessionGate requireResume><Suspense fallback={<p role="status">Loading your selected resume…</p>}><ResumeSelection><Preparation /></ResumeSelection></Suspense></SessionGate>
  </section>;
}
