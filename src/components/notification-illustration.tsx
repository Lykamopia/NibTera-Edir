
'use client';

export function NotificationIllustration() {
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
        .notification-bell-body {
            animation: swing 2.5s ease-in-out infinite;
            transform-origin: top center;
        }
        .notification-clapper {
            animation: ring 2.5s ease-in-out infinite;
            transform-origin: top center;
        }
        .notification-wave {
            stroke-dasharray: 20;
            stroke-dashoffset: 20;
            animation: emit-wave 2.5s ease-in-out infinite;
            transform-origin: center;
        }
        @keyframes swing {
            0%, 100% { transform: rotate(0deg); }
            10%, 30% { transform: rotate(-8deg); }
            20%, 40% { transform: rotate(8deg); }
            50% { transform: rotate(0deg); }
        }
        @keyframes ring {
            0%, 50%, 100% { transform: rotate(0deg); }
            10%, 30% { transform: rotate(-15deg); }
            20%, 40% { transform: rotate(15deg); }
        }
        @keyframes emit-wave {
            0%, 50% { opacity: 0; stroke-dashoffset: 20; transform: scale(0.5); }
            60% { opacity: 1; stroke-dashoffset: 0; transform: scale(0.8); }
            80% { opacity: 0; stroke-dashoffset: 0; transform: scale(1.2); }
        }
        .notification-wave-1 { animation-delay: 0.1s; }
        .notification-wave-2 { animation-delay: 0.25s; }
      `}</style>
      <defs>
        <filter id="notification-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="3" dy="5" stdDeviation="5" floodColor="hsl(var(--primary))" floodOpacity="0.15" />
        </filter>
      </defs>
      
      {/* Sound Waves */}
      <g>
        <path d="M90 60 C 95 60, 95 70, 90 70" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" fill="none" className="notification-wave notification-wave-1" />
        <path d="M95 55 C 105 55, 105 75, 95 75" stroke="hsl(var(--primary) / 0.7)" strokeWidth="2" strokeLinecap="round" fill="none" className="notification-wave notification-wave-2" />
        <path d="M30 60 C 25 60, 25 70, 30 70" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" fill="none" className="notification-wave notification-wave-1" />
        <path d="M25 55 C 15 55, 15 75, 25 75" stroke="hsl(var(--primary) / 0.7)" strokeWidth="2" strokeLinecap="round" fill="none" className="notification-wave notification-wave-2" />
      </g>
      
      {/* Bell */}
      <g className="notification-bell-body" filter="url(#notification-shadow)">
        <path
          d="M40 85 C 40 95, 80 95, 80 85 V 50 C 80 35, 65 30, 60 30 C 55 30, 40 35, 40 50 V 85 Z"
          fill="hsl(var(--accent))"
          stroke="hsl(var(--accent-foreground))"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect x="35" y="85" width="50" height="5" rx="2.5" fill="hsl(var(--accent) / 0.8)" stroke="hsl(var(--accent-foreground))" strokeWidth="3" />

        {/* Clapper */}
        <path className="notification-clapper" d="M60 80 V 90" stroke="hsl(var(--accent-foreground))" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  );
}
