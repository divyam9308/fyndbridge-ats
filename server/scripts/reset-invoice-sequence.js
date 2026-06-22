require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const [billingEntity, financialYear, confirmation] = process.argv.slice(2)

if (!['FCS', 'FCAPL'].includes(billingEntity) || !/^\d{2}-\d{2}$/.test(financialYear || '') || confirmation !== '--yes') {
  console.error('Usage: npm run invoice:reset -- <FCS|FCAPL> <YY-YY> --yes')
  process.exit(1)
}

const supabase = require('../src/services/supabaseAdmin')

async function reset() {
  const { data, error } = await supabase
    .from('invoices')
    .delete()
    .eq('billing_entity', billingEntity)
    .eq('financial_year', financialYear)
    .select('invoice_number')

  if (error) throw error
  console.log(`Reset ${billingEntity}/${financialYear}; deleted ${data.length} invoice record(s). Next invoice: 001`)
}

reset().catch(error => {
  console.error(error.message)
  process.exit(1)
})
