/**
 * Craft handler - Experimental crafting flow
 */

const { ChannelType } = require('discord.js');
const { Player, InventoryThread, Item } = require('../database/models');
const { delay } = require('../utils/timing');
const { getPrompt } = require('../utils/prompts');
const { formatItemAsEmbed, formatSynergyDisplay } = require('../ui/embeds');
const { getInventoryHeader, postCloseThreadButton } = require('../ui/messages');
const { callClaudeAPI } = require('../services/claude');
const { addPricingToItems } = require('../services/pricing');
const costTrackingService = require('../services/costTracking');
const sessionsService = require('../services/sessions');
const selectionFlow = require('../selectionFlow');

/**
 * Score the synergy between two items for crafting
 * @param {Object} item1 - First item data
 * @param {Object} item2 - Second item data
 * @param {string} threadId - Thread ID for cost tracking
 * @returns {Promise<Object>} Synergy scoring result
 */
async function scoreCraftingSynergy(item1, item2, threadId) {
  console.log('[CRAFT] Scoring item synergy...');

  const synergyPrompt = getPrompt('SYNERGY');

  const synergyInput = JSON.stringify({
    item1: {
      name: item1.name,
      itemType: item1.item_type,
      rarity: item1.rarity,
      description: item1.description,
      history: item1.history,
      properties: item1.properties,
      complication: item1.complication
    },
    item2: {
      name: item2.name,
      itemType: item2.item_type,
      rarity: item2.rarity,
      description: item2.description,
      history: item2.history,
      properties: item2.properties,
      complication: item2.complication
    }
  }, null, 2);

  try {
    const { text: synergyResponse, usage } = await callClaudeAPI({
      model: 'claude-haiku-4-5',
      maxTokens: 1024,
      system: synergyPrompt,
      messages: [{ role: 'user', content: synergyInput }],
      threadId
    });

    console.log(`[CRAFT] Synergy response received (${usage.input_tokens} input, ${usage.output_tokens} output tokens)`);

    const jsonMatch = synergyResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Synergy response did not contain valid JSON');
    }

    const synergy = JSON.parse(jsonMatch[0]);

    // Validate and clamp scores to 1-5 range
    const categories = ['physicalCompatibility', 'complicationCountering', 'thematicHarmony', 'powerLevelMatching', 'historicalSynergy'];
    for (const cat of categories) {
      if (synergy[cat]?.score) {
        synergy[cat].score = Math.max(1, Math.min(5, synergy[cat].score));
      }
    }

    // Recalculate totalBonus to ensure accuracy
    synergy.totalBonus = categories.reduce((sum, cat) => sum + (synergy[cat]?.score || 1), 0);

    console.log(`[CRAFT] Synergy scores: Physical=${synergy.physicalCompatibility?.score}, Complication=${synergy.complicationCountering?.score}, Thematic=${synergy.thematicHarmony?.score}, Power=${synergy.powerLevelMatching?.score}, History=${synergy.historicalSynergy?.score}, Total=${synergy.totalBonus}`);

    return synergy;
  } catch (error) {
    console.error('[CRAFT] Error scoring synergy:', error);
    // Return default scores on error
    return {
      physicalCompatibility: { score: 3, reason: 'Unable to assess' },
      complicationCountering: { score: 3, reason: 'Unable to assess' },
      thematicHarmony: { score: 3, reason: 'Unable to assess' },
      powerLevelMatching: { score: 3, reason: 'Unable to assess' },
      historicalSynergy: { score: 3, reason: 'Unable to assess' },
      totalBonus: 15,
      overallAssessment: 'The arcane energies are difficult to read...'
    };
  }
}

/**
 * Execute the experimental crafting - call AI to determine result
 * @param {string} playerId - Discord user ID
 * @param {Array} selections - Array of selected items (2 items)
 * @param {Object} thread - Discord thread channel
 * @param {Object} guild - Discord guild
 */
