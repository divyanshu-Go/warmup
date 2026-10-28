// Full-route browser audit: real pages/session provider, synthetic transport/media.
// Run: node tests/interviewFlow.browser.cjs --journey
// Never contacts FastAPI/Groq, sends email, or modifies application records.
const fs = require('node:fs');
const path = require('node:path');
module.exports = ({ root, output }) => {
  fs.writeFileSync(path.join(output, 'navigation.js'), `
import { useSyncExternalStore } from 'react';
const subscribe = callback => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback); };
export function navigate(url, replace = false) { window.history[replace ? 'replaceState' : 'pushState']({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }
export function usePathname() { return useSyncExternalStore(subscribe, () => window.location.pathname); }
export function useSearchParams() { const query = useSyncExternalStore(subscribe, () => window.location.search); return new URLSearchParams(query); }
export const useRouter = () => ({ push: url => navigate(url), replace: url => navigate(url, true) });
`);
  fs.writeFileSync(path.join(output, 'link.js'), `
import React from 'react'; import { navigate } from './navigation';
export default function Link({ children, ...props }) { return <a {...props} onClick={event => { if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !props.href.startsWith('#')) { event.preventDefault(); navigate(props.href); } }}>{children}</a>; }
`);
  fs.writeFileSync(path.join(output, 'api.js'), `
const storageKey = 'isolated-journey-fixture';
const data = JSON.parse(sessionStorage.getItem(storageKey) || '{"signedIn":false,"resumes":[],"answers":[],"questionCount":0,"submissions":0}');
const user = { id: 'synthetic-user', name: 'Synthetic Candidate', email: 'fixture@example.com' };
let failHistory = false;
function save() { sessionStorage.setItem(storageKey, JSON.stringify(data)); document.getElementById('fixture-counts').textContent = JSON.stringify({ questions: data.questionCount, submissions: data.submissions, saved: data.answers.length }); }
function makeResume(id, filename) { return { id, filename, created_at: new Date().toISOString(), parsed_data: { name: user.name, email: user.email, skills: ['Python', 'SQL'], experience: ['Built a synthetic test project.'], education: ['Test degree'], difficulty_level: 'Easy' } }; }
document.getElementById('fixture-fail-history').onclick = () => { failHistory = true; };
document.getElementById('fixture-seed-history').onclick = () => { const alternate = makeResume('alternate-resume', 'Alternate fixture.pdf'); if (!data.resumes.some(item => item.id === alternate.id)) data.resumes.unshift(alternate); for (let i = 0; i < 12; i++) data.answers.push({ id: 'seed-' + i, resume_id: i < 10 ? 'synthetic-resume' : 'alternate-resume', filename: i < 10 ? 'Synthetic fixture.pdf' : alternate.filename, kind: i % 2 ? 'hr' : 'technical', difficulty: 'Easy', question: 'Synthetic saved question ' + i, answer: 'Synthetic saved transcript ' + i, score: i % 11, feedback: 'Synthetic saved feedback ' + i, answered_at: new Date(Date.now() - (i + 1) * 86400000).toISOString() }); save(); };
document.getElementById('fixture-expire').onclick = () => { data.signedIn = false; save(); window.dispatchEvent(new Event('interview:session-expired')); };
export function invalidateSessionRequests() {}
export function apiUrl() { return 'data:application/json,{"status":"ok"}'; }
export async function loadQuestionAudio() { return new Blob(['synthetic question audio']); }
export async function requestApi(route, body) {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (route === '/api/auth/me') { if (!data.signedIn) throw Object.assign(new Error('Signed out'), { status: 401 }); return { user }; }
  if (route === '/api/auth/logout') { data.signedIn = false; save(); return {}; }
  if (route === '/api/auth/send-code') return { email: user.email };
  if (route === '/api/auth/sign-in/send-code') return { message: 'Synthetic code is 123456.' };
  if (route === '/api/auth/verify-code' || route === '/api/auth/sign-in/verify-code') {
    if (body.code !== '123456') throw new Error('Invalid synthetic code. Use 123456.');
    data.signedIn = true;
    if (route === '/api/auth/verify-code' && data.draft && !data.resumes.some(item => item.id === data.draft.id)) data.resumes.push(data.draft);
    save(); return { user };
  }
  if (route === '/api/resumes' && body instanceof FormData) { if (!body.get('file')) throw new Error('Missing file'); data.draft = makeResume('synthetic-resume', body.get('file').name); save(); return data.draft; }
  if (route === '/api/resumes/latest') return { resume: data.resumes.at(-1) || null };
  if (route.startsWith('/api/resumes?')) { const offset = Number(new URLSearchParams(route.split('?')[1]).get('offset')); return { resumes: data.resumes.slice(offset, offset + 10), has_more: data.resumes.length > offset + 10 }; }
  if (route.endsWith('/context')) return { matches: [] };
  if (route.startsWith('/api/resumes/')) { const resume = data.resumes.find(item => item.id === route.split('/')[3]); if (!resume) throw new Error('Resume not found for your account.'); return { resume }; }
  if (route.startsWith('/api/interview/history?')) { if (failHistory) { failHistory = false; throw new TypeError('Synthetic history failure'); } const params = new URLSearchParams(route.split('?')[1]); const offset = Number(params.get('offset')); const limit = Number(params.get('limit')); return { entries: data.answers.slice(offset, offset + limit), has_more: data.answers.length > offset + limit }; }
  if (route === '/api/interview/question') { data.questionCount++; data.pending = { id: 'turn-' + data.questionCount, resume_id: body.resume_id, kind: data.questionCount % 2 ? 'technical' : 'hr', question: data.questionCount % 2 ? 'Describe a project tradeoff.' : 'How did you handle a team disagreement?', difficulty: 'Easy' }; save(); return data.pending; }
  if (route.endsWith('/audio-answer')) { data.submissions++; if (!(body instanceof FormData) || !body.get('audio')?.size) throw new Error('Missing audio'); const answer = { ...data.pending, filename: data.resumes.find(item => item.id === data.pending.resume_id)?.filename, score: 8, answer: 'Synthetic transcribed answer.', feedback: 'Synthetic feedback: explain your reasoning with a concrete example.', answered_at: new Date().toISOString() }; data.answers.unshift(answer); save(); return answer; }
  throw new Error('Unexpected fixture request: ' + route);
}
save();
`);
  const entryPath = path.join(output, 'entry.js');
  const originalEntry = fs.readFileSync(entryPath, 'utf8');
  const importPage = (name, filename) => `import ${name} from ${JSON.stringify(path.join(root, filename).replaceAll('\\', '/'))};`;
  const imports = [
    importPage('SessionProvider', 'app/_components/SessionProvider.js'), importPage('AppHeader', 'app/_components/AppHeader.js'),
    importPage('AppFooter', 'app/_components/AppFooter.js'), importPage('Home', 'app/page.js'),
    importPage('ResumesPage', 'app/resumes/page.js'), importPage('AccessPage', 'app/access/page.js'),
    importPage('InterviewPage', 'app/interview/page.js'), importPage('HistoryPage', 'app/history/page.js'),
    "import { usePathname } from './navigation';",
  ].join('\n');
  const render = `
function Journey() { const pathname = usePathname(); const pages = { '/': Home, '/resumes': ResumesPage, '/access': AccessPage, '/interview/setup': SetupPage, '/interview': InterviewPage, '/history': HistoryPage }; const Page = pages[pathname]; return <SessionProvider><a className="skip-link" href="#main-content">Skip to content</a><div className="app-shell"><AppHeader /></div><main id="main-content">{Page ? <Page /> : <h1>Unknown fixture route</h1>}</main><AppFooter /></SessionProvider>; }
createRoot(document.getElementById('fixture-room')).render(<Journey />);
`;
  fs.writeFileSync(entryPath, imports + '\n' + originalEntry.slice(0, originalEntry.indexOf("createRoot(document.getElementById('fixture-room')).render")) + render);
};
