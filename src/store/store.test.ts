import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DispatchRequest } from '../domain/types';
import { Store, type StoreEvent } from './store';

function sampleRequest(id = '6600111'): DispatchRequest {
  return {
    shipperOrderId: id,
    pickupDate: '2026-09-21',
    deliveryDate: '2026-09-22',
    price: 900,
    stops: [{ stopNumber: 1, city: 'Milford', state: 'MA', postalCode: '01757' }],
    vehicles: [{ year: '2010', make: 'Toyota', model: 'Corolla' }],
  };
}

describe('Store', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newcron-store-'));
    file = path.join(dir, 'state.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('guarda una solicitud con estado Pending', () => {
    const store = new Store(file);
    const record = store.saveRequest(sampleRequest(), '2026-09-21T13:00:00.000Z');
    expect(record.status).toBe('Pending');
    expect(store.listRequests()).toHaveLength(1);
    expect(store.get('6600111')?.request?.price).toBe(900);
  });

  it('aplica un resultado y acumula historial', () => {
    const store = new Store(file);
    store.saveRequest(sampleRequest());
    store.applyResult({
      shipperOrderId: '6600111',
      status: 'Accepted',
      notes: 'You will receive an email when a carrier accepts this dispatch request',
    });
    store.applyResult({
      shipperOrderId: '6600111',
      status: 'CarrierAssigned',
      notes: 'Carrier hauler-1 accepted',
    });

    const record = store.get('6600111');
    expect(record?.status).toBe('CarrierAssigned');
    expect(record?.history).toHaveLength(2);
    expect(record?.request).not.toBeNull();
  });

  it('aplica resultados aunque la solicitud no este en memoria (traido por la cola)', () => {
    const store = new Store(file);
    const record = store.applyResult({
      shipperOrderId: '7743789',
      status: 'Cancelled',
      notes: 'Pickup date cannot be earlier than the current date.',
    });
    expect(record.status).toBe('Cancelled');
    expect(record.request).toBeNull();
  });

  it('persiste entre instancias (sobrevive reinicios)', () => {
    const first = new Store(file);
    first.saveRequest(sampleRequest());
    first.applyResult({ shipperOrderId: '6600111', status: 'Accepted', notes: 'ok' });

    const second = new Store(file);
    expect(second.get('6600111')?.status).toBe('Accepted');
    expect(second.listRequests()).toHaveLength(1);
  });

  it('registra emails y los agrega al log', () => {
    const store = new Store(file);
    store.addEmail({
      shipperOrderId: '6600111',
      to: 'a@b.com',
      subject: 'hola',
      body: 'mundo',
      sentAt: '2026-09-21T13:00:00.000Z',
    });
    expect(store.listEmails()).toHaveLength(1);
    const log = fs.readFileSync(path.join(dir, 'emails.log'), 'utf8');
    expect(log).toContain('to=a@b.com');
  });

  it('emite eventos de cambio para las vistas SSE', () => {
    const store = new Store(file);
    const events: StoreEvent[] = [];
    store.onChange((event) => events.push(event));

    store.saveRequest(sampleRequest());
    store.applyResult({ shipperOrderId: '6600111', status: 'Accepted', notes: 'ok' });
    store.addEmail({
      shipperOrderId: '6600111',
      to: 'a@b.com',
      subject: 's',
      body: 'b',
      sentAt: '2026-09-21T13:00:00.000Z',
    });

    expect(events.map((event) => event.type)).toEqual([
      'request:saved',
      'result:applied',
      'email:sent',
    ]);
  });
});
