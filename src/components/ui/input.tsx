import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Client-side input constraints (VA-027). These are a usability layer that
 * mirrors the server-side zod schemas in src/lib/validation.ts — the server
 * remains the authority and re-validates everything.
 *
 * - Every text-like input gets a length cap by type unless the caller passes
 *   its own `maxLength`.
 * - `allow` restricts which characters can be typed or pasted:
 *     digits  → 0-9 only (account numbers, codes)
 *     phone   → 0-9 + ( ) - and space
 *     decimal → 0-9 and one "."
 * - type="email" gets a strict format pattern and is flagged invalid on blur.
 */
const DEFAULT_MAX_LENGTH: Record<string, number> = {
  text: 255,
  search: 100,
  email: 254,
  tel: 20,
  password: 128,
  url: 2048,
}

/** Mirrors zod's email check: local@domain.tld, no spaces or markup. */
export const EMAIL_PATTERN = "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9](?:[A-Za-z0-9\\-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9\\-]*[A-Za-z0-9])?)*\\.[A-Za-z]{2,}"
const EMAIL_RE = new RegExp(`^${EMAIL_PATTERN}$`)

type Allow = "digits" | "phone" | "decimal"

const FILTERS: Record<Allow, (v: string) => string> = {
  digits: (v) => v.replace(/\D/g, ""),
  phone: (v) => v.replace(/[^0-9+()\- ]/g, "").replace(/(?!^)\+/g, ""),
  decimal: (v) => {
    const cleaned = v.replace(/[^0-9.]/g, "")
    const dot = cleaned.indexOf(".")
    return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "")
  },
}

const INPUT_MODE: Record<Allow, React.HTMLAttributes<HTMLInputElement>["inputMode"]> = {
  digits: "numeric",
  phone: "tel",
  decimal: "decimal",
}

const ALLOW_PATTERN: Record<Allow, string> = {
  digits: "[0-9]*",
  // Browsers compile `pattern` with the `v` flag: ( ) - must be escaped in a class.
  phone: "\\+?[0-9 \\(\\)\\-]*",
  decimal: "[0-9]*(\\.[0-9]*)?",
}

export type InputProps = React.ComponentProps<"input"> & {
  /** Restrict the characters that can be entered. */
  allow?: Allow
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, allow, maxLength, pattern, inputMode, onChange, onBlur, ...props }, ref) => {
    const [emailInvalid, setEmailInvalid] = React.useState(false)
    const isEmail = type === "email"
    const effectiveType = type ?? "text"
    const effectiveMaxLength = maxLength ?? (allow ? 20 : DEFAULT_MAX_LENGTH[effectiveType])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (allow) {
        const filtered = FILTERS[allow](e.target.value)
        if (filtered !== e.target.value) e.target.value = filtered
      }
      if (isEmail && emailInvalid) setEmailInvalid(e.target.value !== "" && !EMAIL_RE.test(e.target.value.trim()))
      onChange?.(e)
    }

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      if (isEmail) {
        const v = e.target.value.trim()
        const bad = v !== "" && !EMAIL_RE.test(v)
        setEmailInvalid(bad)
        e.target.setCustomValidity(bad ? "Enter a valid email address (e.g. name@example.com)." : "")
      }
      onBlur?.(e)
    }

    const invalid = props["aria-invalid"] ?? (emailInvalid || undefined)

    return (
      <input
        type={type}
        maxLength={effectiveMaxLength}
        pattern={pattern ?? (allow ? ALLOW_PATTERN[allow] : isEmail ? EMAIL_PATTERN : undefined)}
        inputMode={inputMode ?? (allow ? INPUT_MODE[allow] : undefined)}
        autoCapitalize={isEmail ? "none" : props.autoCapitalize}
        spellCheck={isEmail ? false : props.spellCheck}
        title={props.title ?? (isEmail && emailInvalid ? "Enter a valid email address (e.g. name@example.com)." : undefined)}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
          className
        )}
        ref={ref}
        onChange={handleChange}
        onBlur={handleBlur}
        {...props}
        aria-invalid={invalid}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
