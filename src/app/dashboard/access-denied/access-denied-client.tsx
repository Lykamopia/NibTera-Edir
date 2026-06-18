'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AccessDeniedIllustration } from '@/components/access-denied-illustration';
import { ArrowLeft, ShieldOff, Mail } from 'lucide-react';
import { motion } from 'framer-motion';

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.2 } },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100 } },
};

interface Props {
  returnPath?: string;
}

export default function AccessDeniedClient({ returnPath = '/dashboard/profile' }: Props) {
  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center overflow-hidden bg-background p-4 text-center">
      {/* Ambient background shapes */}
      <motion.div
        className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 bg-destructive/5 rounded-full"
        animate={{ scale: [1, 1.1, 1], rotate: [0, -5, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-1/4 -left-1/4 w-3/4 h-3/4 bg-primary/5 rounded-full"
        animate={{ scale: [1, 1.05, 1], rotate: [0, 5, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
      <svg
        viewBox="0 0 1024 1024"
        className="absolute left-1/2 top-1/2 -z-10 h-[64rem] w-[64rem] -translate-y-1/2 [mask-image:radial-gradient(closest-side,white,transparent)] sm:left-full sm:-ml-80 lg:left-1/2 lg:ml-0 lg:-translate-x-1/2 lg:translate-y-0"
        aria-hidden="true"
      >
        <circle cx={512} cy={512} r={512} fill="url(#gradient-denied)" fillOpacity="0.3" />
        <defs>
          <radialGradient id="gradient-denied">
            <stop stopColor="hsl(var(--destructive))" />
            <stop offset={1} stopColor="hsl(var(--primary))" />
          </radialGradient>
        </defs>
      </svg>

      <motion.div
        className="z-10 flex flex-col items-center max-w-lg"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={item}>
          <AccessDeniedIllustration />
        </motion.div>

        <motion.div
          variants={item}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1"
        >
          <ShieldOff className="h-3.5 w-3.5 text-destructive" />
          <span className="text-xs font-medium text-destructive">Permission Required</span>
        </motion.div>

        <motion.h1
          className="mt-4 text-4xl font-bold tracking-tight text-destructive sm:text-5xl"
          variants={item}
        >
          Access Denied
        </motion.h1>

        <motion.p
          className="mt-4 text-base text-muted-foreground leading-relaxed"
          variants={item}
        >
          You don&apos;t have the required permissions to view this page.
          This area is restricted based on your current role.
        </motion.p>

        <motion.p
          className="mt-2 text-sm text-muted-foreground/70"
          variants={item}
        >
          If you believe this is a mistake, please contact your system administrator to have your permissions reviewed.
        </motion.p>

        <motion.div
          className="mt-8 flex flex-col sm:flex-row items-center gap-3"
          variants={item}
        >
          <Link href={returnPath}>
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Button size="lg" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Return Home
              </Button>
            </motion.div>
          </Link>

          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <Button size="lg" variant="outline" className="gap-2" asChild>
              <a href="mailto:admin@nib.com.et">
                <Mail className="h-4 w-4" />
                Contact Admin
              </a>
            </Button>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
