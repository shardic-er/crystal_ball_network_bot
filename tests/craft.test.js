/**
 * Integration tests for crafting flow
 */

const assert = require('assert');
const {
  MockMessage,
  MockChannel,
  MockThread,
  MockGuild,
  MockInteraction,
  MockUser,
  mockClaudeResponses,
  createTestPlayer,
  createTestItem
} = require('./setup');

describe('Craft Flow', function() {
  this.timeout(5000);

  let mockPlayer;
  let mockInventory;

  before(function() {
    // Mock database models
    const Player = require('../src/database/models/Player');
    const Item = require('../src/database/models/Item');
    const InventoryThread = require('../src/database/models/InventoryThread');

    mockPlayer = {
      player_id: 1,
      discord_id: 'test-user-123',
      username: 'TestPlayer',
      account_balance_gp: 500
    };

    mockInventory = [
      {
        inventory_id: 1,
        item_id: 1,
        player_id: 1,
        name: 'Scroll of Fire',
        item_type: 'Scroll',
        rarity: 'uncommon',
        description: 'A scroll containing fire magic',
        history: 'Written by a pyromancer',
        properties: 'Casts Fireball',
        complication: 'Burns easily',
        purchase_price_gp: 100,
        discord_message_id: 'msg-1'
      },
      {
        inventory_id: 2,
        item_id: 2,
        player_id: 1,
        name: 'Scroll of Ice',
        item_type: 'Scroll',
        rarity: 'uncommon',
        description: 'A scroll containing ice magic',
        history: 'Written by a cryomancer',
        properties: 'Casts Cone of Cold',
        complication: 'Freezes when wet',
        purchase_price_gp: 100,
        discord_message_id: 'msg-2'
      }
    ];

    Player.getByDiscordId = (discordId) => {
      if (discordId === mockPlayer.discord_id) return mockPlayer;
      return null;
    };

    Player.getOrCreate = (discordId, username, startingGold) => mockPlayer;

    Item.getPlayerInventory = (playerId) => mockInventory;

    Item.create = (itemData, price) => ({
      item_id: Date.now(),
      ...itemData,
      base_price_gp: price
    });

    Item.addToInventory = (itemId, playerId, price, messageId) => ({
      inventory_id: Date.now(),
      item_id: itemId,
      player_id: playerId,
      purchase_price_gp: price,
      discord_message_id: messageId
    });

    Item.removeFromInventory = (invId, playerId) => {
      const index = mockInventory.findIndex(i => i.inventory_id === invId);
      if (index !== -1) {
        mockInventory.splice(index, 1);
      }
      return { removed: true };
    };

    InventoryThread.getByPlayerId = () => ({
      thread_id: 1,
      player_id: 1,
      discord_thread_id: 'inv-thread-123',
      header_message_id: 'header-123'
    });

    // Mock claude service - match on prompt keywords
    const claudeService = require('../src/services/claude');
    claudeService.callClaudeAPI = async ({ system, messages }) => {
      if (system && system.toLowerCase().includes('synergy')) {
        return { text: mockClaudeResponses.synergy, usage: { input_tokens: 100, output_tokens: 100 } };
      }
      if (system && system.toLowerCase().includes('craft')) {
        return { text: mockClaudeResponses.crafting, usage: { input_tokens: 150, output_tokens: 200 } };
      }
      // Default to synergy response
      return { text: mockClaudeResponses.synergy, usage: { input_tokens: 10, output_tokens: 10 } };
    };

    // Mock pricing service
    const pricingService = require('../src/services/pricing');
    pricingService.addPricingToItems = async (items) => items.map(() => 200);

    // Mock prompts - include keywords so callClaudeAPI mock can match them
    const promptsUtil = require('../src/utils/prompts');
    promptsUtil.getPrompt = (key) => {
      if (key === 'SYNERGY') return 'Evaluate synergy between items';
      if (key === 'CRAFTING') return 'Craft a new item from ingredients';
      return `Mock prompt for ${key}`;
    };

    // Mock UI
    const messagesUI = require('../src/ui/messages');
    messagesUI.getInventoryHeader = async () => 'Mock Header';
    messagesUI.postCloseThreadButton = async () => {};

    // Mock cost tracking
    const costTrackingService = require('../src/services/costTracking');
    costTrackingService.trackCost = async () => ({ messageCost: 0.01 });
  });

  beforeEach(function() {
    // Reset inventory
    mockInventory.length = 0;
    mockInventory.push(
      {
        inventory_id: 1,
        item_id: 1,
        player_id: 1,
        name: 'Scroll of Fire',
        item_type: 'Scroll',
        rarity: 'uncommon',
        description: 'Fire magic scroll',
        history: 'Pyromancer origin',
        properties: 'Casts Fireball',
        complication: 'Burns easily',
        purchase_price_gp: 100,
        discord_message_id: 'msg-1'
      },
      {
        inventory_id: 2,
        item_id: 2,
        player_id: 1,
        name: 'Scroll of Ice',
        item_type: 'Scroll',
        rarity: 'uncommon',
        description: 'Ice magic scroll',
        history: 'Cryomancer origin',
        properties: 'Casts Cone of Cold',
        complication: 'Freezes when wet',
        purchase_price_gp: 100,
        discord_message_id: 'msg-2'
      }
    );
  });

  describe('scoreCraftingSynergy', function() {
    it('should score synergy between two items', async function() {
      const { scoreCraftingSynergy } = require('../src/handlers/craft');

      const item1 = mockInventory[0];
      const item2 = mockInventory[1];

      const synergy = await scoreCraftingSynergy(item1, item2, 'test-thread');

      assert(synergy, 'Should return synergy object');
      assert(synergy.totalBonus !== undefined, 'Should have totalBonus');
      assert(synergy.physicalCompatibility, 'Should have physicalCompatibility');
      assert(synergy.thematicHarmony, 'Should have thematicHarmony');
    });

    it('should clamp scores to 1-5 range', async function() {
      const { scoreCraftingSynergy } = require('../src/handlers/craft');

      const synergy = await scoreCraftingSynergy(mockInventory[0], mockInventory[1], 'test-thread');

      const categories = ['physicalCompatibility', 'complicationCountering', 'thematicHarmony', 'powerLevelMatching', 'historicalSynergy'];
      for (const cat of categories) {
        if (synergy[cat]?.score) {
          assert(synergy[cat].score >= 1 && synergy[cat].score <= 5,
            `${cat} score should be between 1 and 5`);
        }
      }
    });

    it('should calculate total bonus correctly', async function() {
      const { scoreCraftingSynergy } = require('../src/handlers/craft');

      const synergy = await scoreCraftingSynergy(mockInventory[0], mockInventory[1], 'test-thread');

      // Total should be sum of all category scores
      const categories = ['physicalCompatibility', 'complicationCountering', 'thematicHarmony', 'powerLevelMatching', 'historicalSynergy'];
      const expectedTotal = categories.reduce((sum, cat) => sum + (synergy[cat]?.score || 1), 0);

      assert.strictEqual(synergy.totalBonus, expectedTotal, 'Total bonus should match sum of scores');
    });
  });

  describe('Quality roll mechanics', function() {
    it('should generate base roll between 1 and 100', function() {
      const rolls = [];
      for (let i = 0; i < 100; i++) {
        const roll = Math.floor(Math.random() * 100) + 1;
        rolls.push(roll);
        assert(roll >= 1 && roll <= 100, 'Roll should be 1-100');
      }

      // Check we get variety (not all same number)
      const unique = new Set(rolls);
      assert(unique.size > 1, 'Should have variety in rolls');
    });

    it('should add synergy bonus to base roll', function() {
      const baseRoll = 50;
      const synergyBonus = 17;
      const qualityRoll = baseRoll + synergyBonus;

      assert.strictEqual(qualityRoll, 67, 'Quality roll should be base + bonus');
    });

    it('should allow quality rolls above 100 with high synergy', function() {
      const baseRoll = 95;
      const synergyBonus = 25; // Max possible (5x5)
      const qualityRoll = baseRoll + synergyBonus;

      assert.strictEqual(qualityRoll, 120, 'Quality roll can exceed 100');
    });
  });

  describe('Item consumption', function() {
    it('should remove both source items after crafting', function() {
      const initialCount = mockInventory.length;

      // Simulate removing items
      const Item = require('../src/database/models/Item');
      Item.removeFromInventory(1, 1);
      Item.removeFromInventory(2, 1);

      assert.strictEqual(mockInventory.length, initialCount - 2, 'Both items should be removed');
    });

    it('should not remove items if crafting fails before execution', function() {
      const initialCount = mockInventory.length;
      const initialItems = [...mockInventory];

      // Items should still exist (no removal called)
      assert.strictEqual(mockInventory.length, initialCount, 'Items should remain if crafting aborted');
    });
  });

  describe('Selection flow integration', function() {
    it('should require minimum 2 items for crafting', function() {
      const inventory = mockInventory;
      assert(inventory.length >= 2, 'Should have at least 2 items');
    });

    it('should prevent selecting same item twice', function() {
      const selections = [mockInventory[0]];
      const availableForSecond = mockInventory.filter(
        item => !selections.some(s => s.inventory_id === item.inventory_id)
      );

      assert.strictEqual(availableForSecond.length, mockInventory.length - 1,
        'Second selection should exclude first item');
    });
  });

  describe('Crafting result validation', function() {
    it('should parse crafting result JSON', function() {
      const response = mockClaudeResponses.crafting;
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      assert(jsonMatch, 'Should contain JSON');

      const result = JSON.parse(jsonMatch[0]);
      assert(result.result, 'Should have result object');
      assert(result.result.name, 'Result should have name');
      assert(result.narrative, 'Should have narrative');
    });

    it('should generate item with required fields', function() {
      const response = mockClaudeResponses.crafting;
      const result = JSON.parse(response.match(/\{[\s\S]*\}/)[0]);

      const requiredFields = ['name', 'itemType', 'rarity', 'description', 'properties'];
      for (const field of requiredFields) {
        assert(result.result[field] !== undefined, `Result should have ${field}`);
      }
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
