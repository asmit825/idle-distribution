import { useCallback, useState } from 'react';

const SANDBOX_KEY = 'idle-distribution:sandbox';

function storedSandbox() {
  try { return localStorage.getItem(SANDBOX_KEY) === 'true'; } catch { return false; /* storage unavailable */ }
}

/**
 * Whether both modes play as a sandbox: Mode 1 with no clock and endless waves, Mode 2 with no
 * diversions or Estop. Remembered on this device; timed by default.
 */
export function useSandbox() {
  const [sandbox, setSandbox] = useState(storedSandbox);
  const choose = useCallback((value: boolean) => {
    try { localStorage.setItem(SANDBOX_KEY, String(value)); } catch { /* storage unavailable */ }
    setSandbox(value);
  }, []);
  return [sandbox, choose] as const;
}
