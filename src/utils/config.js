/**
 * Configuration loading and validation
 */

const fsSync = require('fs');
const path = require('path');

// Load config.json
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fsSync.readFileSync(CONFIG_PATH, 'utf-8'));

// Model configurations
const MODEL_CONFIGS = {
  sonnet: {
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    cacheWriteCostPer1M: 3.75,
    cacheReadCostPer1M: 0.30,
    dailyBudgetLimit: 10.00
  },
  haiku: {
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
    inputCostPer1M: 1.00,
    outputCostPer1M: 5.00,
    cacheWriteCostPer1M: 1.25,
    cacheReadCostPer1M: 0.10,
    dailyBudgetLimit: 10.00
  }
};

// Validate model config to prevent NaN issues
function validateModelConfig(modelConfig, name) {
  const requiredFields = ['model', 'provider', 'inputCostPer1M', 'outputCostPer1M', 'dailyBudgetLimit'];
  const missingFields = requiredFields.filter(field => modelConfig[field] === undefined);

  if (missingFields.length > 0) {
    throw new Error(`Model config '${name}' is missing required fields: ${missingFields.join(', ')}`);
  }

  const numericFields = ['inputCostPer1M', 'outputCostPer1M', 'dailyBudgetLimit'];
  for (const field of numericFields) {
    if (typeof modelConfig[field] !== 'number' || isNaN(modelConfig[field])) {
      throw new Error(`Model config '${name}' has invalid ${field}: ${modelConfig[field]}`);
    }
  }

  return true;
}

// Validate all configs on module load
for (const [name, modelConfig] of Object.entries(MODEL_CONFIGS)) {
  validateModelConfig(modelConfig, name);
}

// Get default model mode from environment
const MODEL_MODE = (process.env.MODEL_MODE || 'sonnet').toLowerCase();
const DEFAULT_COST_CONFIG = MODEL_CONFIGS[MODEL_MODE];

if (!DEFAULT_COST_CONFIG) {
  console.error(`Invalid MODEL_MODE: ${MODEL_MODE}. Must be one of: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
  process.exit(1);
}

// Channel names
const GAME_CHANNEL_NAME = 'crystal-ball-network';
const ACCOUNTS_CHANNEL_NAME = 'accounts';

module.exports = {
  config,
  MODEL_CONFIGS,
  MODEL_MODE,
  DEFAULT_COST_CONFIG,
  validateModelConfig,
  GAME_CHANNEL_NAME,
  ACCOUNTS_CHANNEL_NAME
};
