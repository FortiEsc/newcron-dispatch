import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import type { DispatchRequest, ResultPayload, ResultStatus } from '../domain/types';

export type RequestStatus = 'Pending' | ResultStatus;

export interface StatusEvent {
  status: ResultStatus;
  notes: string;
  at: string;
}

export interface RequestRecord {
  shipperOrderId: string;
  status: RequestStatus;
  notes: string | null;
  receivedAt: string;
  updatedAt: string;
  request: DispatchRequest | null;
  history: StatusEvent[];
}

export interface EmailRecord {
  shipperOrderId: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

export type StoreEvent =
  | { type: 'request:saved'; record: RequestRecord }
  | { type: 'result:applied'; record: RequestRecord }
  | { type: 'email:sent'; email: EmailRecord };

interface StoreState {
  requests: Record<string, RequestRecord>;
  emails: EmailRecord[];
}

export class Store {
  private readonly filePath: string;
  private readonly emailLogPath: string;
  private readonly state: StoreState;
  private readonly listeners: Array<(event: StoreEvent) => void> = [];

  constructor(filePath = path.join(process.cwd(), config.paths.dataDir, 'state.json')) {
    this.filePath = filePath;
    this.emailLogPath = filePath.replace(/state\.json$/, 'emails.log');
    this.state = this.restore();
  }

  saveRequest(request: DispatchRequest, receivedAt = new Date().toISOString()): RequestRecord {
    const existing = this.state.requests[request.shipperOrderId];
    const record: RequestRecord = {
      shipperOrderId: request.shipperOrderId,
      status: 'Pending',
      notes: null,
      receivedAt: existing?.receivedAt ?? receivedAt,
      updatedAt: receivedAt,
      request,
      history: existing?.history ?? [],
    };
    this.state.requests[request.shipperOrderId] = record;
    this.persist();
    this.emit({ type: 'request:saved', record });
    return record;
  }

  applyResult(result: ResultPayload, at = new Date().toISOString()): RequestRecord {
    const existing = this.state.requests[result.shipperOrderId];
    const record: RequestRecord = {
      shipperOrderId: result.shipperOrderId,
      status: result.status,
      notes: result.notes,
      receivedAt: existing?.receivedAt ?? at,
      updatedAt: at,
      request: existing?.request ?? null,
      history: [...(existing?.history ?? []), { status: result.status, notes: result.notes, at }],
    };
    this.state.requests[result.shipperOrderId] = record;
    this.persist();
    this.emit({ type: 'result:applied', record });
    return record;
  }

  addEmail(email: EmailRecord): EmailRecord {
    this.state.emails.push(email);
    this.persist();
    try {
      fs.appendFileSync(
        this.emailLogPath,
        `${email.sentAt} | to=${email.to} | ${email.subject} | ${email.body}\n`,
        'utf8'
      );
    } catch (error) {
      console.warn('[store] no se pudo escribir el log de emails:', error);
    }
    this.emit({ type: 'email:sent', email });
    return email;
  }

  get(shipperOrderId: string): RequestRecord | undefined {
    return this.state.requests[shipperOrderId];
  }

  listRequests(): RequestRecord[] {
    return Object.values(this.state.requests).sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt)
    );
  }

  listEmails(): EmailRecord[] {
    return [...this.state.emails];
  }

  onChange(listener: (event: StoreEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: StoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[store] listener fallo:', error);
      }
    }
  }

  private restore(): StoreState {
    try {
      if (!fs.existsSync(this.filePath)) return { requests: {}, emails: [] };
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as StoreState;
      return {
        requests: parsed.requests ?? {},
        emails: parsed.emails ?? [],
      };
    } catch (error) {
      console.warn('[store] no se pudo leer el estado, se inicia vacio:', error);
      return { requests: {}, emails: [] };
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      console.warn('[store] no se pudo persistir el estado:', error);
    }
  }
}
