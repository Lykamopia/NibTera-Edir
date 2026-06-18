
'use client';

export function DelegationEmptyIllustration() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <filter id="delegation-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="1" dy="3" stdDeviation="3" floodColor="hsl(var(--foreground))" floodOpacity="0.08" />
        </filter>
      </defs>

      {/* Two user figures */}
      <g filter="url(#delegation-shadow)">
        <circle cx="45" cy="45" r="14" fill="hsl(var(--primary) / 0.1)" stroke="hsl(var(--primary))" strokeWidth="2" />
        <path d="M45 59 C 35 59, 33 69, 45 77 C 57 69, 55 59, 45 59 Z" fill="hsl(var(--primary) / 0.1)" stroke="hsl(var(--primary))" strokeWidth="2" />
        
        <circle cx="75" cy="55" r="14" fill="hsl(var(--muted) / 0.2)" stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
        <path d="M75 69 C 65 69, 63 79, 75 87 C 87 79, 85 69, 75 69 Z" fill="hsl(var(--muted) / 0.2)" stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
        
        {/* Arrow */}
        <path d="M55 65 L 65 65" stroke="hsl(var(--primary))" strokeWidth="2" strokeDasharray="3 3" />
        <path d="M62 62 L 65 65 L 62 68" stroke="hsl(var(--primary))" strokeWidth="2" fill="none" />
      </g>
    </svg>
  );
}
