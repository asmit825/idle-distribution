import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, initSync } from '../pkg/pallet_sim';
import wasmUrl from '../pkg/pallet_sim_bg.wasm?url';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
let engine: Engine | undefined;
let disposed = false;
root.render(<p role="status" className="startup">Preparing the pallet engine…</p>);

async function boot() {
  try {
    // Fetch the bytes asynchronously, then instantiate and call Rust synchronously
    // on the UI thread. No worker or message-passing boundary is involved.
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Engine download failed (${response.status})`);
    const module = await response.arrayBuffer();
    if (disposed) return;
    initSync({ module });
    engine = new Engine();
    const handshake = `Engine initialized: ${engine.ping()}`;
    console.info(handshake);
    root.render(<StrictMode><App handshake={handshake} /></StrictMode>);
  } catch (error) {
    if (disposed) return;
    console.error(error);
    root.render(<p role="alert" className="startup">The pallet engine could not start. Reload to try again.</p>);
  }
}
void boot();

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true;
  root.unmount();
  engine?.free();
});
