require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Account = require('./models/Account');
const Transaction = require('./models/Transaction');
const DebtPayment = require('./models/DebtPayment');
const Loan = require('./models/Loan');
const LoanPayment = require('./models/LoanPayment');
const Period = require('./models/Period');

// Account balances to restore after reset — keep in sync with seed.js
const accounts = [
  { name: 'Banco Azteca', ownerName: 'Antonio', balance: 20.72 },
  { name: 'Facebank',     ownerName: 'Antonio', balance: 144.9 },
  { name: 'Efectivo',     ownerName: 'Antonio', balance: 14.0 },
  { name: 'Ontop',        ownerName: 'Antonio', balance: 452.76 },
  { name: 'Binance',      ownerName: 'Antonio', balance: 854.22 },
  { name: 'Binance',      ownerName: 'Nohelia', balance: 336.16 },
];

async function reset() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected');

  const [txCount] = await Promise.all([
    Transaction.countDocuments(),
  ]);
  console.log(`\n⚠️  Esto borrará:`);
  console.log(`   • ${txCount} transacciones`);
  const loanCount = await Loan.countDocuments();
  const loanPayCount = await LoanPayment.countDocuments();
  const debtPayCount = await DebtPayment.countDocuments();
  const periodCount = await Period.countDocuments();
  console.log(`   • ${loanCount} préstamos + ${loanPayCount} pagos de préstamo`);
  console.log(`   • ${debtPayCount} pagos de deuda compartida`);
  console.log(`   • ${periodCount} periodos`);
  console.log(`   • Saldos de cuentas restaurados a valores del seed\n`);

  // Clear all transactional data
  await Transaction.deleteMany({});
  console.log('🗑  Transacciones borradas');

  await LoanPayment.deleteMany({});
  await Loan.deleteMany({});
  console.log('🗑  Préstamos y pagos borrados');

  await DebtPayment.deleteMany({});
  console.log('🗑  Pagos de deuda compartida borrados');

  await Period.deleteMany({});
  console.log('🗑  Periodos borrados');

  // Restore account balances
  const nohelia = await User.findOne({ name: 'Nohelia' });
  const antonio = await User.findOne({ name: 'Antonio' });
  const userMap = { Nohelia: nohelia, Antonio: antonio };

  for (const acc of accounts) {
    const owner = userMap[acc.ownerName];
    if (!owner) { console.warn(`⚠️  Usuario desconocido: ${acc.ownerName}`); continue; }
    await Account.findOneAndUpdate(
      { name: acc.name, owner: owner._id },
      { balance: acc.balance }
    );
    console.log(`✅ Balance restaurado: ${acc.name} (${acc.ownerName}) → $${acc.balance}`);
  }

  // Create fresh active period
  await Period.create({ startDate: new Date(), createdBy: nohelia._id, isActive: true });
  console.log('✅ Periodo nuevo creado');

  console.log('\n🎉 Reset completo. El bot está listo para empezar desde cero.');
  await mongoose.disconnect();
}

reset().catch(err => {
  console.error('❌ Reset error:', err);
  process.exit(1);
});
