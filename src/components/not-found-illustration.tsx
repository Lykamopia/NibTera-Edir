'use client';

export function NotFoundIllustration() {
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
        .plane-body {
          animation: hover 4s ease-in-out infinite;
          transform-origin: center;
        }
        .question-mark {
            opacity: 0;
            animation: pop-in-out 4s ease-in-out infinite;
            transform-origin: bottom center;
        }
        .shadow {
          animation: shadow-move 4s ease-in-out infinite;
          transform-origin: center;
        }

        @keyframes hover {
          0%, 100% { transform: translateY(0) rotate(-5deg); }
          50% { transform: translateY(-10px) rotate(5deg); }
        }
        @keyframes shadow-move {
          0%, 100% { transform: scaleX(1); opacity: 0.5; }
          50% { transform: scaleX(0.9); opacity: 0.3; }
        }
        @keyframes pop-in-out {
          0%, 20%, 80%, 100% { opacity: 0; transform: scale(0.8) translateY(10px); }
          30% { opacity: 1; transform: scale(1.1) translateY(0); }
          70% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <defs>
        <filter id="plane-shadow-filter" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="hsl(var(--primary))" floodOpacity="0.1" />
        </filter>
      </defs>
      
      {/* Shadow */}
      <ellipse cx="100" cy="130" rx="40" ry="8" fill="hsl(var(--foreground))" className="shadow" />
      
      {/* Question Mark */}
      <text
        x="100"
        y="110"
        fontFamily="Arial, sans-serif"
        fontSize="80"
        fontWeight="bold"
        textAnchor="middle"
        fill="hsl(var(--primary) / 0.7)"
        className="question-mark"
      >
        ?
      </text>

      {/* Paper Plane */}
      <g className="plane-body" filter="url(#plane-shadow-filter)">
        <path
            d="M50 60 L 150 40 L 70 80 Z"
            fill="hsl(var(--card))"
            stroke="hsl(var(--primary))"
            strokeWidth="3"
            strokeLinejoin="round"
        />
        <path
            d="M70 80 L 95 25 L 150 40"
            fill="hsl(var(--primary) / 0.8)"
            stroke="hsl(var(--primary))"
            strokeWidth="3"
            strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
