import { config, NAMING } from '../config';
import { EmailNotifier } from '../email/notifier';
import type { ResultPayload } from '../domain/types';
import { createBroker } from '../solace';
import { Store } from '../store/store';
import { createApp } from './app';
import { OrdersBoard } from './ordersBoard';

async function main(): Promise<void> {
  const broker = createBroker();
  const store = new Store();
  const notifier = new EmailNotifier(store);
  const board = new OrdersBoard();

  broker.onStatusChange((status, detail) => console.log(`[broker] ${status}: ${detail}`));

  console.log(`NewCron Global Dispatch - broker mode: ${config.brokerMode}`);
  await broker.connect();

  // Cola 1: pedidos disponibles para transportistas (dashboard).
  await board.attach(broker);

  // Cola 2: resultados de solicitudes para el portal de clientes.
  await broker.consume(NAMING.queueResultsClients, (message) => {
    const payload = message.payload as Partial<ResultPayload> | null;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.shipperOrderId !== 'string' ||
      typeof payload.status !== 'string'
    ) {
      console.warn('[results] payload invalido en la cola de resultados, se ignora');
      message.ack();
      return;
    }
    store.applyResult(payload as ResultPayload);
    message.ack();
  });

  const app = createApp({ broker, store, notifier, board });
  const server = app.listen(config.port, () => {
    console.log(`Portal de clientes : http://localhost:${config.port}/`);
    console.log(`Dashboard carriers : http://localhost:${config.port}/dashboard`);
    console.log(`API status         : http://localhost:${config.port}/api/status`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} recibido, cerrando...`);
    server.close(() => {
      broker.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Fallo el arranque de NewCron Global Dispatch:', error);
  process.exit(1);
});
