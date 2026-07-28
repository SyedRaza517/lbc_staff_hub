// London Brookes College brand mark — the arch/fan emblem plus the wordmark,
// recreated as SVG so every logo in the app is one shared, resolution-independent
// component. Brand colours are fixed: maroon fan + navy dome, maroon "LONDON
// BROOKES", navy "COLLEGE".
export const LBC_MAROON = "#9e1b32";
export const LBC_NAVY = "#1a3a8f";

// The emblem alone: a fan of maroon spokes under a navy semicircular arch.
export function BrandMark({ size = 40, className = "", mono = null }) {
  const cx = 50, cy = 52, R = 46, N = 13;
  const spokeColour = mono || LBC_MAROON;
  const archColour = mono || LBC_NAVY;
  const spokes = Array.from({ length: N }, (_, i) => {
    const t = (i / (N - 1)) * Math.PI; // 0 → π across the top half
    return { x: +(cx + R * Math.cos(t)).toFixed(2), y: +(cy - R * Math.sin(t)).toFixed(2) };
  });
  return (
    <svg viewBox="0 0 100 58" width={size} height={size * 0.58} className={className} role="img" aria-label="London Brookes College">
      <g stroke={spokeColour} strokeWidth="2.4" strokeLinecap="round">
        {spokes.map((p, i) => <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} />)}
      </g>
      <path d={`M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`} fill="none" stroke={archColour} strokeWidth="3.2" />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={archColour} strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

// The full lockup: emblem above the two-line wordmark.
export function BrandLockup({ compact = false }) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 leading-none">
      <BrandMark size={compact ? 28 : 40} />
      <span className="font-extrabold tracking-tight" style={{ color: LBC_MAROON, fontSize: compact ? 10 : 14, fontFamily: "'Lora', serif" }}>LONDON BROOKES</span>
      <span className="font-bold tracking-[0.2em]" style={{ color: LBC_NAVY, fontSize: compact ? 7 : 10, fontFamily: "'Lora', serif" }}>COLLEGE</span>
    </div>
  );
}
