import { z } from 'zod';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

export const CONFIG_PATH = resolve(process.cwd(), 'chance.config.json');

export const LLMProviderSchema = z.enum(['openai', 'anthropic', 'openrouter', 'ollama']);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

export const PersonaArchetypeSchema = z.enum(['analyst', 'memer', 'hype', 'oracle', 'custom']);
export type PersonaArchetype = z.infer<typeof PersonaArchetypeSchema>;

export const BehaviorSchema = z.enum([
  'reply_mentions',
  'reply_questions',
  'welcome',
  'react_likes',
  'moderation_tattle',
  'hourly_thought',
]);
export type Behavior = z.infer<typeof BehaviorSchema>;

export const ChainIdSchema = z.enum(['solana', 'ethereum', 'base', 'bsc']);
export type ChainId = z.infer<typeof ChainIdSchema>;

export const ConfigSchema = z.object({
  cc: z.object({
    baseUrl: z.string().url().default('https://api.coin-communities.xyz'),
    apiKey: z.string().min(1),
    serverKey: z.string().min(1),
    serverSecret: z.string().min(1),
    twitterId: z.string().min(1),
    chainId: ChainIdSchema.default('solana'),
    walletAddress: z.string().min(1),
  }),
  llm: z.object({
    provider: LLMProviderSchema,
    model: z.string().min(1),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    temperature: z.number().min(0).max(2).default(0.8),
    maxTokens: z.number().int().positive().default(280),
  }),
  persona: z.object({
    name: z.string().default('Chance'),
    archetype: PersonaArchetypeSchema,
    systemPrompt: z.string().min(1),
  }),
  communities: z.array(z.string().min(1)).min(1).describe('Token addresses to attach to'),
  behaviors: z.array(BehaviorSchema).min(1),
  rateLimits: z
    .object({
      replyCooldownMs: z.number().int().positive().default(15_000),
      likeCooldownMs: z.number().int().positive().default(8_000),
      hourlyThoughtIntervalMs: z.number().int().positive().default(60 * 60 * 1000),
      maxRepliesPerHour: z.number().int().positive().default(40),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<Config | null> {
  try {
    await access(CONFIG_PATH);
  } catch {
    return null;
  }
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const parsed = ConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid ${CONFIG_PATH}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function saveConfig(cfg: Config): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}
