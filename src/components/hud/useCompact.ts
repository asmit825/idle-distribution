import { useEffect, useState } from 'react';

export const COMPACT_QUERY = '(max-width:900px),(max-height:540px),(pointer:coarse)';

export function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => { setCompact(media.matches); document.body.classList.toggle('compact', media.matches); };
    update(); media.addEventListener('change', update);
    return () => { media.removeEventListener('change', update); document.body.classList.remove('compact'); };
  }, []);
  return compact;
}
