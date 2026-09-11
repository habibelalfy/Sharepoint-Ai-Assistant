import { describe, expect, it } from '@jest/globals';
import { loadConfig } from '../src/config';

const validEnv: NodeJS.ProcessEnv = {
  SHAREPOINT_SITE_URL: 'http://sp-server/sites/projects',
  SHAREPOINT_USERNAME: 'svc_ai_assistant',
  SHAREPOINT_PASSWORD: 'secret',
  SHAREPOINT_DOMAIN: 'CORP',
  SHAREPOINT_AUTH_MODE: 'kerberos',
};

/** Returns a copy of the env with one key removed. */
function without(env: NodeJS.ProcessEnv, key: string): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

describe('loadConfig', () => {
  it('builds a config from valid environment variables', () => {
    const config = loadConfig(validEnv);
    expect(config.sharepoint.siteUrl).toBe('http://sp-server/sites/projects');
    expect(config.sharepoint.username).toBe('svc_ai_assistant');
    expect(config.sharepoint.authMode).toBe('kerberos');
    expect(config.sharepoint.domain).toBe('CORP');
    expect(config.logLevel).toBe('info');
    expect(config.serviceName).toBe('sharepoint-ai-assistant');
  });

  it('defaults auth mode to kerberos when omitted', () => {
    expect(loadConfig(without(validEnv, 'SHAREPOINT_AUTH_MODE')).sharepoint.authMode).toBe(
      'kerberos',
    );
  });

  it('defaults log level to info when omitted', () => {
    expect(loadConfig(without(validEnv, 'LOG_LEVEL')).logLevel).toBe('info');
  });

  it('throws when a required variable is missing', () => {
    expect(() => loadConfig(without(validEnv, 'SHAREPOINT_PASSWORD'))).toThrow(
      /SHAREPOINT_PASSWORD/,
    );
  });

  it('throws when auth mode is invalid', () => {
    expect(() => loadConfig({ ...validEnv, SHAREPOINT_AUTH_MODE: 'oauth' })).toThrow(
      /SHAREPOINT_AUTH_MODE/,
    );
  });

  it('throws when the site URL is invalid', () => {
    expect(() => loadConfig({ ...validEnv, SHAREPOINT_SITE_URL: 'not a url' })).toThrow(
      /SHAREPOINT_SITE_URL/,
    );
  });

  it('defaults alert schedules when omitted', () => {
    expect(loadConfig(validEnv).alertSchedules).toEqual({
      overdue: '0 9 * * *',
      milestones: '0 10 * * *',
      healthCheck: '0 8 * * 1',
    });
  });

  it('reads custom alert schedules from env', () => {
    const config = loadConfig({ ...validEnv, ALERT_SCHEDULE_OVERDUE: '0 6 * * *' });
    expect(config.alertSchedules.overdue).toBe('0 6 * * *');
    expect(config.alertSchedules.milestones).toBe('0 10 * * *');
  });

  it('defaults alert recipients to an empty list', () => {
    expect(loadConfig(validEnv).alertRecipients).toEqual([]);
  });

  it('parses ALERT_RECIPIENTS into a trimmed list', () => {
    const config = loadConfig({ ...validEnv, ALERT_RECIPIENTS: ' a@corp.com, b@corp.com , ' });
    expect(config.alertRecipients).toEqual(['a@corp.com', 'b@corp.com']);
  });

  it('builds SMTP config when SMTP_HOST is set', () => {
    const config = loadConfig({
      ...validEnv,
      SMTP_HOST: 'smtp.corp.com',
      SMTP_FROM: 'ai@corp.com',
    });
    expect(config.smtp).toEqual({ host: 'smtp.corp.com', port: 25, from: 'ai@corp.com' });
  });

  it('requires SMTP_FROM when SMTP_HOST is set', () => {
    expect(() => loadConfig({ ...validEnv, SMTP_HOST: 'smtp.corp.com' })).toThrow(/SMTP_FROM/);
  });
});
