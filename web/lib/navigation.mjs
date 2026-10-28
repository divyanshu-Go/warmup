export function safeReturnPath(value) {
  if (typeof value !== 'string') return '/resumes';
  try {
    const url = new URL(value, 'https://interview.local');
    if (url.origin !== 'https://interview.local' || !['/', '/resumes', '/interview', '/history'].includes(url.pathname)) return '/resumes';
    return url.pathname + url.search;
  } catch {
    return '/resumes';
  }
}

export function interviewPath(resumeId) {
  return `/interview?resume=${encodeURIComponent(resumeId)}`;
}
