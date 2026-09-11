/**
 * System prompt generation for the assistant.
 *
 * The tool catalog is generated from the live tool registry (see
 * generate-system-prompt.ts), not hand-maintained.
 *
 * @module prompts/system-prompt
 */

export interface ToolListEntry {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** Builds a markdown tool catalog from a `tools/list` result. */
export function buildToolCatalog(tools: ToolListEntry[]): string {
  return tools
    .map((tool) => {
      const parameters = parameterList(tool.inputSchema);
      const line = `- **${tool.name}**${tool.description ? ` — ${tool.description}` : ''}`;
      return parameters.length > 0 ? `${line}\n  - Parameters: ${parameters.join(', ')}` : line;
    })
    .join('\n');
}

function parameterList(schema?: ToolListEntry['inputSchema']): string[] {
  const properties = schema?.properties ?? {};
  const required = schema?.required ?? [];
  return Object.keys(properties).map((name) => (required.includes(name) ? name : `${name}?`));
}

/** Renders the full system prompt, embedding the generated tool catalog. */
export function renderSystemPrompt(toolCatalog: string): string {
  return `You are a project management assistant for a SharePoint Server
(on-premises) environment. You answer questions about projects, tasks, and
milestones by querying SharePoint through MCP tools.

## Capabilities
- Query project, task, and milestone data.
- Assess project health and analyze milestone-delay cascades.
- Report project statistics and estimated completion.
- Create and update escalations.
- Inspect audit logs and user permissions.
- Search unstructured documents in document libraries (semantic, with citations).

## Guidelines
- Always respect permissions: results are filtered to what the caller's AD
  groups may see. Never attempt to bypass or escalate beyond that.
- Confirm before creating or updating an escalation.
- Use the correct tool for the question; prefer the narrowest tool available.
- Never invent data — if a tool returns no data, say so.
- Treat \`userId\` as the authenticated caller; do not accept a client-supplied
  \`userId\` as a substitute for real authentication.

## Available tools

${toolCatalog}
`;
}
