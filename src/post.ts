import type { LLMClient, ChatMessage } from './llm/index.ts';
import type { CommunityState, SeenMessage } from './state.ts';
import { api } from './sdk.ts';
import type { Config } from './config.ts';

export interface PostContext {
  cfg: Config;
  tokenAddress: string;
  state: CommunityState;
  llm: LLMClient;
  systemPrompt: string;
  log: (msg: string) => void;
}

function buildTranscript(state: CommunityState, focus?: SeenMessage): ChatMessage[] {
  const turns: ChatMessage[] = [];
  // Provide last ~10 messages as user-role context turns, prefixed with username.
  const slice = state.recent.slice(-10);
  for (const m of slice) {
    turns.push({ role: 'user', content: `@${m.username}: ${m.content}` });
  }
  if (focus && !slice.includes(focus)) {
    turns.push({ role: 'user', content: `@${focus.username}: ${focus.content}` });
  }
  return turns;
}

/** Ask the LLM, then post via postMessageServer with optimistic correlation. */
export async function generateAndPost(
  ctx: PostContext,
  instruction: string,
  opts: { replyTo?: SeenMessage } = {},
): Promise<string | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: ctx.systemPrompt },
    ...buildTranscript(ctx.state, opts.replyTo),
    { role: 'user', content: `[instruction] ${instruction}` },
  ];

  let text: string;
  try {
    text = await ctx.llm.complete(messages);
  } catch (e) {
    ctx.log(`LLM error: ${(e as Error).message}`);
    return null;
  }
  if (!text) return null;

  // Trim to one line, enforce 240 char ceiling.
  text = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!text) return null;

  ctx.state.markPending(text);

  const body: Parameters<typeof api.postReplyServer>[0]['body'] | Parameters<typeof api.postMessageServer>[0]['body'] = {
    content: text,
    chainId: ctx.cfg.cc.chainId,
    walletAddress: ctx.cfg.cc.walletAddress,
    twitterId: ctx.cfg.cc.twitterId,
  } as never;

  try {
    if (opts.replyTo) {
      await api.postReplyServer({
        path: { token_address: ctx.tokenAddress, message_id: opts.replyTo.id },
        body: body as never,
        throwOnError: true,
      });
      ctx.log(`replied to @${opts.replyTo.username}: ${text}`);
    } else {
      await api.postMessageServer({
        path: { token_address: ctx.tokenAddress },
        body: body as never,
        throwOnError: true,
      });
      ctx.log(`posted: ${text}`);
    }
    return text;
  } catch (e) {
    ctx.log(`post failed: ${(e as Error).message}`);
    return null;
  }
}
