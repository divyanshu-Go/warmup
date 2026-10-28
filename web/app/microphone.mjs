export const MIN_INPUT_LEVEL = 0.0001;

export function inputLevel(samples) {
    if (!samples.length) return 0;
    let total = 0;
    for (const sample of samples) total += sample * sample;
    return Math.sqrt(total / samples.length);
}

export async function monitorMicrophone(stream, onLevel) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('This browser cannot check microphone input. Please use Chrome or Edge.');
    const context = new AudioContext();
    let source, analyser, silentOutput, timer;
    let heardSound = false;
    let stopped = false;
    function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        source?.disconnect();
        analyser?.disconnect();
        silentOutput?.disconnect();
        if (context.state !== 'closed') context.close().catch(() => {});
    }
    try {
        await context.resume();
        if (context.state !== 'running') throw new Error('Microphone audio is suspended by the browser. Reload and allow microphone access.');
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        silentOutput = context.createGain();
        silentOutput.gain.value = 0;
        source.connect(analyser);
        analyser.connect(silentOutput);
        silentOutput.connect(context.destination);
        const samples = new Float32Array(analyser.fftSize);
        function measure() {
            if (stopped) return;
            analyser.getFloatTimeDomainData(samples);
            const level = inputLevel(samples);
            if (level >= MIN_INPUT_LEVEL) heardSound = true;
            onLevel(level);
        }
        timer = setInterval(measure, 100);
        return { stop, hasSignal() { measure(); return heardSound; } };
    } catch (error) {
        stop();
        throw error;
    }
}
