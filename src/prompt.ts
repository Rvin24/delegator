/**
 * Interactive chain picker.
 *
 * When the user runs the script without `CHAIN` (or `CHAIN_ID`) set, this
 * helper prompts them to pick a chain from a numbered list. The picked
 * value is written into `process.env.CHAIN` so that the subsequent
 * `resolveChainProfile()` call sees it.
 *
 * The prompt is skipped when:
 *   - `CHAIN` or `CHAIN_ID` is already set in the environment, or
 *   - stdin is not a TTY (piped input, CI, etc.) — in which case we
 *     fall back to the default behavior (base).
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { KNOWN_CHAINS } from './chains.js';

const DEFAULT_CHAIN = 'base';

export async function promptForChainIfNeeded(): Promise<void> {
  if (process.env.CHAIN && process.env.CHAIN.trim() !== '') return;
  if (process.env.CHAIN_ID && process.env.CHAIN_ID.trim() !== '') return;
  if (!input.isTTY) return;

  const presets = KNOWN_CHAINS;
  const defaultIndex = presets.indexOf(DEFAULT_CHAIN);

  console.log('Pick a chain (Enter for default = base):');
  presets.forEach((name, i) => {
    const marker = i === defaultIndex ? ' (default)' : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${name}${marker}`);
  });

  const rl = readline.createInterface({ input, output });
  let chosen: string | undefined;
  try {
    /* eslint-disable-next-line no-constant-condition */
    while (true) {
      const raw = (await rl.question('Chain [1]: ')).trim();
      if (raw === '') {
        chosen = DEFAULT_CHAIN;
        break;
      }
      const asNum = Number(raw);
      if (Number.isInteger(asNum) && asNum >= 1 && asNum <= presets.length) {
        chosen = presets[asNum - 1];
        break;
      }
      const lowered = raw.toLowerCase();
      if (presets.includes(lowered)) {
        chosen = lowered;
        break;
      }
      console.log(`  ! "${raw}" is not a valid choice. Try a number 1-${presets.length} or a name from the list.`);
    }
  } finally {
    rl.close();
  }

  process.env.CHAIN = chosen;
  console.log(`Selected chain: ${chosen}\n`);
}
