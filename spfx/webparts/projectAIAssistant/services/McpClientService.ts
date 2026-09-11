import { WebPartContext } from '@microsoft/sp-webpart-base';

/**
 * Wraps calls to the MCP HTTP gateway, attaching the SPFx context's access
 * token so the gateway can authenticate the caller server-side.
 */
export class McpClientService {
  public constructor(
    private readonly gatewayUrl: string,
    private readonly context: WebPartContext,
  ) {}

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.gatewayUrl}/api/mcp/tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ toolName, args }),
    });

    const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? `Gateway error ${response.status}`);
    }
    return body.result;
  }

  private async getAccessToken(): Promise<string> {
    const provider = await this.context.aadTokenProviderFactory.getTokenProvider();
    // Replace with the gateway's registered AAD audience / scope.
    return provider.getToken('api://sharepoint-ai-assistant/.default');
  }
}
