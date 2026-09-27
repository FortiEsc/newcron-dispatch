/**
 * Provisiona las colas de NewCron en el broker Solace via SEMP v2 REST.
 * Idempotente: crea cola/suscripcion solo si no existen.
 *
 *   npm run provision
 */
import { config, QUEUE_DEFINITIONS } from '../src/config';

const { sempUrl, sempUser, sempPassword, vpnName } = config.solace;

function normalizeBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  if (trimmed.includes('/SEMP/v2/config')) return trimmed;
  return `${trimmed}/SEMP/v2/config`;
}

async function semp(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const url = `${normalizeBaseUrl(sempUrl)}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${sempUser}:${sempPassword}`).toString('base64')}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no-JSON */
  }
  return { status: response.status, json };
}

function describe(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

async function ensureQueue(queueName: string): Promise<void> {
  const path = `/msgVpns/${encodeURIComponent(vpnName)}/queues/${encodeURIComponent(queueName)}`;
  const existing = await semp('GET', path);
  if (existing.status === 200) {
    console.log(`  = cola ya existe: ${queueName}`);
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`GET cola ${queueName} devolvio ${existing.status}: ${describe(existing.json)}`);
  }

  const created = await semp('POST', `/msgVpns/${encodeURIComponent(vpnName)}/queues`, {
    queueName,
    accessType: 'non-exclusive',
    permission: 'consume',
    ingressEnabled: true,
    egressEnabled: true,
    maxMsgSpoolUsage: 100,
    TTL: 0,
    maxDeliveryCount: 10,
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(`POST cola ${queueName} devolvio ${created.status}: ${describe(created.json)}`);
  }
  console.log(`  + cola creada: ${queueName}`);
}

async function ensureSubscription(queueName: string, subscriptionTopic: string): Promise<void> {
  const base = `/msgVpns/${encodeURIComponent(vpnName)}/queues/${encodeURIComponent(queueName)}`;
  const subPath = `${base}/subscriptions/${encodeURIComponent(subscriptionTopic)}`;

  const existing = await semp('GET', subPath);
  if (existing.status === 200) {
    console.log(`  = suscripcion ya existe: ${queueName} <- ${subscriptionTopic}`);
    return;
  }
  if (existing.status !== 404) {
    throw new Error(
      `GET suscripcion devolvio ${existing.status}: ${describe(existing.json)}`
    );
  }

  const created = await semp('POST', `${base}/subscriptions`, { subscriptionTopic });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(
      `POST suscripcion devolvio ${created.status}: ${describe(created.json)}`
    );
  }
  console.log(`  + suscripcion creada: ${queueName} <- ${subscriptionTopic}`);
}

async function main(): Promise<void> {
  if (!sempUrl || !sempUser || !sempPassword || !vpnName) {
    console.log(
      [
        'SIN CREDENCIALES SEMP: no se provisionara nada.',
        'Las colas del broker simulado (BROKER_MODE=mock) no necesitan provisionamiento.',
        'Para provisionar en Solace Cloud completa en .env:',
        '  SOLACE_SEMP_URL, SOLACE_SEMP_USER, SOLACE_SEMP_PASSWORD, SOLACE_VPN',
        '(estan en Solace Cloud Console -> Connect tab -> SEMP - REST API)',
      ].join('\n')
    );
    return;
  }

  console.log(`Provisionando colas en msgVpn "${vpnName}" (${normalizeBaseUrl(sempUrl)})`);
  for (const definition of QUEUE_DEFINITIONS) {
    await ensureQueue(definition.name);
    await ensureSubscription(definition.name, definition.subscriptionTopic);
  }
  console.log('Listo. Colas y suscripciones verificadas.');
}

main().catch((error) => {
  console.error('Fallo el provisionamiento:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
