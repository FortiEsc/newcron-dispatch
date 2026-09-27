import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { DispatchRequest } from './types';
import { NOTES, validateDispatchRequest, type ValidationContext } from './validation';

const ZONE = 'America/New_York';

function ctxAt(iso: string): ValidationContext {
  return { now: DateTime.fromISO(iso, { zone: ZONE }), timezone: ZONE, sameDayCutoffHour: 15 };
}

function baseRequest(overrides: Partial<DispatchRequest> = {}): Record<string, unknown> {
  return {
    shipperOrderId: '6600111',
    pickupDate: '2026-09-21',
    deliveryDate: '2026-09-22',
    price: 900,
    stops: [
      { stopNumber: 1, city: 'Milford', state: 'MA', postalCode: '01757' },
      { stopNumber: 2, city: 'Shippensburg', state: 'PA', postalCode: '17257' },
    ],
    vehicles: [{ year: '2010', make: 'Toyota', model: 'Corolla' }],
    transportationReleaseNotes:
      'Verify the pickup date; shipments cannot be delivered after 3:00 p.m. on the current date or on previous days.',
    ...overrides,
  };
}

describe('validateDispatchRequest - happy path', () => {
  it('accepts the payload del enunciado (pickup hoy, entrega manana, 9:00 a.m.)', () => {
    const outcome = validateDispatchRequest(baseRequest(), ctxAt('2026-09-21T09:00:00'));
    expect(outcome.valid).toBe(true);
    expect(outcome.notes).toBeNull();
    expect(outcome.request?.shipperOrderId).toBe('6600111');
    expect(outcome.request?.stops).toHaveLength(2);
    expect(outcome.request?.price).toBe(900);
  });

  it('acepta pickup futuro con delivery al dia siguiente', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ pickupDate: '2026-09-25', deliveryDate: '2026-09-26' }),
      ctxAt('2026-09-21T18:45:00')
    );
    expect(outcome.valid).toBe(true);
  });

  it('acepta pickup hoy antes del corte (14:59)', () => {
    const outcome = validateDispatchRequest(baseRequest(), ctxAt('2026-09-21T14:59:59'));
    expect(outcome.valid).toBe(true);
  });

  it('normaliza tipos (shipperOrderId numerico, year numerico)', () => {
    const outcome = validateDispatchRequest(
      baseRequest({
        shipperOrderId: 7743789 as unknown as string,
        vehicles: [{ year: 2010 as unknown as string, make: 'Toyota', model: 'Corolla' }],
      }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(true);
    expect(outcome.request?.shipperOrderId).toBe('7743789');
    expect(outcome.request?.vehicles[0].year).toBe('2010');
  });
});

describe('validateDispatchRequest - fecha de pickup', () => {
  it('cancela si pickup es anterior a hoy', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ pickupDate: '2026-09-20', deliveryDate: '2026-09-22' }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toBe('Pickup date cannot be earlier than the current date.');
    expect(outcome.request).toBeNull();
  });

  it('cancela si pickup es hoy y se recibe a las 15:00 exactas', () => {
    const outcome = validateDispatchRequest(baseRequest(), ctxAt('2026-09-21T15:00:00'));
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toBe('Same-day pickup requests must be received before 3:00 p.m.');
  });

  it('cancela si pickup es hoy y se recibe despues de las 3:00 p.m.', () => {
    const outcome = validateDispatchRequest(baseRequest(), ctxAt('2026-09-21T16:30:00'));
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toBe(NOTES.sameDayAfterCutoff(15));
  });

  it('usa America/New_York, no la hora UTC del servidor', () => {
    const nowNyon22h = DateTime.fromISO('2026-09-21T02:00:00', { zone: 'utc' }).setZone(ZONE);
    expect(nowNyon22h.toISODate()).toBe('2026-09-20');

    const outcome = validateDispatchRequest(baseRequest(), {
      now: nowNyon22h,
      timezone: ZONE,
      sameDayCutoffHour: 15,
    });
    expect(outcome.valid).toBe(true);
  });
});

describe('validateDispatchRequest - fecha de delivery', () => {
  it('cancela si delivery es igual a pickup', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ deliveryDate: '2026-09-21' }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toBe(NOTES.deliveryTooSoon);
  });

  it('cancela si delivery es anterior a pickup', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ pickupDate: '2026-09-25', deliveryDate: '2026-09-24' }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toBe(NOTES.deliveryTooSoon);
  });

  it('acepta exactamente un dia de diferencia', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ pickupDate: '2026-09-25', deliveryDate: '2026-09-26' }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(true);
  });
});

describe('validateDispatchRequest - schema', () => {
  it('rechaza payload que no es objeto', () => {
    const outcome = validateDispatchRequest('hola', ctxAt('2026-09-21T09:00:00'));
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toContain('Invalid request payload');
  });

  it('rechaza si faltan stops', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ stops: [] }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toContain('stops');
  });

  it('rechaza si faltan vehicles', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ vehicles: [] }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toContain('vehicles');
  });

  it('rechaza si el precio no es numerico positivo', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ price: -5 }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toContain('price');
  });

  it('rechaza fechas mal formadas', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ pickupDate: '21-09-2026' }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toContain('pickupDate');
  });

  it('rechaza si falta shipperOrderId', () => {
    const outcome = validateDispatchRequest(
      baseRequest({ shipperOrderId: '' }),
      ctxAt('2026-09-21T09:00:00')
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.notes).toContain('shipperOrderId');
  });
});
