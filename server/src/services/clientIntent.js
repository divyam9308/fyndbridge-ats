const { createEntityIntent } = require('./entityIntentCore')
const { clientAiFilter } = require('./clientAiFilter')

const clientIntent = createEntityIntent({
  entityKey: 'clients',
  singular: 'Client',
  plural: 'Clients',
  filter: clientAiFilter,
  schemaName: 'client_intent_v2',
  sortFields: {
    created_at: { aliases: ['latest clients', 'oldest clients'], permissionField: 'created_at', description: 'client creation time' },
    client_id: { aliases: ['client number'], permissionField: 'client_id', description: 'numeric client display ID order' },
    client_name: { aliases: ['alphabetical'], permissionField: 'client_name', description: 'client name' },
    value: { aliases: ['client value', 'highest value'], permissionField: 'value', description: 'normalized absolute INR value' },
    next_follow_up_date: { aliases: ['earliest follow up'], permissionField: 'next_follow_up_date', description: 'next scheduled follow-up date' }
  },
  parseSort: clientAiFilter.parseSort,
  extraInstructions: clientAiFilter.guidance,
  examples: clientAiFilter.examples
})

module.exports = {
  clientIntent,
  clientIntentSchema: clientIntent.intentSchema,
  buildClientIntentPrompt: clientIntent.buildIntentPrompt,
  repairClientIntent: clientIntent.repairIntent,
  validateClientIntent: clientIntent.validateIntent,
  clientExecutionFilter: clientIntent.executionFilter,
  parseClientIntent: clientIntent.parseIntent
}
