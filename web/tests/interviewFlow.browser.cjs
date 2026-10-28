// Isolated browser fixture for the real SpokenInterview controller and room view.
// Synthetic media + mock API only. Does not contact FastAPI or persist records.
// Run: node tests/interviewFlow.browser.cjs; then open http://127.0.0.1:3128.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test_artifacts/interview-flow');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'jsx-loader.cjs'), `module.exports = function(source) {
  return require(${JSON.stringify(require.resolve('next/dist/build/swc'))}).transformSync(source, {
    filename: this.resourcePath, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }
  }).code;
};`);
fs.writeFileSync(path.join(output, 'link.js'), `import React from 'react'; export default function Link(props) { return React.createElement('a', props, props.children); }`);
fs.writeFileSync(path.join(output, 'navigation.js'), `export const usePathname = () => window.location.pathname; export const useSearchParams = () => new URLSearchParams(window.location.search); export const useRouter = () => ({ push() {}, replace() {} });`);
fs.writeFileSync(path.join(output, 'session.js'), `
import React from 'react';
const Context = React.createContext(null);
export const useSession = () => React.useContext(Context);
export default function MockSession({ children }) {
  const [practiceMicrophone, setPracticeMicrophone] = React.useState('');
  return <Context.Provider value={{ user: { id: 'synthetic-user' }, savedResume: { id: 'synthetic-resume', filename: 'Synthetic fixture.pdf', parsed_data: { name: 'Synthetic Candidate', difficulty_level: 'Easy' } }, resumeLinked: true, practiceMicrophone, setPracticeMicrophone, isRestoring: false, chooseResume() {} }}>{children}</Context.Provider>;
}
`);
fs.writeFileSync(path.join(output, 'monitor.js'), `export const MIN_INPUT_LEVEL = 0.0001; export async function monitorMicrophone(stream, onLevel) { onLevel(0.1); return { hasSignal: () => true, stop() {} }; }`);
fs.writeFileSync(path.join(output, 'api.js'), `
let questions = 0, submissions = 0, saved = 0;
function counts() { document.getElementById('fixture-counts').textContent = JSON.stringify({ questions, submissions, saved }); }
export async function loadQuestionAudio() { return new Blob(['synthetic question audio']); }
export async function requestApi(route, body) {
  if (route === '/api/interview/question') {
    questions++; counts();
    await new Promise(resolve => setTimeout(resolve, 100));
    return { id: 'synthetic-turn-' + questions, question: questions === 1 ? 'Describe a project tradeoff.' : 'How did you handle a team disagreement?', kind: questions === 1 ? 'technical' : 'hr', difficulty: 'Easy' };
  }
  if (route.endsWith('/audio-answer')) {
    submissions++; counts();
    if (!(body instanceof FormData) || !body.get('audio')?.size) throw new Error('Missing audio payload');
    await new Promise(resolve => setTimeout(resolve, 300));
    if (submissions === 1) { const error = new Error('Synthetic scoring failure. Retry the same recording.'); error.transcript = 'Synthetic cached transcript.'; throw error; }
    saved++; counts();
    return { id: route.split('/')[3], answer: 'Synthetic saved answer.', score: 8, feedback: 'Synthetic feedback: explain your reasoning with a concrete example.' };
  }
  throw new Error('Unexpected test request: ' + route);
}
`);
fs.writeFileSync(path.join(output, 'entry.js'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import SpokenInterview from ${JSON.stringify(path.join(root, 'app/interview/SpokenInterview.js').replaceAll('\\', '/'))};
import SetupPage from ${JSON.stringify(path.join(root, 'app/interview/setup/page.js').replaceAll('\\', '/'))};
import MockSession from './session';
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  async enumerateDevices() { return [{ kind: 'audioinput', deviceId: 'synthetic-mic', label: 'Synthetic microphone' }]; },
  async getUserMedia() { const track = { label: 'Synthetic microphone', readyState: 'live', enabled: true, stop() {} }; return { getAudioTracks: () => [track], getTracks: () => [track] }; },
  addEventListener() {}, removeEventListener() {}
}});
function wav() {
  const samples = 8000, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 220 / 8000) * 3000, true);
  return bytes;
}
window.MediaRecorder = class {
  static isTypeSupported() { return false; }
  constructor() { this.state = 'inactive'; this.mimeType = 'audio/wav'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([wav()], { type: 'audio/wav' }) }); this.onstop?.(); }
};
window.Audio = class {
  constructor() { this.currentTime = 0; }
  async play() { this.onplaying?.(); }
  pause() { this.onpause?.(); }
};
createRoot(document.getElementById('fixture-room')).render(<MockSession>{window.location.pathname === '/interview/setup' ? <SetupPage /> : <SpokenInterview resumeId="synthetic-resume" resumeFilename="Synthetic fixture.pdf" autoStart={new URLSearchParams(window.location.search).get('start') === '1'} />}</MockSession>);
`);

const journey = process.argv.includes('--journey');
if (journey) require('./journeyFixture.cjs')({ root, output });

webpack({ mode: 'development', devtool: false, entry: path.join(output, 'entry.js'), output: { path: output, filename: 'bundle.js' },
  resolve: { alias: { 'next/link$': path.join(output, 'link.js'), 'next/navigation$': path.join(output, 'navigation.js') } },
  module: { rules: [{ test: /\.js$/, exclude: /node_modules/, use: path.join(output, 'jsx-loader.cjs') }] },
  plugins: [new webpack.NormalModuleReplacementPlugin(/lib[\\/]api$/, resource => { resource.request = path.join(output, 'api.js'); }),
    new webpack.NormalModuleReplacementPlugin(/\.?\.\/microphone\.mjs$/, resource => { resource.request = path.join(output, 'monitor.js'); }),
    ...(!journey ? [new webpack.NormalModuleReplacementPlugin(/SessionProvider$/, resource => { resource.request = path.join(output, 'session.js'); })] : [])],
}, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  if (process.argv.includes('--build-only')) { console.log('Isolated fixture bundle updated.'); return; }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Isolated interview flow check</title><link rel="stylesheet" href="/styles.css"></head><body><div class="app-shell"><p class="preview-note">ISOLATED TEST FIXTURE — synthetic microphone/audio and mock API; no account, provider or database calls.</p><pre id="fixture-counts">No requests yet</pre>${journey ? '<button id="fixture-fail-history">Fixture: fail next history request</button><button id="fixture-seed-history">Fixture: seed 12 answers</button><button id="fixture-expire">Fixture: expire session</button>' : ''}</div><div id="fixture-room"${journey ? '' : ' class="interview-room"'}></div><script src="/bundle.js"></script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(path.join(output, 'bundle.js'))); }
    else if (request.url === '/styles.css') { response.setHeader('Content-Type', 'text/css'); response.end(fs.readFileSync(path.join(root, 'app/globals.css'))); }
    else { response.setHeader('Content-Type', 'text/html'); response.end(html); }
  });
  server.listen(3128, '127.0.0.1', () => console.log('Isolated interview fixture: http://127.0.0.1:3128 (mock API only)'));
});
