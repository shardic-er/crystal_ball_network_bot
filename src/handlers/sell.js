/**
 * Sell handler - Selling flow, buyers, negotiation
 */

const { ChannelType } = require('discord.js');
const { Player, InventoryThread, Item } = require('../database/models');
const { config, GAME_CHANNEL_NAME } = require('../utils/config');
const { delay } = require('../utils/timing');
const { getPrompt } = require('../utils/prompts');
const { formatItemAsEmbed, formatBuyerAsMarkdown } = require('../ui/embeds');
const { getInventoryHeader, postCloseThreadButton } = require('../ui/messages');
const { callClaudeAPI } = require('../services/claude');
const { addPricingToItems } = require('../services/pricing');
const sessionsService = require('../services/sessions');

// Interest level affects negotiation behavior (configured in config.json)
const INTEREST_NEGOTIATION = config.negotiation.interestLevels;

/**
 * Generate prospective buyers for an item being sold
 * @param {Object} item - Item data from inventory
 * @param {string} threadId - Thread ID for cost tracking
 * @param {Function} onBuyersGenerated - Callback when buyers are generated (before pricing)
 * @returns {Promise<Object>} Parsed buyers JSON with calculated prices
 */
async function generateBuyers(item, threadId, onBuyersGenerated = null) {
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

    const buyerPrompt = getPrompt('BUYER');

    // Generate buyers via AI
    const { text: buyerResponse, usage } = await callClaudeAPI({
      model: 'claude-haiku-4-5',
      maxTokens: 2048,
      system: buyerPrompt,
      messages: [{ role: 'user', content: itemJson }],
      threadId
    });

    console.log(`[BUYERS] Received response (${usage.input_tokens} input, ${usage.output_tokens} output tokens)`);

    // Parse JSON response
    const jsonMatch = buyerResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Buyer response did not contain valid JSON');
    }

    const buyerData = JSON.parse(jsonMatch[0]);
    console.log(`[BUYERS] Parsed ${buyerData.buyers?.length || 0} buyers`);

    // Call the callback with Curator message before pricing (to show progress to user)
    if (onBuyersGenerated && buyerData.message) {
      await onBuyersGenerated(buyerData.message);
    }

    // Price the item 3 times in parallel - model variance creates natural price differences
    const itemForPricing = {
      name: item.name,
      rarity: item.rarity,
      properties: item.properties,
      complication: item.complication
    };

    console.log(`[BUYERS] Pricing item (3 parallel calls for variance)...`);

    // 3 parallel pricing calls - each buyer gets their own independent appraisal
    const pricingPromises = buyerData.buyers.map(async (buyer) => {
      const prices = await addPricingToItems([itemForPricing], threadId);
      const offerPrice = typeof prices[0] === 'number' ? prices[0] : item.base_price_gp;

      const negotiation = INTEREST_NEGOTIATION[buyer.interestLevel] || INTEREST_NEGOTIATION.medium;
      buyer.offerGp = offerPrice;
      buyer.maxOffer = Math.round(offerPrice * negotiation.maxIncrease);
      buyer.walkAwayPrice = Math.round(offerPrice * negotiation.walkAwayThreshold);

      console.log(`[BUYERS] ${buyer.name} (${buyer.interestLevel}): ${buyer.offerGp}gp initial, max ${buyer.maxOffer}gp, walks at ${buyer.walkAwayPrice}gp`);
      return buyer;
    });

    await Promise.all(pricingPromises);

    console.log('=== BUYER GENERATION COMPLETE ===\n');
    return buyerData;

  } catch (error) {
    console.error('=== BUYER GENERATION ERROR ===');
    console.error('[BUYERS] Error:', error);
    throw error;
  }
}

/**
 * Classify if a player message contains a price offer
 * @param {string} messageContent - Player's message
 * @param {string} threadId - Thread ID for cost tracking
 * @returns {Promise<{isOffer: boolean, amount: number|null}>}
 */
