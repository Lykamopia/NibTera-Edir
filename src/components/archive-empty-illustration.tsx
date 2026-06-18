
'use client';

export function ArchiveEmptyIllustration() {
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
            .archive-box-lid {
                animation: lid-lift 3s ease-in-out infinite;
                transform-origin: 30px 75px;
            }
            .archive-paper {
                animation: paper-in 3s ease-in-out infinite;
                transform-origin: center bottom;
            }
            @keyframes lid-lift {
                0%, 100% { transform: rotate(0deg); }
                30% { transform: rotate(-25deg); }
                70% { transform: rotate(-25deg); }
                90% { transform: rotate(0deg); }
            }
            @keyframes paper-in {
                0%, 20% { transform: translateY(0) scaleY(1); opacity: 1; }
                50% { transform: translateY(20px) scaleY(0); opacity: 0; }
                51%, 100% { transform: translateY(-20px) scaleY(0); opacity: 0; }
            }
        `}</style>

        <defs>
            <filter id="archive-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="4" stdDeviation="4" floodColor="hsl(var(--primary))" floodOpacity="0.1" />
            </filter>
        </defs>

        {/* Box Base */}
        <path d="M25 80 H 95 V 105 H 25 V 80 Z" fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth="2" filter="url(#archive-shadow)" />
        <path d="M25 80 L 35 70 H 85 L 95 80" fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth="2" />
        <path d="M35 70 V 95" stroke="hsl(var(--border))" strokeWidth="2" />
        <path d="M85 70 V 95" stroke="hsl(var(--border))" strokeWidth="2" />

        {/* Paper going in */}
        <g className="archive-paper">
            <path d="M45 40 H 75 L 80 45 V 70 H 50 L 45 65 V 40 Z" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="1.5" />
            <path d="M45 40 L 50 45 H 75" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" />
            <rect x="55" y="52" width="18" height="2" rx="1" fill="hsl(var(--border))" />
            <rect x="55" y="58" width="22" height="2" rx="1" fill="hsl(var(--border))" />
        </g>
        
        {/* Box Lid */}
        <g className="archive-box-lid">
            <path d="M20 75 H 100 V 85 H 20 V 75 Z" fill="hsl(var(--accent) / 0.8)" stroke="hsl(var(--accent-foreground))" strokeWidth="2" />
            <path d="M20 75 L 30 65 H 90 L 100 75" fill="hsl(var(--accent) / 0.8)" stroke="hsl(var(--accent-foreground))" strokeWidth="2" />
            <path d="M30 65 V 75" stroke="hsl(var(--accent-foreground))" strokeWidth="2" />
        </g>
    </svg>
  );
}
