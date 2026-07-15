const { createEntityIntent } = require('./entityIntentCore')
const { mandateAiFilter } = require('./mandateAiFilter')

const mandateIntent = createEntityIntent({
  entityKey: 'mandates',
  singular: 'Mandate',
  plural: 'Mandates',
  filter: mandateAiFilter,
  schemaName: 'mandate_intent_v2',
  sortFields: {
    date_of_allocation: { aliases: ['latest mandates', 'oldest mandates'], permissionField: 'date_of_allocation', description: 'actual mandate allocation date' },
    job_id: { aliases: ['job number'], permissionField: 'job_id', description: 'numeric JB display ID order' },
    role: { aliases: ['alphabetical'], permissionField: 'role', description: 'role title' },
    budget: { aliases: ['highest budget', 'lowest budget'], permissionField: 'budget', description: 'semantic budget range bound in LPA' },
    experience: { aliases: ['lowest experience', 'highest experience'], permissionField: 'experience', description: 'semantic experience range in years' }
  },
  parseSort: mandateAiFilter.parseSort,
  extraInstructions: mandateAiFilter.guidance,
  examples: mandateAiFilter.examples
})

module.exports = {
  mandateIntent,
  mandateIntentSchema: mandateIntent.intentSchema,
  buildMandateIntentPrompt: mandateIntent.buildIntentPrompt,
  repairMandateIntent: mandateIntent.repairIntent,
  validateMandateIntent: mandateIntent.validateIntent,
  mandateExecutionFilter: mandateIntent.executionFilter,
  parseMandateIntent: mandateIntent.parseIntent
}
