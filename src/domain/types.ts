export interface Stop {
  stopNumber: number;
  city: string;
  state: string;
  postalCode: string;
}

export interface Vehicle {
  year: string;
  make: string;
  model: string;
}

export interface DispatchRequest {
  shipperOrderId: string;
  pickupDate: string;
  deliveryDate: string;
  price: number;
  stops: Stop[];
  vehicles: Vehicle[];
  transportationReleaseNotes?: string;
  shipperEmail?: string;
}

export type ResultStatus = 'Accepted' | 'Cancelled' | 'CarrierAssigned';

export interface ResultPayload {
  shipperOrderId: string;
  status: ResultStatus;
  notes: string;
}

export interface PendingOrder extends DispatchRequest {
  receivedAt: string;
}

export interface ValidationOutcome {
  valid: boolean;
  request: DispatchRequest | null;
  notes: string | null;
}
