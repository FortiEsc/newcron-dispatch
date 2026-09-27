/**
 * Demo end-to-end de NewCron Global Dispatch.
 * Levanta el servidor si no esta corriendo, envia solicitudes validas/invalidas,
 * acepta una carga como transportista y verifica los resultados.
 *
 *   npm run demo
 */
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { DateTime } from 'luxon';
import { config } from '../src/config';

const BASE_URL = `http://localhost:${config.port}`;
const ZONE = config.timezone;

interface ApiResponse<T = any> {
  httpStatus: number;
  body: T;
}

let failures = 0;

function check(condition: boolean, label: string, detail = ''): void {
  const mark = condition ? 'OK  ' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ` -> ${detail}` : ''}`);
}

async function request(
  method: string,
  apiPath: string,
  body?: unknown
): Promise<ApiResponse> {
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { httpStatus: response.status, body: parsed as any };
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/status`);
      if (response.ok) return true;
    } catch {
      /* aun no responde */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function waitForOrder(orderId: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const orders = await request('GET', '/api/orders');
    const found = (orders.body?.orders ?? []).some(
      (order: any) => order.shipperOrderId === orderId
    );
    if (found) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function waitForRequestStatus(
  orderId: string,
  status: string,
  timeoutMs = 15000
): Promise<ApiResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: ApiResponse = { httpStatus: 0, body: null };
  while (Date.now() < deadline) {
    last = await request('GET', `/api/requests/${orderId}`);
    if (last.body?.status === status) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

function samplePayload(overrides: Record<string, any>): Record<string, any> {
  const pickup = DateTime.now().setZone(ZONE).plus({ days: 3 });
  return {
    shipperOrderId: '6600111',
    pickupDate: pickup.toISODate(),
    deliveryDate: pickup.plus({ days: 1 }).toISODate(),
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

async function runScenarios(): Promise<void> {
  const now = DateTime.now().setZone(ZONE);
  const pastPickup = samplePayload({
    shipperOrderId: '7743789',
    pickupDate: '2026-09-21',
    deliveryDate: '2026-09-22',
  });
  const sameDay = now.hour >= config.sameDayCutoffHour;
  const valid = samplePayload({});
  const sameDayPayload = samplePayload({
    shipperOrderId: '8880001',
    pickupDate: now.toISODate(),
    deliveryDate: now.plus({ days: 1 }).toISODate(),
  });
  const deliveryEqual = samplePayload({ shipperOrderId: '5550001' });
  deliveryEqual.deliveryDate = deliveryEqual.pickupDate;
  const noVehicles = samplePayload({ shipperOrderId: '4440001', vehicles: [] });

  console.log('\n1) Payload valido (pickup futuro)');
  const r1 = await request('POST', '/api/requests', valid);
  check(r1.httpStatus === 202, 'HTTP 202', String(r1.httpStatus));
  check(r1.body?.status === 'Accepted', 'status Accepted', r1.body?.status);
  check(
    r1.body?.notes === 'You will receive an email when a carrier accepts this dispatch request',
    'notes exactos del enunciado',
    r1.body?.notes
  );

  console.log('\n2) Payload del enunciado con pickup en el pasado');
  const r2 = await request('POST', '/api/requests', pastPickup);
  check(r2.httpStatus === 422, 'HTTP 422', String(r2.httpStatus));
  check(r2.body?.status === 'Cancelled', 'status Cancelled', r2.body?.status);
  check(
    r2.body?.notes === 'Pickup date cannot be earlier than the current date.',
    'notes exactos del enunciado',
    r2.body?.notes
  );

  console.log(`\n3) Pickup hoy (${now.toISODate()} ${now.toFormat('HH:mm')} ${ZONE})`);
  const r3 = await request('POST', '/api/requests', sameDayPayload);
  if (sameDay) {
    check(r3.httpStatus === 422, 'cancelada por corte de 3:00 p.m.', String(r3.httpStatus));
    check(
      typeof r3.body?.notes === 'string' && r3.body.notes.includes('before 3:00 p.m.'),
      'notes del corte',
      r3.body?.notes
    );
  } else {
    check(r3.httpStatus === 202, 'aceptada antes del corte de 3:00 p.m.', String(r3.httpStatus));
    check(r3.body?.status === 'Accepted', 'status Accepted', r3.body?.status);
  }

  console.log('\n4) Delivery igual a pickup');
  const r4 = await request('POST', '/api/requests', deliveryEqual);
  check(r4.httpStatus === 422, 'HTTP 422', String(r4.httpStatus));
  check(
    typeof r4.body?.notes === 'string' && r4.body.notes.includes('at least one day'),
    'notes exigen un dia de diferencia',
    r4.body?.notes
  );

  console.log('\n5) Payload sin vehicles (schema)');
  const r5 = await request('POST', '/api/requests', noVehicles);
  check(r5.httpStatus === 422, 'HTTP 422', String(r5.httpStatus));
  check(
    typeof r5.body?.notes === 'string' && r5.body.notes.includes('Invalid request payload'),
    'notes de payload invalido',
    r5.body?.notes
  );

  console.log('\n6) El pedido valido esta en la cola del dashboard');
  const inQueue = await waitForOrder(valid.shipperOrderId);
  check(inQueue, `pedido ${valid.shipperOrderId} disponible para transportistas`);

  console.log('\n7) Un transportista acepta la carga');
  const r7 = await request('POST', `/api/orders/${valid.shipperOrderId}/accept`, {
    carrierId: 'demo-hauler-1',
  });
  check(r7.httpStatus === 200, 'HTTP 200', String(r7.httpStatus));
  check(r7.body?.status === 'CarrierAssigned', 'status CarrierAssigned', r7.body?.status);
  check(
    typeof r7.body?.notes === 'string' && r7.body.notes.includes('demo-hauler-1'),
    'notes identifican al transportista',
    r7.body?.notes
  );

  const r7b = await request('POST', `/api/orders/${valid.shipperOrderId}/accept`, {
    carrierId: 'otro',
  });
  check(r7b.httpStatus === 404, 'segunda aceptacion rechazada', String(r7b.httpStatus));

  console.log('\n8) El cliente ve el resultado y el email simulado');
  const record = await waitForRequestStatus(valid.shipperOrderId, 'CarrierAssigned');
  check(record.body?.status === 'CarrierAssigned', 'estado final CarrierAssigned', record.body?.status);
  check(
    (record.body?.history ?? []).length >= 2,
    'historial con Accepted y CarrierAssigned',
    String((record.body?.history ?? []).length)
  );

  const emails = await request('GET', '/api/emails');
  const email = (emails.body?.emails ?? []).find(
    (item: any) => item.shipperOrderId === valid.shipperOrderId
  );
  check(Boolean(email), 'email simulado enviado', email ? email.subject : 'sin email');

  const cancelled = await request('GET', '/api/requests/7743789');
  check(cancelled.body?.status === 'Cancelled', 'portal refleja Cancelled', cancelled.body?.status);
}

async function main(): Promise<void> {
  console.log(`NewCron Global Dispatch - demo contra ${BASE_URL} (broker: ${config.brokerMode})`);

  let child: ChildProcess | null = null;
  const running = await waitForServer(1500);
  if (running) {
    console.log('Usando el servidor ya corriendo en el puerto.');
  } else {
    console.log('Levantando el servidor para el demo...');
    const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    child = spawn(process.execPath, [tsxCli, path.join('src', 'server', 'main.ts')], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    const ready = await waitForServer(20000);
    if (!ready) {
      child.kill();
      throw new Error('El servidor no respondio en 20s');
    }
  }

  try {
    await runScenarios();
  } finally {
    if (child) child.kill();
  }

  console.log(
    failures === 0
      ? '\nDEMO OK - todas las verificaciones pasaron.'
      : `\nDEMO CON FALLOS - ${failures} verificaciones fallaron.`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Fallo el demo:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
