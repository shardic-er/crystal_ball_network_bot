/**
 * Selection Flow System
 *
 * Reusable UI pattern for "select N items/NPCs for a purpose"
 * Handles pagination, multi-step selection, and validation.
 *
 * State is kept in-memory (Map keyed by threadId).
 * If bot restarts mid-selection, user just restarts the flow.
 */

const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// In-memory state for active selections
const activeSelections = new Map();

// Constants
const PAGE_SIZE = 25; // Discord's max select menu options

/**
 * Flow definitions for different selection types
 */
const FLOW_DEFINITIONS = {
  experimental_craft: {
    type: 'experimental_craft',
    title: 'Experimental Crafting',
    description: 'Combine two items to discover what they create.\n**Warning:** Both items will be consumed.\n',
    steps: [
      {
        prompt: 'Select first item',
        required: true
      },
      {
        prompt: 'Select second item',
        required: true,
        filterPrevious: true // Exclude items selected in previous steps
      }
    ],
    confirm: {
      prompt: 'Both items will be destroyed. This cannot be undone.',
      buttonLabel: 'Combine'
    }
  }
  // Future: quest_party, commission_material, etc.
};

/**
 * Start a new selection flow
 * @param {Object} options
 * @param {string} options.threadId - Discord thread ID
 * @param {string} options.playerId - Player's Discord ID
 * @param {string} options.flowType - Type of flow (e.g., 'experimental_craft')
 * @param {Array} options.sourceItems - Items/NPCs to select from
 * @param {Object} options.context - Additional context for the flow
 * @param {Function} options.onConfirm - Callback when selection is confirmed
 * @returns {Object} Initial state
 */
function startFlow(options) {
  const { threadId, playerId, flowType, sourceItems, context = {}, onConfirm } = options;

  const flowDef = FLOW_DEFINITIONS[flowType];
  if (!flowDef) {
    throw new Error(`Unknown flow type: ${flowType}`);
  }

  const state = {
    playerId,
    flowType,
    flowDef,
    currentStep: 0,
    selections: [], // Array of selected item objects
    selectionIds: [], // Array of selected item IDs (for filtering)
    page: 0,
    sourceItems,
    context,
    onConfirm,
    messageId: null, // Will be set after first message is sent
    state: 'selecting' // 'selecting', 'confirming', 'complete'
  };
  // Note: 'selected' state removed - selections now immediately advance to next step

  activeSelections.set(threadId, state);
  return state;
}

/**
 * Get current flow state for a thread
 * @param {string} threadId
 * @returns {Object|null}
 */
function getFlowState(threadId) {
  return activeSelections.get(threadId) || null;
}

/**
 * Update the message ID for a flow (called after sending the message)
 * @param {string} threadId
 * @param {string} messageId
 */
function setMessageId(threadId, messageId) {
  const state = activeSelections.get(threadId);
  if (state) {
    state.messageId = messageId;
  }
}

/**
 * Get items for current page, filtered by previous selections
 * @param {Object} state
 * @returns {Array}
 */
function getPageItems(state) {
  const { sourceItems, selectionIds, flowDef, currentStep, page } = state;
  const stepDef = flowDef.steps[currentStep];

  // Filter out previously selected items if this step requires it
  let available = sourceItems;
  if (stepDef.filterPrevious) {
    available = sourceItems.filter(item => !selectionIds.includes(item.inventory_id));
  }

  // Paginate
  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;

  return {
    items: available.slice(start, end),
    totalItems: available.length,
    totalPages: Math.ceil(available.length / PAGE_SIZE),
    currentPage: page,
    start: start + 1,
    end: Math.min(end, available.length)
  };
}

/**
 * Build the selection message components
 * @param {Object} state
 * @returns {Object} { content, components }
 */
