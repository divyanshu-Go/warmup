import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inputLevel, monitorMicrophone } from '../app/microphone.mjs';

function fakeAudioContext({ suspended = false, failSource = false } = {}) {
    let instance;
    function node() {
        return { connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.disconnected = true; } };
    }
    class AudioContext {
        constructor() {
            instance = this;
            this.state = 'suspended';
            this.destination = {};
            this.source = node();
            this.analyser = { ...node(), amplitude: 0, getFloatTimeDomainData(samples) { samples.fill(this.amplitude); } };
            this.gain = { ...node(), gain: { value: 1 } };
            this.closeCount = 0;
        }
        async resume() { if (!suspended) this.state = 'running'; }
        createMediaStreamSource() { if (failSource) throw new Error('Source unavailable'); return this.source; }
        createAnalyser() { return this.analyser; }
        createGain() { return this.gain; }
        async close() { this.closeCount++; this.state = 'closed'; }
    }
    return { AudioContext, instance: () => instance };
}

test('input level distinguishes silent samples from quiet audible samples', () => {
    assert.equal(inputLevel(new Float32Array(2048)), 0);
    assert.equal(inputLevel([]), 0);
    assert.ok(inputLevel(new Float32Array([0.01, -0.01])) > 0.009);
});

test('signal history survives pauses, and the monitor never plays microphone sound', async () => {
    const fake = fakeAudioContext();
    globalThis.window = { AudioContext: fake.AudioContext };
    const levels = [];
    const monitor = await monitorMicrophone({}, level => levels.push(level));
    try {
        assert.equal(monitor.hasSignal(), false);
        fake.instance().analyser.amplitude = 0.01;
        assert.equal(monitor.hasSignal(), true);
        fake.instance().analyser.amplitude = 0;
        assert.equal(monitor.hasSignal(), true);
        assert.equal(fake.instance().gain.gain.value, 0);
        assert.equal(levels[0], 0);
    } finally {
        monitor.stop();
        monitor.stop();
    }
    assert.equal(fake.instance().closeCount, 1);
    assert.equal(fake.instance().source.disconnected, true);
    assert.equal(fake.instance().analyser.disconnected, true);
});

test('an entirely silent capture is not reported as sound', async () => {
    const fake = fakeAudioContext();
    globalThis.window = { AudioContext: fake.AudioContext };
    const monitor = await monitorMicrophone({}, () => {});
    try {
        assert.equal(monitor.hasSignal(), false);
        assert.equal(monitor.hasSignal(), false);
    } finally {
        monitor.stop();
    }
});

test('suspended audio context is reported and cleaned up instead of appearing silent', async () => {
    const fake = fakeAudioContext({ suspended: true });
    globalThis.window = { AudioContext: fake.AudioContext };
    await assert.rejects(monitorMicrophone({}, () => {}), /suspended/);
    assert.equal(fake.instance().closeCount, 1);
});

test('failed microphone analysis releases the audio context', async () => {
    const fake = fakeAudioContext({ failSource: true });
    globalThis.window = { AudioContext: fake.AudioContext };
    await assert.rejects(monitorMicrophone({}, () => {}), /Source unavailable/);
    assert.equal(fake.instance().closeCount, 1);
});
