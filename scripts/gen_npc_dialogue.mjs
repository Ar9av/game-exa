/**
 * Generates rich NPC dialogue at build time using Claude Haiku.
 *
 * Reads GDD NPC entities (with personality fields), generates 6-8 dialogue
 * lines per NPC based on their personality, role, and the game's world context.
 * Writes to public/data/npc-dialogue.json — loaded by Game.js at runtime.
 *
 * Usage:
 *   node scripts/gen_npc_dialogue.mjs <project-dir>
 *   node --env-file=~/.all-skills/.env scripts/gen_npc_dialogue.mjs <project-dir>
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const FALLBACK_DIALOGUE = {
  NPC_GIRL:  ['Hello, traveller!', 'This town is full of secrets!'],
  NPC_BOY:   ['Hey! You\'re exploring too?', 'I heard there are hidden chests nearby!'],
  NPC_ELDER: ['Welcome, young one.', 'This town holds great treasure for those who seek it.'],
};

export async function generateNpcDialogue({ projectDir, apiKey, log = console.log }) {
  const stateFile = join(resolve(projectDir), 'game-state.json');
  if (!existsSync(stateFile)) throw new Error(`game-state.json not found in ${projectDir}`);

  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const gdd   = state.gdd;
  if (!gdd) throw new Error('No GDD in game-state.json — run game-designer first');

  const npcs = (gdd.entities ?? []).filter(e => e.kind === 'npc');
  if (npcs.length === 0) {
    log('No NPC entities found in GDD — skipping dialogue generation');
    return {};
  }

  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  const dialogue = {};

  for (const npc of npcs) {
    log(`  → generating dialogue for ${npc.id}`);

    const personalityDesc = npc.personality
      ? buildPersonalityDesc(npc.personality)
      : 'A friendly townsperson.';

    try {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            `You are writing NPC dialogue for a Pokémon-style RPG game called "${gdd.title}".`,
            '',
            `NPC: ${npc.id}`,
            `Visual description: ${npc.desc}`,
            `Personality: ${personalityDesc}`,
            '',
            `Game context: ${gdd.tagline}`,
            `World: A charming pixel-art town. The player is a trainer collecting ${gdd.winCondition.match(/\d+/)?.[0] ?? 'several'} hidden treasure chests.`,
            '',
            'Write exactly 6 short NPC dialogue lines. Rules:',
            '- Each line ≤ 2 sentences, max 80 characters total',
            '- Use \\n within a line for a natural pause/breath',
            '- Lines should rotate: greetings, hints, lore, personality flavor, world detail, send-off',
            '- Match the personality described',
            '- No meta-game references, no "game over", no wall-of-text',
            '',
            'Respond ONLY with a JSON array of 6 strings, no prose:',
            '["line1", "line2", "line3", "line4", "line5", "line6"]',
          ].join('\n'),
        }],
      });

      const lines = JSON.parse(msg.content[0].text);
      if (Array.isArray(lines) && lines.length > 0) {
        dialogue[npc.id] = lines;
        log(`     ✓ ${lines.length} lines`);
      } else {
        throw new Error('invalid response shape');
      }
    } catch (e) {
      log(`     ⚠ failed (${e.message}), using fallback`);
      dialogue[npc.id] = FALLBACK_DIALOGUE[npc.id] ?? [`Hello! I'm ${npc.id.replace('NPC_', '').toLowerCase()}.`, 'Have a wonderful day!'];
    }
  }

  const outPath = join(resolve(projectDir), 'public', 'data', 'npc-dialogue.json');
  await writeFile(outPath, JSON.stringify(dialogue, null, 2));
  log(`✅ npc-dialogue.json written to ${outPath}`);
  return dialogue;
}

function buildPersonalityDesc(p) {
  const traits = [];
  if (p.openness        > 0.7) traits.push('curious and imaginative');
  if (p.conscientiousness > 0.7) traits.push('diligent and reliable');
  if (p.extraversion    > 0.7) traits.push('outgoing and enthusiastic');
  else if (p.extraversion < 0.3) traits.push('quiet and reserved');
  if (p.agreeableness   > 0.7) traits.push('warm and helpful');
  if (p.neuroticism     > 0.6) traits.push('anxious and worrying');
  if (p.backstory) traits.push(p.backstory);
  return traits.join('. ') || 'An ordinary townsperson.';
}

// CLI
if (process.argv[1]?.endsWith('gen_npc_dialogue.mjs')) {
  const projectDir = process.argv[2] ?? '.';
  await generateNpcDialogue({ projectDir });
}
