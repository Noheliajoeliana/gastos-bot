# Bot de Finanzas de Pareja — Guía del Proyecto

## Descripción

Bot de Telegram para registro y seguimiento de finanzas personales de una pareja (Nohelia y Antonio). Soporta gastos compartidos con división 50/50 o 41/59, ingresos individuales, transferencias entre cuentas, préstamos entre ambos y seguimiento de presupuestos por categoría.

## Stack

- **Runtime**: Node.js
- **Framework del bot**: Telegraf v4 (webhooks en producción, long-polling en local)
- **Base de datos**: MongoDB via Mongoose
- **Deployment**: Render (Express en el puerto `PORT` para health checks y webhook)
- **Zona horaria**: America/Mexico_City (aplicada en `index.js` vía `process.env.TZ`)
- **Moneda base**: USD. Otras monedas se convierten con tasa manual: `amountUSD = amount / exchangeRate`

## Estructura del proyecto

```
index.js                 # Entrada: Express server, bot setup, middleware, router de texto
models/
  User.js               # Usuarios fijos: Nohelia y Antonio
  Account.js            # Cuentas individuales con balance en USD
  Category.js           # Categorías de gasto/ingreso con presupuesto mensual opcional
  Transaction.js        # Gastos, ingresos y transferencias
  DebtPayment.js        # Pagos del saldo neto por gastos compartidos
  Loan.js               # Préstamos formales entre los dos usuarios
  LoanPayment.js        # Abonos a préstamos
  Period.js             # Periodos de resumen (solo uno activo a la vez)
handlers/
  menu.js              # /start, /menu
  gasto.js             # /gasto — flujo conversacional con inline keyboards
  ingreso.js           # /ingreso
  transferencia.js     # /transferencia
  prestamo.js          # /prestamo
  pagoPrestamo.js      # /pagoprestamo
  pagarDeuda.js        # /pagardeuda
  consultas.js         # /consultas — menú de consultas
  nuevoPeriodo.js      # /nuevoPeriodo
  eliminar.js          # /eliminar — borrar últimos movimientos
utils/
  helpers.js           # calculateNetBalance, calculateDebt, getFrequentConfig, etc.
  session.js           # sessionMap en memoria (Map<chatId, sessionState>)
seed.js                # Script de seed inicial (llenar arrays antes de correr)
```

## Flujo de sesiones

El estado conversacional vive en `sessionMap` (en memoria). Si el servidor se reinicia, las sesiones se pierden y el usuario debe reiniciar el flujo con el comando correspondiente.

Estructura de sesión:
```js
{ command: 'gasto', step: 'enterAmount', data: { accountId, amount, ... } }
```

Steps que esperan texto del usuario: `enterAmount`, `enterRate`, `enterNote`.
Steps que esperan un botón: todos los demás.

## Callback data de inline keyboards

Prefijos por flujo (todos dentro del límite de 64 bytes):
- `g:` gasto, `in:` ingreso, `tr:` transferencia, `pr:` préstamo
- `pp:` pago de préstamo, `pd:` pago de deuda, `co:` consultas
- `np:` nuevo periodo, `el:` eliminar, `mn:` menú principal

## Modelo de deuda compartida

### Dirección de deuda en transacciones
- `debtDirection: "toHim"` — Nohelia le debe a Antonio (Antonio pagó)
- `debtDirection: "toHer"` — Antonio le debe a Nohelia (Nohelia pagó)

### Cálculo del saldo neto (calculado en tiempo real, no almacenado)
```
saldoDeuda = Σ debtAmount[toHim] - Σ debtAmount[toHer]
             - Σ debtPayments[paidBy=Nohelia] + Σ debtPayments[paidBy=Antonio]

saldoPrestamos = Σ loans.remainingAmountUSD[herToHim]  (Nohelia debe a Antonio)
               - Σ loans.remainingAmountUSD[himToHer]  (Antonio debe a Nohelia)

saldoTotal = saldoDeuda + saldoPrestamos
```
Positivo → Nohelia le debe a Antonio. Negativo → Antonio le debe a Nohelia.

### Préstamos
- `herToHim` — Nohelia es deudora, Antonio es acreedor (él le prestó a ella)
- `himToHer` — Antonio es deudor, Nohelia es acreedora (ella le prestó a él)

## Transacciones compartidas

Para gastos compartidos con dos categorías (una por usuario) se crean DOS registros:
1. **Transacción principal**: `isShared=true`, `debtDirection`, `debtAmount`, payer's account & category
2. **Transacción de presupuesto**: `isShared=false`, `amountUSD=debtAmount`, other's category (para tracking de presupuesto)

Solo la transacción principal se cuenta en `calculateNetBalance`.

## Variables de entorno (`.env`)

```
BOT_TOKEN           # Token del bot de Telegram
MONGODB_URI         # Connection string de MongoDB
USER_ID_1           # Telegram ID numérico de Nohelia
USER_ID_2           # Telegram ID numérico de Antonio
PORT                # Puerto Express (default: 3000)
WEBHOOK_DOMAIN      # Dominio público para webhook (si no está, usa long-polling)
```

## Comandos del bot

| Comando | Descripción |
|---------|-------------|
| `/start` / `/menu` | Menú principal |
| `/gasto` | Registrar gasto (flujo completo con botones) |
| `/ingreso` | Registrar ingreso |
| `/transferencia` | Transferir entre cuentas |
| `/prestamo` | Registrar préstamo |
| `/pagoprestamo` | Abonar a préstamo activo |
| `/pagardeuda` | Abonar al saldo neto compartido |
| `/consultas` | Consultas: saldo, cuentas, presupuesto, etc. |
| `/nuevoperiodo` | Cerrar periodo activo y abrir uno nuevo |
| `/eliminar` | Eliminar uno de los últimos 5 movimientos |
| `/cancelar` | Cancelar flujo activo en cualquier paso |

## Seed inicial

```bash
# 1. Llenar los arrays `accounts` y `categories` en seed.js
# 2. Correr:
npm run seed
```

El seed es idempotente: usa `findOneAndUpdate` con `upsert: true`, se puede correr múltiples veces.

## Comandos útiles

```bash
npm start          # Ejecutar el bot
npm run seed       # Correr el seed inicial
npm run lint       # ESLint
```

## Convenciones de código

- **Idioma del código**: inglés (variables, funciones)
- **Mensajes al usuario**: español
- Usar `const`/`let`, nunca `var`
- Sin comentarios salvo cuando el WHY no es obvio
