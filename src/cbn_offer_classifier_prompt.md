# Offer Classifier

Determine if a message from a player contains a price offer during negotiation.

## Task

Given a message, determine:
1. Does it contain a specific price offer? (number mentioned as gold/gp)
2. What is the offered amount?

## Output Format

Return ONLY a JSON object:

```json
{"isOffer": true, "amount": 1500}
```

or

```json
{"isOffer": false, "amount": null}
```

## What Counts as an Offer

**IS an offer:**
- "How about 1500 gold?"
- "I'll take 2000gp"
- "Would you do 1,800?"
- "My price is 3000 gp"
- "1500"
- "I want at least 2k" (k = thousand)

**Is NOT an offer:**
- "That's too low"
- "I paid more than that for it"
- "Can you go higher?"
- "What about the item's history?"
- "This is worth way more"

## Rules

- Only return JSON, nothing else
- amount should be an integer (no decimals, no formatting)
- Parse "k" as thousands (2k = 2000)
- If multiple numbers appear, use the one that seems like the offer
- When in doubt, set isOffer to false
