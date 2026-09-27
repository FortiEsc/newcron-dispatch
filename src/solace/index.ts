import { config, QUEUE_DEFINITIONS } from '../config';
import type { Broker } from './broker';
import { MockBroker } from './mockBroker';
import { SolaceBroker } from './solaceBroker';

export * from './broker';
export { MockBroker } from './mockBroker';
export { SolaceBroker } from './solaceBroker';

export function createBroker(): Broker {
  if (config.brokerMode === 'real') {
    return new SolaceBroker({
      url: config.solace.url,
      vpnName: config.solace.vpnName,
      userName: config.solace.userName,
      password: config.solace.password,
    });
  }
  return new MockBroker(QUEUE_DEFINITIONS);
}
