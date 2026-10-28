import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMicrophoneCheck } from '../app/interview/microphoneCheck.mjs';
import { installInterviewLeaveGuard, SUBMITTING_MESSAGE } from '../app/interview/leaveGuard.mjs';

function stream() {
  const track = { enabled: true, readyState: 'live', stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

test('setup check uses selected input, detects sound and releases all resources', async () => {
  const audio = stream();
  let constraints;
  let stopped = false;
  const check = createMicrophoneCheck({
    getUserMedia: async options => { constraints = options; return audio; },
    monitor: async () => ({ hasSignal: () => true, stop() { stopped = true; } }),
  }, () => {});
  assert.equal(await check.start('chosen-mic'), true);
  assert.equal(constraints.audio.deviceId.exact, 'chosen-mic');
  assert.equal(check.stop(), true);
  assert.equal(stopped, true);
  assert.equal(audio.track.stopped, true);
});

test('leaving setup during permission acquisition releases a late stream', async () => {
  let grant;
  let monitored = false;
  const audio = stream();
  const check = createMicrophoneCheck({ getUserMedia: () => new Promise(resolve => { grant = resolve; }), monitor: async () => { monitored = true; } }, () => {});
  const pending = check.start('');
  check.dispose();
  grant(audio);
  assert.equal(await pending, false);
  assert.equal(audio.track.stopped, true);
  assert.equal(monitored, false);
});

test('setup monitor errors release the input and leave the check retryable', async () => {
  const audio = stream();
  const check = createMicrophoneCheck({ getUserMedia: async () => audio, monitor: async () => { throw new Error('Audio context suspended'); } }, () => {});
  await assert.rejects(check.start(''), /suspended/);
  assert.equal(audio.track.stopped, true);
  check.dispose();
});

test('cancelling while the input monitor opens closes the late monitor too', async () => {
  let ready;
  const audio = stream();
  let stopped = false;
  const check = createMicrophoneCheck({ getUserMedia: async () => audio, monitor: () => new Promise(resolve => { ready = resolve; }) }, () => {});
  const pending = check.start('');
  await Promise.resolve();
  check.stop();
  ready({ hasSignal: () => false, stop() { stopped = true; } });
  assert.equal(await pending, false);
  assert.equal(stopped, true);
  assert.equal(audio.track.stopped, true);
});

test('a lost-device signal error cannot prevent setup cleanup', async () => {
  const audio = stream();
  let stopped = false;
  const check = createMicrophoneCheck({ getUserMedia: async () => audio, monitor: async () => ({ hasSignal() { throw new Error('Device lost'); }, stop() { stopped = true; } }) }, () => {});
  await check.start('');
  assert.equal(check.stop(), false);
  assert.equal(stopped, true);
  assert.equal(audio.track.stopped, true);
});

function guard() {
  const browserEvents = new Map();
  const documentEvents = new Map();
  let dirty = true;
  let submitting = false;
  let accepted = false;
  const messages = [];
  const window = { location: { href: 'https://practice.local/interview?resume=one' }, confirm(message) { messages.push(message); return accepted; },
    addEventListener(name, handler) { browserEvents.set(name, handler); }, removeEventListener(name) { browserEvents.delete(name); } };
  const document = { addEventListener(name, handler) { documentEvents.set(name, handler); }, removeEventListener(name) { documentEvents.delete(name); } };
  const dispose = installInterviewLeaveGuard({ window, document, shouldWarn: () => dirty, isSubmitting: () => submitting });
  function click(overrides = {}, element = {}) {
    const event = { button: 0, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; },
      target: { closest: () => ({ matches: () => true, href: 'https://practice.local/history', hasAttribute: () => false, ...element }) }, ...overrides };
    documentEvents.get('click')(event);
    return event;
  }
  return { click, dispose, browserEvents, documentEvents, messages, setDirty: value => { dirty = value; }, setAccepted: value => { accepted = value; }, setSubmitting: value => { submitting = value; } };
}

test('cancelling an unsaved link or sign-out prevents the action without submitting anything', () => {
  const g = guard();
  assert.equal(g.click().prevented, true);
  assert.equal(g.click({}, { matches: () => false }).stopped, true);
  g.setAccepted(true);
  assert.equal(g.click().prevented, false);
  g.dispose();
  assert.equal(g.browserEvents.size + g.documentEvents.size, 0);
});

test('refresh warns only for unsaved work; saved answers leave freely', () => {
  const g = guard();
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  g.browserEvents.get('beforeunload')(event);
  assert.equal(event.prevented, true);
  g.setDirty(false);
  assert.equal(g.click().prevented, false);
  const saved = { preventDefault() { throw new Error('Saved work must not block refresh'); } };
  g.browserEvents.get('beforeunload')(saved);
  g.dispose();
});

test('same-page anchors and new-tab links do not incorrectly warn about leaving', () => {
  const g = guard();
  assert.equal(g.click({}, { href: 'https://practice.local/interview?resume=one#question' }).prevented, false);
  assert.equal(g.click({ ctrlKey: true }).prevented, false);
  assert.equal(g.click({}, { target: '_blank' }).prevented, false);
  assert.equal(g.messages.length, 0);
  g.dispose();
});

test('submission warning accurately describes an uncertain server outcome', () => {
  const g = guard();
  g.setSubmitting(true);
  g.click();
  assert.equal(g.messages[0], SUBMITTING_MESSAGE);
  assert.match(g.messages[0], /server may still save/);
  g.dispose();
});
