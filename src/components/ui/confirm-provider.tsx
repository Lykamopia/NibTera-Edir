'use client';

/**
 * App-wide imperative confirm/prompt dialogs backed by shadcn/ui — replacements
 * for the native window.confirm() / window.prompt() that must never appear.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete?', destructive: true }))) return;
 *
 *   const prompt = usePrompt();
 *   const reason = await prompt({ title: 'Reason', multiline: true }); // null = cancelled
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}
export interface PromptOptions {
  title?: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  required?: boolean;
  confirmText?: string;
  cancelText?: string;
}

type Ctx = { confirm: (o?: ConfirmOptions) => Promise<boolean>; prompt: (o?: PromptOptions) => Promise<string | null> };
const ConfirmContext = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<{ open: boolean; options: ConfirmOptions }>({ open: false, options: {} });
  const [promptState, setPromptState] = useState<{ open: boolean; options: PromptOptions }>({ open: false, options: {} });
  const [value, setValue] = useState('');
  const confirmResolver = useRef<((v: boolean) => void) | null>(null);
  const promptResolver = useRef<((v: string | null) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => {
    confirmResolver.current = resolve;
    setConfirmState({ open: true, options });
  }), []);

  const prompt = useCallback((options: PromptOptions = {}) => new Promise<string | null>((resolve) => {
    promptResolver.current = resolve;
    setValue(options.defaultValue ?? '');
    setPromptState({ open: true, options });
  }), []);

  const settleConfirm = (result: boolean) => { confirmResolver.current?.(result); confirmResolver.current = null; setConfirmState(s => ({ ...s, open: false })); };
  const settlePrompt = (result: string | null) => { promptResolver.current?.(result); promptResolver.current = null; setPromptState(s => ({ ...s, open: false })); };

  const co = confirmState.options;
  const po = promptState.options;
  const promptInvalid = !!po.required && value.trim().length === 0;

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}

      <AlertDialog open={confirmState.open} onOpenChange={(o) => { if (!o) settleConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{co.title ?? 'Are you sure?'}</AlertDialogTitle>
            {co.description && <AlertDialogDescription>{co.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleConfirm(false)}>{co.cancelText ?? 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settleConfirm(true)}
              className={cn(co.destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
            >
              {co.confirmText ?? 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={promptState.open} onOpenChange={(o) => { if (!o) settlePrompt(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{po.title ?? 'Enter a value'}</DialogTitle>
            {po.description && <DialogDescription>{po.description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-1.5">
            {po.label && <Label className="text-xs">{po.label}</Label>}
            {po.multiline
              ? <Textarea rows={3} value={value} placeholder={po.placeholder} autoFocus onChange={e => setValue(e.target.value)} />
              : <Input value={value} placeholder={po.placeholder} autoFocus onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !promptInvalid) settlePrompt(value); }} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => settlePrompt(null)}>{po.cancelText ?? 'Cancel'}</Button>
            <Button onClick={() => settlePrompt(value)} disabled={promptInvalid}>{po.confirmText ?? 'Submit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx.confirm;
}
export function usePrompt() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('usePrompt must be used within ConfirmProvider');
  return ctx.prompt;
}
