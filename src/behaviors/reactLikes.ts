import type { BehaviorCtx } from './onMessage.ts';
import { api } from '../sdk.ts';

export async function maybeLike(
  ctx: BehaviorCtx,
  message: { id: string; userId: string; content: string },
): Promise<void> {
  if (!ctx.enabled.has('react_likes')) return;
  if (message.userId === ctx.ownUserId) return;
  if (!ctx.rl.tryConsume('like', false)) return;

  // Like if content is non-trivial (>40 chars) and not obviously a question already being replied to.
  if (message.content.trim().length < 40) return;

  try {
    await api.likeMessage({
      path: { token_address: ctx.tokenAddress, message_id: message.id },
      throwOnError: true,
    });
    ctx.log(`liked message ${message.id}`);
  } catch (e) {
    ctx.log(`like failed: ${(e as Error).message}`);
  }
}
