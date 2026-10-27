import { PLATFORM_NAME } from "../../common/brand/brand";
import type { EmailMessage } from "../../infrastructure/email/email.port";

const NOT_YOU = "If this wasn't you, you can ignore this email.";
const SECURE_IT = "If this wasn't you, reset your password straight away so nobody else can use your account.";
const sign = (text: string) => `${text}\n\n${PLATFORM_NAME}`;

export interface SignInDetails {
  device: string;
  when: string;
  ip: string;
}

export const AuthEmails = {
  verifyEmail: (to: string, code: string): EmailMessage => ({
    to,
    kind: "auth.verify_email",
    subject: `${code} is your verification code`,
    text: sign(`Your verification code is ${code}. It expires in 15 minutes.\n\n${NOT_YOU}`),
  }),
  welcome: (to: string, businessName: string, webUrl: string): EmailMessage => ({
    to,
    kind: "auth.welcome",
    subject: `Welcome to ${PLATFORM_NAME}, ${businessName}`,
    text: sign(
      `Your account is ready. Here's how to get your first stock into a hub:\n\n1. Add your products, with their weights and sizes.\n2. Complete your business verification.\n3. Top up your wallet.\n4. Declare your first stock shipment and send it to the hub address we give you.\n\nIf you get stuck anywhere, the flower in the bottom corner of every page can help.`,
    ),
    action: { label: "Open your dashboard", url: `${webUrl}/overview` },
  }),
  accountAlreadyExists: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "auth.account_exists",
    subject: "Someone tried to create an account with your email",
    text: sign(`An account already exists for this email address, so we didn't create another. If it was you, sign in instead, or reset your password if you've forgotten it.\n\n${NOT_YOU}`),
    action: { label: "Sign in", url: `${webUrl}/login` },
  }),
  passwordReset: (to: string, link: string): EmailMessage => ({
    to,
    kind: "auth.password_reset",
    subject: "Reset your password",
    text: sign(`Someone asked to reset the password for this account. The link works once and expires in 30 minutes.\n\n${NOT_YOU} Your password won't change.`),
    action: { label: "Choose a new password", url: link },
  }),
  passwordChanged: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "auth.password_changed",
    subject: "Your password was changed",
    text: sign(`Your password was just changed, and every other session was signed out.\n\n${SECURE_IT}`),
    action: { label: "Reset my password", url: `${webUrl}/forgot-password` },
  }),
  accountLocked: (to: string, minutes: number, webUrl: string): EmailMessage => ({
    to,
    kind: "auth.account_locked",
    subject: "We paused sign-ins to your account",
    text: sign(`After several incorrect passwords we paused sign-ins to your account for ${minutes} minutes.\n\n${SECURE_IT}`),
    action: { label: "Reset my password", url: `${webUrl}/forgot-password` },
  }),
  newSignIn: (to: string, details: SignInDetails, webUrl: string): EmailMessage => ({
    to,
    kind: "auth.new_sign_in",
    subject: `New sign-in to your ${PLATFORM_NAME} account`,
    text: sign(
      `Your account was just signed in to from a browser we haven't seen before.\n\nDevice: ${details.device}\nWhen: ${details.when}\nNetwork address: ${details.ip}\n\nIf this was you, there's nothing to do. ${SECURE_IT}`,
    ),
    action: { label: "Reset my password", url: `${webUrl}/forgot-password` },
  }),
  mfaEnrolmentCode: (to: string, code: string): EmailMessage => ({
    to,
    kind: "auth.mfa_enrolment_code",
    subject: `${code} confirms your two-factor set-up`,
    text: sign(`Someone with your password is setting up two-factor authentication. If that's you, enter ${code}. It expires in 15 minutes.\n\n${SECURE_IT}`),
  }),
  mfaEnabled: (to: string): EmailMessage => ({
    to,
    kind: "auth.mfa_enabled",
    subject: "Two-factor authentication is on",
    text: sign(`Two-factor authentication was just turned on for your account. Keep your recovery codes somewhere safe: each one lets you sign in once if you lose your phone.\n\n${SECURE_IT}`),
  }),
  recoveryCodeUsed: (to: string, remaining: number, webUrl: string): EmailMessage => ({
    to,
    kind: "auth.recovery_code_used",
    subject: "A recovery code was used to sign in",
    text: sign(
      `One of your recovery codes was just used to sign in to your account. You have ${remaining} ${remaining === 1 ? "code" : "codes"} left.${remaining <= 3 ? " Set up two-factor authentication again on your phone soon so you don't run out." : ""}\n\n${SECURE_IT}`,
    ),
    action: { label: "Reset my password", url: `${webUrl}/forgot-password` },
  }),
  sessionTheft: (to: string, webUrl: string): EmailMessage => ({
    to,
    kind: "auth.session_theft",
    subject: "We signed you out everywhere",
    text: sign(
      `An old sign-in token was used again, which can mean it was stolen. To be safe we signed out every session on your account.\n\nSign in again, and change your password if you didn't expect this.`,
    ),
    action: { label: "Sign in", url: `${webUrl}/login` },
  }),
};
