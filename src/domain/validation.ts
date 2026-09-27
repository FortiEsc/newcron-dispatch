import { DateTime } from 'luxon';
import { config } from '../config';
import type { DispatchRequest, Stop, ValidationOutcome, Vehicle } from './types';

export interface ValidationContext {
  now: DateTime;
  timezone: string;
  sameDayCutoffHour: number;
}

export function defaultValidationContext(): ValidationContext {
  return {
    now: DateTime.now().setZone(config.timezone),
    timezone: config.timezone,
    sameDayCutoffHour: config.sameDayCutoffHour,
  };
}

export const NOTES = {
  pickupInPast: 'Pickup date cannot be earlier than the current date.',
  deliveryTooSoon: 'Delivery date must be at least one day after the pickup date.',
  sameDayAfterCutoff: (hour: number): string =>
    `Same-day pickup requests must be received before ${hour % 12}:00 ${hour < 12 ? 'a.m.' : 'p.m.'}`,
  invalidPayload: (fields: string[]): string =>
    `Invalid request payload. Check these fields: ${fields.join(', ')}.`,
} as const;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asIsoDate(value: unknown, zone: string): string | null {
  if (typeof value !== 'string') return null;
  const parsed = DateTime.fromISO(value, { zone });
  if (!parsed.isValid) return null;
  return parsed.toISODate();
}

function asPositiveNumber(value: unknown): number | null {
  const num =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function parseStops(value: unknown): { stops: Stop[] | null; invalid: boolean } {
  if (!Array.isArray(value) || value.length === 0) return { stops: null, invalid: true };
  const stops: Stop[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return { stops: null, invalid: true };
    const record = item as Record<string, unknown>;
    const stopNumber = Number(record.stopNumber);
    const city = asNonEmptyString(record.city);
    const state = asNonEmptyString(record.state);
    const postalCode = asNonEmptyString(record.postalCode);
    if (!Number.isInteger(stopNumber) || stopNumber < 1 || !city || !state || !postalCode) {
      return { stops: null, invalid: true };
    }
    stops.push({ stopNumber, city, state, postalCode });
  }
  return { stops, invalid: false };
}

function parseVehicles(value: unknown): { vehicles: Vehicle[] | null; invalid: boolean } {
  if (!Array.isArray(value) || value.length === 0) return { vehicles: null, invalid: true };
  const vehicles: Vehicle[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return { vehicles: null, invalid: true };
    const record = item as Record<string, unknown>;
    const year = asNonEmptyString(record.year);
    const make = asNonEmptyString(record.make);
    const model = asNonEmptyString(record.model);
    if (!year || !make || !model) return { vehicles: null, invalid: true };
    vehicles.push({ year, make, model });
  }
  return { vehicles, invalid: false };
}

export function validateDispatchRequest(
  input: unknown,
  ctx: ValidationContext = defaultValidationContext()
): ValidationOutcome {
  if (typeof input !== 'object' || input === null) {
    return {
      valid: false,
      request: null,
      notes: NOTES.invalidPayload(['body must be a JSON object']),
    };
  }

  const raw = input as Record<string, unknown>;
  const errors: string[] = [];

  const shipperOrderId = asNonEmptyString(raw.shipperOrderId);
  if (!shipperOrderId) errors.push('shipperOrderId');

  const pickupDate = asIsoDate(raw.pickupDate, ctx.timezone);
  if (!pickupDate) errors.push('pickupDate (YYYY-MM-DD)');

  const deliveryDate = asIsoDate(raw.deliveryDate, ctx.timezone);
  if (!deliveryDate) errors.push('deliveryDate (YYYY-MM-DD)');

  const price = asPositiveNumber(raw.price);
  if (price === null) errors.push('price');

  const { stops, invalid: stopsInvalid } = parseStops(raw.stops);
  if (stopsInvalid) errors.push('stops (min 1 valid stop)');

  const { vehicles, invalid: vehiclesInvalid } = parseVehicles(raw.vehicles);
  if (vehiclesInvalid) errors.push('vehicles (min 1 valid vehicle)');

  if (errors.length > 0) {
    return { valid: false, request: null, notes: NOTES.invalidPayload(errors) };
  }

  // Invariante: si no hubo errores, todos los campos parseados son no-nulos.
  if (!shipperOrderId || !pickupDate || !deliveryDate || price === null || !stops || !vehicles) {
    throw new Error('validation invariant violated: campos parseados deberian ser validos');
  }

  const request: DispatchRequest = {
    shipperOrderId,
    pickupDate,
    deliveryDate,
    price,
    stops,
    vehicles,
  };
  if (typeof raw.transportationReleaseNotes === 'string') {
    request.transportationReleaseNotes = raw.transportationReleaseNotes;
  }

  const today = ctx.now.startOf('day');
  const pickup = DateTime.fromISO(pickupDate, { zone: ctx.timezone }).startOf('day');
  const delivery = DateTime.fromISO(deliveryDate, { zone: ctx.timezone }).startOf('day');

  if (pickup < today) {
    return { valid: false, request: null, notes: NOTES.pickupInPast };
  }

  if (pickup.equals(today) && ctx.now.hour >= ctx.sameDayCutoffHour) {
    return { valid: false, request: null, notes: NOTES.sameDayAfterCutoff(ctx.sameDayCutoffHour) };
  }

  if (delivery.diff(pickup, 'days').days < 1) {
    return { valid: false, request: null, notes: NOTES.deliveryTooSoon };
  }

  return { valid: true, request, notes: null };
}
