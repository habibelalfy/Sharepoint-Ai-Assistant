/**
 * Authenticated axios client factory.
 *
 * Builds an axios instance wired with the correct authentication for the
 * configured `SHAREPOINT_AUTH_MODE`:
 * - `ntlm` — a drop-in NTLM axios client via `axios-ntlm` (pure JS).
 * - `kerberos` — an axios instance with SPNEGO (`Authorization: Negotiate`)
 *   request/response interceptors, backed by the lazily-loaded `kerberos`
 *   native package.
 *
 * @module sharepoint/auth
 */
import axios, { AxiosHeaders, type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { NtlmClient } from 'axios-ntlm';
import type { SharePointConnectionConfig } from '../config';
import { ConfigError } from '../errors';

/** Headers SharePoint expects on REST (odata=verbose) calls. */
const COMMON_HEADERS = {
  Accept: 'application/json;odata=verbose',
  'Content-Type': 'application/json;odata=verbose',
} as const;

type InternalRequestConfig = AxiosRequestConfig & { _spnegoRetried?: boolean };

/** Sets the Authorization header on a request config (axios 1.x AxiosHeaders). */
function setAuthorizationHeader(config: AxiosRequestConfig, token: string): void {
  const headers = config.headers as AxiosHeaders | undefined;
  config.headers = (headers ?? new AxiosHeaders()).set('Authorization', `Negotiate ${token}`);
}

/**
 * Creates an authenticated axios instance for the given connection config.
 *
 * @param config - SharePoint connection settings.
 * @returns An axios instance ready to make authenticated REST calls.
 */
export function createAuthenticatedAxios(config: SharePointConnectionConfig): Promise<AxiosInstance> {
  return config.authMode === 'ntlm' ? Promise.resolve(createNtlmAxios(config)) : createKerberosAxios(config);
}

/** Builds an NTLM-authenticated axios client (pure JS, no native deps). */
function createNtlmAxios(config: SharePointConnectionConfig): AxiosInstance {
  return NtlmClient(
    {
      username: config.username,
      password: config.password,
      domain: config.domain,
    },
    { headers: { ...COMMON_HEADERS } },
  );
}

/** Builds a Kerberos (SPNEGO) authenticated axios client. */
async function createKerberosAxios(config: SharePointConnectionConfig): Promise<AxiosInstance> {
  const kerberos = await loadKerberos();
  const { hostname } = new URL(config.siteUrl);
  const spnego = await kerberos.initializeClient(`HTTP@${hostname}`, {
    mechOID: kerberos.GSS_MECH_OID_SPNEGO,
  });

  const instance = axios.create({ headers: { ...COMMON_HEADERS } });

  // Attach an initial SPNEGO token to every outgoing request.
  instance.interceptors.request.use(async (requestConfig) => {
    const token = await spnego.step('');
    setAuthorizationHeader(requestConfig, token);
    return requestConfig;
  });

  // On a 401 Negotiate challenge, step the GSS-API exchange once and retry.
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (!isNegotiateChallenge(error)) {
        throw error;
      }
      const requestConfig = error.config as InternalRequestConfig | undefined;
      if (!requestConfig || requestConfig._spnegoRetried) {
        throw error;
      }
      requestConfig._spnegoRetried = true;
      const challenge = parseNegotiateChallenge(error.response?.headers?.['www-authenticate']);
      const token = await spnego.step(challenge ?? '');
      setAuthorizationHeader(requestConfig, token);
      return instance.request(requestConfig);
    },
  );

  return instance;
}

/** Lazily imports the optional `kerberos` package, failing with guidance. */
async function loadKerberos(): Promise<typeof import('kerberos')> {
  try {
    return await import('kerberos');
  } catch (cause) {
    throw new ConfigError(
      'Kerberos (SPNEGO) authentication requires the "kerberos" native package. ' +
        'Install it (`npm install kerberos`) and run the process under a domain account ' +
        'or provide a keytab/SPN for the SharePoint HTTP service.',
      { cause },
    );
  }
}

/** Returns true for a 401 response carrying a `Negotiate` challenge. */
function isNegotiateChallenge(error: AxiosError): boolean {
  const status = error.response?.status;
  const header = error.response?.headers?.['www-authenticate'];
  return status === 401 && typeof header === 'string' && header.toLowerCase().includes('negotiate');
}

/** Extracts the base64 SPNEGO token from a `WWW-Authenticate: Negotiate ...` header. */
function parseNegotiateChallenge(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  return /Negotiate\s+([^\s,]+)/i.exec(header)?.[1];
}
