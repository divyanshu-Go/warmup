import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuestionAudioPlayer } from '../app/questionAudio.mjs';

function setup(load) {
    const elements = [];
    const states = [];
    const errors = [];
    class Audio {
        constructor(src) { this.src = src; this.currentTime = 0; this.plays = 0; elements.push(this); }
        pause() { this.onpause?.(); }
        async play() { this.plays++; this.onplaying?.(); }
    }
    globalThis.Audio = Audio;
    const player = createQuestionAudioPlayer(load, state => states.push(state), error => errors.push(error));
    return { player, elements, states, errors };
}

test('replay uses cached audio and starts from the beginning', async () => {
    let requests = 0;
    const { player, elements, states } = setup(async () => { requests++; return new Blob(['audio']); });
    try {
        await player.play('question-a');
        elements[0].currentTime = 5;
        await player.play('question-a');
        assert.equal(requests, 1);
        assert.equal(elements[0].currentTime, 0);
        assert.equal(elements[0].plays, 2);
        assert.equal(states.at(-1), 'speaking');
    } finally { player.dispose(); }
});

test('stopping an in-flight request prevents late audio from playing', async () => {
    let complete;
    let signal;
    const { player, elements, states } = setup((id, requestSignal) => {
        signal = requestSignal;
        return new Promise(resolve => { complete = resolve; });
    });
    const pending = player.play('question-a');
    player.stop();
    complete(new Blob(['audio']));
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(elements.length, 0);
    assert.equal(states.at(-1), 'idle');
    player.dispose();
});

test('changing questions ignores a slower response for the previous question', async () => {
    let finishOld;
    const { player, elements } = setup(id => id === 'old'
        ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(new Blob(['new audio'])));
    const old = player.play('old');
    await player.play('new');
    finishOld(new Blob(['old audio']));
    await old;
    assert.equal(elements.length, 1);
    assert.equal(elements[0].plays, 1);
    player.dispose();
});

test('browser autoplay denial can be retried using the cached audio', async () => {
    let requests = 0;
    const { player, elements, errors } = setup(async () => { requests++; return new Blob(['audio']); });
    const original = globalThis.Audio.prototype.play;
    globalThis.Audio.prototype.play = async function () {
        const error = new Error('Autoplay denied'); error.name = 'NotAllowedError';
        throw error;
    };
    await player.play('question-a');
    assert.match(errors[0].message, /Press Speak question/);
    elements[0].play = original;
    await player.play('question-a');
    assert.equal(requests, 1);
    assert.equal(elements[0].plays, 1);
    player.dispose();
});

test('provider errors leave the player idle and retryable', async () => {
    const { player, states, errors } = setup(async () => { throw new Error('Provider unavailable'); });
    await player.play('question-a');
    assert.equal(states.at(-1), 'idle');
    assert.match(errors[0].message, /Provider unavailable/);
    player.dispose();
});

test('disposal prevents requests and stops loaded playback', async () => {
    let requests = 0;
    const { player, elements } = setup(async () => { requests++; return new Blob(['audio']); });
    await player.play('question-a');
    player.dispose();
    assert.equal(elements[0].src, '');
    await player.play('question-b');
    assert.equal(requests, 1);
});
