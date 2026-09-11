/**
 * Minimal ambient type declaration for the optional `kerberos` native package.
 *
 * `kerberos` is NOT a hard dependency. It is lazily imported only when
 * `SHAREPOINT_AUTH_MODE=kerberos`, and the import failure is surfaced as a
 * clear {@link ../errors.ConfigError} telling the operator how to install it.
 * This declaration lets the code type-check without the package installed and
 * documents the exact integration contract (SPNEGO via GSS-API).
 */
declare module 'kerberos' {
  export interface KerberosInitializeOptions {
    /** GSS-API mechanism OID (e.g. GSS_MECH_OID_SPNEGO). */
    mechOID?: number;
    /** Service principal to request a ticket for. */
    principal?: string;
  }

  export interface KerberosClient {
    /** Advance the GSS-API exchange; returns the next token (base64). */
    step(challenge: string): Promise<string>;
    /** Decrypt (unwrap) a wrapped token. */
    unwrap(challenge: string): Promise<string>;
    /** Encrypt (wrap) a token. */
    wrap(challenge: string, options?: Record<string, unknown>): Promise<string>;
  }

  export function initializeClient(
    service: string,
    options?: KerberosInitializeOptions,
  ): Promise<KerberosClient>;

  export const GSS_MECH_OID_KRB5: number;
  export const GSS_MECH_OID_SPNEGO: number;
}
