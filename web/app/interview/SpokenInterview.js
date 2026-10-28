"use client";

import { useState, useEffect, useRef } from 'react';
import { loadQuestionAudio, requestApi } from '../../lib/api';
import { createQuestionAudioPlayer } from './questionAudio.mjs';
import { MIN_INPUT_LEVEL, monitorMicrophone } from './microphone.mjs';
import InterviewRoomView from './InterviewRoomView';
import { installInterviewLeaveGuard } from './leaveGuard.mjs';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 300;

export default function SpokenInterview({ resumeId, resumeFilename, initialMicrophone = '', autoStart = false, onMicrophoneChange, onAnswerSaved }) {
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
    const [questionMeta, setQuestionMeta] = useState(null);
    const [operation, setOperation] = useState(null);
    const [isStopping, setIsStopping] = useState(false);
    const [useVoice, setUseVoice] = useState(true);
    const [recording, setRecording] = useState(null);
    const [recordingUrl, setRecordingUrl] = useState(null);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [microphones, setMicrophones] = useState([]);
    const [selectedMicrophone, setSelectedMicrophone] = useState(initialMicrophone);
    const [activeMicrophone, setActiveMicrophone] = useState('');
    const [inputVolume, setInputVolume] = useState(0);
    const [hasInputSignal, setHasInputSignal] = useState(false);
    const operationRef = useRef(null);
    const unsavedRef = useRef(false);
    const feedbackRef = useRef(null);
    unsavedRef.current = !evaluationResult && !!(recording || isRecording || isPreparing || isStopping || operation === 'submit');
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
        if (['preparing', 'recording', 'stopping', 'submit'].includes(operationRef.current)) return;
        if (toggle && (isSpeaking || isVoiceLoading)) questionPlayerRef.current?.stop();
        else {
            audioPreviewRef.current?.pause();
            questionPlayerRef.current?.play(id);
        }
    }

    useEffect(() => installInterviewLeaveGuard({
        window, document, shouldWarn: () => unsavedRef.current,
        isSubmitting: () => operationRef.current === 'submit',
    }), []);

    useEffect(() => {
        if (evaluationResult) feedbackRef.current?.focus();
    }, [evaluationResult]);

    function stopRecording() {
        const recorder = recorderRef.current;
        if (recorder && recorder.state === 'recording') {
            operationRef.current = 'stopping';
            setIsStopping(true);
            recorder.stop();
        }
    }

    async function startRecording() {
        if (operationRef.current || isLoading || isPreparing || isRecording || !currentQuestion || evaluationResult) return;
        operationRef.current = 'preparing';
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
                operationRef.current = null;
                monitor.stop();
                stream.getTracks().forEach(track => track.stop());
                if (mountedRef.current) {
                    setIsRecording(false);
                    setIsStopping(false);
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
            operationRef.current = 'recording';
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
            operationRef.current = null;
            monitorRef.current?.stop();
            streamRef.current?.getTracks().forEach(track => track.stop());
            if (mountedRef.current) {
                setError(err.name === 'NotAllowedError'
                    ? 'Microphone access denied. Allow microphone access and try again.'
                    : err.name === 'NotFoundError' ? 'No microphone was found.'
                    : err.name === 'OverconstrainedError' ? 'The selected microphone is unavailable. Choose another microphone.' : err.message);
            }
        } finally {
            if (operationRef.current === 'preparing') operationRef.current = null;
            if (mountedRef.current) setIsPreparing(false);
        }
    }

    const fetchNewQuestion = async () => {
        if (operationRef.current || isLoading || isRecording || isPreparing || (recording && !evaluationResult)) return;
        operationRef.current = 'question';
        setOperation('question');
        questionPlayerRef.current?.stop();
        setVoiceError('');
        setIsLoading(true);
        setError('');
        try {
            const response = await requestApi('/api/interview/question', { resume_id: resumeId });
            if (!mountedRef.current) return;
            setTurnId(response.id);
            setCurrentQuestion(response.question);
            setQuestionMeta(response);
            setEvaluationResult(null);
            setTranscript('');
            setRecording(null);
            setRecordingUrl(null);
            setRecordingSeconds(0);
            if (useVoice) speakQuestion(response.id);
        } catch (err) {
            if (mountedRef.current) setError(err instanceof TypeError ? 'Unable to reach the API.' : err.message);
        } finally {
            operationRef.current = null;
            if (mountedRef.current) { setIsLoading(false); setOperation(null); }
        }
    };

    const submitRecording = async () => {
        if (operationRef.current || !recording || isLoading || isRecording || isPreparing || evaluationResult) return;
        operationRef.current = 'submit';
        setOperation('submit');
        questionPlayerRef.current?.stop();
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
            operationRef.current = null;
            if (mountedRef.current) { setIsLoading(false); setOperation(null); }
        }
    };

    useEffect(() => {
        if (autoStart) fetchNewQuestion();
    }, [autoStart]);

    function changeMicrophone(event) {
        if (operationRef.current) return;
        if (recording && !window.confirm('Changing microphones discards the local recording. Change microphone?')) return;
        setSelectedMicrophone(event.target.value);
        onMicrophoneChange?.(event.target.value);
        setActiveMicrophone('');
        setRecording(null);
        setRecordingUrl(null);
        setHasInputSignal(false);
        setRecordingSeconds(0);
        setTranscript('');
        setError('');
    }

    return <InterviewRoomView state={{
        currentQuestion, questionMeta, evaluationResult, isLoading, operation,
        isRecording, isPreparing, isStopping, recording, recordingUrl, recordingSeconds,
        transcript, microphones, selectedMicrophone, activeMicrophone, inputVolume,
        hasInputSignal, useVoice, isSpeaking, isVoiceLoading, voiceError, error, resumeId, resumeFilename,
    }} actions={{
        fetchNewQuestion, startRecording, stopRecording, submitRecording, changeMicrophone,
        speakQuestion: () => speakQuestion(turnId, true),
        toggleVoice: () => { if (useVoice) questionPlayerRef.current?.stop(); setUseVoice(!useVoice); setVoiceError(''); },
        previewPlaying: () => {
            if (operationRef.current) audioPreviewRef.current?.pause();
            else questionPlayerRef.current?.stop();
        },
    }} previewRef={audioPreviewRef} feedbackRef={feedbackRef} />;
}
