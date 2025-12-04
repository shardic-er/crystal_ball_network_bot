require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, EmbedBuilder, Partials } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { Player, InventoryThread, Item } = require('./database/models');

// Load config
const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fsSync.readFileSync(CONFIG_PATH, 'utf-8'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

const SESSIONS_FILE = path.join(__dirname, 'cbn_sessions.json');
const COST_TRACKING_FILE = path.join(__dirname, 'cost_tracking.json');
const CBN_PROMPT_PATH = path.join(__dirname, 'cbn_system_prompt.md');
const CBN_PRICING_PROMPT_PATH = path.join(__dirname, 'cbn_pricing_prompt.md');
const CBN_BUYER_PROMPT_PATH = path.join(__dirname, 'cbn_buyer_prompt.md');
const CBN_NEGOTIATION_PROMPT_PATH = path.join(__dirname, 'cbn_negotiation_prompt.md');
const CBN_OFFER_CLASSIFIER_PATH = path.join(__dirname, 'cbn_offer_classifier_prompt.md');
const TEMPLATES_DIR = path.join(__dirname, 'discord_channel_templates');
const GAME_CHANNEL_NAME = 'crystal-ball-network';
const ACCOUNTS_CHANNEL_NAME = 'accounts';

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
function validateModelConfig(config, name) {
  const requiredFields = ['model', 'provider', 'inputCostPer1M', 'outputCostPer1M', 'dailyBudgetLimit'];
  const missingFields = requiredFields.filter(field => config[field] === undefined);

  if (missingFields.length > 0) {
    throw new Error(`Model config '${name}' is missing required fields: ${missingFields.join(', ')}`);
  }

  const numericFields = ['inputCostPer1M', 'outputCostPer1M', 'dailyBudgetLimit'];
  for (const field of numericFields) {
    if (typeof config[field] !== 'number' || isNaN(config[field])) {
      throw new Error(`Model config '${name}' has invalid ${field}: ${config[field]}`);
    }
  }

  return true;
}

// Validate all configs on startup
for (const [name, config] of Object.entries(MODEL_CONFIGS)) {
  validateModelConfig(config, name);
}

const MODEL_MODE = (process.env.MODEL_MODE || 'sonnet').toLowerCase();
const COST_CONFIG = MODEL_CONFIGS[MODEL_MODE];

if (!COST_CONFIG) {
  console.error(`Invalid MODEL_MODE: ${MODEL_MODE}. Must be one of: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
  process.exit(1);
}

let cbnPromptContent = '';
let cbnPricingPromptContent = '';
let cbnBuyerPromptContent = '';
let cbnNegotiationPromptContent = '';
let cbnOfferClassifierContent = '';
let cbnSessions = {};
let costTracking = {
  dailySpend: {},
  sessionSpend: {},
  playerLifetimeCost: {}
};

async function initialize() {
  console.log('Loading CBN system prompt...');
  try {
    cbnPromptContent = await fs.readFile(CBN_PROMPT_PATH, 'utf-8');
    console.log('CBN system prompt loaded successfully');
  } catch (error) {
    console.error('FATAL ERROR: Could not load CBN system prompt:', error);
    console.error('Make sure cbn_system_prompt.md exists in the src directory');
    process.exit(1);
  }

  console.log('Loading CBN pricing prompt...');
  try {
    cbnPricingPromptContent = await fs.readFile(CBN_PRICING_PROMPT_PATH, 'utf-8');
    console.log('CBN pricing prompt loaded successfully');
  } catch (error) {
    console.error('FATAL ERROR: Could not load CBN pricing prompt:', error);
    console.error('Make sure cbn_pricing_prompt.md exists in the src directory');
    process.exit(1);
  }

  console.log('Loading CBN buyer prompt...');
  try {
    cbnBuyerPromptContent = await fs.readFile(CBN_BUYER_PROMPT_PATH, 'utf-8');
    console.log('CBN buyer prompt loaded successfully');
  } catch (error) {
    console.error('FATAL ERROR: Could not load CBN buyer prompt:', error);
    console.error('Make sure cbn_buyer_prompt.md exists in the src directory');
    process.exit(1);
  }

  console.log('Loading CBN negotiation prompt...');
  try {
    cbnNegotiationPromptContent = await fs.readFile(CBN_NEGOTIATION_PROMPT_PATH, 'utf-8');
    console.log('CBN negotiation prompt loaded successfully');
  } catch (error) {
    console.error('FATAL ERROR: Could not load CBN negotiation prompt:', error);
    console.error('Make sure cbn_negotiation_prompt.md exists in the src directory');
    process.exit(1);
  }

  console.log('Loading CBN offer classifier...');
  try {
    cbnOfferClassifierContent = await fs.readFile(CBN_OFFER_CLASSIFIER_PATH, 'utf-8');
    console.log('CBN offer classifier loaded successfully');
  } catch (error) {
    console.error('FATAL ERROR: Could not load CBN offer classifier:', error);
    console.error('Make sure cbn_offer_classifier_prompt.md exists in the src directory');
    process.exit(1);
  }

  console.log('Loading sessions...');
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
    cbnSessions = JSON.parse(data);
    console.log(`Loaded ${Object.keys(cbnSessions).length} sessions`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing sessions file found, starting fresh');
      cbnSessions = {};
      await saveSessions();
    } else {
      console.error('Error loading sessions:', error);
    }
  }

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

async function saveSessions() {
  try {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(cbnSessions, null, 2));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

async function saveCostTracking() {
  try {
    await fs.writeFile(COST_TRACKING_FILE, JSON.stringify(costTracking, null, 2));
  } catch (error) {
    console.error('Error saving cost tracking:', error);
  }
}

function calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, config) {
  const inputCost = (inputTokens / 1000000) * config.inputCostPer1M;
  const outputCost = (outputTokens / 1000000) * config.outputCostPer1M;
  const cacheWriteCost = (cacheCreationTokens / 1000000) * (config.cacheWriteCostPer1M || 0);
  const cacheReadCost = (cacheReadTokens / 1000000) * (config.cacheReadCostPer1M || 0);

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

function getTodaySpend() {
  const today = new Date().toISOString().split('T')[0];
  return costTracking.dailySpend[today] || 0;
}

async function trackCost(threadId, usage) {
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;

  const session = cbnSessions[threadId];
  const playerModelMode = session?.modelMode || MODEL_MODE;
  const playerConfig = MODEL_CONFIGS[playerModelMode] || COST_CONFIG;

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

  if (session && session.playerId) {
    if (!costTracking.playerLifetimeCost) {
      costTracking.playerLifetimeCost = {};
    }

    if (!costTracking.playerLifetimeCost[session.playerId]) {
      costTracking.playerLifetimeCost[session.playerId] = {
        total: 0,
        messages: 0,
        playerName: session.playerName
      };
    }

    if (isNaN(costTracking.playerLifetimeCost[session.playerId].total)) {
      costTracking.playerLifetimeCost[session.playerId].total = 0;
    }

    costTracking.playerLifetimeCost[session.playerId].total += cost;
    costTracking.playerLifetimeCost[session.playerId].messages += 1;
    costTracking.playerLifetimeCost[session.playerId].playerName = session.playerName;
  }

  await saveCostTracking();

  const lifetimeCost = session ? (costTracking.playerLifetimeCost[session.playerId]?.total || 0) : 0;

  return {
    messageCost: cost,
    sessionTotal: costTracking.sessionSpend[threadId].total,
    messageNumber: costTracking.sessionSpend[threadId].messages,
    dailyTotal: costTracking.dailySpend[today],
    lifetimeCost: lifetimeCost
  };
}

function getSystemPrompt(accountBalance) {
  return [
    {
      type: 'text',
      text: cbnPromptContent
    },
    {
      type: 'text',
      text: `CURRENT CUSTOMER ACCOUNT BALANCE: ${accountBalance} gp

Remember to adjust your tone and suggestions based on this balance according to the personality adjustment guidelines.`
    }
  ];
}

async function sendToClaudeAPI(messages, threadId, accountBalance, forceModel = null) {
  const session = cbnSessions[threadId];
  const playerModelMode = forceModel || session?.modelMode || MODEL_MODE;
  const config = MODEL_CONFIGS[playerModelMode];

  // Strip out itemsData before sending to API (it's only for our internal tracking)
  const cleanMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 2048,
    system: getSystemPrompt(accountBalance),
    messages: cleanMessages
  });

  await trackCost(threadId, response.usage);

  return { text: response.content[0].text };
}

function formatItemAsMarkdown(item, index, price) {
  const attunementText = item.requiresAttunement
    ? item.attunementRequirement
      ? `(requires attunement ${item.attunementRequirement})`
      : '(requires attunement)'
    : '(no attunement)';

  let markdown = `### ${item.name}\n`;
  markdown += `*${item.itemType}, ${item.rarity} ${attunementText}*\n\n`;
  markdown += `${item.description}\n\n`;
  markdown += `**History:** ${item.history}\n\n`;
  markdown += `**Properties:** ${item.properties}\n\n`;
  markdown += `**Complication:** ${item.complication}\n\n`;
  markdown += `**Price: ${price} gp**\n\n`;
  markdown += `---\n`;

  return markdown;
}

/**
 * Handle displaying parsed items or plain text responses to a channel.
 * Filters items by budget if requested, sends messages, and returns session data.
 * @param {Object} params
 * @param {Object} params.channel - Discord channel to send messages to
 * @param {Object} params.parsed - Parsed response from Claude
 * @param {string} params.rawResponse - Raw response text
 * @param {Object} params.player - Player object with account_balance_gp
 * @param {string} params.threadId - Thread ID for pricing
 * @returns {Promise<{finalResponse: string, itemsData: Object|null}>}
 */
async function displayParsedResponse({ channel, parsed, rawResponse, player, threadId }) {
  let finalResponse = rawResponse;
  let itemsData = null;

  if (parsed.type === 'items') {
    const prices = await addPricingToItems(parsed.items, threadId);
    const shouldFilterByBudget = parsed.rawJson?.filterByBudget === true;
    const maxPriceGp = parsed.rawJson?.maxPriceGp;

    let affordableItems = parsed.items;
    let affordablePrices = prices;
    let priceLimit = null;

    if (shouldFilterByBudget) {
      // Use maxPriceGp if specified, otherwise fall back to account balance
      priceLimit = (maxPriceGp !== null && maxPriceGp !== undefined) ? maxPriceGp : player.account_balance_gp;
      console.log(`[FILTER] Budget filtering requested by Claude (filterByBudget: true, maxPriceGp: ${maxPriceGp}, using limit: ${priceLimit}gp)`);

      affordableItems = [];
      affordablePrices = [];
      for (let i = 0; i < parsed.items.length; i++) {
        if (prices[i] <= priceLimit) {
          affordableItems.push(parsed.items[i]);
          affordablePrices.push(prices[i]);
        }
      }
      console.log(`[FILTER] Filtered ${parsed.items.length} items to ${affordableItems.length} affordable items (limit: ${priceLimit}gp)`);
    } else {
      console.log('[FILTER] No budget filtering - showing all items');
    }

    if (affordableItems.length === 0) {
      // Use the price limit if filtering was applied, otherwise use account balance
      const budgetDisplay = priceLimit !== null ? priceLimit : player.account_balance_gp;
      const budgetType = priceLimit !== null ? 'requested budget' : 'current balance';
      await channel.send(
        `*The Curator rubs their temples and sighs.*\n\n` +
        `"I'm afraid ALL the items I was about to show you exceed your ${budgetType} of **${budgetDisplay} gp**. ` +
        `Perhaps try a more... modest search query? Or consider items of common or uncommon rarity within your price range."`
      );
      finalResponse = `Generated ${parsed.items.length} items, but all were too expensive for the ${budgetDisplay}gp ${budgetType}.`;
    } else {
      if (parsed.rawJson?.message) {
        await channel.send(parsed.rawJson.message);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      if (affordableItems.length < parsed.items.length) {
        const filtered = parsed.items.length - affordableItems.length;
        await channel.send(
          `*The Curator discretely sets aside ${filtered} item${filtered > 1 ? 's' : ''} that exceed${filtered === 1 ? 's' : ''} your current budget...*`
        );
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const itemMessages = [];
      for (let i = 0; i < affordableItems.length; i++) {
        const item = affordableItems[i];
        const price = affordablePrices[i];
        const itemMarkdown = formatItemAsMarkdown(item, i, price);
        const itemMessage = await channel.send(itemMarkdown);
        await itemMessage.react('\u{1F6D2}');
        itemMessages.push({
          messageId: itemMessage.id,
          item: { ...item, priceGp: price }
        });
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      itemsData = {
        rawJson: parsed.rawJson,
        items: affordableItems.map((item, index) => ({
          ...item,
          priceGp: affordablePrices[index]
        })),
        itemMessages: itemMessages
      };

      finalResponse = parsed.rawJson?.message || `Generated ${affordableItems.length} affordable items (${parsed.items.length - affordableItems.length} filtered)`;
    }
  } else {
    finalResponse = parsed.content;
    const chunks = splitText(finalResponse);
    for (const chunk of chunks) {
      await channel.send(chunk);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return { finalResponse, itemsData };
}

function parseAndFormatResponse(responseText, prices) {
  console.log('[FORMAT] Attempting to parse response as JSON...');

  // Try to extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('[FORMAT] No JSON found in response, treating as plain text');
    return { type: 'plain', content: responseText, items: [] };
  }

  try {
    const data = JSON.parse(jsonMatch[0]);
    console.log(`[FORMAT] Successfully parsed JSON with ${data.items?.length || 0} items`);

    if (!data.items || data.items.length === 0) {
      // Non-item response (account query, etc.)
      return { type: 'plain', content: data.message || responseText, items: [] };
    }

    // Format items as markdown
    let formattedResponse = '';

    if (data.message) {
      formattedResponse += `${data.message}\n\n`;
    }

    data.items.forEach((item, index) => {
      const price = prices && prices[index] !== undefined ? prices[index] : '[Price TBD]';
      formattedResponse += formatItemAsMarkdown(item, index, price);
      formattedResponse += '\n';
    });

    console.log(`[FORMAT] Formatted ${data.items.length} items as markdown`);
    return {
      type: 'items',
      content: formattedResponse,
      items: data.items,
      rawJson: data
    };

  } catch (error) {
    console.error('[FORMAT] JSON parsing failed:', error);
    console.log('[FORMAT] Falling back to plain text');
    return { type: 'plain', content: responseText, items: [] };
  }
}

async function addPricingToItems(items, threadId) {
  if (!items || items.length === 0) {
    console.log('[PRICING] No items to price');
    return [];
  }

  console.log('=== PRICING SYSTEM START ===');
  console.log(`[PRICING] Pricing ${items.length} items`);

  const session = cbnSessions[threadId];
  const playerModelMode = session?.modelMode || MODEL_MODE;
  const config = MODEL_CONFIGS[playerModelMode];

  try {
    // Convert items to JSON string for pricing
    const itemsForPricing = JSON.stringify(items, null, 2);
    console.log(`[PRICING] Sending ${itemsForPricing.length} characters to pricing model`);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: cbnPricingPromptContent,
      messages: [{ role: 'user', content: itemsForPricing }]
    });

    await trackCost(threadId, response.usage);
    const pricingResponse = response.content[0].text;
    console.log(`[PRICING] Received response (${response.usage.input_tokens} input tokens, ${response.usage.output_tokens} output tokens)`);

    console.log(`[PRICING] Raw pricing response:\n${pricingResponse}`);

    // Parse JSON array of prices
    const jsonMatch = pricingResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Pricing response did not contain valid JSON array');
    }

    const prices = JSON.parse(jsonMatch[0]);
    console.log(`[PRICING] Parsed ${prices.length} prices:`, prices);

    if (prices.length !== items.length) {
      console.warn(`[PRICING] WARNING: Price count (${prices.length}) doesn't match item count (${items.length})`);
    }

    console.log('=== PRICING SYSTEM COMPLETE ===\n');
    return prices;

  } catch (error) {
    console.error('=== PRICING SYSTEM ERROR ===');
    console.error('[PRICING] Error adding pricing:', error);
    console.error('[PRICING] Error stack:', error.stack);
    // Fallback: return placeholder prices
    const fallbackPrices = items.map(() => '[Price TBD]');
    console.log(`[PRICING] Using fallback pricing for ${items.length} items`);
    console.log('=== PRICING SYSTEM COMPLETE (FALLBACK) ===\n');
    return fallbackPrices;
  }
}

// Interest level affects negotiation behavior (configured in config.json)
const INTEREST_NEGOTIATION = config.negotiation.interestLevels;

/**
 * Generate prospective buyers for an item being sold
 * @param {Object} item - Item data from inventory
 * @param {string} threadId - Thread ID for cost tracking
 * @returns {Promise<Object>} Parsed buyers JSON with calculated prices
 */
async function generateBuyers(item, threadId) {
  console.log('=== BUYER GENERATION START ===');
  console.log(`[BUYERS] Generating buyers for: ${item.name}`);

  try {
    // Format item for the buyer prompt
    const itemJson = JSON.stringify({
      name: item.name,
      itemType: item.item_type,
      rarity: item.rarity,
      description: item.description,
      history: item.history,
      properties: item.properties,
      complication: item.complication
    }, null, 2);

    // Generate buyers via AI
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: cbnBuyerPromptContent,
      messages: [{ role: 'user', content: itemJson }]
    });

    await trackCost(threadId, response.usage);
    const buyerResponse = response.content[0].text;
    console.log(`[BUYERS] Received response (${response.usage.input_tokens} input, ${response.usage.output_tokens} output tokens)`);

    // Parse JSON response
    const jsonMatch = buyerResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Buyer response did not contain valid JSON');
    }

    const buyerData = JSON.parse(jsonMatch[0]);
    console.log(`[BUYERS] Parsed ${buyerData.buyers?.length || 0} buyers`);

    // Get independent price appraisals for each buyer (3 separate pricing calls)
    const itemForPricing = JSON.stringify([{
      name: item.name,
      rarity: item.rarity,
      properties: item.properties,
      complication: item.complication
    }]);

    for (const buyer of buyerData.buyers) {
      const priceResponse = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        system: cbnPricingPromptContent,
        messages: [{ role: 'user', content: itemForPricing }]
      });

      await trackCost(threadId, priceResponse.usage);
      const priceText = priceResponse.content[0].text;
      const priceMatch = priceText.match(/\[[\s\S]*\]/);
      const appraisedPrice = priceMatch ? JSON.parse(priceMatch[0])[0] : item.base_price_gp;

      buyer.offerGp = appraisedPrice;
      // Store negotiation limits based on interest level
      const negotiation = INTEREST_NEGOTIATION[buyer.interestLevel] || INTEREST_NEGOTIATION.medium;
      buyer.maxOffer = Math.round(appraisedPrice * negotiation.maxIncrease);
      buyer.walkAwayPrice = Math.round(appraisedPrice * negotiation.walkAwayThreshold);

      console.log(`[BUYERS] ${buyer.name} (${buyer.interestLevel}): ${buyer.offerGp}gp initial, max ${buyer.maxOffer}gp, walks at ${buyer.walkAwayPrice}gp`);
    }

    console.log('=== BUYER GENERATION COMPLETE ===\n');
    return buyerData;

  } catch (error) {
    console.error('=== BUYER GENERATION ERROR ===');
    console.error('[BUYERS] Error:', error);
    throw error;
  }
}

