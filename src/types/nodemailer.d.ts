/**
 * Minimal ambient type declaration for the optional `nodemailer` package.
 *
 * `nodemailer` is NOT a hard dependency. It is lazily imported only when an
 * operator selects SMTP delivery for alert emails, and the import failure is
 * surfaced as a clear ConfigError (see services/email-service). This
 * declaration lets the code type-check without the package installed.
 */
declare module 'nodemailer' {
  export interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  export function createTransport(options: Record<string, unknown>): Transporter;
}
