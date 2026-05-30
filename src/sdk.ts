// Configure and re-export Coin Communities SDK pieces we use.
// Note: the realtime module is NOT in the `node` conditional export — we import
// it explicitly from the `/react` subpath, which works fine in Bun/Node 22+
// because they ship a global WebSocket. Realtime symbols live under the
// `realtime` namespace on that entry.

import { configureApi, api, realtime } from '@coin-communities/sdk/react';
import type { Config } from './config.ts';

export { api };
export const CommunityRealtimeClient = realtime.CommunityRealtimeClient;
export type CommunityMessageEvent = realtime.CommunityMessageEvent;
export type LikeUpdatePayload = realtime.LikeUpdatePayload;
export type ModerationUpdatePayload = realtime.ModerationUpdatePayload;
export type RealtimeHandlers = realtime.RealtimeHandlers;

export function configureFromConfig(cfg: Config) {
  configureApi({
    baseUrl: cfg.cc.baseUrl,
    headers: {
      'x-api-key': cfg.cc.apiKey,
      'x-server-key': cfg.cc.serverKey,
      'x-server-secret': cfg.cc.serverSecret,
    },
  });
}

/** Server-side ticket fetcher for realtime, scoped to one community. */
export function makeTicketFetcher(tokenAddress: string) {
  return async () => {
    const { data, error } = await api.getWsTicketServer({
      path: { token_address: tokenAddress },
    });
    if (error || !data?.ticket) {
      throw new Error(`getWsTicketServer failed: ${error?.message ?? 'no ticket'}`);
    }
    return data.ticket;
  };
}
