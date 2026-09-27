import * as path from 'path';
import express, { type Request, type Response } from 'express';
import { NAMING, resultsTopic } from '../config';
import { EmailNotifier } from '../email/notifier';
import type { PendingOrder, ResultPayload } from '../domain/types';
import { validateDispatchRequest } from '../domain/validation';
import type { Broker } from '../solace';
import type { Store, StoreEvent } from '../store/store';
import type { OrdersBoard } from './ordersBoard';

export interface AppDeps {
  broker: Broker;
  store: Store;
  notifier: EmailNotifier;
  board: OrdersBoard;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

const ACCEPTED_NOTES = 'You will receive an email when a carrier accepts this dispatch request';

function extractShipperOrderId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>).shipperOrderId;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function createSseClient(res: Response) {
  res.writeHead(200, SSE_HEADERS);
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  return {
    send(event: string, data: unknown) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      clearInterval(ping);
      try {
        res.end();
      } catch {
        /* ya cerrado */
      }
    },
  };
}

export function createApp(deps: AppDeps): express.Express {
  const { broker, store, notifier, board } = deps;
  const app = express();

  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(path.join(process.cwd(), 'public')));

  const brokerStatus = () => ({ mode: broker.mode, status: broker.status, detail: broker.statusDetail });

  app.get('/api/status', (_req, res) => {
    res.json({
      broker: brokerStatus(),
      availableOrders: board.size(),
      requests: store.listRequests().length,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  app.post('/api/requests', async (req: Request, res: Response) => {
    const outcome = validateDispatchRequest(req.body);
    const receivedAt = new Date().toISOString();

    try {
      if (outcome.valid && outcome.request) {
        const request = outcome.request;
        store.saveRequest(request, receivedAt);

        const orderPayload: PendingOrder = { ...request, receivedAt };
        await broker.publish(NAMING.topicOrdersNew, orderPayload, request.shipperOrderId);

        const result: ResultPayload = {
          shipperOrderId: request.shipperOrderId,
          status: 'Accepted',
          notes: ACCEPTED_NOTES,
        };
        await broker.publish(resultsTopic('Accepted'), result, request.shipperOrderId);
        return res.status(202).json(result);
      }

      const result: ResultPayload = {
        shipperOrderId: extractShipperOrderId(req.body) ?? 'unknown',
        status: 'Cancelled',
        notes: outcome.notes ?? 'Invalid request payload.',
      };
      await broker.publish(resultsTopic('Cancelled'), result, result.shipperOrderId);
      return res.status(422).json(result);
    } catch (error) {
      console.error('[api] fallo al publicar la solicitud:', error);
      return res.status(503).json({
        shipperOrderId: extractShipperOrderId(req.body) ?? 'unknown',
        status: 'Error',
        notes: 'The dispatch broker is not available. Try again later.',
      });
    }
  });

  app.get('/api/requests', (_req, res) => {
    res.json({ requests: store.listRequests() });
  });

  app.get('/api/requests/:id', (req, res) => {
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Solicitud no encontrada' });
    return res.json(record);
  });

  app.get('/api/emails', (_req, res) => {
    res.json({ emails: store.listEmails() });
  });

  app.get('/api/orders', (_req, res) => {
    res.json({ broker: brokerStatus(), orders: board.list() });
  });

  app.post('/api/orders/:id/accept', async (req, res) => {
    const orderId = req.params.id;
    const carrierId =
      typeof req.body?.carrierId === 'string' && req.body.carrierId.trim()
        ? req.body.carrierId.trim()
        : 'carrier-anonimo';

    const entry = board.take(orderId);
    if (!entry) {
      return res.status(404).json({ error: 'El pedido no esta disponible (ya fue aceptado)' });
    }

    const result: ResultPayload = {
      shipperOrderId: orderId,
      status: 'CarrierAssigned',
      notes: `Carrier "${carrierId}" accepted this dispatch request.`,
    };

    try {
      await broker.publish(resultsTopic('CarrierAssigned'), result, orderId);
    } catch (error) {
      board.restore(orderId, entry);
      console.error('[api] fallo al publicar la aceptacion:', error);
      return res.status(503).json({ error: 'Broker no disponible, el pedido sigue abierto' });
    }

    entry.ack();

    const record = store.get(orderId);
    if (record?.request) {
      notifier.sendCarrierAssigned(record.request, carrierId);
    }

    return res.json({ ...result, carrierId });
  });

  app.get('/api/stream', (req: Request, res: Response) => {
    const client = createSseClient(res);
    client.send('snapshot', {
      requests: store.listRequests(),
      emails: store.listEmails(),
      orders: board.list(),
      broker: brokerStatus(),
    });

    const offStore = store.onChange((event: StoreEvent) => client.send('store', event));
    const offOrders = board.onChange((orders) => client.send('orders', { orders }));
    const offBroker = broker.onStatusChange(() => client.send('broker', brokerStatus()));

    req.on('close', () => {
      offStore();
      offOrders();
      offBroker();
      client.close();
    });
  });

  app.get('/api/orders/stream', (req: Request, res: Response) => {
    const client = createSseClient(res);
    client.send('snapshot', { orders: board.list(), broker: brokerStatus() });

    const offOrders = board.onChange((orders) => client.send('orders', { orders }));
    const offBroker = broker.onStatusChange(() => client.send('broker', brokerStatus()));

    req.on('close', () => {
      offOrders();
      offBroker();
      client.close();
    });
  });

  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html'));
  });

  return app;
}
