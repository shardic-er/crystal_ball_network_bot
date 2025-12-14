/**
 * Pricing service - Two-shot pricing system for items
 */

const { MODEL_CONFIGS, MODEL_MODE } = require('../utils/config');
const { getPrompt } = require('../utils/prompts');
const { delay, startTiming, endTiming } = require('../utils/timing');
const { callClaudeAPI } = require('./claude');
const sessionsService = require('./sessions');
const costTrackingService = require('./costTracking');

/**
 * Add pricing to items using the two-shot pricing system
 * @param {Array} items - Array of item objects to price
 * @param {string} threadId - Thread ID for session lookup and cost tracking
 * @param {number} maxRetries - Maximum retry attempts (default 3)
 * @returns {Promise<Array>} Array of prices (numbers or '[Price TBD]' on failure)
 */
async function addPricingToItems(items, threadId, maxRetries = 3) {
  if (!items || items.length === 0) {
    console.log('[PRICING] No items to price');
    return [];
  }

  startTiming('pricing-api-call');

  const session = sessionsService.getSession(threadId);
  const pricingPrompt = getPrompt('PRICING');

  // Convert items to JSON string for pricing
  const itemsForPricing = JSON.stringify(items, null, 2);

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { text: pricingResponse, usage } = await callClaudeAPI({
        model: 'claude-sonnet-4-5',
        maxTokens: 4096,
        system: pricingPrompt,
        messages: [{ role: 'user', content: itemsForPricing }],
        threadId
      });

      // Parse JSON array of prices
      const jsonMatch = pricingResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('Pricing response did not contain valid JSON array');
      }

      const prices = JSON.parse(jsonMatch[0]);

      if (prices.length !== items.length) {
        console.warn(`[PRICING] Price count (${prices.length}) doesn't match item count (${items.length})`);
      }

      endTiming('pricing-api-call');
      return prices;

    } catch (error) {
      lastError = error;
      const isRetryable = error.status === 529 || error.status === 503 || error.status === 500;

      if (isRetryable && attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // 1s, 2s, 4s, max 8s
        console.log(`[PRICING] Attempt ${attempt} failed (${error.status || error.message}), retrying in ${delayMs}ms...`);
        await delay(delayMs);
      } else if (!isRetryable) {
        console.error(`[PRICING] Non-retryable error on attempt ${attempt}:`, error.message);
        break;
      }
    }
  }

  // All retries exhausted or non-retryable error
  console.error('=== PRICING SYSTEM ERROR ===');
  console.error('[PRICING] Error adding pricing:', lastError);
  console.error('[PRICING] Error stack:', lastError?.stack);
  // Fallback: return placeholder prices
  const fallbackPrices = items.map(() => '[Price TBD]');
  console.log(`[PRICING] Using fallback pricing for ${items.length} items`);
  console.log('=== PRICING SYSTEM COMPLETE (FALLBACK) ===\n');
  return fallbackPrices;
}

module.exports = {
  addPricingToItems
};
