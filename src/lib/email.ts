
import nodemailer from 'nodemailer';
import type { Memo, User, Role, Prisma } from './types';
import prisma from './prisma';
import { getEmailSettings, getGeneralSettings } from '@/app/actions/settings';
import { getBaseUrl } from './url';
const logoUrl = 'https://cdn.brandfetch.io/id3xwknDM-/w/2048/h/2048/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1769246323397';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 465,
  // Implicit TLS on 465; on other ports (e.g. 587) `secure: false` lets STARTTLS
  // upgrade the connection — `requireTLS` below makes that upgrade MANDATORY, so
  // mail is never transmitted in cleartext regardless of the port.
  secure: Number(process.env.EMAIL_PORT) === 465,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Without explicit timeouts, nodemailer defaults to ~2 minutes per phase, which
  // blocks request-handling actions (user creation, password reset, etc.) when the
  // SMTP host is unreachable. Fail fast so callers' try/catch fallbacks kick in quickly.
  connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS) || 10000,
  greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT_MS) || 10000,
  socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT_MS) || 10000,
  tls: {
    // Reject self-signed/invalid certs unless explicitly opted-in (dev only), and
    // never negotiate down to legacy, broken TLS versions.
    rejectUnauthorized: process.env.EMAIL_ALLOW_SELF_SIGNED !== 'true',
    minVersion: 'TLSv1.2',
  },
});

// Transient connection-level failures (e.g. brief network blips to the SMTP host)
// surface as ETIMEDOUT/ECONNRESET during the CONN phase. A short retry gives these
// a chance to recover instead of permanently dropping the email (e.g. the
// account-setup link sent on user creation, which has no user-facing retry button).
const RETRYABLE_ERROR_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNECTION', 'ESOCKET']);

