/**
 * Pluggable email transport for alert notifications.
 *
 * @module services/email-service
 */
import { ConfigError } from '../errors';

/** Sends an alert email to a set of recipients. */
export interface EmailSender {
  sendEmail(recipients: string[], subject: string, body: string): Promise<void>;
}

/**
 * Logs emails to stderr instead of sending them. The default transport, useful
 * for local development and for tests (see {@link ConsoleEmailSender.sent}).
 */
export class ConsoleEmailSender implements EmailSender {
  /** Emails "sent" so far, for inspection in tests. */
  public readonly sent: Array<{ recipients: string[]; subject: string; body: string }> = [];

  public async sendEmail(recipients: string[], subject: string, body: string): Promise<void> {
    this.sent.push({ recipients, subject, body });
    // stderr keeps stdout reserved for the MCP stdio transport.
    process.stderr.write(`[email] to=${recipients.join(', ')} subject="${subject}"\n`);
  }
}

/** Settings required to send email over SMTP. */
export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
}

/**
 * SMTP fallback sender backed by the optional `nodemailer` package. Like the
 * `kerberos` adapter, `nodemailer` is lazily loaded so it is not a hard
 * dependency — operators install it only when SMTP delivery is required.
 */
export class SmtpEmailSender implements EmailSender {
  public constructor(private readonly options: SmtpOptions) {}

  public async sendEmail(recipients: string[], subject: string, body: string): Promise<void> {
    const nodemailer = await loadNodemailer();
    const transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
    });
    await transport.sendMail({
      from: this.options.from,
      to: recipients.join(', '),
      subject,
      text: body,
    });
  }
}

async function loadNodemailer(): Promise<typeof import('nodemailer')> {
  try {
    return await import('nodemailer');
  } catch (cause) {
    throw new ConfigError(
      'SMTP email requires the "nodemailer" package. Install it (`npm install nodemailer`) and provide SMTP settings.',
      { cause },
    );
  }
}
