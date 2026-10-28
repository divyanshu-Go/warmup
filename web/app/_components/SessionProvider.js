'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl, requestApi, invalidateSessionRequests } from '../../lib/api';
import { safeReturnPath } from '../../lib/navigation.mjs';

const SessionContext = createContext(null);
export function useSession() { return useContext(SessionContext); }

export default function SessionProvider({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [savedResume, setSavedResume] = useState(null);
  const [draftResume, setDraftResume] = useState(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [isSelectingResume, setIsSelectingResume] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [resumeVersion, setResumeVersion] = useState(0);
  const [apiStatus, setApiStatus] = useState('Checking connection…');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const fileInput = useRef(null);
  const epoch = useRef(0);
  const selectionRequest = useRef(0);

  function clearPrivateState() {
    epoch.current++;
    selectionRequest.current++;
    setUser(null);
    setSavedResume(null);
    setDraftResume(null);
    setFile(null);
    setFileError('');
    setRestoreError('');
    setResumeError('');
    setVerificationCode('');
    setVerificationSent(false);
    setIsUploading(false);
    setIsSelectingResume(false);
    setIsRestoring(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function restoreSession() {
    const current = ++epoch.current;
    setIsRestoring(true);
    setUser(null);
    setSavedResume(null);
    setRestoreError('');
    try {
      const session = await requestApi('/api/auth/me');
      if (current !== epoch.current) return;
      setUser(session.user);
      const data = await requestApi('/api/resumes/latest');
      if (current !== epoch.current) return;
      setSavedResume(data.resume);
    } catch (error) {
      if (current !== epoch.current) return;
      if (error.status === 401) clearPrivateState();
      else setRestoreError('Unable to restore your resume. Check the API connection and retry.');
    } finally {
      if (current === epoch.current) setIsRestoring(false);
    }
  }

  useEffect(() => {
    function expired() {
      const destination = safeReturnPath(window.location.pathname + window.location.search);
      clearPrivateState();
      router.replace(`/access?expired=1&next=${encodeURIComponent(destination)}`);
    }
    window.addEventListener('interview:session-expired', expired);
    restoreSession();
    return () => {
      epoch.current++;
      window.removeEventListener('interview:session-expired', expired);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        const response = await fetch(apiUrl('/health'), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Health check failed');
        const data = await response.json();
        if (data.status !== 'ok') throw new Error('Unexpected health response');
        setApiStatus('API connected');
      } catch {
        if (!controller.signal.aborted) {
          setApiStatus('API unavailable. Start FastAPI and reload this page.');
        }
      }
    }

    checkApi();
    return () => controller.abort();
  }, []);


  function selectResume(event) {
    const selected = event.target.files?.[0];
    setFileError('');
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.pdf') || selected.size > 5 * 1024 * 1024) {
      setFile(null);
      event.target.value = '';
      setFileError(!selected.name.toLowerCase().endsWith('.pdf') ? 'Please choose a PDF resume.' : 'Please choose a PDF no larger than 5 MB.');
      return;
    }
    setFile(selected);
  }

  async function uploadResume(event) {
    event.preventDefault();
    if (!file || isUploading || isRestoring) return;
    const current = epoch.current;
    setIsUploading(true);
    setFileError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const data = await requestApi('/api/resumes', body);
      if (current !== epoch.current) return;
      setDraftResume(data);
      setVerificationCode('');
      setVerificationSent(false);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (error) {
      if (current === epoch.current) setFileError(error instanceof TypeError ? 'Unable to reach the API. Your active resume is unchanged.' : error.message);
    } finally {
      if (current === epoch.current) setIsUploading(false);
    }
  }

  async function handleVerified(verifiedUser, linkedResume = null) {
    invalidateSessionRequests();
    const current = ++epoch.current;
    selectionRequest.current++;
    setUser(verifiedUser);
    setSavedResume(linkedResume);
    setDraftResume(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    setVerificationCode('');
    setVerificationSent(false);
    setRestoreError('');
    setResumeError('');
    setIsSelectingResume(false);
    setResumeVersion(version => version + 1);
    setHistoryVersion(version => version + 1);
    setIsRestoring(!linkedResume);
    if (linkedResume) return;
    try {
      const data = await requestApi('/api/resumes/latest');
      if (current === epoch.current) setSavedResume(data.resume);
    } catch (error) {
      if (current === epoch.current) setRestoreError('Signed in, but your resume could not be loaded. Please retry.');
    } finally {
      if (current === epoch.current) setIsRestoring(false);
    }
  }

  const chooseResume = useCallback(async (resumeId) => {
    const current = epoch.current;
    const request = ++selectionRequest.current;
    setIsSelectingResume(true);
    setResumeError('');
    try {
      const data = await requestApi(`/api/resumes/${encodeURIComponent(resumeId)}`);
      if (current !== epoch.current || request !== selectionRequest.current) return;
      setSavedResume(data.resume);
    } catch (error) {
      if (current === epoch.current && request === selectionRequest.current) setResumeError(error.message || 'Resume could not be loaded. Retry from Resumes.');
    } finally {
      if (current === epoch.current && request === selectionRequest.current) setIsSelectingResume(false);
    }
  }, []);

  function handleSignOut() {
    invalidateSessionRequests();
    clearPrivateState();
  }
  async function signOut() {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await requestApi('/api/auth/logout', {});
      handleSignOut();
    } finally { setAuthBusy(false); }
  }

  return <SessionContext.Provider value={{
    user, savedResume, draftResume, resumeLinked: !!user && !!savedResume,
    file, fileError, fileInput, isUploading, isRestoring, restoreError, apiStatus, authBusy, setAuthBusy,
    verificationCode, setVerificationCode, verificationSent, setVerificationSent,
    historyVersion, resumeVersion, resumeError, isSelectingResume,
    selectResume, uploadResume, handleVerified, handleSignOut, signOut, chooseResume,
    restoreSession, discardDraft: () => { setDraftResume(null); setVerificationCode(''); setVerificationSent(false); },
    answerSaved: () => setHistoryVersion(version => version + 1),
  }}>{children}</SessionContext.Provider>;
}