/**
 * Format a buyer as markdown for display
 * @param {Object} buyer - Buyer object with calculated offerGp
 * @param {number} index - Buyer index (0-2)
 * @returns {string} Formatted markdown
 */
function formatBuyerAsMarkdown(buyer, index) {
  let markdown = `### ${buyer.name}, ${buyer.title}\n`;
  markdown += `*Prospective Buyer*\n\n`;
  markdown += `${buyer.description}\n\n`;
  markdown += `**Interest:** "${buyer.motivation}"\n\n`;
  markdown += `**Offer: ${buyer.offerGp.toLocaleString()} gp**`;
  if (buyer.negotiable) {
    markdown += ` *(negotiable)*`;
  }
  markdown += `\n\n---`;
  return markdown;
}

/**
 * Parse item data from a Discord message in inventory thread
 * Items are posted in a specific markdown format by formatItemAsMarkdown
 * @param {string} content - Message content
 * @returns {Object|null} Parsed item data or null if not an item message
 */
function parseItemFromMessage(content) {
  // Item messages start with ### Item Name
  const nameMatch = content.match(/^### (.+?)$/m);
  if (!nameMatch) return null;

  const name = nameMatch[1];

  // Parse rarity and type from the italicized line
  const typeMatch = content.match(/^\*(.+?), (.+?) \(.*?\)\*$/m);
  const itemType = typeMatch ? typeMatch[1] : 'Unknown';
  const rarity = typeMatch ? typeMatch[2] : 'unknown';

  // Parse price (either "Price: X gp" or "Purchased for: X gp")
  const priceMatch = content.match(/\*\*(?:Price|Purchased for):\s*([\d,]+)\s*gp\*\*/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;

  return { name, itemType, rarity, price };
}

/**
 * Clean up a sell thread - remove moneybag reactions and lock
 * @param {Object} session - Sell session
 * @param {Object} channel - Discord channel
 */
async function cleanupSellThread(session, channel) {
  // Remove all moneybag reactions from buyer messages and current offer
  for (const buyer of session.buyers) {
    if (buyer.messageId) {
      try {
        const buyerMsg = await channel.messages.fetch(buyer.messageId);
        await buyerMsg.reactions.cache.get('\u{1F4B0}')?.remove();
      } catch (e) {
        // Message may not exist
      }
    }
  }
  if (session.currentOffer?.messageId) {
    try {
      const offerMsg = await channel.messages.fetch(session.currentOffer.messageId);
      await offerMsg.reactions.cache.get('\u{1F4B0}')?.remove();
    } catch (e) {
      // Message may not exist
    }
  }

  // Lock the thread so player can read but not continue
  try {
    await channel.setLocked(true);
    console.log(`[SELL] Locked thread ${channel.id}`);
  } catch (e) {
    console.warn('[SELL] Could not lock thread:', e.message);
  }

  // Clean up session
  delete cbnSessions[channel.id];
  await saveSessions();
}

/**
 * @param {Object} session - Sell session
 * @param {number} amount - Sale amount in gp
 * @param {Object} channel - Discord channel to send messages
 * @param {Object} guild - Discord guild for fetching inventory thread
 */
async function completeSale(session, amount, channel, guild) {
  console.log(`[SELL] Completing sale of ${session.itemBeingSold.name} for ${amount}gp`);

  const player = Player.getByDiscordId(session.playerId);
  if (!player) {
    throw new Error('Player not found');
  }

  // Remove item from inventory
  Item.removeFromInventory(session.itemBeingSold.inventoryId, player.player_id);

  // Add gold to player
  Player.addGold(player.player_id, amount);

  // Get updated player balance
  const updatedPlayer = Player.getById(player.player_id);
  console.log(`[SELL] Player ${player.username} now has ${updatedPlayer.account_balance_gp}gp`);

  // Update inventory header
  const invThread = InventoryThread.getByPlayerId(player.player_id);
  if (invThread) {
    try {
      const inventoryChannel = await guild.channels.fetch(invThread.discord_thread_id);
      const headerMessage = await inventoryChannel.messages.fetch(invThread.header_message_id);

      const headerTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'inventory_header.md'),
        'utf-8'
      );

      const inventory = Item.getPlayerInventory(player.player_id, true, false);
      const totalValue = inventory.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);

      const updatedHeader = headerTemplate
        .replace('{balance}', updatedPlayer.account_balance_gp)
        .replace('{count}', inventory.length)
        .replace('{value}', totalValue);

      await headerMessage.edit(updatedHeader);
      console.log(`[SELL] Updated inventory header`);

      // Delete the item message from inventory thread
      // We need to find and delete the message containing this item
      // For now, we'll leave this as a TODO - the item is removed from DB but message stays
      // The user can run !bootstrap to refresh if needed

    } catch (error) {
      console.error('[SELL] Error updating inventory:', error);
    }
  }

  // Send confirmation
  await channel.send(`**Sale Complete!** Sold **${session.itemBeingSold.name}** for **${amount.toLocaleString()} gp**.\n\n*Your new balance: ${updatedPlayer.account_balance_gp.toLocaleString()} gp*`);

  // Clean up thread (remove reactions, lock, clear session)
  await cleanupSellThread(session, channel);
}

