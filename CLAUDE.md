# Bot de Gastos - Guia del Proyecto

## Descripcion

Bot de Telegram para rastrear y saldar gastos compartidos y deudas individuales entre dos usuarios. Los gastos se registran en USD (cash) o bolivares venezolanos (bs), con soporte para division 50/50 o proporcional por ingresos. El cierre semanal se ejecuta manualmente mediante un flujo de confirmacion entre ambos usuarios.

## Stack

- **Runtime**: Node.js 18+
- **Framework del bot**: Telegraf v4 (long-polling, sin webhooks)
- **Base de datos**: MongoDB via Mongoose v9
- **Deployment**: Render (Express en el puerto `PORT` para health checks)
- **Testing**: Jest (pendiente de implementar)
- **Linter**: ESLint

## Estructura del proyecto

```
index.js            # Punto de entrada: handlers de comandos, middleware, servidor Express
models/
  Expense.js        # Schema de documento semanal con array embebido de gastos
  Debt.js           # Schema de deuda individual entre usuarios
utils/
  helpers.js        # Parsing de mensajes, conversion de moneda, calculo de balances
```

## Flujo general

### Registro de gastos compartidos
1. El usuario envia un mensaje de texto plano (no un comando) al bot.
2. El handler `bot.on('text')` lo intercepta, llama a `parseExpense()` para extraer monto, metodo, tasa, descripcion y si es proporcional.
3. Se busca el documento de semana abierta (`processed: false`). Si no existe, se crea uno nuevo con `getWeekStart()`.
4. El gasto se agrega al array `expenses` del documento semanal y se guarda.

### Semana de facturacion
- Empieza cada **domingo a las 19:01** (hora local del servidor).
- `getWeekStart()` calcula el ultimo domingo 19:01 como inicio de semana.

### Registro de deudas individuales (`/deuda`)
- Las deudas no estan atadas a la semana; se acumulan independientemente.
- Se almacenan en una coleccion separada (`Debt`).
- El monto se convierte a USD al momento del registro.
- Ambos usuarios reciben notificacion.

### Resumen (`/resumen`)
- Muestra gastos compartidos, deudas individuales y balance total neto.
- No modifica la base de datos, es solo lectura.
- Usa `calculateSummary()` para el calculo de balances.

### Cierre/corte (`/corte`)
1. Un usuario inicia la solicitud con `/corte`.
2. Se crea un estado in-memory (`pendingReset`) con el ID del iniciador.
3. El otro usuario debe confirmar con `/si` o rechazar con `/no`.
4. El iniciador puede cancelar con `/cancelar`.
5. Si no hay respuesta en **5 minutos**, la solicitud expira automaticamente.
6. Al confirmar: se ejecuta `enviarResumenSemanal()`, que envia el resumen a ambos usuarios, marca el documento de la semana como `processed: true` y las deudas como `settled: true`.

### Convencion de signos en balances
- **Positivo**: usuario 2 le debe a usuario 1.
- **Negativo**: usuario 1 le debe a usuario 2.
- `balance_gastos` y `balance_deudas` usan la misma convencion para poder sumarse directamente.

## Variables de entorno (`.env`)

```
BOT_TOKEN           # Token del bot de Telegram
MONGODB_URI         # Connection string de MongoDB
USER_ID_1           # Telegram ID numerico del usuario 1
USER_ID_2           # Telegram ID numerico del usuario 2
USER_NAME_1         # Nombre del usuario 1
USER_NAME_2         # Nombre del usuario 2
USER_PROPORTION_1   # Proporcion de ingresos usuario 1 (ej: 0.41)
USER_PROPORTION_2   # Proporcion de ingresos usuario 2 (ej: 0.59)
PORT                # Puerto para el servidor Express (default: 3000)
```

## Comandos del bot

| Comando | Descripcion |
|---------|-------------|
| `/resumen` | Ver gastos y deudas de la semana actual |
| `/eliminar N` | Eliminar gasto propio numero N de la semana |
| `/deuda <monto> <metodo> [<tasa>] <desc> <deudor>` | Registrar deuda individual |
| `/eliminardeuda N` | Eliminar deuda numero N |
| `/corte` | Solicitar cierre semanal |
| `/si` | Confirmar corte pendiente |
| `/no` | Rechazar corte pendiente |
| `/cancelar` | Cancelar solicitud de corte propia |
| `/ayuda` | Ver ayuda en Telegram |

## Convenciones de codigo

- **Idioma del codigo**: Todo el codigo (variables, funciones, comentarios) debe estar en **ingles**.
- **Mensajes al usuario** (strings de Telegram): en **espanol** (es la interfaz del bot).
- Usar `const`/`let`, nunca `var`.
- ESLint configurado en el proyecto.

## Comandos utiles

```bash
npm start          # Ejecutar el bot
npm test           # Ejecutar tests (Jest)
npm run lint       # Ejecutar ESLint
```
