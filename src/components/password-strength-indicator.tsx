
'use client';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PasswordRule {
    text: string;
    regex: RegExp;
}

interface PasswordStrengthIndicatorProps {
    password?: string;
    rules: PasswordRule[];
}

export function PasswordStrengthIndicator({ password, rules }: PasswordStrengthIndicatorProps) {
    if (!password) {
        return null;
    }

    return (
        <div className="space-y-1 p-3 bg-muted/50 rounded-md border border-dashed">
            <p className="text-xs font-semibold text-muted-foreground">Password must contain:</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                {rules.map((rule, index) => {
                    const isValid = rule.regex.test(password);
                    return (
                        <li key={index} className="flex items-center text-xs">
                            {isValid ? (
                                <Check className="h-3 w-3 mr-1.5 text-green-500" />
                            ) : (
                                <X className="h-3 w-3 mr-1.5 text-destructive" />
                            )}
                            <span className={cn(isValid ? 'text-muted-foreground' : 'text-foreground')}>{rule.text}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
