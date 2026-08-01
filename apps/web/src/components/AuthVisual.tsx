// Deterministic scatter of star positions/sizes — generated once from a
// simple seeded PRNG so it's stable across renders without needing
// Math.random() (which would reshuffle the sky on every re-render).
function seededStars(count: number) {
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: count }, () => ({
    cx: rand() * 700,
    cy: rand() * 480,
    r: 0.5 + rand() * 1.3,
    opacity: 0.25 + rand() * 0.55,
  }));
}

const STARS = seededStars(70);

/**
 * A layered mountain/lake night scene rendered as SVG — stands in for a
 * photo background (no image asset shipped/hotlinked). Depth comes from
 * three overlapping mountain silhouettes lightening with distance
 * (atmospheric perspective); the water below the horizon carries a mirrored,
 * SVG-turbulence-distorted reflection of those same peaks with its
 * baseFrequency animated via SMIL, plus a few translucent streaks drifting
 * across it via CSS — together reading as gently flowing/rippling water.
 */
export function AuthVisual() {
  return (
    <svg
      viewBox="0 0 700 1000"
      preserveAspectRatio="xMidYMid slice"
      className="auth-visual-svg"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#050810" />
          <stop offset="55%" stopColor="#0d1729" />
          <stop offset="100%" stopColor="#1a2c4a" />
        </linearGradient>
        <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#dfe8ff" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#9db4e0" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#9db4e0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mtnFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a4d70" />
          <stop offset="100%" stopColor="#26375a" />
        </linearGradient>
        <linearGradient id="mtnMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#212f4e" />
          <stop offset="100%" stopColor="#141f38" />
        </linearGradient>
        <linearGradient id="mtnNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1327" />
          <stop offset="100%" stopColor="#070b17" />
        </linearGradient>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0e1a30" />
          <stop offset="100%" stopColor="#04070d" />
        </linearGradient>
        <filter id="ripple" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" numOctaves="2" seed="7" result="noise">
            <animate attributeName="baseFrequency" values="0.01 0.04;0.014 0.055;0.01 0.04" dur="9s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>

      <rect x="0" y="0" width="700" height="1000" fill="url(#sky)" />

      <circle cx="540" cy="150" r="150" fill="url(#moonGlow)" />
      <circle cx="540" cy="150" r="34" fill="#eef3ff" opacity="0.95" />

      {STARS.map((s, i) => (
        <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="#ffffff" opacity={s.opacity} />
      ))}

      {/* Far, mid, near mountain silhouettes — each closer layer darker and
          lower (atmospheric perspective + overlap reads as depth). */}
      <polygon
        fill="url(#mtnFar)"
        opacity="0.75"
        points="0,620 70,520 150,580 230,470 320,560 410,500 500,590 580,510 700,600 700,660 0,660"
      />
      <polygon
        fill="url(#mtnMid)"
        opacity="0.9"
        points="0,660 90,560 190,630 280,540 360,620 460,550 560,640 650,570 700,610 700,680 0,680"
      />
      <polygon fill="url(#mtnNear)" points="0,680 110,600 210,670 300,600 400,675 520,610 630,670 700,640 700,680 0,680" />

      {/* Water */}
      <rect x="0" y="680" width="700" height="320" fill="url(#water)" />

      {/* Rippled reflection of the near ridge, mirrored below the waterline */}
      <g transform="translate(0,1360) scale(1,-1)" opacity="0.32" filter="url(#ripple)">
        <polygon fill="url(#mtnNear)" points="0,680 110,600 210,670 300,600 400,675 520,610 630,670 700,640 700,680 0,680" />
      </g>
      <g transform="translate(0,1360) scale(1,-1)" opacity="0.18" filter="url(#ripple)">
        <circle cx="540" cy="150" r="26" fill="#eef3ff" />
      </g>

      {/* Drifting shimmer streaks — pure CSS animation (see .auth-visual-shimmer). */}
      <rect className="auth-visual-shimmer" x="-200" y="740" width="180" height="3" fill="#dfe8ff" opacity="0.18" />
      <rect className="auth-visual-shimmer auth-visual-shimmer-2" x="-320" y="820" width="140" height="2" fill="#dfe8ff" opacity="0.14" />
      <rect className="auth-visual-shimmer auth-visual-shimmer-3" x="-260" y="900" width="220" height="2.5" fill="#dfe8ff" opacity="0.12" />
    </svg>
  );
}
