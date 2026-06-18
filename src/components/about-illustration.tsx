'use client';

export function AboutIllustration() {
  return (
    <svg
      width="150"
      height="150"
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <style>{`
        .about-main-icon {
          animation: about-float 5s ease-in-out infinite;
          transform-origin: center;
        }
        .about-orbit-path {
            animation: about-rotate 20s linear infinite;
            transform-origin: center;
        }
        .about-satellite {
            animation: about-float-satellite 5s ease-in-out infinite;
            transform-origin: center;
        }
        .about-satellite-1 { animation-delay: -2s; }
        .about-satellite-2 { animation-delay: -4s; }
        .about-satellite-3 { animation-delay: -6s; }
        
        @keyframes about-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes about-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes about-float-satellite {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(3px); }
        }
      `}</style>
      <defs>
        <filter id="about-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="hsl(var(--primary))" floodOpacity="0.1" />
        </filter>
        <linearGradient id="about-main-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--accent))" />
        </linearGradient>
      </defs>

      {/* Orbit paths */}
      <g className="about-orbit-path">
        <circle cx="75" cy="75" r="40" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 4" />
        <circle cx="75" cy="75" r="60" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 6" />
      </g>

      {/* Main Icon */}
      <g className="about-main-icon" filter="url(#about-shadow)">
        <circle cx="75" cy="75" r="30" fill="url(#about-main-grad)" />
        <path d="M65 75 L70 80 L85 65" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Satellites */}
      <g>
        <g transform="translate(115, 75)" className="about-satellite about-satellite-1">
            <circle cx="0" cy="0" r="10" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2" />
            <path d="M-4 0 H4" stroke="hsl(var(--primary))" strokeWidth="1.5" />
        </g>
        <g transform="translate(45, 27)" className="about-satellite about-satellite-2">
            <circle cx="0" cy="0" r="8" fill="hsl(var(--card))" stroke="hsl(var(--accent))" strokeWidth="2" />
            <path d="M0 -3 L0 3" stroke="hsl(var(--accent))" strokeWidth="1.5" />
        </g>
         <g transform="translate(40, 110)" className="about-satellite about-satellite-3">
            <circle cx="0" cy="0" r="9" fill="hsl(var(--card))" stroke="hsl(var(--secondary))" strokeWidth="2" />
            <path d="M-3 -3 L3 3 M-3 3 L3 -3" stroke="hsl(var(--secondary))" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  );
}