/**
 * Classify if a player message contains a price offer
 * @param {string} messageContent - Player's message
 * @param {string} threadId - Thread ID for cost tracking
 * @returns {Promise<{isOffer: boolean, amount: number|null}>}
 */
async function classifyOffer(messageContent, threadId) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      system: cbnOfferClassifierContent,
      messages: [{ role: 'user', content: messageContent }]
    });

    await trackCost(threadId, response.usage);

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { isOffer: false, amount: null };
  } catch (error) {
    console.error('[NEGOTIATE] Error classifying offer:', error);
    return { isOffer: false, amount: null };
  }
}

/**
 * Get buyer response during negotiation
 * @param {Object} session - Sell session
 * @param {string} playerMessage - Player's message
 * @param {string} threadId - Thread ID for cost tracking
 * @returns {Promise<Object>} Buyer's response with potential new offer
 */
async function getBuyerResponse(session, playerMessage, threadId) {
  const buyer = session.buyers[session.activeBuyer];
  const item = session.itemBeingSold;

  // Use pre-calculated negotiation limits from buyer generation
  // maxOffer: highest they'll go based on interest level
  // walkAwayPrice: if player demands this much, they leave
  const maxBudget = buyer.maxOffer || Math.round(buyer.offerGp * 1.15);
  const walkAwayPrice = buyer.walkAwayPrice || Math.round(buyer.offerGp * 1.5);

  // Build context for the negotiation
  const context = `
## Buyer Context
Name: ${buyer.name}
Title: ${buyer.title}
Personality: ${buyer.description}
Motivation: ${buyer.motivation}
Interest Level: ${buyer.interestLevel} (affects patience and flexibility)

## Item Being Sold
Name: ${item.name}
Rarity: ${item.itemData.rarity}
Properties: ${item.itemData.properties}
Complication: ${item.itemData.complication}
History: ${item.itemData.history}

## Negotiation State
Initial offer: ${buyer.offerGp} gp
Maximum budget: ${maxBudget} gp (the absolute highest you'll go)
Walk away threshold: ${walkAwayPrice} gp (if player demands more than this, leave)
Current offer: ${session.currentOffer?.amount || buyer.offerGp} gp

## Conversation History
${session.messages.map(m => `${m.role}: ${m.content}`).join('\n')}
`;

  // Add player's message to history
  session.messages.push({ role: 'user', content: playerMessage });

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: cbnNegotiationPromptContent + '\n\n' + context,
    messages: [{ role: 'user', content: playerMessage }]
  });

  await trackCost(threadId, response.usage);

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    const result = JSON.parse(jsonMatch[0]);
    // Add buyer's response to history
    session.messages.push({ role: 'assistant', content: result.response });
    return result;
  }

  // Fallback if JSON parsing fails
  return {
    response: text,
    newOffer: session.currentOffer?.amount || buyer.offerGp,
    isOffer: false,
    walkAway: false
  };
}

