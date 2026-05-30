import type { Config, LLMProvider } from '../config.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

export async function makeLLM(cfg: Config['llm']): Promise<LLMClient> {
  switch (cfg.provider) {
    case 'openai':
      return makeOpenAI(cfg, 'https://api.openai.com/v1');
    case 'openrouter':
      return makeOpenAI(cfg, cfg.baseUrl ?? 'https://openrouter.ai/api/v1');
    case 'anthropic':
      return makeAnthropic(cfg);
    case 'ollama':
      return makeOllama(cfg);
  }
}

async function makeOpenAI(cfg: Config['llm'], baseURL: string): Promise<LLMClient> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: cfg.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY, baseURL });
  return {
    async complete(messages) {
      const res = await client.chat.completions.create({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      });
      return res.choices[0]?.message?.content?.trim() ?? '';
    },
  };
}

async function makeAnthropic(cfg: Config['llm']): Promise<LLMClient> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY });
  return {
    async complete(messages) {
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const turns = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const res = await client.messages.create({
        model: cfg.model,
        system: sys || undefined,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        messages: turns,
      });
      const block = res.content.find((b) => b.type === 'text');
      return block && block.type === 'text' ? block.text.trim() : '';
    },
  };
}

function makeOllama(cfg: Config['llm']): LLMClient {
  const baseUrl = cfg.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  return {
    async complete(messages) {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          stream: false,
          options: { temperature: cfg.temperature, num_predict: cfg.maxTokens },
        }),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content?.trim() ?? '';
    },
  };
}

export const PROVIDER_DEFAULTS: Record<LLMProvider, { model: string; needsKey: boolean; label: string }> = {
  openai: { model: 'gpt-4o-mini', needsKey: true, label: 'OpenAI' },
  anthropic: { model: 'claude-3-5-sonnet-latest', needsKey: true, label: 'Anthropic' },
  openrouter: { model: 'anthropic/claude-3.5-sonnet', needsKey: true, label: 'OpenRouter' },
  ollama: { model: 'llama3.1', needsKey: false, label: 'Ollama (local)' },
};