async function sendMailWithRetry(mailOptions: Parameters<typeof transporter.sendMail>[0], retries = 2, delayMs = 2000) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await transporter.sendMail(mailOptions);
        } catch (error: any) {
            const isRetryable = RETRYABLE_ERROR_CODES.has(error?.code) && error?.command === 'CONN';
            if (!isRetryable || attempt >= retries) throw error;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

type EmailSettings = {
    notificationsEnabled: boolean;
    headerText: string;
    bodyText: string;
    footerText: string;
};

type GeneralSettings = {
    acknowledgementType: 'BADGE' | 'SIGNATURE';
};

interface MemoEmailOptions {
  to: string;
  subject: string;
  memo?: Memo;
  sender?: User & { role: Role | null };
  type?: 'direct' | 'cc' | 'acknowledged' | 'replied' | 'assigned';
  emailSettings: EmailSettings;
  generalSettings?: GeneralSettings;
  html?: string;
}

interface VerificationEmailOptions {
    to: string;
    name: string;
    token: string;
}

interface PasswordResetEmailOptions {
    to: string;
    name: string;
    token: string;
}

interface EmailChangeVerificationOptions {
    to: string; // new email
    name: string;
    token: string;
    userId: string;
}

interface EmailChangeNotificationOptions {
    to: string; // old email
    name: string;
    newEmail: string;
}

interface ConcurrentLoginNotificationOptions {
    to: string;
    name: string;
    ipAddress: string;
    userAgent: string;
}

async function logEmail(data: Omit<Prisma.EmailLogCreateInput, 'from'>) {
    try {
        await prisma.emailLog.create({
            data: {
                from: process.env.EMAIL_FROM || 'noreply@example.com',
                ...data
            }
        });
    } catch (logError) {
        console.error("Failed to log email:", logError);
    }
}


async function generateMemoEmailBody(
    memo: Memo, 
    sender: User & { role: Role | null }, 
    type: 'direct' | 'cc' | 'acknowledged' | 'replied' | 'assigned',
    emailSettings: EmailSettings,
    generalSettings: GeneralSettings
): Promise<string> {
    const { notificationsEnabled, headerText, bodyText, footerText } = emailSettings;
    if (!notificationsEnabled) {
        return '';
    }

    const memoUrl = `${getBaseUrl()}/dashboard/inbox?id=${memo.id}`;
    
    const senderNameWithRole = sender.title
        ? `${sender.name} <span style="font-size: 0.8em; font-style: italic; color: #666;">(${sender.title})</span>`
        : sender.role 
            ? `${sender.name} <span style="font-size: 0.8em; font-style: italic; color: #666;">(${sender.role.name})</span>`
            : sender.name;

    let notificationType = '';
    switch (type) {
        case 'direct':
            notificationType = `You have received a new memo from <strong>${senderNameWithRole}</strong>.`;
            break;
        case 'cc':
            notificationType = `You have been CC'd on a memo from <strong>${senderNameWithRole}</strong>.`;
            break;
        case 'acknowledged':
            notificationType = `Your memo (Ref: ${memo.memo_reference_number}) has been <strong>acknowledged</strong> by <strong>${senderNameWithRole}</strong>.`;
            break;
        case 'replied':
            notificationType = `A <strong>reply</strong> has been sent to your memo (Ref: ${memo.memo_reference_number}) by <strong>${senderNameWithRole}</strong>.`;
            break;
        case 'assigned':
            notificationType = `Your memo (Ref: ${memo.memo_reference_number}) has been <strong>assigned/forwarded</strong> by <strong>${senderNameWithRole}</strong>.`;
            break;
    }
    
    const processedBody = bodyText
        .replace(/{{notificationType}}/g, notificationType)
        .replace(/{{senderName}}/g, senderNameWithRole)
        .replace(/{{subject}}/g, memo.subject)
        .replace(/{{reference}}/g, memo.memo_reference_number || '')
        .replace(/{{memoUrl}}/g, memoUrl)
        .replace(/\n/g, '<br>');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${headerText}</title>
        <style>
            body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #f4f4f4; font-family: Arial, sans-serif; color: #333; }
            .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; }
            .header { background-color: hsl(0, 0, 100); padding: 20px; text-align: center; }
            .header img { max-width: 150px; }
            .content { padding: 30px; }
            .content h2 { font-size: 20px; color: #333; margin-top: 0; }
            .content p { font-size: 16px; line-height: 1.6; }
            .memo-details { background-color: #f9f9f9; border-left: 4px solid hsl(37, 100%, 48%); padding: 15px; margin: 20px 0; }
            .memo-details p { margin: 5px 0; font-size: 14px; }
            .button-container { text-align: center; margin: 30px 0; }
            .footer { padding: 20px; font-size: 12px; color: #777; text-align: center; background-color: #f1f1f1; }
        </style>
    </head>
    <body>
        <table width="100%" border="0" cellspacing="0" cellpadding="20" style="background-color: #f4f4f4;">
            <tr>
                <td>
                    <div class="container">
                        <div class="header">
                           <img src="${logoUrl}" alt="NibTera Edir Logo" style="width:60px;height:60px;display:block;margin:0 auto;">
                        </div>
                        <div class="content">
                            <h2>${headerText}</h2>
                            <p>${processedBody}</p>
                            
                            <div class="memo-details">
                                <p><strong>From:</strong> ${senderNameWithRole}</p>
                                <p><strong>Subject:</strong> ${memo.subject}</p>
                                <p><strong>Reference:</strong> ${memo.memo_reference_number}</p>
                            </div>

                            <div class="button-container">
                                <a href="${memoUrl}" style="display: inline-block; background-color: #9A4D1C; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px;">View Full Memo</a>
                            </div>
                            
                            <p>Thank you,</p>
                            <p>The NibTera Edir System</p>
                        </div>
                         <div class="footer">
                            <p>${footerText}</p>
                        </div>
                    </div>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
}

function generateAuthEmailBody(title: string, content: string): string {
    const { footerText } = { footerText: 'This is an automated message. Please do not reply.' };

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            body { margin: 0; padding: 0; width: 100% !important; background-color: #f4f4f4; font-family: Arial, sans-serif; color: #333; }
            .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; }
            .header { padding: 20px; text-align: center; }
            .header img { max-width: 150px; }
            .content { padding: 30px; }
            .content h2 { font-size: 20px; color: #333; margin-top: 0; }
            .content p { font-size: 16px; line-height: 1.6; }
            .credentials { background-color: #f9f9f9; border-left: 4px solid hsl(37, 100%, 48%); padding: 15px; margin: 20px 0; }
            .credentials p { margin: 5px 0; font-size: 14px; }
            .button-container { text-align: center; margin: 30px 0; }
            .footer { padding: 20px; font-size: 12px; color: #777; text-align: center; background-color: #f1f1f1; }
            code { background-color: #eee; padding: 2px 5px; border-radius: 3px; font-family: monospace; }
        </style>
    </head>
    <body>
        <table width="100%" border="0" cellspacing="0" cellpadding="20" style="background-color: #f4f4f4;">
            <tr>
                <td>
                    <div class="container">
                        <div class="header">
                           <img src="${logoUrl}" alt="NibTera Edir Logo" style="width:60px;height:60px;display:block;margin:0 auto;">
                        </div>
                        <div class="content">
                            <h2>${title}</h2>
                            ${content}
                        </div>
                         <div class="footer">
                            <p>${footerText}</p>
                        </div>
                    </div>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
}

export async function sendVerificationEmail({ to, name, token }: VerificationEmailOptions) {
    const verificationLink = `${getBaseUrl()}/set-password?token=${token}`;
    const expirationHours = 1;

    const title = "Welcome to NibTera Edir! Please Verify Your Account";
    const content = `
        <p>Hello ${name},</p>
        <p>An account has been created for you on the NibTera Edir platform. To get started, please set your password by clicking the link below.</p>
        <p>This link is valid for <strong>${expirationHours} hour</strong>.</p>
        <div class="button-container">
            <a href="${verificationLink}" style="background-color: #9A4D1C; color: #ffffff; display: inline-block; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px;">Set Your Password</a>
        </div>
        <p>If you did not request this, please ignore this email.</p>
    `;
    
    const htmlBody = generateAuthEmailBody(title, content);

    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: title,
        html: htmlBody,
    };

    try {
        const info = await sendMailWithRetry(mailOptions);
        const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'sent',
            triggerEvent: 'welcome_user',
            relatedEntityId: user?.id,
            messageId: info.messageId,
        });
        return info;
    } catch (error: any) {
        console.error('Error sending verification email:', error);
         const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'failed',
            triggerEvent: 'welcome_user',
            relatedEntityId: user?.id,
            errorMessage: error.message,
        });
        // Don't throw error so user creation can still succeed
        console.log('Email sending failed, but user creation will continue');
        return null;
    }
}

export async function sendPasswordResetEmail({ to, name, token }: PasswordResetEmailOptions) {
    const resetLink = `${getBaseUrl()}/set-password?token=${token}&mode=reset`;
    const expirationHours = 1;

    const title = "Your Password Reset Request";
    const content = `
        <p>Hello ${name},</p>
        <p>We received a request to reset your password for the NibTera Edir platform. You can reset your password by clicking the link below.</p>
        <p>This link is valid for <strong>${expirationHours} hour</strong>.</p>
        <div class="button-container">
            <a href="${resetLink}" style="background-color: #9A4D1C; color: #ffffff; display: inline-block; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px;">Reset Your Password</a>
        </div>
        <p>If you did not request a password reset, you can safely ignore this email.</p>
    `;

    const htmlBody = generateAuthEmailBody(title, content);
    
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: title,
        html: htmlBody,
    };

    try {
        const info = await sendMailWithRetry(mailOptions);
        const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'sent',
            triggerEvent: 'password_reset',
            relatedEntityId: user?.id,
            messageId: info.messageId,
        });
        return info;
    } catch (error: any) {
        console.error('Error sending password reset email:', error);
        const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'failed',
            triggerEvent: 'password_reset',
            relatedEntityId: user?.id,
            errorMessage: error.message,
        });
        throw error;
    }
}

