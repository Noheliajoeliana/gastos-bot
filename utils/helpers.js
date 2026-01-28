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
    // Cualquier otro día, retroceder al último domingo
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
  }

  return weekStart;
}

// Parsear mensaje de gasto
function parseExpense(text) {
  // Formato: "monto metodo [tasa] descripcion [proporcional]"
  // Ejemplos:
  //   "20 cash comida" (50/50)
  //   "20 cash comida proporcional" (41/59)
  //   "1200 bs 60 restaurante proporcional"

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
    // Debe tener tasa
    if (parts.length < 4) {
      return null;
    }
    rate = parseFloat(parts[2]);
    if (isNaN(rate)) {
      return null;
    }

    // Descripción y verificar si es proporcional
    const descParts = parts.slice(3);
    isProportional = descParts[descParts.length - 1].toLowerCase() === 'proporcional';

    if (isProportional) {
      description = descParts.slice(0, -1).join(' ');
    } else {
      description = descParts.join(' ');
    }

  } else {
    // cash
    const descParts = parts.slice(2);
    isProportional = descParts[descParts.length - 1].toLowerCase() === 'proporcional';

    if (isProportional) {
      description = descParts.slice(0, -1).join(' ');
    } else {
      description = descParts.join(' ');
    }
  }

  // Verificar que la descripción no esté vacía
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

// Calcular monto en dólares
function calculateUSD(amount, method, rate) {
  if (method === 'cash') {
    return amount;
  }
  // bs
  return amount / rate;
}

// Calcular resumen de gastos con proporciones según tipo de gasto
function calculateSummary(expenses, userId1, userId2, proportion1, proportion2) {
  let total1 = 0;  // Total gastado por usuario 1
  let total2 = 0;  // Total gastado por usuario 2

  const expenses1 = [];
  const expenses2 = [];

  // Acumular cuánto debe pagar cada uno
  let debeUser1 = 0;
  let debeUser2 = 0;
  expenses.forEach((exp, i) => {
    const amountUSD = calculateUSD(exp.amount, exp.method, exp.rate);

    if (exp.userId === userId1) {
      total1 += amountUSD;
      expenses1.push({ ...exp._doc, amountUSD, num: i+1 });


    } else if (exp.userId === userId2) {
      total2 += amountUSD;
      expenses2.push({ ...exp._doc, amountUSD, num: i+1 });
    }
    if (exp.isProportional) {
      debeUser2 += amountUSD * proportion2;
      debeUser1 += amountUSD * proportion1;
    } else {
      debeUser2 += amountUSD * 0.5; // 50/50
      debeUser1 += amountUSD * 0.5; // 50/50
    }
  });
  const totalGeneral = total1 + total2;

  // Calcular quién debe a quién
  let balance = 0;
  let deudor = '';
  let acreedor = '';

  if (total1 > debeUser1) {
    // Usuario 1 pagó más de lo que le corresponde
    balance = total1 - debeUser1;
    deudor = 'Usuario2';
    acreedor = 'Usuario1';
  } else if (total2 > debeUser2) {
    // Usuario 2 pagó más de lo que le corresponde
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