async function classifyOffer(messageContent, threadId) {
  try {
    const classifierPrompt = getPrompt('OFFER_CLASSIFIER');

    const { text } = await callClaudeAPI({
      model: 'claude-haiku-4-5',
      maxTokens: 100,
      system: classifierPrompt,
      messages: [{ role: 'user', content: messageContent }],
      threadId
    });

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

  const negotiationPrompt = getPrompt('NEGOTIATION');

  const { text } = await callClaudeAPI({
    model: 'claude-haiku-4-5',
    maxTokens: 1024,
    system: negotiationPrompt + '\n\n' + context,
    messages: [{ role: 'user', content: playerMessage }],
    threadId
  });

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
 * Clean up a sell thread - remove moneybag reactions and lock
 * @param {Object} session - Sell session
 * @param {Object} channel - Discord channel
 * @param {Object} cbnSessions - Sessions reference
 */
async function cleanupSellThread(session, channel, cbnSessions) {
  // Remove all reactions from buyer messages and current offer
  for (const buyer of session.buyers) {
    if (buyer.messageId) {
      try {
        const buyerMsg = await channel.messages.fetch(buyer.messageId);
        await buyerMsg.reactions.cache.get('\u{1F4B0}')?.remove(); // moneybag
        await buyerMsg.reactions.cache.get('\u{1F4AC}')?.remove(); // speech bubble
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

  // Post close button
  await postCloseThreadButton(channel);

  // Clean up session
  delete cbnSessions[channel.id];
  await sessionsService.saveSessions();
}

/**
 * Complete a sale - update inventory, gold, etc.
 * @param {Object} session - Sell session
 * @param {number} amount - Sale amount in gp
 * @param {Object} channel - Discord channel to send messages
 * @param {Object} guild - Discord guild for fetching inventory thread
 * @param {Object} cbnSessions - Sessions reference
 */
async function completeSale(session, amount, channel, guild, cbnSessions) {
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

      const inventory = Item.getPlayerInventory(player.player_id, true, false);
      const totalValue = inventory.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);
      const updatedHeader = await getInventoryHeader(updatedPlayer.account_balance_gp, inventory.length, totalValue);
      await headerMessage.edit(updatedHeader);
      console.log(`[SELL] Updated inventory header`);

      // Delete the item message from inventory thread
      if (session.itemBeingSold.itemData.discord_message_id) {
        try {
          const itemMsg = await inventoryChannel.messages.fetch(session.itemBeingSold.itemData.discord_message_id);
          await itemMsg.delete();
          console.log(`[SELL] Deleted item message from inventory`);
        } catch (e) {
          console.warn('[SELL] Could not delete inventory message:', e.message);
        }
      }

    } catch (error) {
      console.error('[SELL] Error updating inventory:', error);
    }
  }

  // Send confirmation
  await channel.send(`**Sale Complete!** Sold **${session.itemBeingSold.name}** for **${amount.toLocaleString()} gp**.\n\n*Your new balance: ${updatedPlayer.account_balance_gp.toLocaleString()} gp*`);

  // Clean up thread (remove reactions, lock, clear session)
  await cleanupSellThread(session, channel, cbnSessions);
}

/**
 * Handle scales emoji reaction (start selling from inventory)
 * @param {Object} reaction - Discord reaction
 * @param {Object} user - Discord user
 * @param {Object} message - Discord message
 * @param {Object} cbnSessions - Sessions reference
 */
async function handleSellReaction(reaction, user, message, cbnSessions) {
  try {
    // Only handle in inventory threads
    if (!message.channel.name?.startsWith('inventory-')) {
      return;
    }

    console.log(`[SELL] User ${user.username} clicked sell on item in inventory`);

    // Remove the reaction to acknowledge the click
    await reaction.users.remove(user.id);

    // Look up item directly by message ID from database
    const inventoryItem = Item.getByMessageId(message.id);
    if (!inventoryItem) {
      console.log('[SELL] No inventory item found for message ID:', message.id);
      return;
    }

    // Verify the user owns this item
    const player = Player.getByDiscordId(user.id);
    if (!player || inventoryItem.player_id !== player.player_id) {
      console.log('[SELL] User does not own this item');
      return;
    }

    console.log(`[SELL] Found inventory item: ${inventoryItem.name} (inventory_id: ${inventoryItem.inventory_id})`);

    // Check if there's already a sell session for this item
    const existingSessionEntry = Object.entries(cbnSessions).find(
      ([threadId, s]) => s.sessionType === 'sell' &&
           s.playerId === user.id &&
           s.itemBeingSold?.inventoryId === inventoryItem.inventory_id
    );

    if (existingSessionEntry) {
      const [existingThreadId, existingSession] = existingSessionEntry;

      // Check if item was already sold (session cleanup failed somehow)
      const currentItemState = Item.getInventoryItem(existingSession.itemBeingSold?.inventoryId);
      if (!currentItemState || currentItemState.sold) {
        console.log(`[SELL] Item already sold or removed, cleaning up orphaned session`);
        delete cbnSessions[existingThreadId];
        await sessionsService.saveSessions();
        // Continue to create new session (though item is gone, user will get feedback below)
      } else {
        // Check if session is older than 1 hour (the auto-archive duration)
        const sessionAge = Date.now() - new Date(existingSession.startedAt).getTime();
        const ONE_HOUR_MS = 60 * 60 * 1000;
        const isExpiredByTime = sessionAge > ONE_HOUR_MS;

        if (isExpiredByTime) {
          console.log(`[SELL] Session expired by time (age: ${Math.round(sessionAge / 60000)} minutes)`);
          delete cbnSessions[existingThreadId];
          await sessionsService.saveSessions();
        } else {
          // Session is within 1 hour - check if thread is still usable
          try {
            const existingThread = await message.guild.channels.fetch(existingThreadId);
            if (existingThread && !existingThread.archived) {
              console.log('[SELL] Already have an active sell session for this item');
              // Try to notify user in the existing thread
              try {
                await existingThread.send(`*The crystal ball flickers* - You already have an active sell session here for **${inventoryItem.name}**.`);
              } catch (e) {
                // Thread might not be accessible
              }
              return;
            }
            // Thread is archived or inaccessible - clean up
            console.log('[SELL] Thread archived or inaccessible, cleaning up session');
            delete cbnSessions[existingThreadId];
            await sessionsService.saveSessions();
          } catch (e) {
            console.log(`[SELL] Could not fetch existing thread ${existingThreadId}: ${e.message}`);
            // Thread doesn't exist anymore - clean up
            delete cbnSessions[existingThreadId];
            await sessionsService.saveSessions();
          }
        }
      }
    }

    // Create sell thread
    const itemNameTruncated = inventoryItem.name.length > 50
      ? inventoryItem.name.substring(0, 47) + '...'
      : inventoryItem.name;
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
      reason: `Creating sell session for ${user.username} - ${inventoryItem.name}`
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

    await sessionsService.saveSessions();

    // Send shimmer message
    await sellThread.send('*The crystal ball shimmers to life...*');

    // Generate buyers (with callback to show Curator message while pricing runs)
    try {
      const buyerData = await generateBuyers(inventoryItem, sellThread.id, async (curatorMessage) => {
        // This runs after buyers are generated but before pricing
        // Show item being sold as embed + Curator message
        const itemEmbed = formatItemAsEmbed(inventoryItem, inventoryItem.purchase_price_gp, {
          priceLabel: 'You Paid',
          footer: 'Searching for buyers...'
        });

        await sellThread.send({ embeds: [itemEmbed] });
        await sellThread.send(curatorMessage + '\n\n**\u2014 Prospective Buyers \u2014**');
      });

      // Post each buyer with reactions
      const buyerMessages = [];
      for (let i = 0; i < buyerData.buyers.length; i++) {
        const buyer = buyerData.buyers[i];
        const buyerMarkdown = formatBuyerAsMarkdown(buyer, i);
        const buyerMsg = await sellThread.send(buyerMarkdown);

        // Add reactions: moneybag to accept, speech bubble to negotiate
        await buyerMsg.react('\u{1F4B0}'); // moneybag
        await buyerMsg.react('\u{1F4AC}'); // speech bubble

        buyer.messageId = buyerMsg.id;
        buyerMessages.push({ messageId: buyerMsg.id, buyer });
        await delay(300);
      }

      // Update session with buyer message IDs
      cbnSessions[sellThread.id].buyers = buyerData.buyers;
      await sessionsService.saveSessions();

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

/**
 * Handle moneybag emoji reaction (accept offer in sell thread)
 * @param {Object} reaction - Discord reaction
 * @param {Object} user - Discord user
 * @param {Object} message - Discord message
 * @param {Object} cbnSessions - Sessions reference
 */
async function handleAcceptOffer(reaction, user, message, cbnSessions) {
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
          await completeSale(session, session.currentOffer.amount, message.channel, message.guild, cbnSessions);
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
      await completeSale(session, buyer.offerGp, message.channel, message.guild, cbnSessions);
      return;
    }

  } catch (error) {
    console.error('[SELL] Error:', error);
    await message.channel.send(`Error processing sale: ${error.message}`);
  }
}

/**
 * Handle speech bubble emoji reaction (start negotiation)
 * @param {Object} reaction - Discord reaction
 * @param {Object} user - Discord user
 * @param {Object} message - Discord message
 * @param {Object} cbnSessions - Sessions reference
 */
async function handleNegotiation(reaction, user, message, cbnSessions) {
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

    await sessionsService.saveSessions();

  } catch (error) {
    console.error('[SELL] Negotiation error:', error);
  }
}

/**
 * Handle negotiation messages in sell threads
 * @param {Object} message - Discord message
 * @param {Object} session - Sell session
 * @param {Object} cbnSessions - Sessions reference
 */
async function handleNegotiationMessage(message, session, cbnSessions) {
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
    const offerResult = await classifyOffer(message.content, message.channel.id);
    console.log(`[NEGOTIATE] Offer classification:`, offerResult);

    // Get buyer's response
    const buyerResponse = await getBuyerResponse(session, message.content, message.channel.id);
    console.log(`[NEGOTIATE] Buyer response - offer: ${buyerResponse.newOffer}, walkAway: ${buyerResponse.walkAway}`);

    // Send the buyer's response
    const responseMsg = await message.channel.send(buyerResponse.response);

    // Handle walk away
    if (buyerResponse.walkAway) {
      await message.channel.send(`*${session.buyers[session.activeBuyer].name} turns and walks away, disappearing into the crowd.*\n\n**Negotiation ended.** The buyer is no longer interested.`);

      // Clean up thread (remove reactions, lock, clear session)
      await cleanupSellThread(session, message.channel, cbnSessions);
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
      await sessionsService.saveSessions();

      console.log(`[NEGOTIATE] New offer: ${buyerResponse.newOffer}gp on message ${responseMsg.id}`);
    }

  } catch (error) {
    console.error('[NEGOTIATE] Error:', error);
    await message.channel.send('*The buyer looks confused for a moment, then regains composure.* "I... what was I saying? Let me think about that."');
  }
}

module.exports = {
  generateBuyers,
  classifyOffer,
  getBuyerResponse,
  cleanupSellThread,
  completeSale,
  handleSellReaction,
  handleAcceptOffer,
  handleNegotiation,
  handleNegotiationMessage
};
