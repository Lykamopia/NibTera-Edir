'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { handleActionError } from '@/lib/error-handler';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Eye, EyeOff, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { changePassword } from '@/app/actions/auth';

const PASSWORD_REQUIREMENTS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character (!@#$%^&*)', test: (p: string) => /[!@#$%^&*]/.test(p) },
] as const;

const newPasswordSchema = z.string()
  .min(8, 'At least 8 characters')
  .regex(/[A-Z]/, 'At least one uppercase letter')
  .regex(/[a-z]/, 'At least one lowercase letter')
  .regex(/[0-9]/, 'At least one number')
  .regex(/[!@#$%^&*]/, 'At least one special character (!@#$%^&*)');

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: newPasswordSchema,
  confirmPassword: z.string().min(1, 'Please confirm your new password'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'New password must be different from your current password',
  path: ['newPassword'],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

function PasswordStrengthIndicator({ password }: { password: string }) {
  if (!password) return null;
  const results = PASSWORD_REQUIREMENTS.map((r) => r.test(password));
  const score = results.filter(Boolean).length;

  const barColor =
    score <= 2 ? 'bg-red-500' :
    score <= 3 ? 'bg-amber-500' :
    score <= 4 ? 'bg-blue-500' : 'bg-green-500';

  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex gap-1">
        {PASSWORD_REQUIREMENTS.map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-200',
              i < score ? barColor : 'bg-muted',
            )}
          />
        ))}
      </div>
      <ul className="space-y-0.5">
        {PASSWORD_REQUIREMENTS.map((req, i) => (
          <li
            key={i}
            className={cn(
              'flex items-center gap-1.5 text-xs transition-colors',
              results[i] ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground/70',
            )}
          >
            {results[i] ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
            {req.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChangePasswordForm() {
  const [loading, setLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ChangePasswordFormData>({ resolver: zodResolver(changePasswordSchema) });

  const newPasswordValue = watch('newPassword') ?? '';

  const onSubmit = async (data: ChangePasswordFormData) => {
    setLoading(true);
    try {
      const result = await changePassword(data.currentPassword, data.newPassword);
      if (result.success) {
        toast.success('Password changed', {
          description: 'Your password has been updated. Please sign in again.',
        });
        reset();
        setTimeout(() => {
          signOut({ callbackUrl: `${window.location.origin}/login` });
        }, 1500);
      } else {
        toast.error('Could not change password', { description: result.error });
      }
    } catch (error: any) {
      handleActionError(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Change Password</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Update your password. You&apos;ll be signed out of all devices afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
          <fieldset disabled={loading} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword" className="text-xs sm:text-sm">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrent ? 'text' : 'password'}
                  className="text-sm pr-10"
                  {...register('currentPassword')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowCurrent(!showCurrent)}
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.currentPassword && (
                <p className="text-xs text-red-500">{errors.currentPassword.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newPassword" className="text-xs sm:text-sm">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNew ? 'text' : 'password'}
                  className="text-sm pr-10"
                  {...register('newPassword')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowNew(!showNew)}
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.newPassword && (
                <p className="text-xs text-red-500">{errors.newPassword.message}</p>
              )}
              <PasswordStrengthIndicator password={newPasswordValue} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-xs sm:text-sm">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  className="text-sm pr-10"
                  {...register('confirmPassword')}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowConfirm(!showConfirm)}
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Password
              </Button>
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
