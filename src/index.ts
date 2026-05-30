import { loadConfig } from './config.ts';
import { runSetup } from './setup.ts';
import { run } from './agent.ts';

const cmd = process.argv[2] ?? 'run';

if (cmd === 'setup') {
  await runSetup();
  process.exit(0);
}

if (cmd === 'run') {
  let cfg = await loadConfig();
  if (!cfg) {
    console.log('[chance] no chance.config.json found — entering setup.\n');
    cfg = await runSetup();
  }
  await run(cfg);
} else {
  console.error(`Unknown command: ${cmd}\nUsage: bun src/index.ts [setup|run]`);
  process.exit(1);
}
