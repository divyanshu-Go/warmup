// A local input check only: no MediaRecorder, upload, speech or transcription.
export function createMicrophoneCheck({ getUserMedia, monitor }, onLevel) {
  let generation = 0;
  let stream = null;
  let input = null;
  let disposed = false;

  function stop() {
    generation++;
    let detected = false;
    try { detected = input?.hasSignal() || false; }
    catch { /* A lost device must not prevent releasing the remaining resources. */ }
    input?.stop();
    input = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    return detected;
  }

  async function start(deviceId) {
    stop();
    if (disposed) return false;
    const request = generation;
    const audio = { channelCount: { ideal: 1 } };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const captured = await getUserMedia({ audio });
    if (disposed || request !== generation) {
      captured.getTracks().forEach(track => track.stop());
      return false;
    }
    stream = captured;
    try {
      const track = captured.getAudioTracks()[0];
      if (!track || !track.enabled || track.readyState !== 'live') throw new Error('No active microphone input. Choose another device.');
      const monitoring = await monitor(captured, onLevel);
      if (disposed || request !== generation) {
        monitoring.stop();
        captured.getTracks().forEach(track => track.stop());
        return false;
      }
      input = monitoring;
      return true;
    } catch (error) {
      if (request === generation) stop();
      throw error;
    }
  }
  return { start, stop, dispose() { stop(); disposed = true; } };
}
