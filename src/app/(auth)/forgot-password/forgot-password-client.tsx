'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Loader2, Mail, ArrowLeft, CheckCircle2, KeyRound } from 'lucide-react';
import Logo from '@/components/logo';
import { requestPasswordReset } from '@/app/actions/auth';

const schema = z.object({
  email: z.string().min(1, 'Email or username is required'),
});
type FormData = z.infer<typeof schema>;

export default function ForgotPasswordClient() {
  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      await requestPasswordReset(data.email);
    } finally {
      setLoading(false);
      setSubmitted(true); // Always show success — never reveal whether the address is registered
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fdfbf7] dark:bg-[#0a0a0a] p-4">
        <Card className="w-full max-w-md border-green-200 dark:border-green-900/50 bg-white/80 dark:bg-black/70">
          <CardHeader className="text-center pt-10 pb-4">
            <div className="flex justify-center mb-6">
              <Logo layout="vertical" />
            </div>
            <div className="flex justify-center mb-3">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
            </div>
            <CardTitle className="text-2xl font-bold">Check Your Email</CardTitle>
          </CardHeader>
          <CardContent className="text-center px-8 pb-10">
            <p className="text-muted-foreground mb-2">
              If an account is registered for that address you will receive a
              password-reset link shortly.
            </p>
            <p className="text-sm text-muted-foreground/70 mb-8">
              The link expires in <strong>1 hour</strong> and can only be used once.
              Check your spam folder if you don't see the email.
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Login
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#fdfbf7] dark:bg-[#0a0a0a] p-4">
      <div className="w-full max-w-md">
        <Card className="border-primary/20 dark:border-primary/30 bg-white/80 dark:bg-black/70 backdrop-blur-xl shadow-[0_0_50px_-12px_rgba(var(--primary),0.2)] dark:shadow-[0_0_50px_-12px_rgba(0,0,0,0.8)] text-foreground dark:text-white relative overflow-hidden">
          <CardHeader className="text-center pt-10 pb-6">
            <div className="mb-6 flex justify-center scale-110 transition-transform duration-500">
              <Logo layout="vertical" />
            </div>
            <div className="flex justify-center mb-3">
              <KeyRound className="h-8 w-8 text-primary/60" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight mb-1">
              Reset Password
            </CardTitle>
            <CardDescription className="text-muted-foreground dark:text-white/60 text-base mt-1">
              Enter your email address and we&apos;ll send a reset link.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-8 pb-10">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <fieldset disabled={loading} className="flex flex-col gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-foreground/80 dark:text-white/80 ml-1">
                    <Mail className="h-4 w-4" />
                    <Label
                      htmlFor="email"
                      className="text-sm font-medium tracking-wide"
                    >
                      Email Address
                    </Label>
                  </div>
                  <Input
                    id="email"
                    type="text"
                    placeholder="firstname.lastname or firstname.lastname@nibbank.com.et"
                    {...register('email')}
                    className="h-12 bg-background/50 dark:bg-white/5 border-2 border-primary/30 dark:border-primary/40 text-foreground dark:text-white placeholder:text-muted-foreground/50 dark:placeholder:text-white/30 focus-visible:border-primary focus-visible:ring-0 focus-visible:outline-none transition-all px-4 shadow-sm"
                  />
                  {errors.email && (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1 ml-1">
                      {errors.email.message}
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
                    'Send Reset Link'
                  )}
                </Button>
              </fieldset>
            </form>

            <div className="mt-6 text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground dark:text-white/50 dark:hover:text-white/90 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Login
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 text-muted-foreground dark:text-white/40 text-xs text-center">
          <p className="tracking-widest uppercase font-medium">
            © {new Date().getFullYear()} NIB. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
