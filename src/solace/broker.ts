export type BrokerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface IncomingMessage {
  applicationMessageId: string | null;
  payload: unknown;
  ack(): void;
}

export type MessageHandler = (message: IncomingMessage) => void | Promise<void>;

export type StatusListener = (status: BrokerStatus, detail: string) => void;

export interface Broker {
  readonly mode: 'real' | 'mock';
  readonly status: BrokerStatus;
  readonly statusDetail: string;
  connect(): Promise<void>;
  disconnect(): void;
  publish(topic: string, payload: unknown, applicationMessageId?: string): Promise<void>;
  consume(queueName: string, handler: MessageHandler): Promise<void>;
  onStatusChange(listener: StatusListener): () => void;
}

export function topicMatches(pattern: string, topic: string): boolean {
  const patternTokens = pattern.split('/');
  const topicTokens = topic.split('/');
  for (let i = 0; i < patternTokens.length; i++) {
    const token = patternTokens[i];
    if (token === '>') return true;
    if (topicTokens[i] === undefined) return false;
    if (token === '*') continue;
    if (token !== topicTokens[i]) return false;
  }
  return topicTokens.length === patternTokens.length;
}
