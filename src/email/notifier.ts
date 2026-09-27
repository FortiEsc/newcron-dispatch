import type { DispatchRequest, ResultPayload } from '../domain/types';
import type { EmailRecord, Store } from '../store/store';

export function shipperEmailFor(request: Pick<DispatchRequest, 'shipperOrderId' | 'shipperEmail'>): string {
  if (request.shipperEmail) return request.shipperEmail;
  return `dispatch+${request.shipperOrderId}@shipper.example.com`;
}

export class EmailNotifier {
  constructor(private readonly store: Store) {}

  sendCarrierAssigned(request: DispatchRequest, carrierId: string): EmailRecord {
    return this.send({
      shipperOrderId: request.shipperOrderId,
      to: shipperEmailFor(request),
      subject: `Carrier assigned to dispatch ${request.shipperOrderId}`,
      body: [
        `Carrier "${carrierId}" accepted your dispatch request ${request.shipperOrderId}.`,
        `Pickup: ${request.pickupDate} - Delivery: ${request.deliveryDate} - Price: $${request.price}.`,
        'This is a simulated email from NewCron Global Dispatch.',
      ].join(' '),
    });
  }

  sendResult(result: ResultPayload, to: string): EmailRecord {
    return this.send({
      shipperOrderId: result.shipperOrderId,
      to,
      subject: `Dispatch ${result.shipperOrderId} - ${result.status}`,
      body: `${result.notes} (simulated email)`,
    });
  }

  private send(input: {
    shipperOrderId: string;
    to: string;
    subject: string;
    body: string;
  }): EmailRecord {
    const email: EmailRecord = { ...input, sentAt: new Date().toISOString() };
    this.store.addEmail(email);
    console.log(`[email] -> ${email.to} :: ${email.subject}`);
    return email;
  }
}