/**
 * Split text into chunks that fit within Discord's message limit.
 * @param {string} text - The text to split
 * @param {Object} options - Split options
 * @param {number} options.maxLength - Maximum length per chunk (default 2000)
 * @param {string} options.mode - 'prose' splits on paragraphs/sentences, 'lines' splits on newlines/words
 */
function splitText(text, { maxLength = 2000, mode = 'prose' } = {}) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  const primaryDelimiter = mode === 'prose' ? '\n\n' : '\n';
  const primaryParts = text.split(primaryDelimiter);
  let currentChunk = '';

  for (const part of primaryParts) {
    if ((currentChunk + primaryDelimiter + part).length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      if (part.length > maxLength) {
        // Split oversized parts: prose uses sentences, lines uses words
        const subParts = mode === 'prose'
          ? (part.match(/[^.!?]+[.!?]+/g) || [part])
          : part.split(' ');
        const subDelimiter = ' ';

        for (const subPart of subParts) {
          if ((currentChunk + subDelimiter + subPart).length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = subPart;
          } else {
            currentChunk += (currentChunk ? subDelimiter : '') + subPart;
          }
        }
      } else {
        currentChunk = part;
      }
    } else {
      currentChunk += (currentChunk ? primaryDelimiter : '') + part;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text.substring(0, maxLength)];
}