function buildSelectionMessage(state) {
  const { flowDef, currentStep, state: flowState, selections } = state;

  // Handle confirmation state
  if (flowState === 'confirming') {
    return buildConfirmMessage(state);
  }

  // Build selection UI
  const stepDef = flowDef.steps[currentStep];
  const pageData = getPageItems(state);

  // Build content
  let content = `**${stepDef.prompt}**`;
  if (pageData.totalItems > PAGE_SIZE) {
    content += ` (${pageData.start}-${pageData.end} of ${pageData.totalItems})`;
  }

  // Build select menu
  const selectOptions = pageData.items.map(item => ({
    label: truncate(item.name, 100),
    description: truncate(`${item.rarity} ${item.item_type}`, 100),
    value: item.inventory_id.toString()
  }));

  if (selectOptions.length === 0) {
    return {
      content: `**${stepDef.prompt}**\n\n*No items available to select.*`,
      components: []
    };
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`selection_choose_${state.flowType}`)
    .setPlaceholder('Choose an item...')
    .addOptions(selectOptions);

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  // Build pagination buttons if needed
  const components = [selectRow];

  if (pageData.totalPages > 1 || currentStep > 0) {
    const buttonRow = new ActionRowBuilder();

    // Cancel button (shown on step 2+)
    if (currentStep > 0) {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`selection_cancel_${state.flowType}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // Pagination buttons
    if (pageData.totalPages > 1) {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`selection_prev_${state.flowType}`)
          .setLabel('< Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(state.page === 0),
        new ButtonBuilder()
          .setCustomId(`selection_next_${state.flowType}`)
          .setLabel('Next >')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(state.page >= pageData.totalPages - 1)
      );
    }

    if (buttonRow.components.length > 0) {
      components.push(buttonRow);
    }
  }

  return { content, components };
}

/**
 * Build final confirmation message
 * @param {Object} state
 * @returns {Object} { content, components }
 */
function buildConfirmMessage(state) {
  const { flowDef } = state;

  let content = `**Confirm Selection**\n\n`;
  content += flowDef.confirm.prompt;

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`selection_cancel_${state.flowType}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`selection_execute_${state.flowType}`)
      .setLabel(flowDef.confirm.buttonLabel)
      .setStyle(ButtonStyle.Danger)
  );

  return { content, components: [buttonRow] };
}

/**
 * Handle a selection from the dropdown
 * @param {string} threadId
 * @param {string} selectedValue - The inventory_id as string
 * @returns {Object} { state, shouldEdit, shouldPostNew }
 */
function handleSelection(threadId, selectedValue) {
  const state = activeSelections.get(threadId);
  if (!state) return null;

  const inventoryId = parseInt(selectedValue, 10);
  const selectedItem = state.sourceItems.find(item => item.inventory_id === inventoryId);

  if (!selectedItem) {
    console.error(`[SelectionFlow] Item not found: ${inventoryId}`);
    return null;
  }

  // Store the selection
  state.selections[state.currentStep] = selectedItem;
  state.selectionIds[state.currentStep] = inventoryId;

  const { flowDef, currentStep } = state;

  // Immediately advance to next step or final confirmation (no intermediate "selected" state)
  if (currentStep < flowDef.steps.length - 1) {
    // Move to next step
    state.currentStep++;
    state.page = 0;
    state.state = 'selecting';
    return { state, shouldEdit: false, shouldPostNew: true, selectedItem };
  }

  // All steps complete, move to final confirmation
  state.state = 'confirming';
  return { state, shouldEdit: false, shouldPostNew: true, selectedItem };
}

/**
 * Handle "Back" button - go to previous step
 * @param {string} threadId
 * @returns {Object} { state, shouldEdit }
 */
function handleBack(threadId) {
  const state = activeSelections.get(threadId);
  if (!state) return null;

  if (state.currentStep > 0) {
    state.currentStep--;
    state.page = 0;
    // Remove the selection for the step we're going back to
    state.selections.pop();
    state.selectionIds.pop();
    state.state = 'selecting';
  }

  return { state, shouldEdit: true };
}

/**
 * Handle pagination
 * @param {string} threadId
 * @param {string} direction - 'prev' or 'next'
 * @returns {Object} { state, shouldEdit }
 */
function handlePagination(threadId, direction) {
  const state = activeSelections.get(threadId);
  if (!state) return null;

  const pageData = getPageItems(state);

  if (direction === 'prev' && state.page > 0) {
    state.page--;
  } else if (direction === 'next' && state.page < pageData.totalPages - 1) {
    state.page++;
  }

  return { state, shouldEdit: true };
}

/**
 * Handle cancel - clean up the flow
 * @param {string} threadId
 * @returns {Object} { cancelled: true }
 */
function handleCancel(threadId) {
  activeSelections.delete(threadId);
  return { cancelled: true };
}

/**
 * Handle execute - run the final callback
 * @param {string} threadId
 * @returns {Object} { state, selections }
 */
async function handleExecute(threadId) {
  const state = activeSelections.get(threadId);
  if (!state) return null;

  const { selections, onConfirm, playerId, context } = state;

  // Mark as complete
  state.state = 'complete';

  // Clean up
  activeSelections.delete(threadId);

  // Execute callback
  if (onConfirm) {
    await onConfirm(playerId, selections, context);
  }

  return { state, selections };
}

/**
 * Clean up a flow (e.g., thread deleted)
 * @param {string} threadId
 */
function cleanupFlow(threadId) {
  activeSelections.delete(threadId);
}

/**
 * Truncate string to max length
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Build the intro message for a flow
 * @param {Object} flowDef
 * @returns {string}
 */
function buildIntroMessage(flowDef) {
  return `**${flowDef.title}**\n\n${flowDef.description}`;
}

module.exports = {
  FLOW_DEFINITIONS,
  startFlow,
  getFlowState,
  setMessageId,
  buildSelectionMessage,
  buildIntroMessage,
  handleSelection,
  handleBack,
  handlePagination,
  handleCancel,
  handleExecute,
  cleanupFlow
};