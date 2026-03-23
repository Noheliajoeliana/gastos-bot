# Bot de Gastos

A Telegram bot for tracking and settling shared expenses and individual debts between two users. Expenses can be recorded in USD (cash) or Venezuelan bolívars (bs), with support for equal (50/50) or income-proportional splits. Settlement is triggered manually via a two-user confirmation flow.

---

## Requirements

- Node.js 18+
- A MongoDB instance (local or cloud, e.g. MongoDB Atlas)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

---

## Setup

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file at the project root with the following variables:
   ```env
   BOT_TOKEN=your_telegram_bot_token
   MONGODB_URI=your_mongodb_connection_string

   USER_ID_1=telegram_numeric_id_user1
   USER_ID_2=telegram_numeric_id_user2
   USER_NAME_1=Name1
   USER_NAME_2=Name2

   # Income-based proportions (must add up to 1)
   USER_PROPORTION_1=0.41
   USER_PROPORTION_2=0.59
   ```

3. Start the bot:
   ```bash
   npm start
   ```

---

## How it works

### Billing week

The week starts every **Sunday at 19:01** (local time). Any expense registered after that cutoff belongs to the new week.

### Recording a shared expense

Send a plain-text message (no slash command needed):

| Format | Description |
|--------|-------------|
| `20 cash groceries` | $20, equal 50/50 split |
| `20 cash groceries proporcional` | $20, proportional split |
| `1200 bs 60 restaurant` | 1200 bs ÷ rate 60 = $20, 50/50 |
| `1200 bs 60 restaurant proporcional` | same, proportional split |

The **proportional** split divides the expense according to each user's configured income proportion instead of halves.

### Commands

| Command | Description |
|---------|-------------|
| `/resumen` | Show current week's expenses, individual debts, and net balance |
| `/eliminar N` | Delete your own expense number N from the current week |
| `/deuda <amount> <method> [<rate>] <description> <debtorName>` | Record a one-sided individual debt |
| `/eliminardeuda N` | Delete individual debt number N (e.g. entered by mistake) |
| `/corte` | Request a settlement — sends a confirmation request to the other user |
| `/si` | Confirm a pending settlement request |
| `/no` | Reject a pending settlement request |
| `/cancelar` | Cancel your own pending settlement request |
| `/ayuda` | Show the help message inside Telegram |

### Settlement (/corte)

When `/corte` is used:
1. The initiating user sends the request and a preview is shown to both users.
2. The **other** user must confirm with `/si` (or reject with `/no`).
3. On confirmation, the bot sends a full weekly summary to both users and marks all expenses and debts as settled.
4. If no response is received within **5 minutes**, the request expires automatically.

---

## Project structure

```
├── index.js            # Bot entry point, command handlers
├── models/
│   ├── Expense.js      # Weekly expense document schema
│   └── Debt.js         # Individual debt schema
└── utils/
    └── helpers.js      # Parsing, currency conversion, and balance calculation
```

---

## Deployment

The `npm start` script runs the bot directly with Node.js using long-polling, which works on any cloud server (VPS, Railway, Render, etc.) without requiring a public URL or webhook configuration.

Make sure the environment variables from `.env` are available in the deployment environment (most platforms provide a secrets/env vars UI).