export async function sendEmailChangeVerificationEmail({ to, name, token, userId }: EmailChangeVerificationOptions) {
    const verificationLink = `${getBaseUrl()}/verify-email?token=${token}`;
    const expirationHours = 1;

    const title = "Confirm Your New Email Address";
    const content = `
        <p>Hello ${name},</p>
        <p>You requested to change your email address for the NibTera Edir platform to this one. Please confirm this change by clicking the link below.</p>
        <p>This link is valid for <strong>${expirationHours} hour</strong>.</p>
        <div class="button-container">
            <a href="${verificationLink}" style="background-color: #9A4D1C; color: #ffffff; display: inline-block; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px;">Confirm New Email</a>
        </div>
        <p>If you did not request this change, you can safely ignore this email.</p>
    `;
    
    const htmlBody = generateAuthEmailBody(title, content);

    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: title,
        html: htmlBody,
    };

    try {
        const info = await sendMailWithRetry(mailOptions);
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'sent',
            triggerEvent: 'email_change_verification',
            relatedEntityId: userId,
            messageId: info.messageId,
        });
        return info;
    } catch (error: any) {
        console.error('Error sending email change verification:', error);
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'failed',
            triggerEvent: 'email_change_verification',
            relatedEntityId: userId,
            errorMessage: error.message,
        });
        throw error;
    }
}

