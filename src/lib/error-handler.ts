import { toast } from "sonner";
import { signOut } from "next-auth/react";
import { getClientBaseUrl } from "@/lib/url";

interface ErrorData {
  name?: string;
  message?: string;
}

// Substrings that indicate the user's session is no longer valid, whether the
// server threw our own NotAuthenticatedError or a lower-level auth/session error
// (e.g. NextAuth's "No session", a stale "jwt expired", or Next.js failing to
// locate a server action because the client bundle is from a previous deploy).
const SESSION_INVALID_PATTERNS = [
  "not authenticated",
  "no session",
  "unauthorized",
  "unauthenticated",
  "jwt expired",
  "invalid session",
  "session expired",
  "failed to find server action",
];

function isSessionInvalidError(err: ErrorData): boolean {
  const haystack = `${err.name ?? ""} ${err.message ?? ""}`.toLowerCase();
  return SESSION_INVALID_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export function handleActionError(error: unknown, fallbackTitle = "Error") {
  let errorMessage = "An unexpected error occurred.";

  if (typeof error === "string") {
    if (isSessionInvalidError({ message: error })) {
      toast.error("Session Expired", {
        description: "Your session is no longer valid. Please log in again to continue.",
        duration: 5000,
      });
      if (typeof window !== "undefined") {
        signOut({ redirect: false }).finally(() => { window.location.href = `${getClientBaseUrl()}/login?error=SessionExpired`; });
      }
      return;
    }
    errorMessage = error;
  } else if (error && typeof error === "object" && "message" in error) {
    const err = error as ErrorData;
    if (err.name === "AccessDeniedError" || err.message?.includes("Access Denied")) {
      errorMessage = err.message || "Access Denied: You do not have the required permissions.";
      toast.error("Access Denied", { description: errorMessage, duration: 5000 });
      return;
    } else if (err.name === "NotAuthenticatedError" || isSessionInvalidError(err)) {
      toast.error("Session Expired", {
        description: "Your session is no longer valid. Please log in again to continue.",
        duration: 5000,
      });
      if (typeof window !== "undefined") {
        signOut({ redirect: false }).finally(() => { window.location.href = `${getClientBaseUrl()}/login?error=SessionExpired`; });
      }
      return;
    } else if (err.name === "NotFoundError" || err.message?.includes("Not found")) {
      errorMessage = err.message || "The requested resource was not found.";
    } else if (err.message) {
      errorMessage = err.message;
    }
  }

  toast.error(fallbackTitle, { description: errorMessage, duration: 5000 });
}
