import * as p from '@clack/prompts';
import {
  ConfigSchema,
  PersonaArchetypeSchema,
  type Config,
  type LLMProvider,
  type Behavior,
  type PersonaArchetype,
} from './config.ts';
import { PROVIDER_DEFAULTS } from './llm/index.ts';
import { buildSystemPrompt } from './personas.ts';
import { saveConfig, loadConfig } from './config.ts';

export async function runSetup(): Promise<Config> {
  const existing = await loadConfig();
  if (existing) {
    const overwrite = await p.confirm({
      message: 'chance.config.json already exists. Overwrite?',
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro('keeping existing config.');
      process.exit(0);
    }
  }

  p.intro('🎲 Chance — setup');

  // --- Coin Communities ---
  p.note('Coin Communities credentials (from your business dashboard).', 'step 1 / 4 — coin communities');

  const baseUrl = await ask('Coin Communities base URL', 'https://api.coin-communities.xyz');
  const apiKey = await secret('x-api-key (regular API key)');
  const serverKey = await secret('x-server-key (server key pair: key)');
  const serverSecret = await secret('x-server-secret (server key pair: secret)');
  const twitterId = await ask('numeric Twitter ID of Chance\'s persona (for postMessageServer)');
  const chainId = (await p.select({
    message: 'chain Chance will post from',
    options: [
      { value: 'solana', label: 'Solana' },
      { value: 'ethereum', label: 'Ethereum' },
      { value: 'base', label: 'Base' },
      { value: 'bsc', label: 'BSC' },
    ],
    initialValue: 'solana',
  })) as 'solana' | 'ethereum' | 'base' | 'bsc';
  cancelGuard(chainId);
  const walletAddress = await ask('linked wallet address Chance will post from');

  const communitiesRaw = await ask('token addresses to attach to (comma-separated)');
  const communities = communitiesRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (communities.length === 0) {
    p.cancel('need at least one token address.');
    process.exit(1);
  }

  // --- LLM ---
  p.note('Pick which model powers Chance\'s brain.', 'step 2 / 4 — llm');

  const provider = (await p.select({
    message: 'LLM provider',
    options: (Object.keys(PROVIDER_DEFAULTS) as LLMProvider[]).map((k) => ({
      value: k,
      label: PROVIDER_DEFAULTS[k].label,
    })),
    initialValue: 'openai',
  })) as LLMProvider;
  cancelGuard(provider);

  const def = PROVIDER_DEFAULTS[provider];
  const model = await ask(`model name`, def.model);
  const apiKeyLLM = def.needsKey ? await secret(`${def.label} API key`) : undefined;
  const llmBaseUrl =
    provider === 'ollama'
      ? await ask('Ollama base URL', 'http://127.0.0.1:11434')
      : provider === 'openrouter'
        ? await ask('OpenRouter base URL', 'https://openrouter.ai/api/v1')
        : undefined;

  // --- Persona ---
  p.note('Pick a persona archetype or write your own system prompt.', 'step 3 / 4 — persona');

  const name = await ask('persona display name', 'Chance');
  const archetype = (await p.select({
    message: 'archetype',
    options: [
      { value: 'analyst', label: 'analyst — sober, data-leaning' },
      { value: 'memer', label: 'memer — short, very online' },
      { value: 'hype', label: 'hype — warm community-builder' },
      { value: 'oracle', label: 'oracle — cryptic, vague' },
      { value: 'custom', label: 'custom — write your own prompt' },
    ],
    initialValue: 'hype',
  })) as PersonaArchetype;
  cancelGuard(archetype);
  PersonaArchetypeSchema.parse(archetype);

  let customPrompt: string | undefined;
  if (archetype === 'custom') {
    customPrompt = await ask('custom system prompt (will be combined with base safety rules)');
  }
  const systemPrompt = buildSystemPrompt(archetype, name, customPrompt);

  // --- Behaviors ---
  p.note('Toggle which behaviors are active on day one.', 'step 4 / 4 — behaviors');

  const behaviors = (await p.multiselect({
    message: 'enabled behaviors (space to toggle)',
    options: [
      { value: 'reply_mentions', label: 'reply when @mentioned' },
      { value: 'reply_questions', label: 'reply to questions' },
      { value: 'welcome', label: 'welcome first-time posters' },
      { value: 'react_likes', label: 'like high-quality messages' },
      { value: 'moderation_tattle', label: 'log moderation flips' },
      { value: 'hourly_thought', label: 'post a scheduled thought (hourly)' },
    ],
    initialValues: [
      'reply_mentions',
      'reply_questions',
      'welcome',
      'react_likes',
      'moderation_tattle',
      'hourly_thought',
    ],
    required: true,
  })) as Behavior[];
  cancelGuard(behaviors);

  // Final assemble
  const cfg = ConfigSchema.parse({
    cc: { baseUrl, apiKey, serverKey, serverSecret, twitterId, chainId, walletAddress },
    llm: { provider, model, apiKey: apiKeyLLM, baseUrl: llmBaseUrl },
    persona: { name, archetype, systemPrompt },
    communities,
    behaviors,
  });

  await saveConfig(cfg);
  p.outro(`saved → chance.config.json. start with: bun run start`);
  return cfg;
}

async function ask(message: string, initial?: string): Promise<string> {
  const v = await p.text({
    message,
    initialValue: initial,
    validate: (val) => (val.trim() ? undefined : 'required'),
  });
  cancelGuard(v);
  return (v as string).trim();
}

async function secret(message: string): Promise<string> {
  const v = await p.password({
    message,
    validate: (val) => (val.trim() ? undefined : 'required'),
  });
  cancelGuard(v);
  return (v as string).trim();
}

function cancelGuard<T>(v: T | symbol): asserts v is T {
  if (p.isCancel(v)) {
    p.cancel('setup cancelled.');
    process.exit(0);
  }
}
