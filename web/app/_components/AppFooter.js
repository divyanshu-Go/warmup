'use client';

import { useSession } from './SessionProvider';

export default function AppFooter() {
  const { apiStatus } = useSession();
  return <footer><p role="status">{apiStatus}</p></footer>;
}
