const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

// Render the real route components with controlled session/router boundaries.
// Effects do not run during SSR: these checks never call the API or providers.
let session;
let pathname = '/resumes';
let query = '';
const cache = new Map();
const appPath = path.resolve(__dirname, '../app');

function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, mod);
  mod.require = id => {
    if (id === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children);
    if (id === 'next/navigation') return { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ push() {}, replace() {} }) };
    if (id.endsWith('SessionProvider')) return { useSession: () => session };
    if (id.startsWith('.')) {
      let target = path.resolve(path.dirname(filename), id);
      if (!path.extname(target)) target += '.js';
      if (target.endsWith('.js')) return load(target);
    }
    return Module.prototype.require.call(mod, id);
  };
  const { code } = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  mod._compile(code, filename);
  return mod.exports;
}

const resume = { id: 'resume-1', filename: 'candidate.pdf', parsed_data: {
  name: 'Candidate', email: 'candidate@example.com', skills: ['Python'], experience: [], education: [], difficulty_level: 'Easy',
} };

function render(route, overrides = {}, props = {}, exportName = 'default') {
  session = {
    user: null, savedResume: null, draftResume: null, resumeLinked: false, isRestoring: false,
    restoreError: '', isUploading: false, file: null, fileError: '', fileInput: { current: null },
    verificationCode: '', verificationSent: false, historyVersion: 0,
    selectResume() {}, uploadResume() {}, setVerificationCode() {}, setVerificationSent() {},
    handleVerified() {}, handleSignOut() {}, signOut() {}, answerSaved() {},
    chooseResume() {}, discardDraft() {}, restoreSession() {}, practiceMicrophone: '', setPracticeMicrophone() {},
    ...overrides,
  };
  const Component = load(path.join(appPath, route))[exportName];
  return renderToStaticMarkup(React.createElement(Component, props));
}

test('interview and history do not expose private feature content while signed out', () => {
  for (const route of ['interview/page.js', 'history/page.js']) {
    const html = render(route);
    assert.match(html, /Email verification required/);
    assert.match(html, route === 'history/page.js' ? /<h1>Your Practice History<\/h1>/ : /<h1>Interview practice<\/h1>/);
    assert.doesNotMatch(html, /Start Interview|Refresh history/);
  }
});

test('restoration loading and failures keep protected features hidden', () => {
  for (const route of ['interview/page.js', 'history/page.js']) {
    assert.match(render(route, { isRestoring: true }), /Checking your session/);
    const html = render(route, { restoreError: 'Unable to restore your resume.' });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Start Interview|Refresh history/);
  }
});

