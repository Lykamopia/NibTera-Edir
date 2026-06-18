
'use client';

export function NoAccessIllustration() {
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
        .no-access-door { animation: no-access-door-shake 3s ease-in-out infinite; transform-origin: center; }
        .no-access-user { animation: no-access-user-walk 3s ease-in-out infinite; }
        @keyframes no-access-door-shake {
            0%, 100% { transform: rotate(0deg); }
            40% { transform: rotate(-1deg); }
            50% { transform: rotate(1deg); }
            60% { transform: rotate(0deg); }
        }
        @keyframes no-access-user-walk {
            0%, 30%, 100% { transform: translateX(0px); }
            40% { transform: translateX(-5px); }
            50% { transform: translateX(5px); }
            60% { transform: translateX(0px); }
        }
      `}</style>
      <defs>
        <filter id="no-access-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="1" dy="3" stdDeviation="3" floodColor="hsl(var(--foreground))" floodOpacity="0.08" />
        </filter>
      </defs>

      {/* Door */}
      <g className="no-access-door" filter="url(#no-access-shadow)">
        <rect x="55" y="30" width="40" height="60" rx="4" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
        <circle cx="88" cy="60" r="3" fill="hsl(var(--muted-foreground))" />
      </g>

      {/* User */}
      <g className="no-access-user">
        <circle cx="40" cy="55" r="12" fill="hsl(var(--primary) / 0.1)" stroke="hsl(var(--primary))" strokeWidth="2" />
        <path d="M40 67 C 30 67, 28 77, 40 85 C 52 77, 50 67, 40 67 Z" fill="hsl(var(--primary) / 0.1)" stroke="hsl(var(--primary))" strokeWidth="2" />
      </g>
    </svg>
  );
}
