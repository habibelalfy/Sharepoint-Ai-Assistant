import { describe, expect, it, jest } from '@jest/globals';
import type { SharePointConnectionConfig } from '../../src/config';
import { ConfigError } from '../../src/errors';
import { createAuthenticatedAxios } from '../../src/sharepoint/auth';

jest.mock('axios-ntlm', () => ({
  NtlmClient: jest.fn(() => ({ __ntlmClient: true })),
}));

const baseConfig: SharePointConnectionConfig = {
  siteUrl: 'http://sp-server/sites/projects',
  username: 'svc',
  password: 'pw',
  domain: 'CORP',
  authMode: 'ntlm',
};

describe('createAuthenticatedAxios', () => {
  it('returns an NTLM-backed client for authMode=ntlm', async () => {
    const client = await createAuthenticatedAxios(baseConfig);
    expect(client).toMatchObject({ __ntlmClient: true });
  });

  it('throws ConfigError for kerberos when the kerberos package is absent', async () => {
    await expect(
      createAuthenticatedAxios({ ...baseConfig, authMode: 'kerberos' }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