test('an unverified upload directs interview access to verification', () => {
  const html = render('interview/page.js', { draftResume: resume });
  assert.match(html, /href="\/access\?next=/);
  assert.doesNotMatch(html, /Start Interview/);
});

test('linked resume renders the existing combined interview and history', () => {
  const signedIn = { user: { id: 'user-1', email: 'candidate@example.com' }, savedResume: resume, resumeLinked: true };
  const interview = render('interview/page.js', signedIn);
  assert.match(interview, /candidate.pdf/);
  assert.match(interview, /Combined spoken interview/);
  assert.match(interview, /Start Interview/);
  assert.match(render('history/page.js', signedIn), /Refresh history/);
});

test('access supports returning sign-in and separate draft verification', () => {
  const empty = render('access/page.js');
  assert.match(empty, /Sign in with an email code/);
  assert.doesNotMatch(empty, /type="password"/);
  const draft = render('access/page.js', { draftResume: resume, verificationSent: true, verificationCode: '123456' });
  assert.match(draft, /candidate@example.com/);
  assert.match(draft, /value="123456"/);
  assert.match(draft, /Resend code/);
});

test('resumes retains uploaded details and chooses verification versus interview navigation', () => {
  assert.match(render('resumes/page.js', { draftResume: resume }), /Verify Email &amp; Continue/);
  const html = render('resumes/page.js', { savedResume: resume, resumeLinked: true, user: { id: 'user-1' } });
  assert.match(html, /Start Practicing/);
  assert.match(html, /Find relevant resume passages/);
});

test('a replacement draft keeps the active verified resume and interview link', () => {
  const replacement = { ...resume, id: 'replacement-2', filename: 'replacement.pdf' };
  const html = render('resumes/page.js', { draftResume: replacement, savedResume: resume, resumeLinked: true, user: { id: 'user-1' } });
  assert.match(html, /replacement.pdf/);
  assert.match(html, /candidate.pdf/);
  assert.match(html, /interview\/setup\?resume=resume-1/);
  assert.match(html, /draft-results-heading/);
  assert.match(html, /Your active resume is unchanged/);
});

test('a missing or foreign selected resume never displays the previous interview', () => {
  query = 'resume=foreign-resume';
  const html = render('interview/page.js', { savedResume: resume, resumeLinked: true, user: { id: 'user-1' }, resumeError: 'Resume not found for your account.' });
  assert.match(html, /Resume not found for your account/);
  assert.doesNotMatch(html, /Start Interview/);
  query = '';
});

test('the sign-in link preserves a requested interview resume', () => {
  pathname = '/interview';
  query = 'resume=saved-2';
  const html = render('interview/page.js');
  assert.match(html, /next=%2Finterview%3Fresume%3Dsaved-2/);
  query = '';
});

test('shared header identifies the current route and signed-in account', () => {
  pathname = '/history';
  const html = render('_components/AppHeader.js', { user: { email: 'candidate@example.com' } });
  assert.match(html, /href="\/history" aria-current="page"/);
  assert.match(html, /candidate@example.com/);
  assert.match(html, /Sign out/);
});

test('Home shows one upload CTA and onboarding instead of an incomplete signed-out dashboard', () => {
  const html = render('page.js');
  assert.match(html, /Your next great answer/);
  assert.equal((html.match(/>Upload Resume /g) || []).length, 1);
  assert.match(html, /How interview practice works/);
  assert.match(html, /Sign in with an email code/);
  assert.doesNotMatch(html, /ACTIVE RESUME|Recent answers|Start Practicing/);
});

test('Home waits for restoration and offers recovery rather than showing private or empty metrics', () => {
  assert.match(render('page.js', { isRestoring: true }), /Checking your session/);
  const html = render('page.js', { restoreError: 'Unable to restore your resume.' });
  assert.match(html, /Retry connection/);
  assert.doesNotMatch(html, /Recent answers|Start Practicing/);
});

test('returning Home shows the selected resume and one practice action without redirecting', () => {
  const html = render('page.js', { user: { id: 'user-1', name: 'Alex Smith' }, savedResume: resume, resumeLinked: true });
  assert.match(html, /Welcome back, Alex/);
  assert.match(html, /candidate.pdf/);
  assert.match(html, /href="\/interview\/setup\?resume=resume-1"/);
  assert.equal((html.match(/Start Practicing/g) || []).length, 1);
  assert.match(html, /Loading recent practice/);
});

test('signed-in Home without a resume prompts upload and cannot start an interview', () => {
  const html = render('page.js', { user: { id: 'user-1' } });
  assert.match(html, /Add your first resume/);
  assert.match(html, /Upload Resume/);
  assert.doesNotMatch(html, /Start Practicing|Verified<\/span>/);
});

test('unverified Home offers draft recovery without marking the draft active', () => {
  const html = render('page.js', { draftResume: resume });
  assert.match(html, /Continue verification/);
  assert.match(html, /candidate.pdf/);
  assert.doesNotMatch(html, /Start Practicing|ACTIVE RESUME/);
});

test('dashboard activity uses actual scores including zero and labels its limited sample', () => {
  const entries = [{ id: 'turn-1', kind: 'technical', score: 0, question: 'Explain transactions.', answer: 'My saved answer', feedback: 'My saved feedback', filename: 'candidate.pdf', difficulty: 'Easy', answered_at: '2026-10-28T12:00:00Z' }];
  const html = render('_components/RecentPractice.js', {}, { entries, hasMore: true, loading: false, error: '', onRefresh() {} }, 'PracticeActivity');
  assert.match(html, /1 shown/);
  assert.match(html, /More available in history/);
  assert.match(html, /Latest score/);
  assert.match(html, /0<small>\/10/);
  assert.match(html, /My saved answer/);
  assert.match(html, /My saved feedback/);
  assert.doesNotMatch(html, /Average|Total interviews/);
});

test('activity empty and error states do not invent scores or answer counts', () => {
  const props = { entries: [], hasMore: false, loading: false, error: '', onRefresh() {} };
  assert.match(render('_components/RecentPractice.js', {}, props, 'PracticeActivity'), /Your first answer starts the story/);
  const html = render('_components/RecentPractice.js', {}, { ...props, error: 'Unable to load history.' }, 'PracticeActivity');
  assert.match(html, /Retry recent practice/);
  assert.doesNotMatch(html, /Latest score|0 shown/);
});

test('header has only Dashboard, Resumes and History; interview belongs to Dashboard', () => {
  for (const [route, expected] of [['/', 'Dashboard'], ['/resumes', 'Resumes'], ['/history', 'History'], ['/interview', 'Dashboard'], ['/interview/setup', 'Dashboard']]) {
    pathname = route;
    const html = render('_components/AppHeader.js');
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
    assert.equal((nav.match(/<a /g) || []).length, 3);
    assert.match(nav, new RegExp(`aria-current="(?:page|location)">${expected}</a>`));
    assert.doesNotMatch(nav, />Interview<\/a>/);
  }
});

const historyEntries = [
  { id: 'answer-1', resume_id: 'resume-1', filename: 'candidate.pdf', kind: 'technical', score: 0, question: 'Explain transactions.', answer: 'Saved zero-score transcript', feedback: 'Add an example.', difficulty: 'Easy', answered_at: '2026-10-28T12:00:00Z' },
  { id: 'answer-2', resume_id: 'resume-2', filename: 'other.pdf', kind: 'hr', score: 8, question: 'Describe teamwork.', answer: 'Saved HR transcript', feedback: 'Good example.', difficulty: 'Medium', answered_at: '2026-10-27T12:00:00Z' },
];
function historyView(overrides = {}) {
  return render('history/InterviewHistory.js', {}, { entries: historyEntries, hasMore: true, loading: false, error: '', ...overrides }, 'HistoryResults');
}

test('History has a clear heading and practice links through setup for the active resume', () => {
  const html = render('history/page.js', { user: { id: 'user-1' }, savedResume: resume, resumeLinked: true });
  assert.match(html, /Your Practice History/);
  assert.match(html, /href="\/interview\/setup\?resume=resume-1"/);
  assert.match(render('history/page.js', { user: { id: 'user-1' } }), /Choose a resume/);
});

test('History summary averages only saved loaded scores, including zero, with explicit scope', () => {
  const html = historyView();
  assert.match(html, /Average loaded score/);
  assert.match(html, /4.0<small>\/10/);
  assert.match(html, /Based on 2 saved scores/);
  assert.match(html, /not a lifetime performance report/);
  assert.doesNotMatch(html, /Total interviews|Improvement|streak/);
  const invalid = historyView({ entries: [{ ...historyEntries[0], score: null, answered_at: null }] });
  assert.doesNotMatch(invalid, /Average loaded score|Last practiced|Invalid Date/);
});

test('History filters combine resume and type without hiding older-page access', () => {
  const html = historyView({ resumeFilter: 'resume-2', kindFilter: 'hr' });
  assert.match(html, /1 of 2 loaded answers shown/);
  assert.match(html, /Saved HR transcript/);
  assert.doesNotMatch(html, /Saved zero-score transcript/);
  assert.match(html, /Filters apply to loaded answers only/);
  assert.match(html, /Load more answers/);
  assert.match(html, /Clear filters/);
  const empty = historyView({ resumeFilter: 'resume-2', kindFilter: 'technical' });
  assert.match(empty, /No loaded answers match/);
  assert.match(empty, /Load more answers/);
  assert.match(historyView({ resumeFilter: 'older-resume' }), /Previously selected resume/);
});

test('History feedback retains full question, transcript, score, feedback and resume references', () => {
  const html = historyView();
  assert.match(html, /<details class="history-entry"/);
  for (const value of ['Full question', 'Explain transactions.', 'Saved zero-score transcript', 'Score: 0/10', 'Add an example.', 'candidate.pdf', 'Resume reference: resume-1', 'View feedback']) assert.ok(html.includes(value), value);
  assert.match(html, /<label for="history-resume"/);
  assert.match(html, /<label for="history-kind"/);
  assert.match(html, /href="\/resumes\?resume=resume-1"/);
});

test('History loading, empty and failed-page states offer truthful recovery', () => {
  assert.match(historyView({ loading: true }), /Loading interview history/);
  const empty = historyView({ entries: [], hasMore: false });
  assert.match(empty, /Your first answer starts here/);
  assert.doesNotMatch(empty, /Average loaded score|Last practiced|Load more answers/);
  const error = historyView({ error: 'Network unavailable.' });
  assert.match(error, /role="alert"/);
  assert.match(error, /Retry history request/);
  assert.match(error, /Previously loaded answers remain available/);
  assert.match(error, /Saved HR transcript/);
});

test('Resume Library puts the active resume first and hides the secondary upload panel', () => {
  const html = render('resumes/page.js', { user: { id: 'user-1' }, savedResume: resume, resumeLinked: true });
  assert.match(html, /Your Resumes/);
  assert.match(html, /Active Resume/);
  assert.match(html, /Upload another resume/);
  assert.match(html, /id="resume-upload-panel"[^>]*hidden=""/);
  assert.ok(html.indexOf('Active Resume') < html.indexOf('Saved Resumes'));
  assert.ok(html.indexOf('Saved Resumes') < html.indexOf('id="resume-upload-panel"'));
  assert.match(html, /<details[^>]*class="surface resume-search"/);
  assert.doesNotMatch(html, /<details[^>]*class="surface resume-search"[^>]*open/);
});

test('first-time Resume Library shows upload guidance and no practice action', () => {
  const html = render('resumes/page.js');
  assert.match(html, /No active resume yet/);
  assert.match(html, /Scanned PDFs need OCR/);
  assert.doesNotMatch(html, /id="resume-upload-panel"[^>]*hidden|Start Practicing/);
});

test('file selection, parsing and upload errors leave the verified resume and practice target intact', () => {
  for (const state of [{ file: { name: 'new.pdf' } }, { isUploading: true }, { fileError: 'Please choose a PDF resume.' }]) {
    const html = render('resumes/page.js', { user: { id: 'user-1' }, savedResume: resume, resumeLinked: true, ...state });
    assert.match(html, /Active Resume/);
    assert.match(html, /candidate.pdf/);
    assert.match(html, /href="\/interview\/setup\?resume=resume-1"/);
    if (state.fileError) assert.match(html, /Your active resume is unchanged/);
  }
});

test('a draft without an extracted email explains correction instead of offering impossible verification', () => {
  const draft = { ...resume, parsed_data: { ...resume.parsed_data, email: null } };
  const html = render('resumes/page.js', { draftResume: draft });
  assert.match(html, /No email was found/);
  assert.match(html, /Upload corrected PDF/);
  assert.match(html, /Dismiss Draft/);
  assert.match(html, /does not delete the stored upload/);
  assert.doesNotMatch(html, /Verify Email &amp; Continue/);
});

test('all extracted skills, experience and education remain accessible beyond the summary', () => {
  const detailed = { ...resume, parsed_data: { ...resume.parsed_data, skills: Array.from({ length: 10 }, (_, i) => `Skill ${i}`), experience: ['First project', 'Second project'], education: ['Computer Science degree'] } };
  const html = render('resumes/ResumeDetails.js', {}, { savedResume: detailed, resumeLinked: true });
  assert.match(html, /View all extracted details/);
  assert.match(html, /Skill 9/);
  assert.match(html, /Second project/);
  assert.match(html, /Computer Science degree/);
});

test('saved resume rows preserve URL selection, active status and actual upload dates', () => {
  const html = render('resumes/SavedResumes.js', {}, { selectedId: 'resume-1', resumes: [
    { id: 'resume-1', filename: 'current.pdf', created_at: '2026-10-28T12:00:00Z' },
    { id: 'resume-2', filename: 'older.pdf', created_at: '2026-10-27T12:00:00Z' },
  ] }, 'SavedResumeList');
  assert.match(html, /is-active/);
  assert.match(html, /Active/);
  assert.match(html, /Uploaded/);
  assert.match(html, /href="\/resumes\?resume=resume-2"/);
  assert.match(html, /Use resume: older.pdf/);
});

test('a foreign resume selection hides both practice and passage search for the previous resume', () => {
  query = 'resume=foreign';
  const html = render('resumes/page.js', { user: { id: 'user-1' }, savedResume: resume, resumeLinked: true, resumeError: 'Resume not found for your account.' });
  assert.match(html, /Resume not found for your account/);
  assert.doesNotMatch(html, /Start Practicing|Find relevant resume passages/);
  query = '';
});

test('setup keeps the combined format and carries the selected resume into Start Interview', () => {
  const html = render('interview/setup/page.js', { user: { id: 'user-1' }, savedResume: resume, resumeLinked: true });
  assert.match(html, /candidate.pdf/);
  assert.match(html, /Combined technical \+ HR/);
  assert.match(html, /Easy/);
  assert.match(html, /Check microphone/);
  assert.match(html, /does not record or upload/);
  assert.match(html, /href="\/interview\?resume=resume-1&amp;start=1"/);
  assert.match(html, /Change resume/);
  assert.doesNotMatch(html, /name="mode"|type="radio"/);
});

test('setup blocks unverified access and foreign URL-selected resumes', () => {
  assert.match(render('interview/setup/page.js'), /Email verification required/);
  query = 'resume=foreign';
  const html = render('interview/setup/page.js', { user: { id: 'user-1' }, savedResume: resume, resumeLinked: true, resumeError: 'Resume not found for your account.' });
  assert.match(html, /Resume not found/);
  assert.doesNotMatch(html, /Start Interview/);
  query = '';
});

function roomState(overrides = {}) {
  return { currentQuestion: 'Explain a project tradeoff.', questionMeta: { kind: 'technical', difficulty: 'Easy' },
    evaluationResult: null, isLoading: false, operation: null, isRecording: false, isPreparing: false, isStopping: false,
    recording: null, recordingUrl: null, recordingSeconds: 0, transcript: '', microphones: [], selectedMicrophone: '',
    activeMicrophone: '', inputVolume: 0, hasInputSignal: false, useVoice: true, isSpeaking: false, isVoiceLoading: false,
    voiceError: '', error: '', resumeId: 'resume-1', resumeFilename: 'candidate.pdf', ...overrides };
}

function renderRoom(overrides) {
  const noop = () => {};
  return render('interview/InterviewRoomView.js', {}, { state: roomState(overrides), actions: {
    fetchNewQuestion: noop, toggleVoice: noop, speakQuestion: noop, changeMicrophone: noop,
    startRecording: noop, stopRecording: noop, submitRecording: noop, previewPlaying: noop,
  } });
}

test('room distinguishes recording from submission and disables conflicting controls', () => {
  const ready = renderRoom();
  assert.match(ready, /Start Recording/);
  assert.doesNotMatch(ready, />Submit Recording</);
  const recording = renderRoom({ isRecording: true, recordingSeconds: 63, hasInputSignal: true });
  assert.match(recording, /Stop Recording/);
  assert.match(recording, /1:03/);
  assert.match(recording, /<select[^>]*disabled/);
  assert.doesNotMatch(recording, />Submit Recording</);
  assert.match(recording, /aria-current="step"[^>]*><span[^>]*>2<\/span>Record/);
});

test('preview, failed submission, saved feedback and next-question states stay distinct', () => {
  const preview = renderRoom({ recording: true, recordingUrl: 'blob:preview', recordingSeconds: 25 });
  assert.match(preview, /Record Again/);
  assert.match(preview, /Submit Recording/);
  assert.match(preview, /Your recorded answer/);
  const submitting = renderRoom({ recording: true, isLoading: true, operation: 'submit' });
  assert.match(submitting, /Submitting…/);
  assert.match(submitting, /Do not submit again/);
  assert.doesNotMatch(submitting, /Getting your interview question/);
  const failed = renderRoom({ recording: true, transcript: 'Cached transcript', error: 'Evaluation failed' });
  assert.match(failed, /Retry Submission/);
  assert.match(failed, /Cached transcript/);
  assert.doesNotMatch(failed, /ANSWER SAVED/);
  const saved = renderRoom({ transcript: 'Saved answer', evaluationResult: { id: 'turn-1', score: 0, feedback: 'Saved feedback' } });
  assert.match(saved, /Score: 0 out of 10/);
  assert.match(saved, /Saved answer/);
  assert.match(saved, /Saved feedback/);
  assert.match(saved, /Next Question/);
  assert.match(saved, /View History/);
  assert.doesNotMatch(saved, /Start Recording|Submit Recording/);
  assert.match(renderRoom({ isLoading: true, operation: 'question', currentQuestion: null }), /Getting your interview question/);
});
