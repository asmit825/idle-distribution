import { Boxes, MousePointer2 } from 'lucide-react';
import { PalletCanvas } from './components/PalletCanvas';

export function App({ handshake }: { handshake: string }) {
  return (
    <main className="workstation">
      <header className="header">
        <div className="brand"><Boxes size={28} /><div><span className="eyebrow">IDLE DISTRIBUTION</span><h1>Pallet builder</h1></div></div>
        <span role="status" className="engine-status"><i />{handshake}</span>
      </header>
      <section className="viewport" aria-label="Pallet inspection viewport">
        <PalletCanvas />
        <div className="viewport-label"><span className="eyebrow">STAGING BAY 01</span><h2>Ready for the first layer.</h2><p>Grade A · Wood stringer pallet</p></div>
        <div className="dimensions"><strong>48 × 40 × 4.75</strong><span>INCHES · LENGTH / WIDTH / HEIGHT</span></div>
      </section>
      <footer><span><MousePointer2 size={16} />Drag to orbit · Scroll or pinch to zoom · Right-drag to pan</span><span>7 top boards / 3 stringers / 5 bottom boards</span></footer>
    </main>
  );
}
