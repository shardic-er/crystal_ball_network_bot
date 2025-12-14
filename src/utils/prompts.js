/**
 * Prompt file loading and management
 */

const fs = require('fs').promises;
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

// Prompt name constants
const PROMPT_NAMES = {
  SYSTEM: 'cbn_system_prompt',
  PRICING: 'cbn_pricing_prompt',
  BUYER: 'cbn_buyer_prompt',
  NEGOTIATION: 'cbn_negotiation_prompt',
  OFFER_CLASSIFIER: 'cbn_offer_classifier_prompt',
  CRAFTING: 'cbn_crafting_prompt',
  SYNERGY: 'cbn_synergy_prompt'
};

// Store loaded prompts
const prompts = {};

/**
 * Load a single prompt file
 * @param {string} name - Prompt name (without .md extension)
 * @returns {Promise<string>} Prompt content
 */
async function loadPromptFile(name) {
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    console.log(`${name} loaded successfully`);
    return content;
  } catch (error) {
    console.error(`FATAL ERROR: Could not load ${name}:`, error);
    console.error(`Make sure ${name}.md exists in the prompts directory`);
    process.exit(1);
  }
}

/**
 * Load all prompt files
 */
async function loadPrompts() {
  console.log('Loading prompts...');

  for (const [key, name] of Object.entries(PROMPT_NAMES)) {
    prompts[key] = await loadPromptFile(name);
  }

  console.log('All prompts loaded successfully');
}

/**
 * Get a loaded prompt by key
 * @param {string} key - Prompt key from PROMPT_NAMES
 * @returns {string} Prompt content
 */
function getPrompt(key) {
  if (!prompts[key]) {
    throw new Error(`Prompt '${key}' not loaded. Call loadPrompts() first.`);
  }
  return prompts[key];
}

/**
 * Get all loaded prompts
 * @returns {Object} All prompts keyed by name
 */
function getAllPrompts() {
  return { ...prompts };
}

module.exports = {
  PROMPT_NAMES,
  loadPrompts,
  getPrompt,
  getAllPrompts
};