async function loadAllChannelConfigs() {
  const configs = [];

  try {
    const files = await fs.readdir(TEMPLATES_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();

    for (const file of mdFiles) {
      const content = await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf-8');
      const name = file.replace('.md', '');

      const firstLine = content.split('\n')[0];
      const topic = firstLine.startsWith('#')
        ? firstLine.replace(/^#+\s*/, '').substring(0, 100)
        : `Information about ${name}`;

      const isReadOnly = name !== GAME_CHANNEL_NAME;

      configs.push({ name, topic, content, isReadOnly });
    }
  } catch (error) {
    console.error('Error loading channel configs:', error);
  }

  configs.sort((a, b) => {
    if (a.name === 'welcome') return -1;
    if (b.name === 'welcome') return 1;
    return a.name.localeCompare(b.name);
  });

  return configs;
}

async function bootstrapServer(guild, statusMessage) {
  const updateStatus = async (text) => {
    try {
      await statusMessage.edit(text);
    } catch (error) {
      // Ignore cache errors - message may have been deleted with channel
      if (error.code !== 'ChannelNotCached') {
        console.error('Error updating status:', error);
      }
    }
  };

  await updateStatus('Starting bootstrap process...');

  // Clear ephemeral sessions (sell and search) since bootstrap will wipe their threads
  const sessionIds = Object.keys(cbnSessions);
  let clearedSessions = 0;
  for (const threadId of sessionIds) {
    const session = cbnSessions[threadId];
    if (session.sessionType === 'sell' || session.sessionType === 'search') {
      delete cbnSessions[threadId];
      clearedSessions++;
    }
  }
  if (clearedSessions > 0) {
    await saveSessions();
    console.log(`[BOOTSTRAP] Cleared ${clearedSessions} ephemeral sessions`);
  }

  try {
    const botMember = await guild.members.fetch(client.user.id);
    await botMember.setNickname('Crystal Ball Network');
    console.log('Bot nickname set to "Crystal Ball Network"');
  } catch (error) {
    console.warn('Warning: Could not set bot nickname.', error.message);
  }

  try {

  const channelConfigs = await loadAllChannelConfigs();

  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === 'Crystal Ball Network'
  );

  if (!category) {
    await updateStatus('Creating category: Crystal Ball Network...');
    category = await guild.channels.create({
      name: 'Crystal Ball Network',
      type: ChannelType.GuildCategory
    });
  }

  const existingChannels = guild.channels.cache.filter(
    c => c.parentId === category.id && c.type === ChannelType.GuildText && c.name !== ACCOUNTS_CHANNEL_NAME
  );

  for (const [, channel] of existingChannels) {
    try {
      await updateStatus(`Deleting old channel: #${channel.name}...`);
      await channel.delete();
    } catch (error) {
      console.error(`Error deleting channel ${channel.name}:`, error);
    }
  }

  for (const config of channelConfigs) {
    // Skip accounts channel if it already exists (it's persistent)
    if (config.name === ACCOUNTS_CHANNEL_NAME) {
      const existingAccounts = guild.channels.cache.find(
        c => c.name === ACCOUNTS_CHANNEL_NAME && c.type === ChannelType.GuildText
      );
      if (existingAccounts) {
        console.log('[BOOTSTRAP] Skipping accounts channel - already exists');
        continue;
      }
    }

    await updateStatus(`Creating channel: #${config.name}...`);

    const channel = await guild.channels.create({
      name: config.name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: config.topic
    });

    await updateStatus(`Posting content to #${config.name}...`);

    const chunks = splitText(config.content, { mode: 'lines' });
    for (const chunk of chunks) {
      await channel.send(chunk);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (config.isReadOnly) {
      await channel.permissionOverwrites.edit(guild.id, {
        SendMessages: false,
        AddReactions: true
      });
    }
  }

  await updateStatus('Initializing inventory threads for existing members...');

  // Initialize inventory threads for all existing members
  const members = await guild.members.fetch();
  const accountsChannel = guild.channels.cache.find(
    c => c.name === ACCOUNTS_CHANNEL_NAME && c.type === ChannelType.GuildText
  );

  if (accountsChannel) {
    let created = 0;
    let skipped = 0;

    for (const [, member] of members) {
      // Skip bots
      if (member.user.bot) continue;

      // Create or get player first
      const player = Player.getOrCreate(member.id, member.user.username, 500);

      // Check if inventory thread exists in database
      const existing = InventoryThread.getByPlayerId(player.player_id);

      // Delete existing Discord thread if it exists (we'll recreate it fresh)
      if (existing) {
        try {
          const oldThread = await guild.channels.fetch(existing.discord_thread_id);
          await oldThread.delete();
          console.log(`[BOOTSTRAP] Deleted old inventory thread for ${member.user.username}`);
        } catch (error) {
          console.log(`[BOOTSTRAP] Old thread already gone for ${member.user.username}`);
        }

        // Clean up database entry
        const db = require('./database/db');
        db.prepare('DELETE FROM inventory_threads WHERE thread_id = ?').run(existing.thread_id);
      }

      // Also check for any stray threads with matching name
      const existingThreads = accountsChannel.threads.cache.filter(
        t => t.name === `inventory-${member.user.username}`
      );
      for (const [, strayThread] of existingThreads) {
        try {
          await strayThread.delete();
          console.log(`[BOOTSTRAP] Deleted stray thread for ${member.user.username}`);
        } catch (err) {
          console.log(`[BOOTSTRAP] Could not delete stray thread: ${err.message}`);
        }
      }

      // Create fresh inventory thread
      const threadName = `inventory-${member.user.username}`;
      const thread = await accountsChannel.threads.create({
        name: threadName,
        autoArchiveDuration: null,
        type: ChannelType.PrivateThread,
        reason: `Creating inventory thread for ${member.user.username}`
      });

      await thread.members.add(member.id);

      const headerTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'inventory_header.md'),
        'utf-8'
      );

      const headerContent = headerTemplate
        .replace('{balance}', player.account_balance_gp)
        .replace('{count}', 0)
        .replace('{value}', 0);

      const headerMessage = await thread.send(headerContent);

      // Populate with existing items from database
      const existingItems = Item.getPlayerInventory(player.player_id, true, false);

      if (existingItems.length > 0) {
        console.log(`[BOOTSTRAP] Populating ${existingItems.length} existing items for ${member.user.username}`);

        for (const dbItem of existingItems) {
          const itemMarkdown = formatItemAsMarkdown(
            {
              name: dbItem.name,
              itemType: dbItem.item_type,
              rarity: dbItem.rarity,
              requiresAttunement: Boolean(dbItem.requires_attunement),
              attunementRequirement: dbItem.attunement_requirement,
              description: dbItem.description,
              history: dbItem.history,
              properties: dbItem.properties,
              complication: dbItem.complication
            },
            0,
            dbItem.purchase_price_gp
          ).replace('**Price:', '*Purchased for:').replace('gp**', 'gp*');

          const itemMessage = await thread.send(itemMarkdown);
          await itemMessage.react('\u{2696}'); // scales - click to sell
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Update header with correct counts
        const totalValue = existingItems.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);
        const updatedHeader = headerTemplate
          .replace('{balance}', player.account_balance_gp)
          .replace('{count}', existingItems.length)
          .replace('{value}', totalValue);

        await headerMessage.edit(updatedHeader);
      }

      // Lock the thread to make it read-only
      await thread.setLocked(true);

      InventoryThread.create(player.player_id, thread.id, headerMessage.id);

      created++;
      console.log(`[BOOTSTRAP] Created inventory for ${member.user.username}`);
    }

    console.log(`[BOOTSTRAP] Inventory initialization: Created ${created}, skipped ${skipped}`);
  }

  await updateStatus('Bootstrap complete! The Crystal Ball Network is ready.');
  } catch (error) {
    console.error('Bootstrap error:', error);
    await updateStatus(`Bootstrap failed: ${error.message}. Please check bot permissions.`);
    throw error;
  }
}

async function showCostInfo(message, threadId) {
  const session = cbnSessions[threadId];
  const sessionCost = costTracking.sessionSpend[threadId];
  const playerCost = costTracking.playerLifetimeCost[session.playerId];
  const todaySpend = getTodaySpend();

  const playerModelMode = session?.modelMode || MODEL_MODE;
  const config = MODEL_CONFIGS[playerModelMode];

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Cost Information')
    .addFields(
      {
        name: 'Current Model',
        value: `${config.model} (${config.provider})`,
        inline: true
      },
      {
        name: 'This Session',
        value: `$${sessionCost?.total.toFixed(4) || '0.0000'} (${sessionCost?.messages || 0} msgs)`,
        inline: true
      },
      {
        name: 'Your Lifetime',
        value: `$${playerCost?.total.toFixed(4) || '0.0000'} (${playerCost?.messages || 0} msgs)`,
        inline: true
      },
      {
        name: 'Today Total',
        value: `$${todaySpend.toFixed(4)} / $${config.dailyBudgetLimit.toFixed(2)} limit`,
        inline: false
      }
    )
    .setFooter({
      text: `Use !fast (haiku) or !fancy (sonnet) to switch models`
    });

  await message.reply({ embeds: [embed] });
}

