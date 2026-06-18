
'use client';

export function MemoEmptyIllustration() {
  return (
    <svg
      width="200"
      height="150"
      viewBox="0 0 200 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <style>{`
        .bounce {
          animation: bounce 3s ease-in-out infinite;
          transform-origin: center;
        }
        .shadow {
          animation: shadow-pulse 3s ease-in-out infinite;
          transform-origin: center;
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes shadow-pulse {
          0%, 100% { transform: scaleX(1); opacity: 0.4; }
          50% { transform: scaleX(0.85); opacity: 0.25; }
        }
      `}</style>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="hsl(var(--primary))" floodOpacity="0.15" />
        </filter>
      </defs>

      {/* Shadow */}
      <ellipse cx="100" cy="135" rx="50" ry="10" fill="hsl(var(--foreground))" className="shadow" />

      {/* Main Content */}
      <g className="bounce" filter="url(#glow)">
        {/* Base Rectangle */}
        <rect
          x="55"
          y="45"
          width="90"
          height="65"
          rx="12"
          fill="hsl(var(--card))"
          stroke="hsl(var(--border))"
          strokeWidth="2"
        />

        {/* Lines */}
        <rect x="70" y="62" width="55" height="4" rx="2" fill="hsl(var(--muted-foreground) / 0.5)" />
        <rect x="70" y="76" width="40" height="4" rx="2" fill="hsl(var(--muted-foreground) / 0.4)" />
        <rect x="70" y="90" width="48" height="4" rx="2" fill="hsl(var(--muted-foreground) / 0.4)" />

        {/* Plus Icon */}
        <rect
          x="130"
          y="55"
          width="8"
          height="24"
          rx="4"
          fill="hsl(var(--primary))"
          transform="translate(134, 67) rotate(90) translate(-134, -67)"
        />
        <rect x="130" y="55" width="8" height="24" rx="4" fill="hsl(var(--primary))" />
      </g>
    </svg>
  );
}
