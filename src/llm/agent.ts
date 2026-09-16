/**
 * Tool-calling agent loop for the chat endpoint.
 *
 * Feeds the conversation + the MCP tool catalog to an LLM (OpenAI-compatible
 * tool calling); the model either returns a final answer or requests tool calls,
 * which are executed against the in-process MCP server and fed back until the
 * model produces a final answer.
 *
 * @module llm/agent
 */
import { LLMProviderError } from '../errors';
import { buildToolCatalog, renderSystemPrompt } from '../prompts/system-prompt';
import type { ChatMessage, ILLMProvider, ToolCall, ToolDefinition } from './provider';

/** MCP tool-calling surface (implemented by the in-process MCP client). */
export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
}

export interface ChatAgentOptions {
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 8;

export class ChatAgent {
  public constructor(
    private readonly provider: ILLMProvider,
    private readonly tools: ToolCaller,
    private readonly options: ChatAgentOptions = {},
  ) {}

  /**
   * Runs one chat turn to completion (final answer).
   *
   * @param history - Prior user/assistant conversation, ending with the user's message.
   * @returns The model's final natural-language answer.
   */
  public async chat(history: ChatMessage[], userId?: string): Promise<string> {
    const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
    const catalogTools = await this.tools.listTools();
    const latest = history[history.length - 1];
    const creationName = latest?.role === 'user' ? projectCreationName(latest.content ?? '') : null;
    if (creationName && catalogTools.some((tool) => tool.name === 'create_project')) {
      if (!userId) throw new Error('Authentication is required to create a project.');
      const result = (await this.tools.callTool('create_project', {
        name: creationName,
        userId,
      })) as {
        status?: string;
        project?: { id?: string; title?: string };
      } | null;
      if (
        !result?.project?.id ||
        !result.project.title ||
        !['created', 'already_exists'].includes(result.status ?? '')
      ) {
        throw new Error('Project creation was not verified. Check Project Server before retrying.');
      }
      return result.status === 'created'
        ? `Created project "${result.project.title}" successfully.\nProject ID: ${result.project.id}`
        : `Project "${result.project.title}" already exists. No duplicate was created.\nProject ID: ${result.project.id}`;
    }
    const documentProject =
      latest?.role === 'user' ? documentListingProject(latest.content ?? '') : null;
    if (documentProject && catalogTools.some((tool) => tool.name === 'search_project_documents')) {
      const result = (await this.tools.callTool('search_project_documents', {
        projectName: documentProject,
        query: '',
        userId,
      })) as {
        projectName?: string;
        documents?: Array<{ name: string; library: string; url: string }>;
      } | null;
      if (!result || !Array.isArray(result.documents))
        throw new Error('Invalid document listing response.');
      const projectName = result.projectName ?? documentProject;
      if (result.documents.length === 0)
        return `No documents were found in the accessible document libraries of ${projectName}.`;
      return [
        `${result.documents.length} document(s) in ${projectName}:`,
        ...result.documents.map(
          (doc, index) => `${index + 1}. ${doc.name}\n   Library: ${doc.library}\n   ${doc.url}`,
        ),
      ].join('\n');
    }
    if (
      latest?.role === 'user' &&
      isProjectListing(latest.content ?? '') &&
      catalogTools.some((tool) => tool.name === 'list_projects')
    ) {
      const projects = await this.tools.callTool('list_projects', { userId });
      if (!Array.isArray(projects)) throw new Error('Invalid project listing response.');
      if (projects.length === 0) {
        return 'No published projects are accessible to the configured SharePoint account.';
      }
      return [
        `${projects.length} published projects accessible to the configured SharePoint account:`,
        ...projects.map((project, index) => `${index + 1}. ${project.title} (ID: ${project.id})`),
      ].join('\n');
    }
    const toolDefinitions = catalogTools.map(toToolDefinition);
    const systemPrompt = renderSystemPrompt(
      buildToolCatalog(
        catalogTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as
            | { type?: string; properties?: Record<string, unknown>; required?: string[] }
            | undefined,
        })),
      ),
    );

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

    for (let step = 0; step < maxSteps; step += 1) {
      const result = await this.provider.complete(messages, toolDefinitions);
      if (result.toolCalls.length === 0) {
        return result.content ?? '(the model returned no answer)';
      }

      messages.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: await this.executeTool(call, userId),
        });
      }
    }

    throw new LLMProviderError(`Chat did not converge within ${maxSteps} tool-call steps`);
  }

  private async executeTool(call: ToolCall, userId?: string): Promise<string> {
    const args = parseJsonObject(call.function.arguments);
    try {
      const result = await this.tools.callTool(call.function.name, {
        ...args,
        userId,
      });
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function isProjectListing(text: string): boolean {
  return /^(?:please\s+)?(?:(?:can|could) you\s+)?(?:list|show|display|get)(?:\s+me)?\s+(?:(?:all|the|available|published)\s+)*projects(?:\s+(?:in|on|from)\s+(?:sharepoint|pwa))?[.!?\s]*$/i.test(
    text.trim(),
  );
}

/** Explicit standalone creation only. Complex requests remain on the model path. */
function projectCreationName(text: string): string | null {
  const match =
    /^(?:please\s+)?(?:create|craete)\s+(?:a\s+)?(?:new\s+)?project\s+(?:(?:named|called|name(?:\s+it)?)\s+)?(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([\p{L}\p{N}][\p{L}\p{N}_-]*))[.!?\s]*$/iu.exec(
      text.trim(),
    );
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim() || null;
}

/** Only unfiltered document inventories; summaries and content questions use the model. */
function documentListingProject(text: string): string | null {
  const match =
    /^(?:please\s+)?(?:what\s+(?:documents?|files?)(?:\s+are(?:\s+there)?)?|(?:list|show|display)(?:\s+me)?\s+(?:(?:all|the)\s+)*(?:documents?|files?))\s+(?:on|in|for)\s+(?:project\s+)?([\p{L}\p{N}][\p{L}\p{N} _-]*?)[?.!\s]*$/iu.exec(
      text.trim(),
    );
  return match?.[1]?.trim() || null;
}

function toToolDefinition(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
}): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: (tool.inputSchema as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
      },
    },
  };
}

function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
