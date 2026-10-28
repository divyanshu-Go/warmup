export function apiUrl(path) {
  const base = process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:8001`;
  return `${base.replace(/\/$/, '')}${path}`;
}

export async function requestApi(path, body) {
  const options = { credentials: 'include' };
  if (body !== undefined) {
    options.method = 'POST';
    if (body instanceof FormData) {
      options.body = body;
    } else {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
  }
  const response = await fetch(apiUrl(path), options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Request failed. Please try again.');
    error.status = response.status;
    error.transcript = data.detail?.transcript;
    throw error;
  }
  return data;
}

export async function loadQuestionAudio(turnId, signal) {
  const response = await fetch(apiUrl(`/api/interview/${turnId}/speech`), {
    method: 'POST', credentials: 'include', signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Question voice could not be loaded. Please retry.');
  }
  if (!response.headers.get('content-type')?.includes('audio/wav')) {
    throw new Error('The server did not return question audio. Restart FastAPI and retry.');
  }
  return response.blob();
}
