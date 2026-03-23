// Obtener el inicio de la semana actual (último domingo 19:01)
function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = domingo, 1 = lunes, etc.

  let weekStart = new Date(now);
  weekStart.setHours(19, 1, 0, 0);

  if (dayOfWeek === 0) {
    // Es domingo
    if (now.getHours() < 19 || (now.getHours() === 19 && now.getMinutes() < 1)) {
      // Antes de las 19:01, usar domingo anterior
      weekStart.setDate(weekStart.getDate() - 7);
    }
    // Después de las 19:01, usar hoy
  } else {
    // Any other weekday: rewind to the most recent Sunday.
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
  }

  return weekStart;
}

/**
 * Parses a free-text expense message sent by the user and returns a structured object.
 *
 * Expected format: "<amount> <method> [<rate>] <description> [proporcional]"
 *   - method: "cash" (amount is already in USD) or "bs" (Venezuelan bolívars, requires a rate).
 *   - The optional trailing keyword "proporcional" switches the split from the default
 *     50/50 to the configured income-based proportion (e.g. 41/59).
 *
 * Examples:
 *   "20 cash groceries"               → 50/50 split, $20
 *   "20 cash groceries proporcional"  → proportional split, $20
 *   "1200 bs 60 restaurant"           → 50/50 split, 1200 bs ÷ 60 = $20
 *   "1200 bs 60 restaurant proporcional"
 *
 * Returns null if the message does not match the expected format.
 */
function parseExpense(text) {
  const parts = text.trim().split(/\s+/);

  if (parts.length < 3) {
    return null;
  }

  const amount = parseFloat(parts[0]);
  const method = parts[1].toLowerCase();

  if (isNaN(amount) || !['cash', 'bs'].includes(method)) {
    return null;
  }

  let rate = null;
  let description = '';
  let isProportional = false;

  if (method === 'bs') {
    // Bolívars require an exchange rate as the third token.
    if (parts.length < 4) {
      return null;
    }
    rate = parseFloat(parts[2]);
    if (isNaN(rate)) {
      return null;
    }

    // Everything after the rate is the description; strip "proporcional" if present.
    const descParts = parts.slice(3);
    isProportional = descParts[descParts.length - 1].toLowerCase() === 'proporcional';

    if (isProportional) {
      description = descParts.slice(0, -1).join(' ');
    } else {
      description = descParts.join(' ');
    }

  } else {
    // Cash: everything after the method token is the description.
    const descParts = parts.slice(2);
    isProportional = descParts[descParts.length - 1].toLowerCase() === 'proporcional';

    if (isProportional) {
      description = descParts.slice(0, -1).join(' ');
    } else {
      description = descParts.join(' ');
    }
  }

  if (!description.trim()) {
    return null;
  }

  return {
    amount,
    method,
    rate,
    description,
    isProportional
  };
}

/**
 * Converts an expense amount to USD.
 *
 * "cash" amounts are treated as already denominated in USD and returned unchanged.
 * "bs" (bolívars) amounts are divided by the provided exchange rate because the
 * rate represents bolívars per dollar (bs/USD), making division the correct
 * operation to obtain the equivalent dollar value.
 */
function calculateUSD(amount, method, rate) {
  if (method === 'cash') {
    return amount;
  }
  return amount / rate;
}

/**
 * Computes the weekly shared-expense summary, determining who owes whom and how much.
 *
 * Each expense can have one of two split modes:
 *   - Proportional (isProportional = true): split according to proportion1/proportion2,
 *     which reflect each user's income share (e.g. 0.41 / 0.59). Used for recurring
 *     household costs where a fair share is based on earnings rather than equal halves.
 *   - Equal (isProportional = false): split 50/50 regardless of income. Used for
 *     discretionary or one-off shared purchases.
 *
 * The balance is calculated as the difference between what a user actually paid
 * (total1 or total2) and what they were supposed to pay (debeUser1 or debeUser2).
 * If a user paid more than their share, the other user owes them the difference.
 *
 * @param {Array}  expenses    - Array of expense subdocuments from the week document.
 * @param {number} userId1     - Telegram ID of user 1.
 * @param {number} userId2     - Telegram ID of user 2.
 * @param {number} proportion1 - Decimal share for user 1 (e.g. 0.41).
 * @param {number} proportion2 - Decimal share for user 2 (e.g. 0.59).
 * @returns {Object} Summary containing totals, individual expense lists, and the net balance.
 */
function calculateSummary(expenses, userId1, userId2, proportion1, proportion2) {
  let total1 = 0;  // Total actually spent by user 1
  let total2 = 0;  // Total actually spent by user 2

  const expenses1 = [];
  const expenses2 = [];

  // debeUser1/debeUser2 accumulate what each user is obligated to contribute
  // across all expenses, mixing proportional and equal splits as needed.
  let debeUser1 = 0;
  let debeUser2 = 0;

  expenses.forEach((exp, i) => {
    const amountUSD = calculateUSD(exp.amount, exp.method, exp.rate);

    if (exp.userId === userId1) {
      total1 += amountUSD;
      expenses1.push({ ...exp._doc, amountUSD, num: i + 1 });
    } else if (exp.userId === userId2) {
      total2 += amountUSD;
      expenses2.push({ ...exp._doc, amountUSD, num: i + 1 });
    }

    if (exp.isProportional) {
      debeUser1 += amountUSD * proportion1;
      debeUser2 += amountUSD * proportion2;
    } else {
      debeUser1 += amountUSD * 0.5; // equal split
      debeUser2 += amountUSD * 0.5; // equal split
    }
  });

  const totalGeneral = total1 + total2;

  // Determine the net creditor and debtor by comparing actual payments to obligations.
  // Only one user can owe the other; the balance is the absolute overpayment amount.
  let balance = 0;
  let deudor = '';
  let acreedor = '';

  if (total1 > debeUser1) {
    // User 1 paid more than their share — user 2 owes the difference.
    balance = total1 - debeUser1;
    deudor = 'Usuario2';
    acreedor = 'Usuario1';
  } else if (total2 > debeUser2) {
    // User 2 paid more than their share — user 1 owes the difference.
    balance = total2 - debeUser2;
    deudor = 'Usuario1';
    acreedor = 'Usuario2';
  }

  return {
    total1,
    total2,
    totalGeneral,
    debeUser1,
    debeUser2,
    expenses1,
    expenses2,
    balance,
    deudor,
    acreedor
  };
}

module.exports = {
  getWeekStart,
  parseExpense,
  calculateUSD,
  calculateSummary
};