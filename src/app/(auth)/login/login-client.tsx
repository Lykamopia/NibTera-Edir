
'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from "sonner";
import Logo from '@/components/logo';
import { Loader2, ArrowRight, Mail, Lock, Eye, EyeOff, ShieldAlert, FileText, Send, Inbox, Layers, Bell } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getUserLockoutStatus } from '@/app/actions/admin';
import { normalizeNibEmail } from '@/lib/utils';
import { getFirstAccessiblePage } from '@/app/actions/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { getBackgroundImages } from '@/app/actions/settings';

const adColors = [
  { primary: '#d4af37', secondary: '#8b5e34' },
  { primary: '#c5a059', secondary: '#5f432a' },
  { primary: '#b8860b', secondary: '#4a3728' },
  { primary: '#daa520', secondary: '#704214' },
];

const loginSchema = z.object({
  email: z.string().min(1, 'Email or Username is required.'),
  password: z.string().min(1, 'Password is required.'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [lockoutTimeLeft, setLockoutTimeLeft] = useState<number | null>(null);
  
  const [backgrounds, setBackgrounds] = useState<string[]>(['/bg.jpeg']);
  const [currentBgIndex, setCurrentBgIndex] = useState(0);

  useEffect(() => {
    async function fetchBackgrounds() {
        const images = await getBackgroundImages();
        if (images && images.length > 0) {
            setBackgrounds(images);
        }
    }
    fetchBackgrounds();
  }, []);

  useEffect(() => {
    if (backgrounds.length <= 1) return;
    
    const interval = setInterval(() => {
        setCurrentBgIndex((prev) => (prev + 1) % backgrounds.length);
    }, 8000); // Change image every 8 seconds

    return () => clearInterval(interval);
  }, [backgrounds]);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    watch,
    trigger
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: searchParams.get('email') || '',
      password: '',
    }
  });

  const email = watch('email');

  const checkLockout = useCallback(async (currentEmail: string) => {
    if (!currentEmail) return;
    const lockoutStatus = await getUserLockoutStatus(currentEmail);
    if (lockoutStatus?.lockoutUntil) {
        const lockoutDate = new Date(lockoutStatus.lockoutUntil);
        const now = new Date();
        if (now < lockoutDate) {
            const timeLeft = Math.ceil((lockoutDate.getTime() - now.getTime()) / 1000);
            setLockoutTimeLeft(timeLeft);
        } else {
            setLockoutTimeLeft(null);
        }
    } else {
        setLockoutTimeLeft(null);
    }
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (lockoutTimeLeft !== null && lockoutTimeLeft > 0) {
      timer = setInterval(() => {
        setLockoutTimeLeft(prev => (prev ? prev - 1 : 0));
      }, 1000);
    } else if (lockoutTimeLeft === 0) {
        setLockoutTimeLeft(null); // Unlock
    }
    return () => clearInterval(timer);
  }, [lockoutTimeLeft]);
  

  const callbackUrl = searchParams.get('callbackUrl');

  useEffect(() => {
    const error = searchParams.get('error');
    if (error === 'SessionExpired') {
        toast.warning('Session Expired', {
            description: 'You have been logged out due to inactivity. Please log in again.',
        });
        router.replace('/login', {scroll: false});
    } else if (error && error !== 'CredentialsSignin') { // Handle NextAuth's generic error
        toast.error('Login Failed', {
            description: error,
        });
        router.replace('/login', {scroll: false});
    }
  }, [searchParams, router]);


  const onSubmit = async (data: LoginFormData) => {
    const identifier = data.email.trim();

    await checkLockout(identifier);
    if (lockoutTimeLeft && lockoutTimeLeft > 0) {
        return;
    }

    setLoading(true);

    const result = await signIn('credentials', {
      redirect: false,
      identifier,
      password: data.password,
    });

    setLoading(false);

    if (result?.error) {
      await checkLockout(identifier);
      toast.error('Login Failed', {
        description: result.error,
      });
    } else if (result?.ok) {
      const destination = await getFirstAccessiblePage(callbackUrl);
      window.location.replace(destination);
    }
  };
  
  const isLocked = lockoutTimeLeft !== null && lockoutTimeLeft > 0;
  const minutes = Math.floor(lockoutTimeLeft! / 60);
  const seconds = lockoutTimeLeft! % 60;


  const currentColors = adColors[currentBgIndex % adColors.length];

  return (
      <div className="relative min-h-screen w-full overflow-hidden bg-[#fdfbf7] dark:bg-[#0a0a0a]">
          {/* Split Background Layer */}
          <div className="absolute inset-0 z-0 flex w-full h-full">
            {/* Left Side: Branded Illustration with Ambient Honey Highlights */}
            <div className="relative w-full lg:w-[60%] h-full overflow-hidden">
                {/* Minimalist Hexagonal Illustration - Non-continuous & Effective */}
                <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="honey-fade" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={currentColors.primary} stopOpacity="0.08" />
                            <stop offset="50%" stopColor={currentColors.secondary} stopOpacity="0.03" />
                            <stop offset="100%" stopColor={currentColors.primary} stopOpacity="0.08" />
                        </linearGradient>
                        
                        <symbol id="single-hex" viewBox="0 0 56 64">
                            <path 
                                d="M28 0L56 16V48L28 64L0 48V16Z" 
                                fill="currentColor"
                                stroke="currentColor"
                                strokeWidth="0.5"
                            />
                        </symbol>
                    </defs>

                    {/* Background Subtle Wash */}
                    <rect width="100%" height="100%" fill="url(#honey-fade)" />

                    {/* Ambient Honey Highlights - Very subtle animated glows */}
                    <motion.circle 
                        cx="10%"
                        cy="10%"
                        animate={{ 
                            cx: ["10%", "30%", "10%"],
                            cy: ["10%", "20%", "10%"],
                            opacity: [0.03, 0.06, 0.03],
                            fill: [currentColors.primary, currentColors.secondary, currentColors.primary]
                        }}
                        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
                        r="300" filter="blur(100px)" 
                    />
                    <motion.circle 
                        cx="50%"
                        cy="80%"
                        animate={{ 
                            cx: ["50%", "40%", "50%"],
                            cy: ["80%", "70%", "80%"],
                            opacity: [0.02, 0.05, 0.02],
                            fill: [currentColors.secondary, currentColors.primary, currentColors.secondary]
                        }}
                        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
                        r="250" filter="blur(120px)" 
                    />

                    {/* Dispersed Hexagonal Clusters - Carefully positioned for balance */}
                    {/* Top Left Group - Larger and with Icon */}
                    <g className="text-[#d4af37]/20 dark:text-[#d4af37]/15" transform="translate(60, 60) scale(1.5)">
                        <use href="#single-hex" x="0" y="0" width="56" height="64" className="opacity-40" />
                        <use href="#single-hex" x="42" y="24" width="56" height="64" className="opacity-20" />
                        <foreignObject x="12" y="16" width="32" height="32" className="opacity-60">
                            <div className="flex items-center justify-center w-full h-full text-primary">
                                <FileText size={20} />
                            </div>
                        </foreignObject>
                    </g>

                    {/* Middle Left Cluster - Larger with Send Icon */}
                    <g className="text-[#8b5e34]/15 dark:text-[#8b5e34]/10" transform="translate(180, 350) scale(2)">
                        <use href="#single-hex" x="0" y="0" width="56" height="64" className="opacity-30" />
                        <use href="#single-hex" x="-42" y="24" width="56" height="64" className="opacity-15" />
                        <use href="#single-hex" x="0" y="48" width="56" height="64" className="opacity-10" />
                        <foreignObject x="12" y="16" width="32" height="32" className="opacity-50">
                            <div className="flex items-center justify-center w-full h-full text-primary">
                                <Send size={18} />
                            </div>
                        </foreignObject>
                    </g>

                    {/* Middle Right - New Cluster with Inbox Icon */}
                    <g className="text-[#d4af37]/15 dark:text-[#d4af37]/10" transform="translate(450, 200) scale(1.8)">
                        <use href="#single-hex" x="0" y="0" width="56" height="64" className="opacity-25" />
                        <use href="#single-hex" x="42" y="-24" width="56" height="64" className="opacity-15" />
                        <foreignObject x="12" y="16" width="32" height="32" className="opacity-40">
                            <div className="flex items-center justify-center w-full h-full text-primary">
                                <Inbox size={18} />
                            </div>
                        </foreignObject>
                    </g>

                    {/* Bottom Right Focus (Near Split) - Larger with Layers Icon */}
                    <g className="text-[#d4af37]/25 dark:text-[#d4af37]/20" transform="translate(650, 600) scale(2.2)">
                        <use href="#single-hex" x="0" y="0" width="56" height="64" className="opacity-40" />
                        <use href="#single-hex" x="42" y="-24" width="56" height="64" className="opacity-25" />
                        <foreignObject x="12" y="16" width="32" height="32" className="opacity-50">
                            <div className="flex items-center justify-center w-full h-full text-primary">
                                <Layers size={16} />
                            </div>
                        </foreignObject>
                    </g>

                    {/* Bottom Left - New Cluster with Bell Icon */}
                    <g className="text-[#8b5e34]/15 dark:text-[#8b5e34]/10" transform="translate(100, 700) scale(1.4)">
                        <use href="#single-hex" x="0" y="0" width="56" height="64" className="opacity-30" />
                        <use href="#single-hex" x="-42" y="-24" width="56" height="64" className="opacity-15" />
                        <foreignObject x="12" y="16" width="32" height="32" className="opacity-40">
                            <div className="flex items-center justify-center w-full h-full text-primary">
                                <Bell size={16} />
                            </div>
                        </foreignObject>
                    </g>
                </svg>

                {/* Spreading Dynamic Gradient Separator - Enhanced for "Beautiful Effect" */}
                <div className="absolute inset-y-0 right-0 w-80 z-10 pointer-events-none">
                    {/* Primary Glow */}
                    <motion.div 
                        animate={{ 
                            background: [
                                `linear-gradient(to left, ${currentColors.primary}66, ${currentColors.primary}33, transparent)`,
                                `linear-gradient(to left, ${currentColors.secondary}66, ${currentColors.secondary}33, transparent)`,
                                `linear-gradient(to left, ${currentColors.primary}66, ${currentColors.primary}33, transparent)`
                            ]
                        }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 blur-[60px] opacity-60" 
                    />
                    
                    {/* Secondary Accent Glow - Shifting offset */}
                    <motion.div 
                        animate={{ 
                            background: [
                                `linear-gradient(to left, ${currentColors.secondary}44, transparent)`,
                                `linear-gradient(to left, ${currentColors.primary}44, transparent)`,
                                `linear-gradient(to left, ${currentColors.secondary}44, transparent)`
                            ],
                            x: [0, -20, 0]
                        }}
                        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 blur-[100px] opacity-40 scale-110" 
                    />

                    {/* Core "Light" Beam - Very soft, focused at the edge */}
                    <motion.div 
                        animate={{ 
                            backgroundColor: [currentColors.primary, currentColors.secondary, currentColors.primary],
                            opacity: [0.3, 0.5, 0.3]
                        }}
                        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-y-0 right-0 w-1 blur-[20px] z-20"
                    />
                </div>
                
                {/* Refined Fade Transition */}
                <div className="absolute inset-y-0 right-0 w-64 bg-gradient-to-l from-[#fdfbf7] via-[#fdfbf7]/60 to-transparent dark:from-[#0a0a0a] dark:via-[#0a0a0a]/60 dark:to-transparent z-20" />
            </div>

            {/* Right Side: Full Split Ad Carousel */}
            <div className="hidden lg:block lg:w-[40%] h-full relative overflow-hidden border-l border-white/20 dark:border-white/5">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={backgrounds[currentBgIndex]}
                        initial={{ opacity: 0, scale: 1.1 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="absolute inset-0"
                    >
                        <div 
                            className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-[20s] hover:scale-105"
                            style={{ backgroundImage: `url("${backgrounds[currentBgIndex]}")` }}
                        />
                        {/* Branded Wash Overlay for the ad split */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-white/10" />
                        
                        {/* Ad Content Overlay - Optional: Add text or branding if needed */}
                        <div className="absolute bottom-12 right-12 flex gap-3 z-30">
                            {backgrounds.map((_, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentBgIndex(idx)}
                                    className={`h-1 rounded-full transition-all duration-500 ${
                                        idx === currentBgIndex ? "w-8 bg-white" : "w-2 bg-white/30 hover:bg-white/50"
                                    }`}
                                    aria-label={`Go to slide ${idx + 1}`}
                                />
                            ))}
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>

        {/* Branded Badge - Hanging Shield (Top Left) */}
        <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
            className="absolute top-0 left-8 md:left-12 z-40 pointer-events-none select-none group hidden sm:block"
        >
            <div className="relative flex flex-col items-center">
                <div className="w-1.5 h-1.5 rounded-full bg-primary border border-white/20 dark:border-white/10 shadow-sm z-30" />
                <div className="w-px h-16 bg-gradient-to-b from-primary via-primary/40 to-transparent" />
                <div
                    className="relative -mt-0.5 flex flex-col items-center justify-center w-16 h-20 bg-primary shadow-2xl transition-all duration-500 hover:scale-105"
                    style={{
                        clipPath: 'polygon(0% 0%, 100% 0%, 100% 85%, 50% 100%, 0% 85%)',
                    }}
                >
                    <div className="flex flex-col items-center gap-0.5 z-10 px-1 text-center">
                        <span className="text-[6px] font-bold text-white/80 leading-none uppercase tracking-widest">System by</span>
                        <h3 className="text-sm font-black text-white tracking-widest drop-shadow-lg">EPMO</h3>
                    </div>
                </div>
            </div>
        </motion.div>

        {/* Main Content Layer - Positioned to the left of center */}
        <div className="relative z-20 flex min-h-screen w-full items-center justify-start p-6 md:p-12 lg:p-24">
            <div className="flex w-full items-center justify-start max-w-[1800px] mx-auto lg:pl-[10%] xl:pl-[15%]">
                
                {/* Login Card Container - Left Aligned & Slightly Larger View */}
                <div className="w-full max-w-[480px] shrink-0 relative">
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                    >
                        <Card className="border-primary/20 dark:border-primary/30 bg-card/70 dark:bg-black/60 backdrop-blur-xl shadow-[0_0_50px_-12px_rgba(var(--primary),0.2)] dark:shadow-[0_0_50px_-12px_rgba(0,0,0,0.8)] text-foreground dark:text-white relative overflow-hidden group ring-1 ring-primary/5">
                            {/* Central Glow */}
                            <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-primary/10 via-transparent to-transparent z-0" />
                            
                            <CardHeader className="text-center relative z-10 pt-10 pb-6">
                                <div className="mb-6 flex justify-center scale-110 transition-transform duration-500 group-hover:scale-115">
                                    <Logo layout="vertical" />
                                </div>
                                <CardTitle className="text-3xl font-bold tracking-tight mb-1">Welcome Back</CardTitle>
                                <CardDescription className="text-muted-foreground dark:text-white/60 text-base">Please use your Email credentials to access this account.</CardDescription>
                            </CardHeader>

                            <CardContent className="relative z-10 px-8 pb-10">
                                {isLocked && (
                                    <Alert variant="destructive" className="mb-6 bg-destructive/10 border-destructive/50 text-destructive dark:text-red-200">
                                        <ShieldAlert className="h-4 w-4" />
                                        <AlertTitle>Account Locked</AlertTitle>
                                        <AlertDescription>
                                            Try again in 
                                            <span className="font-bold ml-1">
                                                {minutes > 0 && `${minutes}m `}{seconds > 0 && `${seconds}s`}
                                            </span>.
                                        </AlertDescription>
                                    </Alert>
                                )}
                                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                                    <fieldset disabled={loading} className="flex flex-col gap-6">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 text-foreground/80 dark:text-white/80 ml-1">
                                                <Mail className="h-4 w-4" />
                                                <Label htmlFor="email" className="text-sm font-medium tracking-wide">Phone or Email</Label>
                                            </div>
                                            <Input
                                                id="email"
                                                type="text"
                                                placeholder="09xxxxxxxx or you@example.com"
                                                {...register('email')}
                                                className="h-12 bg-background/50 dark:bg-white/5 border-2 border-primary/30 dark:border-primary/40 text-foreground dark:text-white placeholder:text-muted-foreground/50 dark:placeholder:text-white/30 focus-visible:border-primary focus-visible:ring-0 focus-visible:outline-none transition-all px-4 shadow-sm"
                                            />
                                            {errors.email && <p className="text-xs text-destructive dark:text-red-400 mt-1 ml-1">{errors.email.message}</p>}
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 text-foreground/80 dark:text-white/80 ml-1">
                                                <Lock className="h-4 w-4" />
                                                <Label htmlFor="password" name="password" className="text-sm font-medium tracking-wide">Password</Label>
                                            </div>
                                            <div className="relative">
                                                <Input
                                                    id="password"
                                                    type={showPassword ? 'text' : 'password'}
                                                    placeholder="••••••••"
                                                    {...register('password')}
                                                    className="h-12 bg-background/50 dark:bg-white/5 border-2 border-primary/30 dark:border-primary/40 text-foreground dark:text-white placeholder:text-muted-foreground/50 dark:placeholder:text-white/30 focus-visible:border-primary focus-visible:ring-0 focus-visible:outline-none transition-all pr-12 px-4 shadow-sm"
                                                />
                                                <button
                                                    type="button"
                                                    className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground/60 dark:text-white/40 hover:text-foreground dark:hover:text-white transition-colors"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                >
                                                    {showPassword ? (
                                                        <EyeOff className="h-5 w-5" />
                                                    ) : (
                                                        <Eye className="h-5 w-5" />
                                                    )}
                                                </button>
                                            </div>
                                            {errors.password && (
                                                <p className="text-xs text-destructive dark:text-red-400 mt-1 ml-1">{errors.password.message}</p>
                                            )}
                                            <div className="flex justify-end">
                                                <Link
                                                    href="/forgot-password"
                                                    className="text-xs font-medium text-primary hover:underline"
                                                >
                                                    Forgot password?
                                                </Link>
                                            </div>
                                        </div>
                                        <Button
                                            type="submit"
                                            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base shadow-xl shadow-primary/20 transition-all active:scale-[0.98] group/btn mt-1" 
                                            disabled={loading}
                                        >
                                            {loading ? (
                                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                            ) : (
                                                <div className="flex items-center justify-center">
                                                    Sign In
                                                    <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover/btn:translate-x-1" />
                                                </div>
                                            )}
                                        </Button>
                                    </fieldset>
                                </form>
                            </CardContent>
                        </Card>

                        {/* Footer info - Centered */}
                        <div className="mt-8 text-muted-foreground dark:text-white/40 text-xs flex flex-col items-center gap-3">
                            <p className="tracking-widest uppercase font-medium">© {new Date().getFullYear()} NIB. All rights reserved.</p>
                        </div>
                    </motion.div>
                </div>
            </div>
        </div>
    </div>
  );
}
