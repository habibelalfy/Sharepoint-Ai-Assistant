import * as React from 'react';
import styles from '../ProjectAIAssistantWebPart.module.scss';

export interface IChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface IChatHistoryProps {
  messages: IChatMessage[];
}

const ChatHistory: React.FC<IChatHistoryProps> = ({ messages }) => (
  <div className={styles.history}>
    {messages.map((message, index) => (
      <div key={index} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
        <pre className={styles.messageText}>{message.text}</pre>
      </div>
    ))}
  </div>
);

export default ChatHistory;
