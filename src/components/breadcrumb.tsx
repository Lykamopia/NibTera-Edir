'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Shield, User, Info } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Fragment } from 'react';

const pathConfig: { [key: string]: { icon: React.ReactNode; label: string } } = {
  dashboard: { icon: <Home className="h-4 w-4" />, label: 'Dashboard' },
  admin: { icon: <Shield className="h-4 w-4 text-purple-400" />, label: 'Admin' },
  profile: { icon: <User className="h-4 w-4 text-cyan-400" />, label: 'Profile' },
  about: { icon: <Info className="h-4 w-4 text-sky-400" />, label: 'About' },
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0 },
};

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // We only care about segments after 'dashboard'
  const dashboardIndex = segments.indexOf('dashboard');
  const relevantSegments = dashboardIndex !== -1 ? segments.slice(dashboardIndex) : [];

  if (relevantSegments.length <= 1) {
    return null; // Don't show breadcrumb on the root dashboard page
  }
  
  const breadcrumbs = relevantSegments.map((segment, index) => {
    const href = '/' + segments.slice(0, dashboardIndex + index + 1).join('/');
    const config = pathConfig[segment] || { icon: null, label: segment.charAt(0).toUpperCase() + segment.slice(1) };
    
    // Disable clicking for 'dashboard' segment as requested
    const isDashboard = segment === 'dashboard';
    
    return {
      href,
      label: config.label,
      icon: config.icon,
      isClickable: !isDashboard && index !== relevantSegments.length - 1
    };
  });

  return (
    <motion.nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {breadcrumbs.map((crumb, index) => (
        <Fragment key={crumb.href}>
          <motion.div variants={itemVariants}>
            {crumb.isClickable ? (
              <Link href={crumb.href}>
                <div className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {crumb.icon}
                  <span className="whitespace-nowrap">{crumb.label}</span>
                </div>
              </Link>
            ) : (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  index === breadcrumbs.length - 1
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground/60 cursor-default'
                )}
              >
                {crumb.icon}
                <span className="whitespace-nowrap">{crumb.label}</span>
              </div>
            )}
          </motion.div>
          {index < breadcrumbs.length - 1 && (
            <motion.div variants={itemVariants} className="text-muted-foreground">
              /
            </motion.div>
          )}
        </Fragment>
      ))}
    </motion.nav>
  );
}
