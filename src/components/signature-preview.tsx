'use client';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface SignaturePreviewProps {
  src?: string | null;
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
  compact?: boolean;
  priority?: boolean;
}

/**
 * SignaturePreview renders a digital signature image with built-in security features
 * to prevent right-click downloading or direct file access interaction.
 *
 * Refactored to have a theme-independent background for consistent visibility
 * in both light and dark modes, ensuring ink remains legible.
 */
export function SignaturePreview({
  src,
  alt = 'Signature',
  className = '',
  width,
  height,
  compact = false,
  priority = false,
}: SignaturePreviewProps) {
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (src) {
      setError(false);
    }
  }, [src]);

  // Normalize src: ensure internal paths are absolute from root and handle data URLs
  const normalizedSrc = React.useMemo(() => {
    if (!src) return src;
    const t = src.trim();
    if (t.startsWith('http') || t.startsWith('data:') || t.startsWith('/')) return t;
    return `/${t}`;
  }, [src]);

  // Dimensions
  const displayWidth = width ?? (compact ? 48 : 120);
  const displayHeight = height ?? (compact ? 24 : 60);

  // Theme-independent styling: 
  // We use standard Tailwind colors like bg-white and border-slate-200 
  // that do not map to CSS variables modified by .dark class.
  const wrapperClass = cn(
    "inline-flex items-center justify-center rounded border shadow-sm select-none relative group overflow-hidden transition-none",
    "bg-white border-slate-200", // Constant white background and slate border
    compact ? "px-1.5 py-0.5" : "px-3 py-2",
    className
  );

  // Security handlers to prevent direct interaction with the signature image
  const handleSecurity = (e: React.UIEvent) => {
    e.preventDefault();
  };

  if (!normalizedSrc || error) {
      return (
          <div className={cn(
              wrapperClass,
              'bg-slate-50 text-slate-400 border-dashed',
              className
          )} style={{ width: width ? `${width}px` : 'auto', height: height ? `${height}px` : (compact ? '28px' : '64px') }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          </div>
      );
  }

  return (
    <div 
        className={wrapperClass}
        onContextMenu={handleSecurity}
        onDragStart={handleSecurity}
    >
      <Image
        src={normalizedSrc as string}
        alt={alt}
        width={displayWidth}
        height={displayHeight}
        className="object-contain animate-in fade-in duration-300 pointer-events-none"
        style={{ filter: 'none' }} // Ensure no global filters affect the image
        priority={priority}
        unoptimized={
          // Use unoptimized for data URLs and for same-origin upload routes
          !normalizedSrc || (normalizedSrc as string).startsWith('data:') || !(normalizedSrc as string).startsWith('http')
        }
        onError={() => setError(true)}
      />
      {/* Security overlay */}
      <div className="absolute inset-0 z-10 bg-transparent cursor-default" aria-hidden="true" />
    </div>
  );
}

export default SignaturePreview;