client.once('ready', async () => {
  await initialize();
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Default search model: haiku (claude-haiku-4-5)`);
  console.log(`Use !fancy in threads to switch to sonnet`);
  console.log('Crystal Ball Network is online!');
});

// Handle new members joining the server
client.on('guildMemberAdd', async (member) => {
  try {
    console.log(`[MEMBER JOIN] ${member.user.username} joined ${member.guild.name}`);

    // Check if player already has an inventory thread
    const existingThread = InventoryThread.getByPlayerId(member.id);
    if (existingThread) {
      console.log(`[MEMBER JOIN] Player ${member.user.username} already has inventory thread`);
      return;
    }

    // Create or get player in database with 500gp starting balance
    const player = Player.getOrCreate(member.id, member.user.username, 500);
    console.log(`[MEMBER JOIN] Created/found player: ${player.username} (${player.player_id}) with ${player.account_balance_gp}gp`);

    // Find the accounts channel
    const accountsChannel = member.guild.channels.cache.find(
      c => c.name === ACCOUNTS_CHANNEL_NAME && c.type === ChannelType.GuildText
    );

    if (!accountsChannel) {
      console.warn('[MEMBER JOIN] accounts channel not found. Run !bootstrap first.');
      return;
    }

    // Create persistent inventory thread from the accounts channel
    const threadName = `inventory-${member.user.username}`;
    const thread = await accountsChannel.threads.create({
      name: threadName,
      autoArchiveDuration: null, // Never auto-archive
      type: ChannelType.PrivateThread,
      reason: `Creating inventory thread for ${member.user.username}`
    });

    // Add the member to the thread
    await thread.members.add(member.id);

    // Load inventory header template
    const headerTemplate = await fs.readFile(
      path.join(__dirname, 'templates', 'inventory_header.md'),
      'utf-8'
    );

    // Format header with player data
    const headerContent = headerTemplate
      .replace('{balance}', player.account_balance_gp)
      .replace('{count}', 0)
      .replace('{value}', 0);

    // Send header message
    const headerMessage = await thread.send(headerContent);

    // Lock the thread to make it read-only
    await thread.setLocked(true);

    // Store inventory thread in database
    InventoryThread.create(player.player_id, thread.id, headerMessage.id);

    console.log(`[MEMBER JOIN] Created inventory thread for ${member.user.username}: ${thread.name}`);

  } catch (error) {
    console.error('[MEMBER JOIN] Error creating inventory thread:', error);
  }
});

// Handle reaction additions for purchases and sells
client.on('messageReactionAdd', async (reaction, user) => {
  // Ignore bot reactions
  if (user.bot) return;

  // Fetch partial messages/reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }

  // Fetch partial message if needed
  let message = reaction.message;
  if (message.partial) {
    try {
      message = await message.fetch();
    } catch (error) {
      console.error('Error fetching message:', error);
      return;
    }
  }

  const emoji = reaction.emoji.name;

  // Handle shopping cart emoji (purchase)
  if (emoji === '🛒') {
    try {
      // Find the session for this thread
      const threadId = message.channel.id;
      const session = cbnSessions[threadId];

      if (!session) {
        await message.channel.send('This search session is no longer active. Please start a new search by typing your query in #crystal-ball-network.');
        return;
      }

      // Find the item associated with this message
      const itemData = session.messages
        .filter(m => m.itemsData?.itemMessages)
        .flatMap(m => m.itemsData.itemMessages)
        .find(im => im.messageId === message.id);

      if (!itemData) {
        return;
      }

      const item = itemData.item;
      const price = item.priceGp;

      // Get player from database
      const player = Player.getByDiscordId(user.id);
      if (!player) {
        await message.channel.send(`Error: Player not found in database.`);
        return;
      }

      // Check if player has enough funds
      if (player.account_balance_gp < price) {
        // Remove the cart reaction to acknowledge the attempt
        await reaction.users.remove(user.id);

        await message.channel.send(
          `Insufficient funds! **${item.name}** costs **${price} gp** but you only have **${player.account_balance_gp} gp**.`
        );
        return;
      }

      // Save item to database first
      const dbItem = Item.create(item, price);
      console.log(`[PURCHASE] Created item in database: ${dbItem.item_id}`);

      // Add item to player inventory
      Item.addToInventory(dbItem.item_id, player.player_id, price);
      console.log(`[PURCHASE] Added item to player inventory in database`);

      // Deduct gold
      Player.deductGold(player.player_id, price);
      console.log(`[PURCHASE] Deducted ${price}gp from player ${player.username}`);

      // Get updated player balance
      const updatedPlayer = Player.getById(player.player_id);

      // Find or get inventory thread
      let invThread = InventoryThread.getByPlayerId(player.player_id);
      if (!invThread) {
        console.error('[PURCHASE] No inventory thread found for player');
        await message.channel.send('Error: Inventory thread not found.');
        return;
      }

      // Fetch the inventory thread channel
      const inventoryChannel = await message.guild.channels.fetch(invThread.discord_thread_id);
      if (!inventoryChannel) {
        console.error('[PURCHASE] Could not fetch inventory channel');
        return;
      }

      // Unlock inventory thread to post item
      await inventoryChannel.setLocked(false);

      // Format item for inventory (same format, but mark as purchased)
      const inventoryItemMarkdown = formatItemAsMarkdown(item, 0, price)
        .replace('**Price:', '*Purchased for:')
        .replace('gp**', 'gp*');

      // Post item in inventory thread
      const inventoryMessage = await inventoryChannel.send(inventoryItemMarkdown);

      // Add sell reaction to inventory item (scales emoji)
      await inventoryMessage.react('\u{2696}');

      console.log(`[PURCHASE] Posted item to inventory thread`);

      // Update inventory header
      const headerMessage = await inventoryChannel.messages.fetch(invThread.header_message_id);
      const headerTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'inventory_header.md'),
        'utf-8'
      );

      // Get current item count
      const inventory = Item.getPlayerInventory(player.player_id, true, false);
      const totalValue = inventory.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);

      const updatedHeader = headerTemplate
        .replace('{balance}', updatedPlayer.account_balance_gp)
        .replace('{count}', inventory.length + 1)  // +1 for the item we just added
        .replace('{value}', totalValue + price);

      await headerMessage.edit(updatedHeader);
      console.log(`[PURCHASE] Updated inventory header`);

      // Re-lock inventory thread
      await inventoryChannel.setLocked(true);

      // Delete item from search thread
      await message.delete();

      // Send simplified confirmation
      await message.channel.send(`Bought: **${item.name}** for **${price} gp**`);

      console.log(`[PURCHASE] Purchase complete for ${user.username}`);

    } catch (error) {
      console.error('[PURCHASE] Error processing purchase:', error);
      await message.channel.send(`Error processing purchase: ${error.message}`);
    }
  }

  // Handle scales emoji (start selling from inventory)
  if (emoji === '\u{2696}') {
    try {
      // Only handle in inventory threads
      if (!message.channel.name?.startsWith('inventory-')) {
        return;
      }

      console.log(`[SELL] User ${user.username} clicked sell on item in inventory`);

      // Remove the reaction to acknowledge the click
      await reaction.users.remove(user.id);

      // Parse item name from message content
      const parsedItem = parseItemFromMessage(message.content);
      if (!parsedItem) {
        console.log('[SELL] Could not parse item from message');
        await reaction.users.remove(user.id);
        return;
      }

      // Get player
      const player = Player.getByDiscordId(user.id);
      if (!player) {
        await message.channel.send('Error: Player not found.');
        return;
      }

      // Find item in database by name
      const inventoryItem = Item.findInventoryByName(player.player_id, parsedItem.name);
      if (!inventoryItem) {
        await message.channel.send(`Error: "${parsedItem.name}" not found in your inventory.`);
        await reaction.users.remove(user.id);
        return;
      }

      console.log(`[SELL] Found inventory item: ${inventoryItem.name} (inventory_id: ${inventoryItem.inventory_id})`);

      // Check if there's already a sell session for this item
      const existingSellSession = Object.values(cbnSessions).find(
        s => s.sessionType === 'sell' &&
             s.playerId === user.id &&
             s.itemBeingSold?.inventoryId === inventoryItem.inventory_id
      );
      if (existingSellSession) {
        console.log('[SELL] Already have a sell session for this item');
        return;
      }

      // Create sell thread
      const itemNameTruncated = parsedItem.name.length > 50
        ? parsedItem.name.substring(0, 47) + '...'
        : parsedItem.name;
      const sellThreadName = `sell-${user.username}-${itemNameTruncated}`;

      // Find the crystal-ball-network channel (same as search threads)
      const gameChannel = message.guild.channels.cache.find(
        c => c.name === GAME_CHANNEL_NAME && c.type === ChannelType.GuildText
      );

      if (!gameChannel) {
        await message.channel.send('Error: Could not find crystal-ball-network channel.');
        return;
      }

      const sellThread = await gameChannel.threads.create({
        name: sellThreadName,
        autoArchiveDuration: 60, // 1 hour
        type: ChannelType.PrivateThread,
        reason: `Creating sell session for ${user.username} - ${parsedItem.name}`
      });

      await sellThread.members.add(user.id);

      // Create sell session
      cbnSessions[sellThread.id] = {
        playerId: user.id,
        playerName: user.username,
        startedAt: new Date().toISOString(),
        sessionType: 'sell',
        modelMode: 'haiku',
        itemBeingSold: {
          inventoryId: inventoryItem.inventory_id,
          itemId: inventoryItem.item_id,
          name: inventoryItem.name,
          purchasePrice: inventoryItem.purchase_price_gp,
          itemData: inventoryItem
        },
        buyers: [],
        activeBuyer: null,
        currentOffer: null,
        messages: []
      };

      await saveSessions();

      // Send shimmer message
      await sellThread.send('*The crystal ball shimmers to life...*');

      // Generate buyers
      try {
        const buyerData = await generateBuyers(inventoryItem, sellThread.id);

        // Send Curator's intro message
        if (buyerData.message) {
          await sellThread.send(buyerData.message);
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Post each buyer with reactions
        const buyerMessages = [];
        for (let i = 0; i < buyerData.buyers.length; i++) {
          const buyer = buyerData.buyers[i];
          const buyerMarkdown = formatBuyerAsMarkdown(buyer, i);
          const buyerMsg = await sellThread.send(buyerMarkdown);

          // Add reactions: moneybag to accept, speech bubble to negotiate
          await buyerMsg.react('\u{1F4B0}'); // moneybag
          if (buyer.negotiable) {
            await buyerMsg.react('\u{1F4AC}'); // speech bubble
          }

          buyer.messageId = buyerMsg.id;
          buyerMessages.push({ messageId: buyerMsg.id, buyer });
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Update session with buyer message IDs
        cbnSessions[sellThread.id].buyers = buyerData.buyers;
        await saveSessions();

        // Lock the thread until a buyer is selected
        await sellThread.setLocked(true);

        console.log(`[SELL] Created sell thread: ${sellThreadName} with ${buyerData.buyers.length} buyers`);

      } catch (error) {
        console.error('[SELL] Error generating buyers:', error);
        await sellThread.send('*The crystal ball flickers...*\n\nI apologize, but I could not find any buyers for this item at the moment. Please try again later.');
      }

    } catch (error) {
      console.error('[SELL] Error starting sell:', error);
      await message.channel.send(`Error starting sale: ${error.message}`);
    }
  }

  // Handle money bag emoji (accept offer in sell thread)
  if (emoji === '\u{1F4B0}') {
    try {
      const threadId = message.channel.id;
      const session = cbnSessions[threadId];

      // In sell thread - accepting an offer
      if (session?.sessionType === 'sell') {
        // Verify the user clicking is the session owner
        if (session.playerId !== user.id) {
          console.log(`[SELL] User ${user.username} is not the session owner`);
          await reaction.users.remove(user.id);
          return;
        }

        console.log(`[SELL] User ${user.username} accepting offer in sell thread`);

        // Find which buyer this message belongs to
        const buyerIndex = session.buyers.findIndex(b => b.messageId === message.id);

        if (buyerIndex === -1) {
          // Check if this is the current negotiated offer
          if (session.currentOffer && session.currentOffer.messageId === message.id) {
            // Accept the negotiated offer
            await completeSale(session, session.currentOffer.amount, message.channel, message.guild);
            return;
          }

          // This is a stale offer - remove the reaction and ignore
          console.log('[SELL] Stale offer clicked, removing reaction');
          await reaction.users.remove(user.id);
          try {
            // Also remove the bot's moneybag reaction since it shouldn't be there
            await message.reactions.cache.get('\u{1F4B0}')?.remove();
          } catch (e) {
            // Reaction may already be gone
          }
          return;
        }

        const buyer = session.buyers[buyerIndex];
        console.log(`[SELL] Accepting offer from ${buyer.name} for ${buyer.offerGp}gp`);

        // Complete the sale
        await completeSale(session, buyer.offerGp, message.channel, message.guild);
        return;
      }

    } catch (error) {
      console.error('[SELL] Error:', error);
      await message.channel.send(`Error processing sale: ${error.message}`);
    }
  }

  // Handle speech bubble emoji (start negotiation)
  if (emoji === '\u{1F4AC}') {
    try {
      const threadId = message.channel.id;
      const session = cbnSessions[threadId];

      if (session?.sessionType !== 'sell') {
        return; // Not a sell session
      }

      // Verify the user clicking is the session owner
      if (session.playerId !== user.id) {
        console.log(`[SELL] User ${user.username} is not the session owner`);
        await reaction.users.remove(user.id);
        return;
      }

      // Check if negotiation already started
      if (session.activeBuyer !== null) {
        console.log('[SELL] Negotiation already in progress');
        await reaction.users.remove(user.id);
        return;
      }

      // Find which buyer this is
      const buyerIndex = session.buyers.findIndex(b => b.messageId === message.id);
      if (buyerIndex === -1) {
        return; // Not a buyer message
      }

      const buyer = session.buyers[buyerIndex];
      if (!buyer.negotiable) {
        await message.channel.send(`*${buyer.name} shakes their head.* "My offer is firm. Take it or leave it."`);
        await reaction.users.remove(user.id);
        return;
      }

      console.log(`[SELL] User ${user.username} starting negotiation with ${buyer.name}`);

      // Lock in this buyer, remove others
      session.activeBuyer = buyerIndex;

      // Delete other buyer messages
      for (let i = 0; i < session.buyers.length; i++) {
        if (i !== buyerIndex) {
          try {
            const otherMsg = await message.channel.messages.fetch(session.buyers[i].messageId);
            await otherMsg.delete();
          } catch (e) {
            console.warn(`[SELL] Could not delete buyer message: ${e.message}`);
          }
        }
      }

      // Remove reactions from the selected buyer's message
      try {
        await message.reactions.removeAll();
      } catch (e) {
        console.warn(`[SELL] Could not remove reactions: ${e.message}`);
      }

      // Unlock thread for negotiation
      await message.channel.setLocked(false);

      // Send negotiation start message
      await message.channel.send(
        `*${buyer.name} leans forward with interest.*\n\n` +
        `"So, you want to discuss the price? Very well. My initial offer of **${buyer.offerGp.toLocaleString()} gp** stands, but I'm willing to hear your arguments. What do you think this item is truly worth?"\n\n` +
        `*You may now negotiate. State your counter-offer or make your case for a higher price.*`
      );

      // Initialize conversation history for negotiation
      session.messages = [{
        role: 'assistant',
        content: `Initial offer: ${buyer.offerGp} gp. The buyer ${buyer.name} is open to negotiation.`
      }];

      await saveSessions();

    } catch (error) {
      console.error('[SELL] Negotiation error:', error);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Bootstrap command - server owner only
  if (message.content === '!bootstrap') {
    if (message.author.id !== message.guild.ownerId) {
      await message.reply('Only the server owner can use this command.');
      return;
    }

    // Delete the user's command
    try {
      await message.delete();
    } catch (error) {
      console.warn('Could not delete !bootstrap command:', error.message);
    }

    const statusMessage = await message.channel.send('Initializing Crystal Ball Network bootstrap...');
    await bootstrapServer(message.guild, statusMessage);

    // Delete the status message after completion
    setTimeout(async () => {
      try {
        await statusMessage.delete();
      } catch (error) {
        console.warn('Could not delete bootstrap status message:', error.message);
      }
    }, 5000);

    return;
  }

  // Handle crystal-ball-network channel
  if (message.channel.name === GAME_CHANNEL_NAME && message.channel.type === ChannelType.GuildText) {
    try {
      // Get or create player
      const player = Player.getOrCreate(message.author.id, message.author.username, 500);
      console.log(`[SEARCH] Player ${player.username} starting search (balance: ${player.account_balance_gp}gp)`);

      // Store the user's search query
      const userQuery = message.content;

      // Delete the user's message immediately
      await message.delete();

      // Send immediate confirmation in main channel (will be deleted after thread is created)
      const confirmation = await message.channel.send(
        `Opening search portal for ${message.author}...`
      );

      // Create ephemeral search thread with truncated query
      // Truncate query to fit Discord's 100 character limit for thread names
      const maxQueryLength = 100 - message.author.username.length - 8; // "search-" (7) + "-" (1) = 8
      const truncatedQuery = userQuery.length > maxQueryLength
        ? userQuery.substring(0, maxQueryLength - 3) + '...'
        : userQuery;
      const threadName = `search-${message.author.username}-${truncatedQuery}`;

      const thread = await message.channel.threads.create({
        name: threadName,
        autoArchiveDuration: 60, // 1 hour (shortest Discord allows)
        type: ChannelType.PrivateThread,
        reason: `Creating search session for ${message.author.username}`
      });

      // Add member to thread
      await thread.members.add(message.author.id);

      // Create session with user's query (default to haiku for searches)
      cbnSessions[thread.id] = {
        playerId: message.author.id,
        playerName: message.author.username,
        startedAt: new Date().toISOString(),
        messages: [],
        modelMode: 'haiku',
        sessionType: 'search'
      };

      // Send neutral "shimmer" message immediately
      const shimmerMessage = `*The crystal ball shimmers to life...*`;
      await thread.send(shimmerMessage);

      // Now process the user's query with the AI
      await thread.sendTyping();

      cbnSessions[thread.id].messages.push({
        role: 'user',
        content: userQuery
      });

      // Use Haiku for faster item generation
      const apiResponse = await sendToClaudeAPI(cbnSessions[thread.id].messages, thread.id, player.account_balance_gp, 'haiku');
      const rawResponse = apiResponse.text;

      // Parse and format response
      const parsed = parseAndFormatResponse(rawResponse, null);

      const { finalResponse, itemsData } = await displayParsedResponse({
        channel: thread,
        parsed,
        rawResponse,
        player,
        threadId: thread.id
      });

      // Store assistant response
      cbnSessions[thread.id].messages.push({
        role: 'assistant',
        content: finalResponse,
        itemsData: itemsData
      });

      await saveSessions();

      // Delete the "opening portal" confirmation message now that thread is ready
      setTimeout(async () => {
        try {
          await confirmation.delete();
        } catch (error) {
          console.warn('Could not delete confirmation:', error.message);
        }
      }, 3000);

      console.log(`[SEARCH] Created search thread for ${message.author.username}: ${threadName}`);

    } catch (error) {
      console.error('[SEARCH] Error creating search thread:', error);
      await message.channel.send('Sorry, there was an error starting your search session. Please try again.');
    }
    return;
  }

  // bot-commands channel is no longer used - legacy code removed

  // Handle messages in threads
  if (!message.channel.isThread()) return;

  const threadId = message.channel.id;

  if (!cbnSessions[threadId]) return;

  const session = cbnSessions[threadId];

  if (message.author.id !== session.playerId) return;

  // Handle commands
  if (message.content === '!cost') {
    await showCostInfo(message, threadId);
    return;
  }

  if (message.content === '!fast') {
    session.modelMode = 'haiku';
    await saveSessions();
    await message.reply('Switched to fast mode (Claude Haiku 4.5). Lower cost, faster responses.');
    return;
  }

  if (message.content === '!fancy') {
    session.modelMode = 'sonnet';
    await saveSessions();
    await message.reply('Switched to fancy mode (Claude Sonnet 4.5). Highest quality responses.');
    return;
  }

  // !cheap command disabled for compatibility issues
  if (message.content === '!cheap') {
    await message.reply('The !cheap command (GPT-4o-mini) has been disabled due to compatibility issues. Please use !fast (haiku) or !fancy (sonnet) instead.');
    return;
  }

  // Handle sell sessions - block all messages until buyer is selected
  if (session.sessionType === 'sell') {
    if (session.activeBuyer === null) {
      // No buyer selected yet - ignore messages
      console.log(`[SELL] Message ignored - no buyer selected yet`);
      return;
    }
    // Negotiation in progress
    console.log(`[NEGOTIATE] Player ${session.playerName} sent message in negotiation`);

    await message.channel.sendTyping();

    try {
      // First, classify if the message contains an offer
      const offerResult = await classifyOffer(message.content, threadId);
      console.log(`[NEGOTIATE] Offer classification:`, offerResult);

      // Get buyer's response
      const buyerResponse = await getBuyerResponse(session, message.content, threadId);
      console.log(`[NEGOTIATE] Buyer response - offer: ${buyerResponse.newOffer}, walkAway: ${buyerResponse.walkAway}`);

      // Send the buyer's response
      const responseMsg = await message.channel.send(buyerResponse.response);

      // Handle walk away
      if (buyerResponse.walkAway) {
        await message.channel.send(`*${session.buyers[session.activeBuyer].name} turns and walks away, disappearing into the crowd.*\n\n**Negotiation ended.** The buyer is no longer interested.`);

        // Clean up thread (remove reactions, lock, clear session)
        await cleanupSellThread(session, message.channel);
        return;
      }

      // If buyer made a new offer, update session and add sell react
      if (buyerResponse.isOffer && buyerResponse.newOffer) {
        // Remove old offer react if exists
        if (session.currentOffer?.messageId) {
          try {
            const oldMsg = await message.channel.messages.fetch(session.currentOffer.messageId);
            await oldMsg.reactions.cache.get('\u{1F4B0}')?.remove();
          } catch (e) {
            // Message may not exist anymore
          }
        }

        // Update current offer
        session.currentOffer = {
          amount: buyerResponse.newOffer,
          messageId: responseMsg.id
        };

        // Add sell react to the new offer
        await responseMsg.react('\u{1F4B0}');
        await saveSessions();

        console.log(`[NEGOTIATE] New offer: ${buyerResponse.newOffer}gp on message ${responseMsg.id}`);
      }

    } catch (error) {
      console.error('[NEGOTIATE] Error:', error);
      await message.channel.send('*The buyer looks confused for a moment, then regains composure.* "I... what was I saying? Let me think about that."');
    }

    return;
  }

  // Check daily budget before processing
  const currentSpend = getTodaySpend();
  const playerConfig = MODEL_CONFIGS[session.modelMode] || COST_CONFIG;

  if (currentSpend >= playerConfig.dailyBudgetLimit) {
    await message.reply(
      `Daily budget limit reached ($${playerConfig.dailyBudgetLimit.toFixed(2)}). The CBN is temporarily unavailable. Try again tomorrow!`
    );
    return;
  }

  // Add user message to session
  session.messages.push({
    role: 'user',
    content: message.content
  });

  await saveSessions();

  // Show typing indicator
  await message.channel.sendTyping();

  try {
    // Get fresh player balance from database
    const player = Player.getByDiscordId(session.playerId);
    if (!player) {
      await message.reply('Error: Player not found. Please try again.');
      return;
    }

    // Send to Claude/OpenAI for item generation with current balance
    const apiResponse = await sendToClaudeAPI(session.messages, threadId, player.account_balance_gp);
    const rawResponse = apiResponse.text;

    // Parse and format response
    const parsed = parseAndFormatResponse(rawResponse, null);

    const { finalResponse, itemsData } = await displayParsedResponse({
      channel: message.channel,
      parsed,
      rawResponse,
      player,
      threadId
    });

    // Store assistant response (formatted markdown for display)
    session.messages.push({
      role: 'assistant',
      content: finalResponse,
      itemsData: itemsData
    });

    await saveSessions();

  } catch (error) {
    console.error('Error processing message:', error);

    const errorResponse = `*The crystal ball flickers and dims momentarily...*

My apologies, esteemed customer. The CBN network experienced a momentary disruption. Please try your query again.

*Error details: ${error.message}*`;

    await message.channel.send(errorResponse);
  }
});

client.login(process.env.DISCORD_TOKEN);
