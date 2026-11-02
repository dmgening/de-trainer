import { useEffect, useState } from 'react';

/** Hash routes (#/topics, #/history/<id>): back/forward work and the service worker needs no extra fallbacks. */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string, replace = false) {
  const hash = `#/${path}`;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}
