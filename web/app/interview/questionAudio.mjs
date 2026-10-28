export function createQuestionAudioPlayer(loadAudio, onState, onError) {
    let audio = null;
    let url = null;
    let turnId = null;
    let controller = null;
    let generation = 0;
    let disposed = false;

    function stop() {
        generation++;
        controller?.abort();
        controller = null;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
        onState('idle');
    }

    function clear() {
        stop();
        if (audio) {
            audio.onplaying = audio.onended = audio.onpause = audio.onerror = null;
            audio.src = '';
            audio = null;
        }
        if (url) URL.revokeObjectURL(url);
        url = null;
        turnId = null;
    }

    async function play(id) {
        if (disposed) return;
        if (turnId !== id) clear();
        else stop();
        const current = generation;
        onState('loading');
        try {
            if (!audio) {
                controller = new AbortController();
                const blob = await loadAudio(id, controller.signal);
                if (disposed || current !== generation) return;
                controller = null;
                url = URL.createObjectURL(blob);
                audio = new Audio(url);
                turnId = id;
                const element = audio;
                element.onplaying = () => { if (audio === element && !disposed) onState('speaking'); };
                element.onended = element.onpause = () => { if (audio === element && !disposed) onState('idle'); };
                element.onerror = () => {
                    if (audio === element && !disposed) {
                        clear();
                        onError(new Error('Question audio could not be played. Please retry Speak question.'));
                    }
                };
            }
            await audio.play();
        } catch (error) {
            if (disposed || current !== generation || error.name === 'AbortError') return;
            onState('idle');
            onError(error.name === 'NotAllowedError'
                ? new Error('Your browser blocked automatic playback. Press Speak question to listen.')
                : error);
        }
    }

    return { play, stop, dispose() { clear(); disposed = true; } };
}
