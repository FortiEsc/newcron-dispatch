# NewCron Global Dispatch

Pipeline de despacho de car haulers sobre Solace PubSub+: los shipper envían solicitudes de transporte, las solicitudes válidas viajan por colas Solace hasta el dashboard de transportistas, y el estado vuelve al portal en tiempo real.

## Requisitos

- Node.js 24+
- (Opcional) cuenta Solace Cloud — sin ella el proyecto corre en modo mock

## Setup

```powershell
npm install
copy .env.example .env   # completa las credenciales de Solace si usas modo real
npm start
```

## URLs

| URL | Qué es |
|---|---|
| `http://localhost:3000/` | Portal del shipper (crear y consultar solicitudes) |
| `http://localhost:3000/dashboard` | Dashboard de transportistas (pedidos disponibles) |
| `/api/status`, `/api/requests`, `/api/orders`, `/api/emails` | API JSON |
| `/api/stream`, `/api/orders/stream` | SSE (tiempo real, sin recargar) |

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run demo` | prueba end-to-end de los 8 escenarios (levanta su propio servidor) |
| `npm test` | 32 tests unitarios |
| `npm run typecheck` | revisión de tipos |
| `npm run provision` | crea/verifica colas y suscripciones en Solace (idempotente) |
| `npm run reset` | borra `data/` (estado, emails, broker simulado) |
| `npm run dev` | servidor con auto-rearranque |

## Modos de broker

| `BROKER_MODE` | Comportamiento |
|---|---|
| `real` | se conecta a Solace Cloud por `wss` (requiere las 7 credenciales en `.env`) |
| `mock` | broker simulado en `data/mock-broker.json` (desarrollo sin credenciales) |
