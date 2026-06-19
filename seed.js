require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Account = require('./models/Account');
const Category = require('./models/Category');
const Period = require('./models/Period');

// ── FILL THESE BEFORE RUNNING ────────────────────────────────────────────────

const accounts = [
  { name: 'Banco Azteca', ownerName: 'Antonio', balance: 24, originalCurrency: 'MXN' },
  { name: 'Facebank',     ownerName: 'Antonio', balance: 145, originalCurrency: 'USD' },
  { name: 'Efectivo',     ownerName: 'Antonio', balance: 20.85, originalCurrency: 'MXN' },
  { name: 'Ontop',        ownerName: 'Antonio',  balance: 452.76, originalCurrency: 'USD' },
  { name: 'Binance',      ownerName: 'Antonio',  balance: 752, originalCurrency: 'USD' },
  { name: 'Binance',     ownerName: 'Nohelia',  balance: 478.21, originalCurrency: 'USD' },
];

const categories = [
  // ── Gastos — Nohelia ──
  { name: 'Alimentación', ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 150 },
  { name: 'Carro',   ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 120 },
  { name: 'Salud',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 50 },
  { name: 'Casa y servicios',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 120 },
  { name: 'Veterinario',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 100 },
  { name: 'Ocio',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 100 },
  { name: 'Ropa y belleza',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 50 },
  { name: 'Saldo',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 20 },
  { name: 'HCV',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 55 },
  { name: 'Deportes',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 150 },
  { name: 'Condominio',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 20 },
  { name: 'Internet',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 50 },
  { name: 'Otros',        ownerName: 'Nohelia',  transactionType: 'expense', monthlyBudget: 150 },

  // ── Gastos — Antonio ──
  { name: 'Comida',       ownerName: 'Antonio', transactionType: 'expense', monthlyBudget: 200 },
  { name: 'Movilidad',   ownerName: 'Antonio', transactionType: 'expense', monthlyBudget: 50 },
  { name: 'Deporte',        ownerName: 'Antonio', transactionType: 'expense', monthlyBudget: 50 },
  { name: 'Ocio',        ownerName: 'Antonio', transactionType: 'expense', monthlyBudget: 100 },
  { name: 'Ropa',        ownerName: 'Antonio', transactionType: 'expense', monthlyBudget: 100 },
  { name: 'Servicios recurrentes',        ownerName: 'Antonio', transactionType: 'expense', monthlyBudget: 100 },

  // ── Ingresos — Nohelia ──
  { name: 'Salario',      ownerName: 'Nohelia',  transactionType: 'income', monthlyBudget: null },

  // ── Ingresos — Antonio ──
  { name: 'Salario',      ownerName: 'Antonio', transactionType: 'income', monthlyBudget: null },
];

// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected');

  // Users (idempotent — skips if already exists)
  const nohelia = await User.findOneAndUpdate(
    { telegramId: process.env.USER_ID_1 },
    { telegramId: process.env.USER_ID_1, name: 'Nohelia', defaultSplit: 41 },
    { upsert: true, new: true }
  );
  const antonio = await User.findOneAndUpdate(
    { telegramId: process.env.USER_ID_2 },
    { telegramId: process.env.USER_ID_2, name: 'Antonio', defaultSplit: 59 },
    { upsert: true, new: true }
  );
  console.log('✅ Users: Nohelia, Antonio');

  const userMap = { Nohelia: nohelia, Antonio: antonio };

  // Accounts
  for (const acc of accounts) {
    const owner = userMap[acc.ownerName];
    if (!owner) { console.warn(`⚠️ Unknown ownerName: ${acc.ownerName}`); continue; }
    await Account.findOneAndUpdate(
      { name: acc.name, owner: owner._id },
      { name: acc.name, owner: owner._id, balance: acc.balance, originalCurrency: acc.originalCurrency, isActive: true },
      { upsert: true }
    );
    console.log(`✅ Account: ${acc.name} (${acc.ownerName})`);
  }

  // Categories
  for (const cat of categories) {
    const owner = userMap[cat.ownerName];
    if (!owner) { console.warn(`⚠️ Unknown ownerName: ${cat.ownerName}`); continue; }
    await Category.findOneAndUpdate(
      { name: cat.name, owner: owner._id, transactionType: cat.transactionType },
      { name: cat.name, owner: owner._id, transactionType: cat.transactionType, monthlyBudget: cat.monthlyBudget },
      { upsert: true }
    );
    console.log(`✅ Category: ${cat.name} (${cat.ownerName}, ${cat.transactionType})`);
  }

  // First period (only if none exists)
  const existing = await Period.findOne({ isActive: true });
  if (!existing) {
    await Period.create({ startDate: new Date(), createdBy: nohelia._id, isActive: true });
    console.log('✅ Period: first active period created');
  } else {
    console.log('ℹ️  Period: active period already exists, skipping');
  }

  console.log('\n🎉 Seed complete.');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});
