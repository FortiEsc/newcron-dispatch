import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import {
  Broker,
  BrokerStatus,
  IncomingMessage,
  MessageHandler,
  StatusListener,
  topicMatches,
} from './broker';

interface StoredMessage {
  id: string | null;
  payload: unknown;
  delivered: boolean;
  attempts: number;
  acked: boolean;
}

interface PersistedQueue {
  subscription: string;
  messages: StoredMessage[];
}

const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 3;

export class MockBroker implements Broker {
  readonly mode = 'mock' as const;
  status: BrokerStatus = 'disconnected';
  statusDetail = 'Broker simulado en memoria (BROKER_MODE=mock)';

  private readonly queues = new Map<string, PersistedQueue>();
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly statusListeners: StatusListener[] = [];
  private readonly stateFile: string;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    definitions: Array<{ name: string; subscriptionTopic: string }> = [],
    stateFile = path.join(process.cwd(), config.paths.dataDir, 'mock-broker.json')
  ) {
    this.stateFile = stateFile;
    this.loadDefinitions(definitions);
    this.restore();
  }

  private loadDefinitions(definitions: Array<{ name: string; subscriptionTopic: string }>): void {
    for (const definition of definitions) {
      if (!this.queues.has(definition.name)) {
        this.queues.set(definition.name, {
          subscription: definition.subscriptionTopic,
          messages: [],
        });
      }
    }
  }

  async connect(): Promise<void> {
    this.setStatus('connected', 'Broker simulado en memoria (BROKER_MODE=mock)');
    for (const queueName of this.queues.keys()) {
      await this.flush(queueName);
    }
  }

  disconnect(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.setStatus('disconnected', 'Broker simulado detenido');
  }

  async publish(topic: string, payload: unknown, applicationMessageId?: string): Promise<void> {
    if (this.status !== 'connected') {
      throw new Error(`No se puede publicar: broker ${this.status}`);
    }
    let matched = 0;
    for (const [queueName, queue] of this.queues) {
      if (!topicMatches(queue.subscription, topic)) continue;
      matched += 1;
      queue.messages.push({
        id: applicationMessageId ?? null,
        payload,
        delivered: false,
        attempts: 0,
        acked: false,
      });
      await this.flush(queueName);
    }
    this.persist();
    if (matched === 0) {
      console.warn(`[mock-broker] mensaje publicado en "${topic}" sin colas suscritas`);
    }
  }

  async consume(queueName: string, handler: MessageHandler): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Cola desconocida: ${queueName}`);
    }
    this.handlers.set(queueName, handler);
    await this.flush(queueName);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.push(listener);
    return () => {
      const index = this.statusListeners.indexOf(listener);
      if (index >= 0) this.statusListeners.splice(index, 1);
    };
  }

  browse(queueName: string): unknown[] {
    return (this.queues.get(queueName)?.messages ?? [])
      .filter((message) => !message.acked)
      .map((message) => message.payload);
  }

  private async flush(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    const handler = this.handlers.get(queueName);
    if (!queue || !handler) return;

    for (const message of queue.messages) {
      if (message.acked || message.delivered) continue;
      message.delivered = true;
      message.attempts += 1;

      const incoming: IncomingMessage = {
        applicationMessageId: message.id,
        payload: message.payload,
        ack: () => {
          message.acked = true;
          queue.messages = queue.messages.filter((item) => item !== message);
          this.persist();
        },
      };

      try {
        await handler(incoming);
      } catch (error) {
        message.delivered = false;
        console.error(
          `[mock-broker] handler fallo para cola ${queueName} (intento ${message.attempts}):`,
          error
        );
        if (message.attempts < MAX_RETRIES) {
          const timer = setTimeout(() => {
            this.timers.delete(timer);
            void this.flush(queueName);
          }, RETRY_DELAY_MS);
          this.timers.add(timer);
        } else {
          console.error(`[mock-broker] mensaje agoto reintentos en cola ${queueName}`);
        }
      }
    }
    this.persist();
  }

  private setStatus(status: BrokerStatus, detail: string): void {
    this.status = status;
    this.statusDetail = detail;
    for (const listener of this.statusListeners) listener(status, detail);
  }

  private restore(): void {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Record<
        string,
        PersistedQueue
      >;
      for (const [queueName, queue] of Object.entries(raw)) {
        const existing = this.queues.get(queueName);
        if (existing) {
          existing.subscription = queue.subscription;
          existing.messages = queue.messages.map((message) => ({
            ...message,
            delivered: false,
            attempts: 0,
          }));
        } else {
          this.queues.set(queueName, queue);
        }
      }
    } catch (error) {
      console.warn('[mock-broker] no se pudo restaurar el estado:', error);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const raw: Record<string, PersistedQueue> = {};
      for (const [queueName, queue] of this.queues) raw[queueName] = queue;
      fs.writeFileSync(this.stateFile, JSON.stringify(raw, null, 2), 'utf8');
    } catch (error) {
      console.warn('[mock-broker] no se pudo persistir el estado:', error);
    }
  }
}
