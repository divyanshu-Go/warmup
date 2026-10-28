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
    chooseResume() {}, discardDraft() {}, restoreSession() {},
    ...overrides,
  };
  const Component = load(path.join(appPath, route))[exportName];
  return renderToStaticMarkup(React.createElement(Component, props));
}

test('interview and history do not expose private feature content while signed out', () => {
  for (const route of ['interview/page.js', 'history/page.js']) {
    const html = render(route);
    assert.match(html, /Email verification required/);
    assert.doesNotMatch(html, /Start interview|Refresh history/);
  }
});

test('restoration loading and failures keep protected features hidden', () => {
  for (const route of ['interview/page.js', 'history/page.js']) {
    assert.match(render(route, { isRestoring: true }), /Checking your session/);
    const html = render(route, { restoreError: 'Unable to restore your resume.' });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Start interview|Refresh history/);
  }
});

test('an unverified upload directs interview access to verification', () => {
  const html = render('interview/page.js', { draftResume: resume });
  assert.match(html, /href="\/access\?next=/);
  assert.doesNotMatch(html, /Start interview/);
});

test('linked resume renders the existing combined interview and history', () => {
  const signedIn = { user: { id: 'user-1', email: 'candidate@example.com' }, savedResume: resume, resumeLinked: true };
  const interview = render('interview/page.js', signedIn);
  assert.match(interview, /candidate.pdf/);
  assert.match(interview, /Combined spoken interview/);
  assert.match(interview, /Start interview/);
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
  assert.match(render('resumes/page.js', { draftResume: resume }), /Verify email and continue/);
  const html = render('resumes/page.js', { savedResume: resume, resumeLinked: true, user: { id: 'user-1' } });
  assert.match(html, /Start or continue interview/);
  assert.match(html, /Find relevant resume passages/);
});

test('a replacement draft keeps the active verified resume and interview link', () => {
  const replacement = { ...resume, id: 'replacement-2', filename: 'replacement.pdf' };
  const html = render('resumes/page.js', { draftResume: replacement, savedResume: resume, resumeLinked: true, user: { id: 'user-1' } });
  assert.match(html, /replacement.pdf/);
  assert.match(html, /candidate.pdf/);
  assert.match(html, /interview\?resume=resume-1/);
  assert.match(html, /draft-results-heading/);
  assert.match(html, /Your active resume is unchanged/);
});

test('a missing or foreign selected resume never displays the previous interview', () => {
  query = 'resume=foreign-resume';
  const html = render('interview/page.js', { savedResume: resume, resumeLinked: true, user: { id: 'user-1' }, resumeError: 'Resume not found for your account.' });
  assert.match(html, /Resume not found for your account/);
  assert.doesNotMatch(html, /Start interview/);
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
  assert.match(html, /href="\/interview\?resume=resume-1"/);
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
  for (const [route, expected] of [['/', 'Dashboard'], ['/resumes', 'Resumes'], ['/history', 'History'], ['/interview', 'Dashboard']]) {
    pathname = route;
    const html = render('_components/AppHeader.js');
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
    assert.equal((nav.match(/<a /g) || []).length, 3);
    assert.match(nav, new RegExp(`aria-current="(?:page|location)">${expected}</a>`));
    assert.doesNotMatch(nav, />Interview<\/a>/);
  }
});
