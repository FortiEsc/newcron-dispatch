const state = {
  requests: new Map(),
  emails: [],
  broker: { mode: '-', status: 'disconnected', detail: '' },
};

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function nyTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-GN', {
    timeZone: 'America/New_York',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function badgeFor(status) {
  const map = {
    Accepted: 'ok',
    CarrierAssigned: 'info',
    Cancelled: 'bad',
    Pending: 'warn',
  };
  return `<span class="badge ${map[status] || ''}">${esc(status)}</span>`;
}

function toast(message, kind = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  setTimeout(() => {
    el.className = 'toast';
  }, 3500);
}

function renderBroker() {
  const { status, mode, detail } = state.broker;
  $('broker-dot').className = `dot ${status}`;
  $('broker-label').textContent = `${mode} / ${status}`;
  $('broker-label').title = detail;
}

function renderRequests() {
  const list = [...state.requests.values()].sort((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt)
  );
  $('requests-count').textContent = String(list.length);
  $('requests-empty').style.display = list.length ? 'none' : 'block';

  $('requests').innerHTML = list
    .map((record) => {
      const request = record.request;
      const history = (record.history || [])
        .map(
          (entry) =>
            `<li>${esc(nyTime(entry.at))} - ${esc(entry.status)}: ${esc(entry.notes)}</li>`
        )
        .join('');
      return `
        <article class="card">
          <h3>${esc(record.shipperOrderId)} ${badgeFor(record.status)}</h3>
          <div class="muted">${esc(record.notes || 'Esperando resultado...')}</div>
          ${
            request
              ? `
            <div class="kv"><span>Pickup</span><span>${esc(request.pickupDate)}</span></div>
            <div class="kv"><span>Delivery</span><span>${esc(request.deliveryDate)}</span></div>
            <div class="kv"><span>Precio</span><span>$${esc(request.price)}</span></div>
            <div class="kv"><span>Paradas</span><span>${request.stops
                .map((stop) => esc(`${stop.city}/${stop.state}`))
                .join(' -> ')}</span></div>
            <div class="kv"><span>Vehiculos</span><span>${request.vehicles
                .map((vehicle) => esc(`${vehicle.year} ${vehicle.make} ${vehicle.model}`))
                .join(', ')}</span></div>`
              : ''
          }
          <div class="kv"><span>Recibido</span><span>${esc(nyTime(record.receivedAt))}</span></div>
          ${history ? `<ul class="history">${history}</ul>` : ''}
        </article>`;
    })
    .join('');
}

function renderEmails() {
  $('emails-empty').style.display = state.emails.length ? 'none' : 'block';
  $('emails').innerHTML = state.emails
    .slice()
    .reverse()
    .map(
      (email) => `
      <article class="card" style="margin-bottom:10px">
        <h3>${esc(email.subject)} <span class="muted">${esc(nyTime(email.sentAt))}</span></h3>
        <div class="kv"><span>Para</span><span>${esc(email.to)}</span></div>
        <div class="muted">${esc(email.body)}</div>
      </article>`
    )
    .join('');
}

function renderAll() {
  renderBroker();
  renderRequests();
  renderEmails();
}

function addStopRow(values = {}) {
  const row = document.createElement('div');
  row.className = 'stop-row';
  row.innerHTML = `
    <div><label>Ciudad</label><input class="city" required value="${esc(values.city || '')}" placeholder="Milford" /></div>
    <div><label>Estado</label><input class="state" required maxlength="2" value="${esc(
      values.state || ''
    )}" placeholder="MA" /></div>
    <div><label>Codigo postal</label><input class="postal" required value="${esc(
      values.postalCode || ''
    )}" placeholder="01757" /></div>
    <div><button type="button" class="ghost small">Quitar</button></div>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('stops').appendChild(row);
}

function addVehicleRow(values = {}) {
  const row = document.createElement('div');
  row.className = 'vehicle-row';
  row.innerHTML = `
    <div><label>Ano</label><input class="year" required value="${esc(
      values.year || ''
    )}" placeholder="2010" /></div>
    <div><label>Marca</label><input class="make" required value="${esc(
      values.make || ''
    )}" placeholder="Toyota" /></div>
    <div><label>Modelo</label><input class="model" required value="${esc(
      values.model || ''
    )}" placeholder="Corolla" /></div>
    <div><button type="button" class="ghost small">Quitar</button></div>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('vehicles').appendChild(row);
}

