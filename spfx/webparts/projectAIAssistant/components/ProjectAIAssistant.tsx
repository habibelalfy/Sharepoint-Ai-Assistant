import * as React from 'react';
import ChatHistory, { IChatMessage } from './ChatHistory';
import ChatInput from './ChatInput';
import { IProjectAIAssistantProps } from './IProjectAIAssistantProps';
import { McpClientService } from '../services/McpClientService';
import styles from '../ProjectAIAssistantWebPart.module.scss';

/** Formats a tool result for display in the chat. */
function formatResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result, null, 2);
}

const ProjectAIAssistant: React.FC<IProjectAIAssistantProps> = ({ mcpGatewayUrl, context }) => {
  const [messages, setMessages] = React.useState<IChatMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  const service = React.useMemo(
    () => new McpClientService(mcpGatewayUrl, context),
    [mcpGatewayUrl, context],
  );

  const send = async (question: string): Promise<void> => {
    const next: IChatMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setLoading(true);
    setError(undefined);
    try {
      const result = await service.callTool('search_projects', { query: question });
      setMessages([...next, { role: 'assistant', text: formatResult(result) }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <ChatHistory messages={messages} />
      {error && <div className={styles.error}>{error}</div>}
      <ChatInput disabled={loading} onSend={send} />
    </div>
  );
};

export default ProjectAIAssistant;
