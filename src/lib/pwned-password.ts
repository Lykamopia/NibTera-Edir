'use server';

import { createHash } from 'crypto';

/**
 * Checks if a password has been exposed in a data breach using the k-Anonymity model of the Pwned Passwords API.
 * This function is safe to use as it only sends the first 5 characters of the SHA-1 hash of the password.
 * 
 * @param password The password to check.
 * @returns {Promise<boolean>} True if the password is pwned, false otherwise.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1Hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1Hash.substring(0, 5);
  const suffix = sha1Hash.substring(5);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.status === 404) {
      // No hashes found for this prefix, so it's not pwned.
      return false;
    }
    if (!response.ok) {
        // Any other error, we log it and fail open (assume not pwned).
        console.error(`Pwned Passwords API error: ${response.statusText}`);
        return false;
    }
    
    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
        const [hashSuffix] = line.split(':');
        if (hashSuffix === suffix) {
            return true;
        }
    }
    
    return false;

  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
        console.warn('Pwned Passwords API check timed out. Failing open for user.');
    } else {
        console.error('Error checking pwned password API:', error.message);
    }
    // Fail open: If the API is down, don't block the user.
    return false;
  }
}
