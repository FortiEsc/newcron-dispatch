import * as solace from 'solclientjs';
import {
  Broker,
  BrokerStatus,
  IncomingMessage,
  MessageHandler,
  StatusListener,
} from './broker';

export interface SolaceCredentials {
  url: string;
  vpnName: string;
  userName: string;
  password: string;
}

const CONNECT_TIMEOUT_MS = 30000;
const RECONNECT_BASE_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export class SolaceBroker implements Broker {
  readonly mode = 'real' as const;
  status: BrokerStatus = 'disconnected';
  statusDetail = 'Sin conectar';

  private session: solace.Session | null = null;
  private readonly credentials: SolaceCredentials;
  private readonly statusListeners: StatusListener[] = [];
  private readonly pendingConsumers = new Map<string, MessageHandler>();
  private readonly consumers = new Map<string, solace.MessageConsumer>();
  private factoryInitialized = false;
  private reconnectAttempts = 0;
  private closing = false;

  constructor(credentials: SolaceCredentials) {
    this.credentials = credentials;
  }

  async connect(): Promise<void> {
    const { url, vpnName, userName, password } = this.credentials;
    if (!url || !vpnName || !userName) {
      throw new Error(
        'Faltan credenciales de Solace en .env (SOLACE_WSS_URL, SOLACE_VPN, SOLACE_USER, SOLACE_PASSWORD)'
      );
    }
    this.closing = false;
    this.setStatus('connecting', `Conectando a ${url} (msgVpn=${vpnName})`);

    if (!this.factoryInitialized) {
      solace.SolclientFactory.init(
        new solace.SolclientFactoryProperties({ logLevel: solace.LogLevel.WARN })
      );
      this.factoryInitialized = true;
    }

    await this.openSession();
    for (const [queueName, handler] of this.pendingConsumers) {
      await this.attachConsumer(queueName, handler);
    }
  }

  disconnect(): void {
    this.closing = true;
    for (const consumer of this.consumers.values()) {
      try {
        consumer.dispose();
      } catch {
        /* ignore */
      }
    }
    this.consumers.clear();
    if (this.session) {
      try {
        this.session.dispose();
      } catch {
        /* ignore */
      }
      this.session = null;
    }
    this.setStatus('disconnected', 'Sesion cerrada');
  }

  async publish(topic: string, payload: unknown, applicationMessageId?: string): Promise<void> {
    const session = this.session;
    if (!session || this.status !== 'connected') {
      throw new Error(`No se puede publicar: broker ${this.status}`);
    }
    const message = solace.SolclientFactory.createMessage();
    message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
    message.setBinaryAttachment(JSON.stringify(payload));
    message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);
    if (applicationMessageId) message.setApplicationMessageId(applicationMessageId);
    session.send(message);
  }

  async consume(queueName: string, handler: MessageHandler): Promise<void> {
    this.pendingConsumers.set(queueName, handler);
    if (this.session && this.status === 'connected') {
      await this.attachConsumer(queueName, handler);
    }
  }

  onStatusChange(listener: StatusListener): void {
    this.statusListeners.push(listener);
  }

  private openSession(): Promise<void> {
    return new Promise((resolve, reject) => {
      const session = solace.SolclientFactory.createSession({
        url: this.credentials.url,
        vpnName: this.credentials.vpnName,
        userName: this.credentials.userName,
        password: this.credentials.password,
        connectTimeoutInMsecs: CONNECT_TIMEOUT_MS,
      });
      this.session = session;

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.setStatus('error', 'Timeout al conectar con el broker');
        reject(new Error('Timeout al conectar con Solace'));
      }, CONNECT_TIMEOUT_MS);

      session.on(solace.SessionEventCode.UP_NOTICE, () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected', `Conectado a ${this.credentials.url}`);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (error: solace.OperationError) => {
        this.setStatus('error', `Fallo de conexion: ${error.message}`);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Fallo al conectar con Solace: ${error.message}`));
        } else {
          this.scheduleReconnect();
        }
      });

      session.on(solace.SessionEventCode.DISCONNECTED, () => {
        this.setStatus('disconnected', 'Sesion desconectada');
        if (this.closing) return;
        this.scheduleReconnect();
      });

      session.on(solace.SessionEventCode.REJECTED_MESSAGE_ERROR, (error: solace.RequestError) => {
        console.error('[solace] mensaje rechazado:', error.message);
      });

      session.connect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closing) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('error', `Sin conexion tras ${MAX_RECONNECT_ATTEMPTS} reintentos`);
      return;
    }
    this.reconnectAttempts += 1;
    const delay = RECONNECT_BASE_DELAY_MS * this.reconnectAttempts;
    console.warn(`[solace] reconectando en ${delay}ms (intento ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.closing) return;
      void this.openSession()
        .then(async () => {
          for (const [queueName, handler] of this.pendingConsumers) {
            await this.attachConsumer(queueName, handler);
          }
        })
        .catch((error) => {
          console.error('[solace] reintento de conexion fallido:', error);
        });
    }, delay);
  }

  private async attachConsumer(queueName: string, handler: MessageHandler): Promise<void> {
    const session = this.session;
    if (!session) throw new Error('No hay sesion para consumir ' + queueName);

    const existing = this.consumers.get(queueName);
    if (existing) {
      try {
        existing.dispose();
      } catch {
        /* ignore */
      }
      this.consumers.delete(queueName);
    }

    const consumer = session.createMessageConsumer({
      queueDescriptor: { type: solace.QueueType.QUEUE, name: queueName, durable: true },
      acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
      connectRetryTimeout: CONNECT_TIMEOUT_MS,
      reconnectAttempts: 10,
      reconnectIntervalInMsecs: 2000,
      transportAcknowledgeTimeoutInMsecs: 20000,
      transportAcknowledgeThresholdPercentage: 80,
    });

    consumer.on(solace.MessageConsumerEventName.UP, () => {
      console.log(`[solace] consumidor activo en cola ${queueName}`);
    });
    consumer.on(solace.MessageConsumerEventName.SUBSCRIPTION_ERROR, (event: solace.MessageConsumerEvent) => {
      console.error(`[solace] error de suscripcion en ${queueName}: ${event.infoStr}`);
    });
    consumer.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, (error: solace.OperationError) => {
      console.error(`[solace] fallo de consumidor en ${queueName}:`, error.message);
    });
    consumer.on(solace.MessageConsumerEventName.MESSAGE, (message: solace.Message) => {
      const attachment = message.getBinaryAttachment();
      let payload: unknown = attachment;
      if (attachment !== null && attachment !== undefined) {
        try {
          const text =
            typeof attachment === 'string'
              ? attachment
              : Buffer.from(attachment as Uint8Array).toString('utf8');
          payload = JSON.parse(text);
        } catch {
          payload = attachment;
        }
      }
      const incoming: IncomingMessage = {
        applicationMessageId: message.getApplicationMessageId(),
        payload,
        ack: () => {
          try {
            message.acknowledge();
          } catch (error) {
            console.error('[solace] error al hacer acknowledge:', error);
          }
        },
      };
      void Promise.resolve(handler(incoming)).catch((error) => {
        console.error(`[solace] handler fallo en cola ${queueName}:`, error);
      });
    });

    consumer.connect();
    this.consumers.set(queueName, consumer);
  }

  private setStatus(status: BrokerStatus, detail: string): void {
    this.status = status;
    this.statusDetail = detail;
    for (const listener of this.statusListeners) listener(status, detail);
  }
}
