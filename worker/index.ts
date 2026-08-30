import { Lobby } from './lobby';
import { MatchRoom } from './room';
import type { QueueReply } from './protocol';

export { Lobby, MatchRoom };

export interface Env {
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Comma separated list of origins allowed to open a socket. */
  ALLOWED_ORIGINS?: string;
}

/**
 * Whether an origin may talk to this worker. An empty allow-list accepts every
 * origin, matching how the deployment behaves before one is configured; with a
 * list set, the origin has to be on it. A forged Origin header slips this on a
 * non-browser client, so it is a guard against a hostile web page, not a secret.
 */
function isAllowedOrigin(env: Env, origin: string | null): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return origin !== null && allowed.includes(origin);
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  if (!origin || !isAllowedOrigin(env, origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

/** One front desk for the whole deployment, so waiting players can find each other. */
function lobby(env: Env): DurableObjectStub<Lobby> {
  return env.LOBBY.get(env.LOBBY.idFromName('front-desk'));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);
    const reply = (body: QueueReply, status = 200) =>
      Response.json(body, { status, headers: cors });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true }, { headers: cors });
    }

    // --- matchmaking --------------------------------------------------------
    if (url.pathname === '/api/queue/public' && request.method === 'POST') {
      const { roomId } = await lobby(env).findPublic();
      return reply({ ok: true, roomId, kind: 'public' });
    }

    if (url.pathname === '/api/queue/host' && request.method === 'POST') {
      const partyRaw = url.searchParams.get('party');
      if (partyRaw !== null && partyRaw !== '3' && partyRaw !== '4') {
        return reply({ ok: false, reason: 'A party game seats 3 or 4 players.' }, 400);
      }
      const party = partyRaw === null ? undefined : ((Number(partyRaw) as 3 | 4));
      const hosted = await lobby(env).hostPrivate(party);
      if (!hosted) return reply({ ok: false, reason: 'Too many lobbies open right now. Try again in a minute.' }, 503);
      return reply({ ok: true, roomId: hosted.roomId, kind: 'private', code: hosted.code });
    }

    if (url.pathname === '/api/queue/join' && request.method === 'POST') {
      const code = new URL(request.url).searchParams.get('code') ?? '';
      if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
        return reply({ ok: false, reason: 'that is not a code' }, 400);
      }
      const found = await lobby(env).joinPrivate(code);
      if (!found) return reply({ ok: false, reason: 'Lobby not found' }, 404);
      return reply({ ok: true, roomId: found.roomId, kind: 'private', code: code.toUpperCase() });
    }

    if (url.pathname === '/api/queue/cancel' && request.method === 'POST') {
      const params = new URL(request.url).searchParams;
      const code = params.get('code');
      const roomId = params.get('roomId');
      if (code) await lobby(env).cancel(code);
      if (roomId) await lobby(env).leavePublic(roomId);
      return reply({ ok: true, roomId: roomId ?? '', kind: 'public' });
    }

    // /api/room/<roomId> upgrades to the websocket for that match. A socket
    // handshake is not covered by CORS, so the origin is checked here rather
    // than left to the browser to refuse a response it can already read.
    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9_-]{1,64})$/);
    if (match) {
      if (!isAllowedOrigin(env, origin)) {
        return new Response('forbidden origin', { status: 403, headers: cors });
      }
      const id = env.MATCH_ROOM.idFromName(match[1]);
      return env.MATCH_ROOM.get(id).fetch(request);
    }

    return new Response('not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