function showResult(result, httpOk) {
  const banner = $('result');
  banner.className = `banner show ${httpOk ? 'ok' : 'bad'}`;
  banner.innerHTML = `<strong>${esc(result.status)} - ${esc(result.shipperOrderId)}</strong>${esc(
    result.notes
  )}`;
}

async function submitForm(event) {
  event.preventDefault();

  const stops = [...document.querySelectorAll('#stops .stop-row')].map((row, index) => ({
    stopNumber: index + 1,
    city: row.querySelector('.city').value.trim(),
    state: row.querySelector('.state').value.trim().toUpperCase(),
    postalCode: row.querySelector('.postal').value.trim(),
  }));

  const vehicles = [...document.querySelectorAll('#vehicles .vehicle-row')].map((row) => ({
    year: row.querySelector('.year').value.trim(),
    make: row.querySelector('.make').value.trim(),
    model: row.querySelector('.model').value.trim(),
  }));

  const payload = {
    shipperOrderId: $('shipperOrderId').value.trim(),
    pickupDate: $('pickupDate').value,
    deliveryDate: $('deliveryDate').value,
    price: Number($('price').value),
    stops,
    vehicles,
    transportationReleaseNotes: $('notes').value.trim() || undefined,
  };
  const email = $('shipperEmail').value.trim();
  if (email) payload.shipperEmail = email;

  $('submit-btn').disabled = true;
  try {
    const response = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    showResult(result, response.ok);
    toast(`${result.status}: ${result.shipperOrderId}`, response.ok ? 'ok' : 'bad');
  } catch (error) {
    showResult(
      { status: 'Error', shipperOrderId: payload.shipperOrderId, notes: String(error) },
      false
    );
  } finally {
    $('submit-btn').disabled = false;
  }
}

function connectStream() {
  const stream = new EventSource('/api/stream');

  stream.addEventListener('snapshot', (event) => {
    const data = JSON.parse(event.data);
    data.requests.forEach((record) => state.requests.set(record.shipperOrderId, record));
    state.emails = data.emails;
    state.broker = data.broker;
    renderAll();
  });

  stream.addEventListener('store', (event) => {
    const change = JSON.parse(event.data);
    if (change.type === 'email:sent') {
      state.emails.push(change.email);
      renderEmails();
      return;
    }
    state.requests.set(change.record.shipperOrderId, change.record);
    renderRequests();
  });

  stream.addEventListener('broker', (event) => {
    state.broker = JSON.parse(event.data);
    renderBroker();
  });

  stream.onerror = () => {
    state.broker = { ...state.broker, status: 'error', detail: 'SSE desconectado' };
    renderBroker();
  };
}

async function bootstrap() {
  addStopRow({ city: 'Milford', state: 'MA', postalCode: '01757' });
  addStopRow({ city: 'Shippensburg', state: 'PA', postalCode: '17257' });
  addVehicleRow({ year: '2010', make: 'Toyota', model: 'Corolla' });

  const today = new Date();
  $('pickupDate').value = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  $('deliveryDate').value = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10);

  $('add-stop').addEventListener('click', () => addStopRow());
  $('add-vehicle').addEventListener('click', () => addVehicleRow());
  $('request-form').addEventListener('submit', submitForm);

  try {
    const [requestsResponse, emailsResponse, statusResponse] = await Promise.all([
      fetch('/api/requests'),
      fetch('/api/emails'),
      fetch('/api/status'),
    ]);
    const requestsData = await requestsResponse.json();
    const emailsData = await emailsResponse.json();
    const statusData = await statusResponse.json();
    requestsData.requests.forEach((record) => state.requests.set(record.shipperOrderId, record));
    state.emails = emailsData.emails;
    state.broker = statusData.broker;
    renderAll();
  } catch (error) {
    renderAll();
  }

  connectStream();
}

bootstrap();
