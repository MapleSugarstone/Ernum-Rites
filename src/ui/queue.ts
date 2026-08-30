/**
 * The screen between picking a deck and playing a stranger.
 *
 * Three ways in, and they are not equally common: most people press the first
 * button and wait. Hosting and joining are for playing someone you already know,
 * so they sit below, quieter, and the code is the only thing either of them asks
 * you to handle.
 */
import type { RoomKind } from '../../worker/protocol';

export type QueuePhase =
  | { kind: 'idle' }
  | { kind: 'searching'; roomId: string }
  | { kind: 'hosting'; roomId: string; code: string }
  | { kind: 'joining' }
  | { kind: 'connecting'; room: RoomKind }
  | { kind: 'waiting'; code?: string }
  | { kind: 'failed'; reason: string };

export interface QueueView {
  phase: QueuePhase;
  /** What the player will bring, so they can see it before committing. */
  deckName: string;
  /** Typed into the join box, kept between renders. */
  codeDraft: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A code is read aloud and typed back, so it is spaced and never lowercase. */
function spacedCode(code: string): string {
  return code.replace(/(.{3})(?=.)/g, '$1 ');
}

export function queueHtml(view: QueueView): string {
  const { phase, deckName, codeDraft } = view;

  const busy =
    phase.kind === 'searching' || phase.kind === 'connecting' || phase.kind === 'waiting';

  const status = (() => {
    switch (phase.kind) {
      case 'searching':
        return `<p class="qstatus"><span class="qspin"></span>Looking for an opponent…</p>`;
      case 'connecting':
        return `<p class="qstatus"><span class="qspin"></span>Joining the match…</p>`;
      case 'waiting':
        return `<p class="qstatus"><span class="qspin"></span>Waiting for them to arrive…</p>`;
      case 'failed':
        return `<p class="qstatus qfail">${esc(phase.reason)}</p>`;
      default:
        return '';
    }
  })();

  // A hosted code is the whole point of that path, so it gets the room.
  const hosted =
    phase.kind === 'hosting'
      ? `<div class="qcode">
           <p class="qcodelabel">Give them this code</p>
           <p class="qcodevalue" data-act="btn" data-cmd="q:copy">${esc(spacedCode(phase.code))}</p>
           <p class="qcodehint">Click to copy. It works once, and lapses after fifteen minutes.</p>
           <button class="tiny" data-act="btn" data-cmd="q:cancel">Cancel</button>
         </div>`
      : '';

  const joinBox =
    phase.kind === 'joining'
      ? `<div class="qjoin">
           <label for="qcode">Their code</label>
           <input id="qcode" data-act="qcode" maxlength="8" autocomplete="off"
             spellcheck="false" value="${esc(codeDraft)}" placeholder="ABC123">
           <button class="primary" data-act="btn" data-cmd="q:joingo"
             ${codeDraft.trim().length < 4 ? 'disabled' : ''}>Join</button>
           <button class="tiny" data-act="btn" data-cmd="q:cancel">Back</button>
         </div>`
      : '';

  return `<div class="queue">
    <h2>Play online</h2>
    <p class="lede">Bringing <b>${esc(deckName)}</b>. Both players are on a clock:
      seventy-five seconds for your own turn, thirty to answer something on theirs.</p>

    ${status}

    <div class="qactions">
      <button class="primary qbig" data-act="btn" data-cmd="q:public" ${busy ? 'disabled' : ''}>
        Random opponent
      </button>
      <div class="qprivate">
        <button data-act="btn" data-cmd="q:host" ${busy || phase.kind === 'hosting' ? 'disabled' : ''}>
          Host a private game
        </button>
        <button data-act="btn" data-cmd="q:join" ${busy || phase.kind === 'joining' ? 'disabled' : ''}>
          Join with a code
        </button>
      </div>
    </div>

    ${hosted}
    ${joinBox}

    ${
      busy
        ? `<button class="tiny qleave" data-act="btn" data-cmd="q:cancel">Leave the queue</button>`
        : `<button class="tiny" data-act="btn" data-cmd="q:back">Back to decks</button>`
    }
  </div>`;
}
