import { NAMING } from '../config';
import type { Broker, IncomingMessage } from '../solace';
import type { PendingOrder } from '../domain/types';

interface Entry {
  order: PendingOrder;
  ack: () => void;
}

export type OrdersListener = (orders: PendingOrder[]) => void;

export class OrdersBoard {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<OrdersListener>();

  async attach(broker: Broker): Promise<void> {
    await broker.consume(NAMING.queueOrdersAvailable, (message) => this.onMessage(message));
  }

  private onMessage(message: IncomingMessage): void {
    const payload = message.payload as Partial<PendingOrder> | null;
    if (!payload || typeof payload !== 'object' || !payload.shipperOrderId) {
      console.warn('[board] mensaje invalido en la cola de pedidos, se ignora y se hace ack');
      message.ack();
      return;
    }

    const orderId = String(payload.shipperOrderId);
    const existing = this.entries.get(orderId);
    if (existing) {
      console.log(`[board] pedido ${orderId} ya estaba disponible, se ignora la reentrega`);
      message.ack();
      return;
    }

    const order: PendingOrder = {
      ...(payload as PendingOrder),
      receivedAt: payload.receivedAt ?? new Date().toISOString(),
    };
    this.entries.set(orderId, { order, ack: message.ack });
    this.notify();
  }

  list(): PendingOrder[] {
    return [...this.entries.values()]
      .map((entry) => entry.order)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  get(orderId: string): PendingOrder | undefined {
    return this.entries.get(orderId)?.order;
  }

  size(): number {
    return this.entries.size;
  }

  take(orderId: string): { order: PendingOrder; ack: () => void } | null {
    const entry = this.entries.get(orderId);
    if (!entry) return null;
    this.entries.delete(orderId);
    this.notify();
    return entry;
  }

  restore(orderId: string, entry: { order: PendingOrder; ack: () => void }): void {
    if (this.entries.has(orderId)) return;
    this.entries.set(orderId, entry);
    this.notify();
  }

  onChange(listener: OrdersListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[board] listener fallo:', error);
      }
    }
  }
}
