const state = {
  orders: [],
  broker: { mode: '-', status: 'disconnected', detail: '' },
  accepted: [],
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

function toast(message, kind = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  setTimeout(() => {
    el.className = 'toast';
  }, 3500);
}

function carrierId() {
  return $('carrierId').value.trim() || 'carrier-anonimo';
}

function renderBroker() {
  $('broker-dot').className = `dot ${state.broker.status}`;
  $('broker-label').textContent = `${state.broker.mode} / ${state.broker.status}`;
  $('broker-detail').value = state.broker.detail || '';
}

function renderOrders() {
  $('queue-count').textContent = String(state.orders.length);
  $('orders-empty').style.display = state.orders.length ? 'none' : 'block';

  $('orders').innerHTML = state.orders
    .map((order) => {
      const stops = (order.stops || [])
        .map((stop) => `<li>${esc(stop.stopNumber)}. ${esc(stop.city)}, ${esc(stop.state)} ${esc(stop.postalCode)}</li>`)
        .join('');
      const vehicles = (order.vehicles || [])
        .map((vehicle) => `<li>${esc(vehicle.year)} ${esc(vehicle.make)} ${esc(vehicle.model)}</li>`)
        .join('');
      return `
        <article class="card" data-order="${esc(order.shipperOrderId)}">
          <h3>#${esc(order.shipperOrderId)} <span class="badge warn">$${esc(order.price)}</span></h3>
          <div class="kv"><span>Pickup</span><span>${esc(order.pickupDate)}</span></div>
          <div class="kv"><span>Delivery</span><span>${esc(order.deliveryDate)}</span></div>
          <div class="kv"><span>Recibido</span><span>${esc(nyTime(order.receivedAt))}</span></div>
          <div class="kv"><span>Paradas</span><span><ul class="list">${stops}</ul></span></div>
          <div class="kv"><span>Vehiculos</span><span><ul class="list">${vehicles}</ul></span></div>
          ${
            order.transportationReleaseNotes
              ? `<div class="muted" style="margin-top:8px">${esc(order.transportationReleaseNotes)}</div>`
              : ''
          }
          <div style="margin-top:12px">
            <button class="accept" data-id="${esc(order.shipperOrderId)}">Aceptar carga</button>
          </div>
        </article>`;
    })
    .join('');

  document.querySelectorAll('button.accept').forEach((button) => {
    button.addEventListener('click', () => acceptOrder(button.dataset.id, button));
  });
}

function renderAccepted() {
  $('accepted-empty').style.display = state.accepted.length ? 'none' : 'block';
  $('accepted').innerHTML = state.accepted
    .map(
      (item) => `
      <article class="card" style="margin-bottom:10px">
        <h3>#${esc(item.shipperOrderId)} <span class="badge info">${esc(item.status)}</span></h3>
        <div class="muted">${esc(item.notes)}</div>
        <div class="kv"><span>Hora NY</span><span>${esc(nyTime(item.at))}</span></div>
      </article>`
    )
    .join('');
}

function renderAll() {
  renderBroker();
  renderOrders();
  renderAccepted();
}

async function acceptOrder(orderId, button) {
  button.disabled = true;
  button.textContent = 'Aceptando...';
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carrierId: carrierId() }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || result.notes || 'No se pudo aceptar la carga');
    }
    state.accepted.unshift({ ...result, at: new Date().toISOString() });
    state.orders = state.orders.filter((order) => order.shipperOrderId !== orderId);
    renderOrders();
    renderAccepted();
    toast(`Carga ${orderId} aceptada por ${carrierId()}`, 'ok');
  } catch (error) {
    toast(String(error.message || error), 'bad');
    button.disabled = false;
    button.textContent = 'Aceptar carga';
  }
}

function connectStream() {
  const stream = new EventSource('/api/orders/stream');

  stream.addEventListener('snapshot', (event) => {
    const data = JSON.parse(event.data);
    state.orders = data.orders;
    state.broker = data.broker;
    renderAll();
  });

  stream.addEventListener('orders', (event) => {
    const data = JSON.parse(event.data);
    state.orders = data.orders;
    renderOrders();
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
  const saved = localStorage.getItem('newcron.carrierId');
  if (saved) $('carrierId').value = saved;

  $('save-carrier').addEventListener('click', () => {
    localStorage.setItem('newcron.carrierId', carrierId());
    toast(`Identidad guardada: ${carrierId()}`, 'ok');
  });

  try {
    const [ordersResponse, statusResponse] = await Promise.all([
      fetch('/api/orders'),
      fetch('/api/status'),
    ]);
    const ordersData = await ordersResponse.json();
    const statusData = await statusResponse.json();
    state.orders = ordersData.orders;
    state.broker = statusData.broker;
    renderAll();
  } catch (error) {
    renderAll();
  }

  connectStream();
}

bootstrap();
