import type { EmailMessage } from "../../infrastructure/email/email.port";

const SIGN_OFF = "\n\nIf this wasn't you, you can ignore this email.\nGlobal Fulfilment Network";

export const AuthEmails = {
  verifyEmail: (to: string, code: string): EmailMessage => ({ to, subject: `${code} is your verification code`, text: `Your verification code is ${code}. It expires in 15 minutes.${SIGN_OFF}` }),
  accountAlreadyExists: (to: string, webUrl: string): EmailMessage => ({
    to,
    subject: "Someone tried to create an account with your email",
    text: `An account already exists for this email. Sign in at ${webUrl}/login or reset your password at ${webUrl}/forgot-password.${SIGN_OFF}`,
  }),
  passwordReset: (to: string, link: string): EmailMessage => ({ to, subject: "Reset your password", text: `Use this link within 30 minutes to choose a new password:\n${link}${SIGN_OFF}` }),
  passwordChanged: (to: string): EmailMessage => ({ to, subject: "Your password was changed", text: `Your password was just changed and every other session was signed out.${SIGN_OFF}` }),
  accountLocked: (to: string, minutes: number): EmailMessage => ({
    to,
    subject: "We paused sign-ins to your account",
    text: `After several incorrect passwords we paused sign-ins for ${minutes} minutes. If this wasn't you, reset your password.${SIGN_OFF}`,
  }),
  mfaEnrolmentCode: (to: string, code: string): EmailMessage => ({
    to,
    subject: `${code} confirms your two-factor set-up`,
    text: `Someone with your password is setting up two-factor authentication. If that's you, enter ${code}. It expires in 15 minutes. If it isn't you, reset your password now.${SIGN_OFF}`,
  }),
  mfaEnabled: (to: string): EmailMessage => ({ to, subject: "Two-factor authentication is on", text: `Two-factor authentication was just turned on for your account.${SIGN_OFF}` }),
  sessionTheft: (to: string): EmailMessage => ({
    to,
    subject: "We signed you out everywhere",
    text: `An old sign-in token was reused, which can mean it was stolen. We signed out every session. Sign in again and consider changing your password.${SIGN_OFF}`,
  }),
};
