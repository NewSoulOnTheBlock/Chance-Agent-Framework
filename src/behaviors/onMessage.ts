import type { SeenMessage } from '../state.ts';
import type { PostContext } from '../post.ts';
import { generateAndPost } from '../post.ts';
import type { RateLimiter } from '../rateLimit.ts';

const QUESTION_WORDS = /^(what|why|how|when|where|who|is|are|can|could|will|would|should|does|do|did|has|have|any)\b/i;

function isQuestion(content: string): boolean {
  const t = content.trim();
  if (t.endsWith('?')) return true;
  return QUESTION_WORDS.test(t);
}

function mentionsChance(content: string, personaName: string): boolean {
  const lower = content.toLowerCase();
  const name = personaName.toLowerCase();
  return lower.includes(`@${name}`) || new RegExp(`\\b${name}\\b`).test(lower);
}

export interface BehaviorCtx extends PostContext {
  ownUserId: string;
  personaName: string;
  rl: RateLimiter;
  enabled: Set<string>;
}

export async function onMessage(ctx: BehaviorCtx, m: SeenMessage): Promise<void> {
  // Skip Chance's own messages — content reconciliation already drops the optimistic copy upstream.
  if (m.userId === ctx.ownUserId) return;
  // Skip replies inside someone else's thread for now — keep behavior to top-level signal.
  // (Mentions still fire on replies if Chance is mentioned by name.)

  // 1. Welcome new posters first — supersedes other replies.
  if (
    ctx.enabled.has('welcome') &&
    !m.parentMessageId &&
    !ctx.state.welcomed.has(m.userId) &&
    ctx.rl.tryConsume('welcome')
  ) {
    ctx.state.welcomed.add(m.userId);
    await generateAndPost(
      ctx,
      `Welcome @${m.username} who just posted their first message: "${m.content}". Greet them in one short sentence, on-topic to what they said.`,
      { replyTo: m },
    );
    return;
  }
  // Even if welcome isn't enabled, still track first-seen so future "welcome" toggles work.
  ctx.state.welcomed.add(m.userId);

  // 2. Mentions — highest priority reply.
  if (ctx.enabled.has('reply_mentions') && mentionsChance(m.content, ctx.personaName)) {
    if (ctx.rl.tryConsume('reply')) {
      await generateAndPost(
        ctx,
        `@${m.username} addressed you directly: "${m.content}". Respond in character.`,
        { replyTo: m },
      );
      return;
    }
  }

  // 3. Questions — answer if you have something to say.
  if (ctx.enabled.has('reply_questions') && isQuestion(m.content)) {
    if (ctx.rl.tryConsume('reply')) {
      await generateAndPost(
        ctx,
        `@${m.username} asked: "${m.content}". Answer briefly in character, or say something insightful if you don't know.`,
        { replyTo: m },
      );
      return;
    }
  }
}
