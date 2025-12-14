/**
 * Cost tracking service for API usage
 */

const fs = require('fs').promises;
const path = require('path');
const { MODEL_CONFIGS, MODEL_MODE, DEFAULT_COST_CONFIG } = require('../utils/config');

const COST_TRACKING_FILE = path.join(__dirname, '..', 'cost_tracking.json');

// Cost tracking state
let costTracking = {
  dailySpend: {},
  sessionSpend: {},
  playerLifetimeCost: {}
};

/**
 * Load cost tracking data from file
 */
async function loadCostTracking() {
  console.log('Loading cost tracking...');
  try {
    const data = await fs.readFile(COST_TRACKING_FILE, 'utf-8');
    costTracking = JSON.parse(data);
    console.log('Cost tracking loaded');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing cost tracking file found, starting fresh');
      await saveCostTracking();
    } else {
      console.error('Error loading cost tracking:', error);
    }
  }
}

/**
 * Save cost tracking data to file
 */
async function saveCostTracking() {
  try {
    await fs.writeFile(COST_TRACKING_FILE, JSON.stringify(costTracking, null, 2));
  } catch (error) {
    console.error('Error saving cost tracking:', error);
  }
}

/**
 * Calculate cost for API usage
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {number} cacheCreationTokens
 * @param {number} cacheReadTokens
 * @param {Object} modelConfig - Model configuration with cost rates
 * @returns {number} Total cost in dollars
 */
function calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, modelConfig) {
  const inputCost = (inputTokens / 1000000) * modelConfig.inputCostPer1M;
  const outputCost = (outputTokens / 1000000) * modelConfig.outputCostPer1M;
  const cacheWriteCost = (cacheCreationTokens / 1000000) * (modelConfig.cacheWriteCostPer1M || 0);
  const cacheReadCost = (cacheReadTokens / 1000000) * (modelConfig.cacheReadCostPer1M || 0);

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * Get today's total spend
 * @returns {number} Today's spend in dollars
 */
function getTodaySpend() {
  const today = new Date().toISOString().split('T')[0];
  return costTracking.dailySpend[today] || 0;
}

/**
 * Get session cost info
 * @param {string} threadId
 * @returns {Object|null} Session cost data
 */
function getSessionCost(threadId) {
  return costTracking.sessionSpend[threadId] || null;
}

/**
 * Get player lifetime cost info
 * @param {string} playerId
 * @returns {Object|null} Player cost data
 */
function getPlayerCost(playerId) {
  return costTracking.playerLifetimeCost[playerId] || null;
}

/**
 * Track cost for an API call
 * @param {string} threadId - Thread/session ID
 * @param {Object} usage - API usage object with token counts
 * @param {Object} options - Additional options
 * @param {string} options.modelMode - Model mode ('haiku' or 'sonnet')
 * @param {string} options.playerId - Player's Discord ID
 * @param {string} options.playerName - Player's username
 * @returns {Promise<Object>} Cost tracking result
 */
async function trackCost(threadId, usage, options = {}) {
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;

  const playerModelMode = options.modelMode || MODEL_MODE;
  const playerConfig = MODEL_CONFIGS[playerModelMode] || DEFAULT_COST_CONFIG;

  const cost = calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, playerConfig);
  const today = new Date().toISOString().split('T')[0];

  if (isNaN(cost)) {
    console.error('Cost calculation resulted in NaN:', {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      playerConfig,
      usage
    });
    throw new Error('Cost calculation failed - resulted in NaN');
  }

  if (!costTracking.dailySpend[today]) {
    costTracking.dailySpend[today] = 0;
  }
  costTracking.dailySpend[today] += cost;

  if (!costTracking.sessionSpend[threadId]) {
    costTracking.sessionSpend[threadId] = {
      total: 0,
      messages: 0,
      totalCacheReads: 0,
      totalCacheWrites: 0,
      history: []
    };
  }

  if (isNaN(costTracking.sessionSpend[threadId].total)) {
    costTracking.sessionSpend[threadId].total = 0;
  }

  costTracking.sessionSpend[threadId].total += cost;
  costTracking.sessionSpend[threadId].messages += 1;
  costTracking.sessionSpend[threadId].totalCacheReads += cacheReadTokens;
  costTracking.sessionSpend[threadId].totalCacheWrites += cacheCreationTokens;
  costTracking.sessionSpend[threadId].history.push({
    timestamp: new Date().toISOString(),
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cost
  });

  // Track player lifetime costs if playerId provided
  if (options.playerId) {
    if (!costTracking.playerLifetimeCost) {
      costTracking.playerLifetimeCost = {};
    }

    if (!costTracking.playerLifetimeCost[options.playerId]) {
      costTracking.playerLifetimeCost[options.playerId] = {
        total: 0,
        messages: 0,
        playerName: options.playerName || 'Unknown'
      };
    }

    if (isNaN(costTracking.playerLifetimeCost[options.playerId].total)) {
      costTracking.playerLifetimeCost[options.playerId].total = 0;
    }

    costTracking.playerLifetimeCost[options.playerId].total += cost;
    costTracking.playerLifetimeCost[options.playerId].messages += 1;
    if (options.playerName) {
      costTracking.playerLifetimeCost[options.playerId].playerName = options.playerName;
    }
  }

  await saveCostTracking();

  const lifetimeCost = options.playerId
    ? (costTracking.playerLifetimeCost[options.playerId]?.total || 0)
    : 0;

  return {
    messageCost: cost,
    sessionTotal: costTracking.sessionSpend[threadId].total,
    messageNumber: costTracking.sessionSpend[threadId].messages,
    dailyTotal: costTracking.dailySpend[today],
    lifetimeCost: lifetimeCost
  };
}

module.exports = {
  loadCostTracking,
  saveCostTracking,
  calculateCost,
  getTodaySpend,
  getSessionCost,
  getPlayerCost,
  trackCost
};
