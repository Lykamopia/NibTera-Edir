
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  Loader2, Lock, Eye, EyeOff, CheckCircle, ArrowRight,
  Check, X, ArrowLeft,
} from 'lucide-react';
import Logo from '@/components/logo';
import { toast } from 'sonner';
import { verifyPasswordResetToken, setPassword } from '@/app/actions/auth';

// ── Password requirements ─────────────────────────────────────────────────────

const REQUIREMENTS = [
  { label: 'At least 8 characters',  test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter',   test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter',   test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number',             test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character',  test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

const passwordSchema = z
  .string()
  .min(8,           'At least 8 characters')
  .regex(/[A-Z]/,   'At least one uppercase letter')
  .regex(/[a-z]/,   'At least one lowercase letter')
  .regex(/[0-9]/,   'At least one number')
  .regex(/[^A-Za-z0-9]/, 'At least one special character');

const setPasswordSchema = z.object({
  password:        passwordSchema,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path:    ['confirmPassword'],
});

type SetPasswordFormData = z.infer<typeof setPasswordSchema>;

// ── Strength indicator ────────────────────────────────────────────────────────

function PasswordStrengthIndicator({ password }: { password: string }) {
  if (!password) return null;
  const results = REQUIREMENTS.map((r) => r.test(password));
  const score   = results.filter(Boolean).length;

  const barColor =
    score <= 2 ? 'bg-red-500' :
    score <= 3 ? 'bg-amber-500' :
    score <= 4 ? 'bg-blue-500'  : 'bg-green-500';

  return (
    <div className="mt-2.5 space-y-2">
      {/* Strength bar */}
      <div className="flex gap-1">
        {REQUIREMENTS.map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-200',
              i < score ? barColor : 'bg-muted',
            )}
          />
        ))}
      </div>
      {/* Requirement list */}
      <ul className="space-y-0.5">
        {REQUIREMENTS.map((req, i) => (
          <li
            key={i}
            className={cn(
              'flex items-center gap-1.5 text-xs transition-colors',
              results[i]
                ? 'text-green-600 dark:text-green-400'
                : 'text-muted-foreground/70',
            )}
          >
            {results[i]
              ? <Check className="h-3 w-3 shrink-0" />
              : <X     className="h-3 w-3 shrink-0" />}
            {req.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SetPasswordClient() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get('token');
  const isReset      = searchParams.get('mode') === 'reset';

  const [loading,             setLoading]             = useState(false);
  const [verifying,           setVerifying]           = useState(true);
  const [tokenValid,          setTokenValid]          = useState(false);
  const [tokenError,          setTokenError]          = useState('');
  const [showPassword,        setShowPassword]        = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSet,         setPasswordSet]         = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<SetPasswordFormData>({ resolver: zodResolver(setPasswordSchema) });

  const passwordValue = watch('password') ?? '';

  useEffect(() => {
    if (!token) {
      setTokenError('No token provided');
      setVerifying(false);
      return;
    }

    verifyPasswordResetToken(token).then((result) => {
      if (result.valid) {
        setTokenValid(true);
      } else {
        setTokenError(result.error ?? 'Invalid token');
      }
    }).catch(() => {
      setTokenError('An error occurred verifying the token');
    }).finally(() => setVerifying(false));
  }, [token]);

  const onSubmit = async (data: SetPasswordFormData) => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await setPassword(token, data.password);
      if (result.success) {
        setPasswordSet(true);
        toast.success(isReset ? 'Password reset successfully!' : 'Password set successfully!');
        setTimeout(() => router.push('/login'), 2000);
      } else {
        toast.error(result.error ?? 'Failed to set password');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (verifying) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fdfbf7] dark:bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verifying link…</p>
        </div>
      </div>
    );
  }

  // ── Invalid / expired token ───────────────────────────────────────────────

  if (!tokenValid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fdfbf7] dark:bg-[#0a0a0a] p-4">
        <Card className="w-full max-w-md border-red-200 dark:border-red-900/50 bg-white/80 dark:bg-black/70">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Logo layout="vertical" />
            </div>
            <CardTitle className="text-2xl">Invalid or Expired Link</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{tokenError}</AlertDescription>
            </Alert>
            <p className="text-muted-foreground mb-6">
              This link is either invalid or has already expired. Request a new one below.
            </p>
            <div className="flex flex-col gap-3">
              <Link href="/forgot-password">
                <Button className="w-full">Request a New Link</Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" className="w-full gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Login
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Success state ─────────────────────────────────────────────────────────

  if (passwordSet) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fdfbf7] dark:bg-[#0a0a0a] p-4">
        <Card className="w-full max-w-md border-green-200 dark:border-green-900/50 bg-white/80 dark:bg-black/70">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Logo layout="vertical" />
            </div>
            <CardTitle className="text-2xl">
              {isReset ? 'Password Reset!' : 'Password Set!'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <CheckCircle className="h-12 w-12 mx-auto text-green-600 mb-4" />
            <p className="text-muted-foreground mb-6">
              {isReset
                ? 'Your password has been reset successfully. Redirecting to login…'
                : 'Your password has been set. Redirecting to login…'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Password form ─────────────────────────────────────────────────────────

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#fdfbf7] dark:bg-[#0a0a0a] p-4">
      <div className="w-full max-w-md">
        <Card className="border-primary/20 dark:border-primary/30 bg-white/80 dark:bg-black/70 backdrop-blur-xl shadow-[0_0_50px_-12px_rgba(var(--primary),0.2)] dark:shadow-[0_0_50px_-12px_rgba(0,0,0,0.8)] text-foreground dark:text-white relative overflow-hidden">
          <CardHeader className="text-center pt-10 pb-6">
            <div className="mb-6 flex justify-center scale-110 transition-transform duration-500">
              <Logo layout="vertical" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight mb-1">
              {isReset ? 'Reset Your Password' : 'Set Your Password'}
            </CardTitle>
            {isReset && (
              <p className="text-sm text-muted-foreground dark:text-white/60 mt-1">
                Choose a strong new password for your account.
              </p>
            )}
          </CardHeader>

          <CardContent className="px-8 pb-10">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <fieldset disabled={loading} className="flex flex-col gap-6">

                {/* Password field */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-foreground/80 dark:text-white/80 ml-1">
                    <Lock className="h-4 w-4" />
                    <Label htmlFor="password" className="text-sm font-medium tracking-wide">
                      New Password
                    </Label>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Create a strong password"
                      {...register('password')}
                      className="h-12 bg-background/50 dark:bg-white/5 border-2 border-primary/30 dark:border-primary/40 text-foreground dark:text-white placeholder:text-muted-foreground/50 dark:placeholder:text-white/30 focus-visible:border-primary focus-visible:ring-0 focus-visible:outline-none transition-all px-4 shadow-sm pr-12"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground/60 dark:text-white/40 hover:text-foreground dark:hover:text-white transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1 ml-1">
                      {errors.password.message}
                    </p>
                  )}
                  <PasswordStrengthIndicator password={passwordValue} />
                </div>

                {/* Confirm password field */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-foreground/80 dark:text-white/80 ml-1">
                    <Lock className="h-4 w-4" />
                    <Label htmlFor="confirmPassword" className="text-sm font-medium tracking-wide">
                      Confirm Password
                    </Label>
                  </div>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Repeat your password"
                      {...register('confirmPassword')}
                      className="h-12 bg-background/50 dark:bg-white/5 border-2 border-primary/30 dark:border-primary/40 text-foreground dark:text-white placeholder:text-muted-foreground/50 dark:placeholder:text-white/30 focus-visible:border-primary focus-visible:ring-0 focus-visible:outline-none transition-all px-4 shadow-sm pr-12"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground/60 dark:text-white/40 hover:text-foreground dark:hover:text-white transition-colors"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1 ml-1">
                      {errors.confirmPassword.message}
                    </p>
                  )}
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
                      {isReset ? 'Reset Password' : 'Set Password'}
                      <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover/btn:translate-x-1" />
                    </div>
                  )}
                </Button>
              </fieldset>
            </form>

            {isReset && (
              <div className="mt-6 text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground dark:text-white/50 dark:hover:text-white/80 transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Login
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
