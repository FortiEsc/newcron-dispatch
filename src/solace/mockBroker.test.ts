import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NAMING, resultsTopic } from '../config';
import { MockBroker } from './mockBroker';
import { topicMatches } from './broker';

const definitions = [
  { name: NAMING.queueOrdersAvailable, subscriptionTopic: 'newcron/dispatch/v1/orders/new' },
  { name: NAMING.queueResultsClients, subscriptionTopic: 'newcron/dispatch/v1/results/>' },
];

describe('topicMatches (wildcards Solace)', () => {
  it('matchea topic exacto', () => {
    expect(topicMatches('a/b/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/b/c', 'a/b/d')).toBe(false);
  });

  it('matchea con > (uno o mas tokens)', () => {
    expect(topicMatches('a/>', 'a/b')).toBe(true);
    expect(topicMatches('a/>', 'a/b/c')).toBe(true);
    expect(topicMatches('a/>', 'b/c')).toBe(false);
  });

  it('matchea con * (un solo token)', () => {
    expect(topicMatches('a/*/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/*/c', 'a/b/x/c')).toBe(false);
  });

  it('no matchea prefijo parcial', () => {
    expect(topicMatches('a/b', 'a/bc')).toBe(false);
  });
});

describe('MockBroker', () => {
  let stateFile: string;

  beforeEach(() => {
    stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'newcron-')), 'broker.json');
  });

  afterEach(() => {
    fs.rmSync(path.dirname(stateFile), { recursive: true, force: true });
  });

  it('publica a la cola suscrita y entrega el payload al consumidor', async () => {
    const broker = new MockBroker(definitions, stateFile);
    await broker.connect();

    const received: unknown[] = [];
    await broker.consume(NAMING.queueOrdersAvailable, (message) => {
      received.push(message.payload);
      message.ack();
    });

    const payload = { shipperOrderId: '6600111', price: 900 };
    await broker.publish(NAMING.topicOrdersNew, payload, '6600111');

    expect(received).toEqual([payload]);
    expect(broker.browse(NAMING.queueOrdersAvailable)).toEqual([]);
  });

  it('los resultados viajan a su cola aunque nadie este suscrito aun', async () => {
    const broker = new MockBroker(definitions, stateFile);
    await broker.connect();
    await broker.publish(
      resultsTopic('Accepted'),
      { shipperOrderId: '1', status: 'Accepted', notes: 'ok' },
      '1'
    );

    const received: unknown[] = [];
    await broker.consume(NAMING.queueResultsClients, (message) => {
      received.push(message.payload);
      message.ack();
    });

    expect(received).toHaveLength(1);
  });

  it('sin ack el mensaje permanece en la cola (semantica de pending)', async () => {
    const broker = new MockBroker(definitions, stateFile);
    await broker.connect();

    await broker.consume(NAMING.queueOrdersAvailable, () => {
      /* no hace ack: simula pedido visible en el dashboard */
    });
    await broker.publish(NAMING.topicOrdersNew, { shipperOrderId: '7' }, '7');

    expect(broker.browse(NAMING.queueOrdersAvailable)).toEqual([{ shipperOrderId: '7' }]);
  });

  it('restaura colas pendientes tras reiniciar (durable como Solace)', async () => {
    const first = new MockBroker(definitions, stateFile);
    await first.connect();
    await first.publish(NAMING.topicOrdersNew, { shipperOrderId: '42' }, '42');
    first.disconnect();

    const second = new MockBroker(definitions, stateFile);
    await second.connect();
    expect(second.browse(NAMING.queueOrdersAvailable)).toEqual([{ shipperOrderId: '42' }]);
  });

  it('el topico de resultados NO llega a la cola de pedidos', async () => {
    const broker = new MockBroker(definitions, stateFile);
    await broker.connect();
    await broker.publish(resultsTopic('Cancelled'), { shipperOrderId: '9', status: 'Cancelled' });
    expect(broker.browse(NAMING.queueOrdersAvailable)).toEqual([]);
    expect(broker.browse(NAMING.queueResultsClients)).toHaveLength(1);
  });
});
