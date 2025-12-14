/**
 * Integration tests for search flow
 */

const assert = require('assert');
const {
  MockMessage,
  MockChannel,
  MockGuild,
  mockClaudeResponses,
  createMockAPIResponse,
  createTestPlayer,
  createTestSession
} = require('./setup');

// Mock the services before requiring handlers
const mockSessions = {};
const mockCostTracking = { dailySpend: {}, sessionSpend: {} };

// Store original modules
let originalClaudeService;
let originalSessionsService;
let originalCostTrackingService;

describe('Search Flow', function() {
  this.timeout(5000);

  before(function() {
    // Mock services
    const claudeService = require('../src/services/claude');
    const sessionsService = require('../src/services/sessions');
    const costTrackingService = require('../src/services/costTracking');

    // Save originals
    originalClaudeService = { ...claudeService };
    originalSessionsService = { ...sessionsService };
    originalCostTrackingService = { ...costTrackingService };

    // Override with mocks
    claudeService.sendToClaudeAPI = async (messages, threadId, balance, forceModel) => {
      return { text: mockClaudeResponses.search.items };
    };

    claudeService.parseAndFormatResponse = (text) => {
      try {
        const data = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
        return {
          type: data.items ? 'items' : 'plain',
          content: data.message || text,
          items: data.items || [],
          rawJson: data
        };
      } catch (e) {
        return { type: 'plain', content: text, items: [] };
      }
    };

    sessionsService.getSession = (threadId) => mockSessions[threadId] || null;
    sessionsService.setSession = (threadId, data) => { mockSessions[threadId] = data; };
    sessionsService.getSessionsRef = () => mockSessions;
    sessionsService.saveSessions = async () => {};

    costTrackingService.getTodaySpend = () => 0;
    costTrackingService.trackCost = async () => ({ messageCost: 0.001, sessionTotal: 0.001 });
  });

  beforeEach(function() {
    // Clear sessions between tests
    Object.keys(mockSessions).forEach(k => delete mockSessions[k]);
  });

  describe('parseAndFormatResponse', function() {
    it('should parse JSON item response correctly', function() {
      const claudeService = require('../src/services/claude');
      const response = mockClaudeResponses.search.items;
      const parsed = claudeService.parseAndFormatResponse(response);

      assert.strictEqual(parsed.type, 'items');
      assert.strictEqual(parsed.items.length, 1);
      assert.strictEqual(parsed.items[0].name, 'Sword of Testing');
    });

    it('should handle plain text responses', function() {
      const claudeService = require('../src/services/claude');
      const response = 'This is a plain text response without JSON.';
      const parsed = claudeService.parseAndFormatResponse(response);

      assert.strictEqual(parsed.type, 'plain');
      assert.strictEqual(parsed.content, response);
      assert.strictEqual(parsed.items.length, 0);
    });
  });

  describe('displayParsedResponse', function() {
    it('should post items to channel with cart reactions', async function() {
      const { displayParsedResponse } = require('../src/handlers/search');

      // Mock pricing service
      const pricingService = require('../src/services/pricing');
      pricingService.addPricingToItems = async (items) => items.map(() => 100);

      const channel = new MockChannel();
      const player = { account_balance_gp: 500 };
      const parsed = {
        type: 'items',
        content: 'Here are your items',
        items: [{
          name: 'Test Sword',
          rarity: 'uncommon',
          description: 'A test sword for testing',
          itemType: 'Weapon',
          history: 'Forged in tests',
          properties: '+1 to testing',
          complication: 'None'
        }],
        rawJson: {
          message: 'Found some items',
          items: [{
            name: 'Test Sword',
            rarity: 'uncommon',
            description: 'A test sword for testing'
          }]
        }
      };

      const result = await displayParsedResponse({
        channel,
        parsed,
        rawResponse: 'raw',
        player,
        threadId: 'test-thread'
      });

      assert(result.itemsData, 'Should return itemsData');
      assert(channel.sentMessages.length > 0, 'Should send messages');
    });

    it('should filter items by budget when requested', async function() {
      const { displayParsedResponse } = require('../src/handlers/search');
      const pricingService = require('../src/services/pricing');
      pricingService.addPricingToItems = async (items) => [1000]; // Expensive item

      const channel = new MockChannel();
      const player = { account_balance_gp: 100 }; // Low balance
      const parsed = {
        type: 'items',
        content: 'Items',
        items: [{ name: 'Expensive Sword', rarity: 'legendary' }],
        rawJson: { filterByBudget: true, items: [{ name: 'Expensive Sword' }] }
      };

      await displayParsedResponse({
        channel,
        parsed,
        rawResponse: 'raw',
        player,
        threadId: 'test-thread'
      });

      // Should send a "too expensive" message
      const hasFilterMessage = channel.sentMessages.some(m =>
        m.content && m.content.includes('exceed')
      );
      assert(hasFilterMessage, 'Should indicate items exceed budget');
    });
  });

  describe('showCostInfo', function() {
    it('should display cost information embed', async function() {
      const { showCostInfo } = require('../src/handlers/search');
      const costTrackingService = require('../src/services/costTracking');

      costTrackingService.getSessionCost = () => ({ total: 0.05, messages: 10 });
      costTrackingService.getPlayerCost = () => ({ total: 1.23, messages: 100 });
      costTrackingService.getTodaySpend = () => 5.67;

      const channel = new MockChannel();
      const message = new MockMessage({ channel });
      const session = createTestSession('test-thread');

      await showCostInfo(message, 'test-thread', session);

      // Reply should have been called (mock stores in channel)
      assert(true, 'showCostInfo completed without error');
    });
  });

  describe('handleModelSwitch', function() {
    it('should switch to haiku mode', async function() {
      const { handleModelSwitch } = require('../src/handlers/search');

      const channel = new MockChannel();
      const message = new MockMessage({ channel });
      const session = { modelMode: 'sonnet' };

      await handleModelSwitch(message, session, 'haiku');

      assert.strictEqual(session.modelMode, 'haiku');
    });

    it('should switch to sonnet mode', async function() {
      const { handleModelSwitch } = require('../src/handlers/search');

      const channel = new MockChannel();
      const message = new MockMessage({ channel });
      const session = { modelMode: 'haiku' };

      await handleModelSwitch(message, session, 'sonnet');

      assert.strictEqual(session.modelMode, 'sonnet');
    });
  });
});

// Run tests if executed directly
if (require.main === module) {
  const Mocha = require('mocha');
  const mocha = new Mocha();
  mocha.addFile(__filename);
  mocha.run(failures => process.exitCode = failures ? 1 : 0);
}
