"use client";

import { useState, useEffect, useRef } from 'react';
import { loadQuestionAudio, requestApi } from '../../lib/api';
import { createQuestionAudioPlayer } from './questionAudio.mjs';
import { MIN_INPUT_LEVEL, monitorMicrophone } from './microphone.mjs';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 300;

export default function SpokenInterview({ resumeId, onAnswerSaved }) {
    const [turnId, setTurnId] = useState(null);
    const [error, setError] = useState('');
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [transcript, setTranscript] = useState('');
    const [evaluationResult, setEvaluationResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isVoiceLoading, setIsVoiceLoading] = useState(false);
    const [voiceError, setVoiceError] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [isPreparing, setIsPreparing] = useState(false);
    const [tabSwitches, setTabSwitches] = useState(0);
    const [useVoice, setUseVoice] = useState(true);
    const [recording, setRecording] = useState(null);
    const [recordingUrl, setRecordingUrl] = useState(null);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [microphones, setMicrophones] = useState([]);
    const [selectedMicrophone, setSelectedMicrophone] = useState('');
    const [activeMicrophone, setActiveMicrophone] = useState('');
    const [inputVolume, setInputVolume] = useState(0);
    const [hasInputSignal, setHasInputSignal] = useState(false);
    const recorderRef = useRef(null);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const audioPreviewRef = useRef(null);
    const mountedRef = useRef(false);
    const monitorRef = useRef(null);
    const questionPlayerRef = useRef(null);

    async function refreshMicrophones() {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            if (mountedRef.current) setMicrophones(devices.filter(device =>
                device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications'));
        } catch {
            // Permission can hide the list; default capture is still available.
        }
    }

    useEffect(() => {
        mountedRef.current = true;
        refreshMicrophones();
        navigator.mediaDevices?.addEventListener('devicechange', refreshMicrophones);
        return () => {
            mountedRef.current = false;
            clearInterval(timerRef.current);
            navigator.mediaDevices?.removeEventListener('devicechange', refreshMicrophones);
            monitorRef.current?.stop();
            const recorder = recorderRef.current;
            if (recorder) {
                recorder.ondataavailable = null;
                recorder.onstop = null;
                recorder.onerror = null;
                if (recorder.state !== 'inactive') recorder.stop();
            }
            streamRef.current?.getTracks().forEach(track => track.stop());
        };
    }, []);

    useEffect(() => () => {
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    }, [recordingUrl]);

    useEffect(() => {
        const player = createQuestionAudioPlayer(loadQuestionAudio, state => {
            if (!mountedRef.current) return;
            setIsSpeaking(state === 'speaking');
            setIsVoiceLoading(state === 'loading');
        }, error => {
            if (mountedRef.current) setVoiceError(error.message);
        });
        questionPlayerRef.current = player;
        const stopWhenHidden = () => { if (document.hidden) player.stop(); };
        document.addEventListener('visibilitychange', stopWhenHidden);
        return () => {
            document.removeEventListener('visibilitychange', stopWhenHidden);
            player.dispose();
            if (questionPlayerRef.current === player) questionPlayerRef.current = null;
        };
    }, []);

    function speakQuestion(id, toggle = false) {
        setVoiceError('');
        if (toggle && (isSpeaking || isVoiceLoading)) questionPlayerRef.current?.stop();
        else questionPlayerRef.current?.play(id);
    }

    useEffect(() => {
        const hasQuestion = !!currentQuestion;
        const isAnswering = hasQuestion && !evaluationResult;

        if (!isAnswering) return;

        const handleVisibilityChange = () => {
            if (document.hidden) {
                setTabSwitches(prev => {
                    const newCount = prev + 1;
                    if (newCount >= 3) {
                        alert("Warning: Multiple tab switches detected. Please stay on this page.");
                    } else {
                        alert(`Warning: Tab switching is monitored. Warning ${newCount}/3`);
                    }
                    return newCount;
                });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [currentQuestion, evaluationResult]);



    function stopRecording() {
        const recorder = recorderRef.current;
        if (recorder && recorder.state === 'recording') recorder.stop();
    }

    async function startRecording() {
        if (isLoading || isPreparing || isRecording) return;
        setIsPreparing(true);
        setError('');
        try {
            if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
                throw new Error('Audio recording is unavailable. Use a supported browser on localhost or HTTPS.');
            }
            audioPreviewRef.current?.pause();
            questionPlayerRef.current?.stop();
            setVoiceError('');
            const audio = { channelCount: { ideal: 1 } };
            if (selectedMicrophone) audio.deviceId = { exact: selectedMicrophone };
            const stream = await navigator.mediaDevices.getUserMedia({ audio });
            if (!mountedRef.current) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            streamRef.current = stream;
            const track = stream.getAudioTracks()[0];
            if (!track || track.readyState !== 'live' || !track.enabled) {
                throw new Error('The selected microphone has no active audio track. Choose another microphone.');
            }
            setActiveMicrophone(track.label || 'System default microphone');
            refreshMicrophones();
            setInputVolume(0);
            setHasInputSignal(false);
            const monitor = await monitorMicrophone(stream, level => {
                if (!mountedRef.current) return;
                setInputVolume(level);
                if (level >= MIN_INPUT_LEVEL) setHasInputSignal(true);
            });
            monitorRef.current = monitor;
            if (!mountedRef.current) {
                monitor.stop();
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
                .find(type => MediaRecorder.isTypeSupported(type));
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            recorderRef.current = recorder;
            const chunks = [];
            let failed = false;
            function releaseMicrophone() {
                clearInterval(timerRef.current);
                monitor.stop();
                stream.getTracks().forEach(track => track.stop());
                if (mountedRef.current) {
                    setIsRecording(false);
                    setInputVolume(0);
                }
            }
            recorder.ondataavailable = event => {
                if (event.data.size) chunks.push(event.data);
            };
            recorder.onstop = () => {
                const capturedSound = monitor.hasSignal();
                releaseMicrophone();
                if (!mountedRef.current || failed) return;
                if (!capturedSound) {
                    setRecording(null);
                    setRecordingUrl(null);
                    setError(`No microphone sound was captured from ${track.label || 'the selected input'}. Choose the correct microphone and check its hardware mute and Windows input volume, then record again.`);
                    return;
                }
                const blob = new Blob(chunks, { type: recorder.mimeType });
                if (!blob.size || blob.size > MAX_AUDIO_BYTES) {
                    setError(blob.size ? 'Recording exceeds 10 MB. Please record a shorter answer.' : 'No audio was captured. Please record again.');
                    return;
                }
                setRecording(blob);
                setRecordingUrl(URL.createObjectURL(blob));
            };
            recorder.onerror = () => {
                failed = true;
                recorder.onstop = null;
                if (recorder.state !== 'inactive') recorder.stop();
                releaseMicrophone();
                if (mountedRef.current) setError('Audio recording failed. Please record again.');
            };
            setRecording(null);
            setRecordingUrl(null);
            setTranscript('');
            setRecordingSeconds(0);
            recorder.start(1000);
            setIsRecording(true);
            const startedAt = Date.now();
            timerRef.current = setInterval(() => {
                const seconds = Math.floor((Date.now() - startedAt) / 1000);
                setRecordingSeconds(seconds);
                // Leave a small margin for container encoding before the server's 5-minute cap.
                if (seconds >= MAX_RECORDING_SECONDS - 1) stopRecording();
            }, 1000);
        } catch (err) {
            monitorRef.current?.stop();
            streamRef.current?.getTracks().forEach(track => track.stop());
            if (mountedRef.current) {
                setError(err.name === 'NotAllowedError'
                    ? 'Microphone access denied. Allow microphone access and try again.'
                    : err.name === 'NotFoundError' ? 'No microphone was found.'
                    : err.name === 'OverconstrainedError' ? 'The selected microphone is unavailable. Choose another microphone.' : err.message);
            }
        } finally {
            if (mountedRef.current) setIsPreparing(false);
        }
    }

    const fetchNewQuestion = async () => {
        if (isLoading || isRecording || isPreparing) return;
        questionPlayerRef.current?.stop();
        setVoiceError('');
        setIsLoading(true);
        setError('');
        try {
            const response = await requestApi('/api/interview/question', { resume_id: resumeId });
            if (!mountedRef.current) return;
            setTurnId(response.id);
            setCurrentQuestion(response.question);
            setEvaluationResult(null);
            setTranscript('');
            setRecording(null);
            setRecordingUrl(null);
            setRecordingSeconds(0);
            if (useVoice) speakQuestion(response.id);
        } catch (err) {
            if (mountedRef.current) setError(err instanceof TypeError ? 'Unable to reach the API.' : err.message);
        } finally {
            if (mountedRef.current) setIsLoading(false);
        }
    };

    const submitRecording = async () => {
        if (!recording || isLoading || isRecording || isPreparing) return;
        setIsLoading(true);
        setError('');
        try {
            audioPreviewRef.current?.pause();
            const body = new FormData();
            const extension = recording.type.includes('mp4') ? 'm4a' : recording.type.includes('ogg') ? 'ogg' : 'webm';
            body.append('audio', recording, `answer.${extension}`);
            const result = await requestApi(`/api/interview/${turnId}/audio-answer`, body);
            if (!mountedRef.current) return;
            setTranscript(result.answer);
            setEvaluationResult(result);
            onAnswerSaved?.();
        } catch (err) {
            if (!mountedRef.current) return;
            if (err.transcript) setTranscript(err.transcript);
            setError(err instanceof TypeError ? 'Unable to reach the API. Your recording is still available to retry.' : err.message);
        } finally {
            if (mountedRef.current) setIsLoading(false);
        }
    };

    return (
        <section className="upload-card results" aria-labelledby="interview-heading">
            <h2 id="interview-heading">Combined spoken interview</h2>
            <p>Practice technical and HR questions together, one question at a time.</p>
            <label className="voice-setting">
                <input type="checkbox" checked={useVoice} onChange={() => {
                    if (useVoice) questionPlayerRef.current?.stop();
                    setUseVoice(!useVoice);
                    setVoiceError('');
                }} />
                Read questions aloud
            </label>
            {!currentQuestion && <button className="file-label" type="button" onClick={fetchNewQuestion} disabled={isLoading}>
                {isLoading ? 'Getting question…' : 'Start interview'}
            </button>}
            {currentQuestion && <>
                <h3>Question</h3>
                <p className="interview-question">{currentQuestion}</p>
                <button type="button" onClick={() => speakQuestion(turnId, true)} disabled={isRecording || isPreparing}>
                    {isVoiceLoading ? 'Stop loading voice' : isSpeaking ? 'Stop speaking' : 'Speak question'}
                </button>
                <p className="preview-note">Question voice: Autumn</p>
                {isVoiceLoading && <p role="status">Preparing question audio…</p>}
                {voiceError && <p className="error" role="alert">{voiceError}</p>}
                {!evaluationResult && <>
                    <h3>Record your answer</h3>
                    <p>Record up to 5 minutes. Replay or record again before submitting. Audio is sent to Groq for transcription when you submit.</p>
                    <label htmlFor="interview-microphone">Microphone</label>
                    <select className="context-input" id="interview-microphone" value={selectedMicrophone}
                        disabled={isLoading || isPreparing || isRecording}
                        onChange={event => {
                            setSelectedMicrophone(event.target.value);
                            setActiveMicrophone('');
                            setRecording(null);
                            setRecordingUrl(null);
                            setHasInputSignal(false);
                            setTranscript('');
                            setError('');
                        }}>
                        <option value="">System default microphone</option>
                        {microphones.map((microphone, index) => <option key={microphone.deviceId} value={microphone.deviceId}>
                            {microphone.label || `Microphone ${index + 1}`}
                        </option>)}
                    </select>
                    {activeMicrophone && <p>Input: {activeMicrophone}</p>}
                    <meter className="microphone-level" min="0" max="1" value={Math.min(1, inputVolume * 8)} aria-label="Microphone input level" />
                    <p role="status">{isRecording
                        ? hasInputSignal ? 'Microphone sound detected. Keep speaking.' : 'No sound detected yet. Speak and check that the input meter moves.'
                        : 'While recording, this meter should move when you speak.'}</p>
                    <button className="file-label" type="button" onClick={isRecording ? stopRecording : startRecording}
                        disabled={isLoading || isPreparing}>
                        {isPreparing ? 'Opening microphone…' : isRecording ? 'Stop recording' : recording ? 'Record again' : 'Start recording'}
                    </button>
                    <p role="status">{isRecording ? 'Recording: ' : 'Recording length: '}{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</p>
                </>}
                {recordingUrl && <audio ref={audioPreviewRef} className="recording-preview" controls src={recordingUrl} aria-label="Your recorded answer" />}
                {!evaluationResult && <button className="file-label" type="button" onClick={submitRecording}
                    disabled={isLoading || isPreparing || isRecording || !recording}>
                    {isLoading ? 'Transcribing and evaluating…' : 'Submit recording'}
                </button>}
                {transcript && <>
                    <h3>Your transcribed answer</h3>
                    <p className="interview-feedback" aria-label="Your transcribed answer">{transcript}</p>
                </>}
                {evaluationResult && <>
                    <h3>Score: {evaluationResult.score}/10</h3>
                    <p className="interview-feedback">{evaluationResult.feedback}</p>
                    <p className="preview-note">Transcript, score and feedback saved. Reference: {evaluationResult.id}</p>
                    <button className="file-label" type="button" onClick={fetchNewQuestion} disabled={isLoading}>
                        {isLoading ? 'Getting question…' : 'Next question'}
                    </button>
                </>}
            </>}
            {isLoading && <p role="status">{currentQuestion && !evaluationResult ? 'Uploading, transcribing and evaluating your recording. Please keep this page open.' : 'Please wait for the interview AI to respond.'}</p>}
            {error && <p className="error" role="alert">{error}</p>}
        </section>
    );
}