export async function sendEmailChangeNotificationEmail({ to, name, newEmail }: EmailChangeNotificationOptions) {
    const title = "Email Change Request for Your NibTera Edir Account";
    const content = `
        <p>Hello ${name},</p>
        <p>This is a notification that a request has been made to change the email address associated with your NibTera Edir account to <strong>${newEmail}</strong>.</p>
        <p>A verification email has been sent to the new address. Your email will not be changed until it is verified.</p>
        <p><strong>If you did not make this request, please change your password immediately and contact an administrator.</strong></p>
    `;

    const htmlBody = generateAuthEmailBody(title, content);
    
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: title,
        html: htmlBody,
    };

    try {
        const info = await sendMailWithRetry(mailOptions);
        const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'sent',
            triggerEvent: 'email_change_notice',
            relatedEntityId: user?.id,
            messageId: info.messageId,
        });
        return info;
    } catch (error: any) {
        console.error('Error sending email change notification:', error);
        await logEmail({
            to: to,
            subject: title,
            body: htmlBody,
            status: 'failed',
            triggerEvent: 'email_change_notice',
            relatedEntityId: (await prisma.user.findUnique({ where: { email: to } }))?.id,
            errorMessage: error.message,
        });
        throw error;
    }
}

export async function sendConcurrentLoginNotification({ to, name, ipAddress, userAgent }: ConcurrentLoginNotificationOptions) {
    const title = "New Login Detected for Your NibTera Edir Account";
    const content = `
        <p>Hello ${name},</p>
        <p>This is a security notification that a new login attempt was made for your NibTera Edir account while you have an active session.</p>
        <p><strong>Login Details:</strong></p>
        <ul>
            <li><strong>IP Address:</strong> ${ipAddress}</li>
            <li><strong>User Agent:</strong> ${userAgent}</li>
            <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
        </ul>
        <p>If this was you, you can safely ignore this email. Your previous session may have been invalidated depending on security policies.</p>
        <p><strong>If you did not make this login attempt, please change your password immediately and contact an administrator.</strong></p>
    `;

    const htmlBody = generateAuthEmailBody(title, content);
    
    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: title,
        html: htmlBody,
    };

    try {
        const info = await sendMailWithRetry(mailOptions);
        const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({
            to,
            subject: title,
            body: htmlBody,
            status: 'sent',
            triggerEvent: 'concurrent_login_notice',
            relatedEntityId: user?.id,
            messageId: info.messageId,
        });
        return info;
    } catch (error: any) {
        console.error('Error sending concurrent login notification:', error);
        await logEmail({
            to: to,
            subject: title,
            body: htmlBody,
            status: 'failed',
            triggerEvent: 'concurrent_login_notice',
            relatedEntityId: (await prisma.user.findUnique({ where: { email: to } }))?.id,
            errorMessage: error.message,
        });
        throw error;
    }
}

