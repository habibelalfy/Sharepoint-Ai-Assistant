import * as React from 'react';
import styles from '../ProjectAIAssistantWebPart.module.scss';

export interface IChatInputProps {
  disabled: boolean;
  onSend: (text: string) => void | Promise<void>;
}

const ChatInput: React.FC<IChatInputProps> = ({ disabled, onSend }) => {
  const [value, setValue] = React.useState('');

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    void onSend(trimmed);
    setValue('');
  };

  return (
    <div className={styles.inputRow}>
      <input
        className={styles.input}
        type="text"
        value={value}
        placeholder="Ask about a project…"
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            submit();
          }
        }}
      />
      <button className={styles.sendButton} onClick={submit} disabled={disabled}>
        Send
      </button>
    </div>
  );
};

export default ChatInput;
