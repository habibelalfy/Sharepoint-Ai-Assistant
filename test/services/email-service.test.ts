import { describe, expect, it } from '@jest/globals';
import { ConfigError } from '../../src/errors';
import { ConsoleEmailSender, SmtpEmailSender } from '../../src/services/email-service';

describe('ConsoleEmailSender', () => {
  it('records and logs sent emails', async () => {
    const sender = new ConsoleEmailSender();
    await sender.sendEmail(['a@corp.com', 'b@corp.com'], 'Subject', 'Body');
    expect(sender.sent).toEqual([
      { recipients: ['a@corp.com', 'b@corp.com'], subject: 'Subject', body: 'Body' },
    ]);
  });
});

describe('SmtpEmailSender', () => {
  it('throws ConfigError when nodemailer is not installed', async () => {
    const sender = new SmtpEmailSender({
      host: 'smtp.corp.com',
      port: 25,
      from: 'alerts@corp.com',
    });
    await expect(sender.sendEmail(['a@corp.com'], 'Subject', 'Body')).rejects.toBeInstanceOf(
      ConfigError,
    );
  });
});