interface PasswordChangedNotificationOptions {
    to: string;
    name: string;
}

export async function sendPasswordChangedNotificationEmail({ to, name }: PasswordChangedNotificationOptions) {
    const loginUrl = `${getBaseUrl()}/login`;
    const title = 'Your NibTera Edir Password Has Been Changed';
    const content = `
        <p>Hello ${name},</p>
        <p>This is a confirmation that the password for your NibTera Edir account has been successfully changed.</p>
        <p>If you made this change, no further action is required.</p>
        <p><strong>If you did not change your password, please contact your system administrator immediately and consider your account compromised.</strong></p>
        <div class="button-container">
            <a href="${loginUrl}" style="background-color: #9A4D1C; color: #ffffff; display: inline-block; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px;">Sign In to Your Account</a>
        </div>
    `;

    const htmlBody = generateAuthEmailBody(title, content);
    const mailOptions = { from: process.env.EMAIL_FROM, to, subject: title, html: htmlBody };

    try {
        const info = await sendMailWithRetry(mailOptions);
        const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({ to, subject: title, body: htmlBody, status: 'sent', triggerEvent: 'password_changed', relatedEntityId: user?.id, messageId: info.messageId });
        return info;
    } catch (error: any) {
        console.error('Error sending password changed notification:', error);
        const user = await prisma.user.findUnique({ where: { email: to } });
        await logEmail({ to, subject: title, body: htmlBody, status: 'failed', triggerEvent: 'password_changed', relatedEntityId: user?.id, errorMessage: error.message });
        // Do not throw — notification failure should not block the password change
    }
}

export async function sendEmail({ to, subject, memo, sender, type, emailSettings, generalSettings, html }: MemoEmailOptions) {
  if (!emailSettings.notificationsEnabled && !html) {
    return;
  }

  let htmlBody;
  if (html) {
      htmlBody = html;
  } else if (memo && sender && type && generalSettings) {
      htmlBody = await generateMemoEmailBody(memo, sender, type, emailSettings, generalSettings);
  }

  if (!htmlBody) return;
  
  const mailOptions = {
    from: process.env.EMAIL_FROM || '"NibTera Edir System" <noreply@nib.gov.et>',
    to: to,
    subject: subject,
    html: htmlBody,
  };

  try {
    const info = await sendMailWithRetry(mailOptions);
     await logEmail({
        to: to,
        cc: memo ? memo.cc.map(u => u.email).filter(Boolean).join(', ') : undefined,
        subject,
        body: htmlBody,
        status: 'sent',
        triggerEvent: type || (memo ? 'new_memo' : 'system_alert'),
        relatedEntityId: memo ? memo.id : undefined,
        messageId: info.messageId,
    });
    return info;
  } catch (error: any) {
    console.error('Error sending email:', error);
    await logEmail({
        to: to,
        cc: memo ? memo.cc.map(u => u.email).filter(Boolean).join(', ') : undefined,
        subject,
        body: htmlBody,
        status: 'failed',
        triggerEvent: type || (memo ? 'new_memo' : 'system_alert'),
        relatedEntityId: memo ? memo.id : undefined,
        errorMessage: error.message,
    });
    throw error;
  }
}