async function executeExperimentalCraft(playerId, selections, thread, guild) {
  const [item1, item2] = selections;

  console.log(`[CRAFT] Combining: ${item1.name} + ${item2.name}`);

  // First, score the synergy between items
  await thread.send(`*The workshop's arcane sensors analyze your materials...*`);

  const synergy = await scoreCraftingSynergy(item1, item2, thread.id);

  // Display synergy analysis
  await thread.send(formatSynergyDisplay(synergy));
  await delay(500);

  // Roll 1d100 for crafting quality (determines complication severity)
  const baseRoll = Math.floor(Math.random() * 100) + 1;
  const qualityRoll = baseRoll + synergy.totalBonus;
  console.log(`[CRAFT] Base roll: ${baseRoll}, Synergy bonus: +${synergy.totalBonus}, Final quality: ${qualityRoll}`);

  await thread.send(`*The workshop fills with crackling energy as you combine **${item1.name}** and **${item2.name}**...*\n\n**Quality Roll: ${baseRoll}** (base) + **${synergy.totalBonus}** (synergy) = **${qualityRoll}**`);

  const player = Player.getByDiscordId(playerId);
  if (!player) {
    await thread.send('Error: Player not found.');
    return;
  }

  // Get inventory thread reference (but don't modify anything yet)
  const invThread = InventoryThread.getByPlayerId(player.player_id);
  let inventoryChannel = null;
  if (invThread) {
    try {
      inventoryChannel = await guild.channels.fetch(invThread.discord_thread_id);
    } catch (error) {
      console.error('[CRAFT] Error accessing inventory thread:', error);
    }
  }

  const craftingPrompt = getPrompt('CRAFTING');

  // Format items for the crafting prompt
  const craftingInput = JSON.stringify({
    crafterName: player.username,
    qualityRoll: qualityRoll,
    item1: {
      name: item1.name,
      itemType: item1.item_type,
      rarity: item1.rarity,
      description: item1.description,
      history: item1.history,
      properties: item1.properties,
      complication: item1.complication
    },
    item2: {
      name: item2.name,
      itemType: item2.item_type,
      rarity: item2.rarity,
      description: item2.description,
      history: item2.history,
      properties: item2.properties,
      complication: item2.complication
    }
  }, null, 2);

  // ========== PHASE 1: Generate and validate the crafted item ==========
  // Items are NOT consumed until we have a valid result
  let craftingResult;
  let itemPrice;

  try {
    console.log('[CRAFT] Calling AI to generate crafting result...');

    // Call AI to generate the new item
    const { text: craftingResponse, usage } = await callClaudeAPI({
      model: 'claude-sonnet-4-5',
      maxTokens: 2048,
      system: craftingPrompt,
      messages: [{ role: 'user', content: craftingInput }],
      threadId: thread.id
    });

    console.log(`[CRAFT] Received crafting response (${usage.input_tokens} input, ${usage.output_tokens} output tokens)`);

    // Parse the JSON response
    const jsonMatch = craftingResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Crafting response did not contain valid JSON');
    }

    craftingResult = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!craftingResult.result || !craftingResult.result.name) {
      throw new Error('Crafting response missing required fields');
    }

    console.log(`[CRAFT] Generated item: ${craftingResult.result.name}`);

    // Price the new item using the existing pricing system
    console.log('[CRAFT] Pricing new item...');
    const itemForPricing = {
      name: craftingResult.result.name,
      rarity: craftingResult.result.rarity,
      properties: craftingResult.result.properties,
      complication: craftingResult.result.complication
    };
    const prices = await addPricingToItems([itemForPricing], thread.id);
    itemPrice = typeof prices[0] === 'number' ? prices[0] : 100; // Fallback price

    console.log(`[CRAFT] Item priced at ${itemPrice}gp`);

  } catch (error) {
    // AI generation or parsing failed - items are NOT consumed
    console.error('[CRAFT] Error generating crafted item:', error);

    await thread.send(
      `**Crafting Interrupted!**\n\n` +
      `*The arcane energies flicker and dissipate harmlessly. The workshop's safety wards activate, preserving your items.*\n\n` +
      `Your items have been returned to your inventory. Please try again later.`
    );

    // Lock thread and post close button - items are safe
    try {
      await thread.setLocked(true);
      await postCloseThreadButton(thread);
    } catch (e) {
      console.warn(`[CRAFT] Could not lock thread: ${e.message}`);
    }
    return;
  }

  // ========== PHASE 2: Consume source items and create new item ==========
  // Only reached if AI generation was successful

  // Send the narrative message
  if (craftingResult.narrative) {
    await thread.send(`*${craftingResult.narrative}*`);
    await delay(500);
  }

  // NOW consume the source items (point of no return)
  console.log('[CRAFT] Consuming source items...');
  Item.removeFromInventory(item1.inventory_id, player.player_id);
  Item.removeFromInventory(item2.inventory_id, player.player_id);

  // Delete item messages from inventory thread
  if (inventoryChannel) {
    for (const item of selections) {
      if (item.discord_message_id) {
        try {
          const itemMsg = await inventoryChannel.messages.fetch(item.discord_message_id);
          await itemMsg.delete();
        } catch (e) {
          console.warn(`[CRAFT] Could not delete item message: ${e.message}`);
        }
      }
    }
  }

  // Create the new item in the database
  const newItemData = {
    name: craftingResult.result.name,
    itemType: craftingResult.result.itemType,
    rarity: craftingResult.result.rarity,
    description: craftingResult.result.description,
    history: craftingResult.result.history,
    properties: craftingResult.result.properties,
    complication: craftingResult.result.complication
  };

  const dbItem = Item.create(newItemData, itemPrice);
  console.log(`[CRAFT] Created item in database: ${dbItem.item_id}`);

  // Display the crafted item card in the thread
  const craftedEmbed = formatItemAsEmbed(craftingResult.result, itemPrice, {
    priceLabel: 'Value',
    footer: 'Crafted item - Check your inventory!'
  });
  await thread.send({ embeds: [craftedEmbed] });

  // Add the item to the player's inventory
  if (inventoryChannel && invThread) {
    try {
      // Unlock inventory to post item
      await inventoryChannel.setLocked(false);

      // Post item in inventory thread
      const inventoryEmbed = formatItemAsEmbed(craftingResult.result, itemPrice, { priceLabel: 'Crafted Value' });
      const inventoryMessage = await inventoryChannel.send({ embeds: [inventoryEmbed] });
      await inventoryMessage.react('\u{2696}'); // scales - click to sell

      // Add to inventory in database
      Item.addToInventory(dbItem.item_id, player.player_id, itemPrice, inventoryMessage.id);
      console.log(`[CRAFT] Added item to player inventory`);

      // Update inventory header
      const headerMessage = await inventoryChannel.messages.fetch(invThread.header_message_id);
      const updatedInventory = Item.getPlayerInventory(player.player_id, true, false);
      const totalValue = updatedInventory.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);
      const updatedHeader = await getInventoryHeader(player.account_balance_gp, updatedInventory.length, totalValue);
      await headerMessage.edit(updatedHeader);

      // Re-lock inventory thread
      await inventoryChannel.setLocked(true);
    } catch (error) {
      console.error('[CRAFT] Error adding item to inventory:', error);
      await thread.send('*Warning: There was an error adding the item to your inventory. Please contact an administrator.*');
    }
  }

  // Send completion message
  await thread.send(`**Crafting Complete!** Your new item **${craftingResult.result.name}** has been added to your inventory.`);

  // Lock the thread and post close button when crafting is complete
  try {
    await postCloseThreadButton(thread);
    await thread.setLocked(true);
    console.log(`[CRAFT] Locked crafting thread ${thread.id}`);
  } catch (e) {
    console.warn(`[CRAFT] Could not lock thread: ${e.message}`);
  }

  console.log(`[CRAFT] Crafting complete for player ${player.username}`);
}

