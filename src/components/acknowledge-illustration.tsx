
'use client';

export function AcknowledgeIllustration() {
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
            .ack-doc-check {
                stroke-dasharray: 100;
                stroke-dashoffset: 100;
                animation: ack-draw-check 3s ease-in-out infinite;
            }
            .ack-doc-body {
                animation: ack-float 3.5s ease-in-out infinite;
                transform-origin: center;
            }
            @keyframes ack-draw-check {
                0%, 20% { stroke-dashoffset: 100; }
                50% { stroke-dashoffset: 0; }
                100% { stroke-dashoffset: 0; }
            }
            @keyframes ack-float {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-5px); }
            }
        `}</style>
        <defs>
            <filter id="ack-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="1" dy="3" stdDeviation="3" floodColor="hsl(var(--primary))" floodOpacity="0.15" />
            </filter>
        </defs>

        <g className="ack-doc-body">
            {/* Document */}
            <path
                d="M30 25 H 90 L 105 40 V 95 H 45 L 30 80 V 25 Z"
                fill="hsl(var(--card))"
                stroke="hsl(var(--border))"
                strokeWidth="2.5"
                filter="url(#ack-shadow)"
            />
            <path d="M30 25 L 45 40 H 90" fill="none" stroke="hsl(var(--border))" strokeWidth="2.5" />
            <path d="M45 40 V 80" fill="none" stroke="hsl(var(--border))" strokeWidth="2.5" />

            {/* Checkmark */}
            <path
                d="M50 65 L 65 80 L 95 50"
                stroke="hsl(var(--primary))"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                className="ack-doc-check"
            />
        </g>
    </svg>
  );
}
