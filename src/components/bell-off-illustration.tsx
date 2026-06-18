'use client';

export function BellOffIllustration() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <style>{`
        .bell-off-body {
            animation: shake-head 4s ease-in-out infinite;
            transform-origin: top center;
        }
        .bell-off-slash {
            stroke-dasharray: 100;
            stroke-dashoffset: 100;
            animation: draw-slash 4s ease-in-out infinite;
        }
        @keyframes shake-head {
            0%, 10%, 100% { transform: rotate(0deg); }
            30% { transform: rotate(-8deg); }
            50% { transform: rotate(8deg); }
            70% { transform: rotate(-5deg); }
            90% { transform: rotate(5deg); }
        }
        @keyframes draw-slash {
            0%, 20% { stroke-dashoffset: 100; }
            40% { stroke-dashoffset: 0; }
            90%, 100% { stroke-dashoffset: 0; }
        }
      `}</style>
      <defs>
        <filter id="bell-off-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="3" dy="5" stdDeviation="5" floodColor="hsl(var(--primary))" floodOpacity="0.1" />
        </filter>
      </defs>

      {/* Bell Body */}
      <g className="bell-off-body" filter="url(#bell-off-shadow)">
        <path
          d="M40 85 C 40 95, 80 95, 80 85 V 50 C 80 35, 65 30, 60 30 C 55 30, 40 35, 40 50 V 85 Z"
          fill="hsl(var(--muted))"
          stroke="hsl(var(--border))"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect x="35" y="85" width="50" height="5" rx="2.5" fill="hsl(var(--muted) / 0.8)" stroke="hsl(var(--border))" strokeWidth="3" />
        <path d="M60 82 V 90" stroke="hsl(var(--border))" strokeWidth="4" strokeLinecap="round" />
      </g>
      
      {/* Slash */}
      <line
        x1="35"
        y1="95"
        x2="85"
        y2="35"
        className="bell-off-slash"
        stroke="hsl(var(--destructive))"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
