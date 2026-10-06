import { memo, useEffect, useRef } from 'react';

/** Deck coordinates, in inches. Draw only when the authoritative center of mass changes. */
export const CogRadar = memo(function CogRadar({ x, y, drift }: { x: number; y: number; drift: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 240, 200);
    ctx.fillStyle = '#09121d'; ctx.fillRect(0, 0, 240, 200);
    ctx.strokeStyle = '#415168'; ctx.lineWidth = 1;
    ctx.strokeRect(12, 10, 216, 180);
    ctx.fillStyle = '#26c87520'; ctx.fillRect(66, 55, 108, 90);
    ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(120, 10); ctx.lineTo(120, 190);
    ctx.moveTo(12, 100); ctx.lineTo(228, 100); ctx.stroke(); ctx.setLineDash([]);
    const px = 12 + x * 4.5, py = 10 + y * 4.5;
    ctx.strokeStyle = '#20d4ed'; ctx.beginPath(); ctx.moveTo(120, 100); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = drift > 12 ? '#ff5b65' : '#20d4ed'; ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.fill();
  }, [x, y, drift]);
  return <figure className="cog-radar"><canvas ref={canvas} width={240} height={200} role="img"
    aria-label={`Center of gravity: ${x.toFixed(1)}, ${y.toFixed(1)} inches; drift ${drift.toFixed(1)} inches`} />
    <figcaption>48″ × 40″ deck · drift {drift.toFixed(1)}″</figcaption></figure>;
});