/**
 * Handle the Workshop "Experimental Crafting" button click
 * Creates a crafting thread and starts the item selection flow
 * @param {Object} interaction - Discord button interaction
 */
async function handleWorkshopCraftButton(interaction) {
  const user = interaction.user;
  const guild = interaction.guild;

  // Acknowledge the button click with a deferred reply (not ephemeral so we can delete it)
  await interaction.deferReply({ ephemeral: false });

  // Get or create player
  const player = Player.getOrCreate(user.id, user.username, 500);

  // Get player's inventory
  const inventory = Item.getPlayerInventory(player.player_id, true, false);

  if (inventory.length < 2) {
    // Send error as interaction reply that auto-deletes
    const errorMsg = await interaction.editReply(
      `${user}, you need at least 2 items in your inventory to use experimental crafting.`
    );
    setTimeout(async () => {
      try { await errorMsg.delete(); } catch (e) { /* ignore */ }
    }, 10000);
    return;
  }

  // Find the workshop channel to create thread in
  const workshopChannel = interaction.channel;

  // Create crafting thread
  const threadName = `experimental crafting - ${user.username}`;
  const craftThread = await workshopChannel.threads.create({
    name: threadName,
    autoArchiveDuration: 60, // 1 hour (shortest Discord allows)
    type: ChannelType.PrivateThread,
    reason: `Experimental crafting session for ${user.username}`
  });

  await craftThread.members.add(user.id);

  // Don't lock thread during selection - buttons won't work if locked
  // We'll lock after crafting executes

  // Send confirmation message via interaction reply that auto-deletes after 10 seconds
  const confirmation = await interaction.editReply(
    `Crafting session started for ${user}! Head to <#${craftThread.id}>`
  );
  setTimeout(async () => {
    try { await confirmation.delete(); } catch (e) { /* ignore */ }
  }, 10000);

  // Post intro message
  await craftThread.send(selectionFlow.buildIntroMessage(selectionFlow.FLOW_DEFINITIONS.experimental_craft));

  // Start the selection flow
  const flowState = selectionFlow.startFlow({
    threadId: craftThread.id,
    playerId: user.id,
    flowType: 'experimental_craft',
    sourceItems: inventory,
    context: { guild },
    onConfirm: async (playerId, selections, context) => {
      await executeExperimentalCraft(playerId, selections, craftThread, context.guild);
    }
  });

  // Post the first selection message
  const { content, components } = selectionFlow.buildSelectionMessage(flowState);
  const selectionMsg = await craftThread.send({ content, components });
  selectionFlow.setMessageId(craftThread.id, selectionMsg.id);

  console.log(`[CRAFT] Started experimental crafting session for ${user.username}`);
}

