import 'dotenv/config';

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type BrokerMode = 'real' | 'mock';

export const NAMING = {
  topicOrdersNew: 'newcron/dispatch/v1/orders/new',
  topicResults: 'newcron/dispatch/v1/results',
  topicResultsWildcard: 'newcron/dispatch/v1/results/#',
  queueOrdersAvailable: 'NEWCRON/Q01/ORDERS/AVAILABLE',
  queueResultsClients: 'NEWCRON/Q02/RESULTS/CLIENTS',
} as const;

export const QUEUE_DEFINITIONS: Array<{ name: string; subscriptionTopic: string }> = [
  {
    name: NAMING.queueOrdersAvailable,
    subscriptionTopic: 'newcron/dispatch/v1/orders/new',
  },
  {
    name: NAMING.queueResultsClients,
    subscriptionTopic: NAMING.topicResultsWildcard,
  },
];

const rawBrokerMode = (process.env.BROKER_MODE ?? 'mock').toLowerCase();

export const config = {
  port: int(process.env.PORT, 3000),
  timezone: process.env.BUSINESS_TIMEZONE ?? 'America/New_York',
  sameDayCutoffHour: int(process.env.SAME_DAY_CUTOFF_HOUR, 15),
  brokerMode: (rawBrokerMode === 'real' ? 'real' : 'mock') as BrokerMode,
  solace: {
    url: process.env.SOLACE_WSS_URL ?? '',
    vpnName: process.env.SOLACE_VPN ?? '',
    userName: process.env.SOLACE_USER ?? '',
    password: process.env.SOLACE_PASSWORD ?? '',
    sempUrl: process.env.SOLACE_SEMP_URL ?? '',
    sempUser: process.env.SOLACE_SEMP_USER ?? '',
    sempPassword: process.env.SOLACE_SEMP_PASSWORD ?? '',
  },
  paths: {
    dataDir: process.env.DATA_DIR ?? 'data',
  },
};
