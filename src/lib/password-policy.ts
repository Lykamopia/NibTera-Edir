
import { z } from 'zod';
import { isPasswordPwned } from './pwned-password';
import { randomInt } from 'crypto';

export const passwordRules = [
    { text: "At least 8 characters", regex: /.{8,}/ },
    { text: "An uppercase letter", regex: /[A-Z]/ },
    { text: "A lowercase letter", regex: /[a-z]/ },
    { text: "A number", regex: /[0-9]/ },
    { text: "A special character (!@#$%^&*)", regex: /[!@#$%^&*]/ }
];

// Combine all regex into a single Zod schema for validation
export const passwordSchema = z.string()
    .min(8, { message: "Password must be at least 8 characters long." })
    .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter." })
    .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter." })
    .regex(/[0-9]/, { message: "Password must contain at least one number." })
    .regex(/[!@#$%^&*]/, { message: "Password must contain at least one special character (!@#$%^&*)." })
    .refine(async (password) => {
        const isPwned = await isPasswordPwned(password);
        return !isPwned;
    }, {
        message: "This password has been exposed in a data breach. Please choose a more secure password."
    });

// Function to generate a random password that meets the policy
export function generateStrongPassword(length = 12): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*';
    const allChars = uppercase + lowercase + numbers + special;

    let passwordChars: string[] = [];
    passwordChars.push(uppercase[randomInt(uppercase.length)]);
    passwordChars.push(lowercase[randomInt(lowercase.length)]);
    passwordChars.push(numbers[randomInt(numbers.length)]);
    passwordChars.push(special[randomInt(special.length)]);

    for (let i = 4; i < length; i++) {
        passwordChars.push(allChars[randomInt(allChars.length)]);
    }

    // Shuffle the password to ensure randomness using Fisher-Yates algorithm
    for (let i = passwordChars.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
    }
    
    return passwordChars.join('');
}