/**
 * Handle crafting-related interactions (selection flow)
 * @param {Object} interaction - Discord interaction
 */
async function handleCraftingInteraction(interaction) {
  const threadId = interaction.channel?.id;
  if (!threadId) return false;

  // Handle selection flow interactions
  const flowState = selectionFlow.getFlowState(threadId);
  if (!flowState) return false;

  // Verify user owns this flow
  if (flowState.playerId !== interaction.user.id) {
    await interaction.reply({ content: 'This selection is not yours.', ephemeral: true });
    return true;
  }

  const customId = interaction.customId;

  // Handle dropdown selection
  if (interaction.isStringSelectMenu() && customId.startsWith('selection_choose_')) {
    const selectedValue = interaction.values[0];
    const result = selectionFlow.handleSelection(threadId, selectedValue);

    if (result) {
      const { content, components } = selectionFlow.buildSelectionMessage(result.state);

      // Selection now immediately advances - post new message for next step
      if (result.shouldPostNew) {
        // Replace current message with item embed card
        const selectedItem = result.selectedItem;
        const itemEmbed = formatItemAsEmbed(selectedItem, selectedItem.purchase_price_gp, {
          priceLabel: 'Value'
        });

        await interaction.update({
          content: '',
          embeds: [itemEmbed],
          components: []
        });

        // Post new message for next step
        const newMsg = await interaction.channel.send({ content, components });
        selectionFlow.setMessageId(threadId, newMsg.id);
      } else {
        await interaction.update({ content, components });
      }
    }
    return true;
  }

  // Handle button clicks
  if (interaction.isButton()) {
    let result;
    let shouldEdit = false;
    let shouldPostNew = false;

    if (customId.startsWith('selection_prev_')) {
      result = selectionFlow.handlePagination(threadId, 'prev');
      shouldEdit = true;
    } else if (customId.startsWith('selection_next_')) {
      result = selectionFlow.handlePagination(threadId, 'next');
      shouldEdit = true;
    } else if (customId.startsWith('selection_cancel_')) {
      selectionFlow.handleCancel(threadId);
      await interaction.update({
        content: '**Selection cancelled.**',
        components: []
      });
      return true;
    } else if (customId.startsWith('selection_execute_')) {
      await interaction.deferUpdate();

      // Show processing message
      await interaction.editReply({
        content: '**Processing...**',
        components: []
      });

      // Execute the flow
      const execResult = await selectionFlow.handleExecute(threadId);

      if (execResult) {
        // The onConfirm callback handles the actual work
        // Just clean up the message
        await interaction.editReply({
          content: '**Combination complete!** Check the thread for results.',
          components: []
        });
      }
      return true;
    }

    if (result) {
      if (shouldPostNew) {
        // Acknowledge the current interaction
        await interaction.update({
          content: interaction.message.content.replace(/\*\*.*\*\*/, '**Confirmed**'),
          components: []
        });

        // Post new message for next step
        const { content, components } = selectionFlow.buildSelectionMessage(result.state);
        const newMsg = await interaction.channel.send({ content, components });
        selectionFlow.setMessageId(threadId, newMsg.id);
      } else if (shouldEdit) {
        const { content, components } = selectionFlow.buildSelectionMessage(result.state);
        await interaction.update({ content, components });
      }
    }
    return true;
  }

  return false;
}

module.exports = {
  scoreCraftingSynergy,
  executeExperimentalCraft,
  handleWorkshopCraftButton,
  handleCraftingInteraction
};
