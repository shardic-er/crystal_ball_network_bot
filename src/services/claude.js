/**
 * Claude API service - Anthropic client wrapper
 */

const Anthropic = require('@anthropic-ai/sdk');
const { MODEL_CONFIGS, MODEL_MODE } = require('../utils/config');
const { getPrompt } = require('../utils/prompts');
const costTrackingService = require('./costTracking');
const sessionsService = require('./sessions');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

/**
 * Build the system prompt with balance-aware personality
 * @param {number} accountBalance - Player's gold balance
 * @returns {Array} System prompt content blocks
 */
function getSystemPrompt(accountBalance) {
  const systemPrompt = getPrompt('SYSTEM');
  return [
    {
      type: 'text',
      text: systemPrompt
    },
    {
      type: 'text',
      text: `CURRENT CUSTOMER ACCOUNT BALANCE: ${accountBalance} gp

Remember to adjust your tone and suggestions based on this balance according to the personality adjustment guidelines.`
    }
  ];
}

/**
 * Send messages to Claude API
 * @param {Array} messages - Conversation messages
 * @param {string} threadId - Thread ID for session lookup and cost tracking
 * @param {number} accountBalance - Player's gold balance
 * @param {string} forceModel - Optional model override ('haiku' or 'sonnet')
 * @returns {Promise<{text: string}>} Response text
 */
async function sendToClaudeAPI(messages, threadId, accountBalance, forceModel = null) {
  const session = sessionsService.getSession(threadId);
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

  // Track cost with session context
  await costTrackingService.trackCost(threadId, response.usage, {
    modelMode: session?.modelMode,
    playerId: session?.playerId,
    playerName: session?.playerName
  });

  return { text: response.content[0].text };
}

/**
 * Parse Claude response and extract JSON or plain text
 * @param {string} responseText - Raw response from Claude
 * @returns {Object} Parsed response with type, content, items, and rawJson
 */
function parseAndFormatResponse(responseText) {
  // Try to extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { type: 'plain', content: responseText, items: [] };
  }

  try {
    const data = JSON.parse(jsonMatch[0]);

    if (!data.items || data.items.length === 0) {
      // Non-item response (account query, etc.)
      return { type: 'plain', content: data.message || responseText, items: [] };
    }

    // Return parsed data - displayParsedResponse handles the actual formatting
    return {
      type: 'items',
      content: data.message || '',
      items: data.items,
      rawJson: data
    };

  } catch (error) {
    console.error('[FORMAT] JSON parsing failed:', error);
    return { type: 'plain', content: responseText, items: [] };
  }
}

/**
 * Make a raw API call to Claude (for specialized prompts like pricing, buyers, etc.)
 * @param {Object} options - API call options
 * @param {string} options.model - Model to use
 * @param {number} options.maxTokens - Max tokens for response
 * @param {string} options.system - System prompt
 * @param {Array} options.messages - Messages array
 * @param {string} options.threadId - Thread ID for cost tracking
 * @returns {Promise<{text: string, usage: Object}>} Response text and usage
 */
async function callClaudeAPI({ model, maxTokens, system, messages, threadId }) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages
  });

  // Track cost if threadId provided
  if (threadId) {
    const session = sessionsService.getSession(threadId);
    await costTrackingService.trackCost(threadId, response.usage, {
      modelMode: session?.modelMode,
      playerId: session?.playerId,
      playerName: session?.playerName
    });
  }

  return {
    text: response.content[0]?.text || '',
    usage: response.usage
  };
}

module.exports = {
  anthropic,
  getSystemPrompt,
  sendToClaudeAPI,
  parseAndFormatResponse,
  callClaudeAPI
};
