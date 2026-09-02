// First, before any other module can fail to load: a boot error must land on
// the player's screen rather than leave a blank page.
import './ui/bootguard';
import { chooseAction } from './ai/bot';
import { NetClient } from './net/client';
import { nameProblem } from '../worker/protocol';
import { CLOCK_SECONDS, asDisplayed, isRoping, secondsLeft, type Clock } from './engine/timing';
import {
  MILL_DEBT,
  RESHUFFLE_DEBT,
  RESHUFFLE_DEBT_STEP,
  captureWounds,
  effectDamageOf,
  reshuffleCost,
  takeWounds,
} from './engine/effects';
import { everyDeck, starterDecks, type StarterDeck } from './cards';
import { HIDDEN_ID } from './engine/redact';
import { closeReport, note } from './ui/diagnostics';
import {
  BROWSE_TABS,
  DECK_SIZE,
  RARITY_FILTERS,
  addSuggestion,
  browseSections,
  canAdd,
  clearSuggestions,
  copyName,
  counts,
  deckCards,
  deckMarkdown,
  deleteDeck,
  download,
  leaderChoices,
  isLegal,
  matchesSearch,
  newBuilder,
  parseDeckList,
  problems,
  saveDeck,
  savedDecks,
  deckNameProblem,
  DECK_BLURB_MAX,
  DECK_NAME_MAX,
  suggestions,
  suggestionsMarkdown,
  type BrowseTab,
  type BuilderState,
  type SavedDeck,
} from './ui/builder';
import type { Action, SourceRef } from './engine/actions';
import {
  applyAction,
  canPay,
  costFor,
  createGame,
  effectiveStrength,
  flipWouldFire,
  legalAttackTargets,
  manaKindFor,
  NEEDS_ENEMY,
  powerBlockers,
  strengthSourcesOf,
  targetCandidates,
  type DeckList,
} from './engine/engine';
import { canBeLeader, colorsOf, deckIdentity } from './engine/identity';
import { allCards, card, tryCard } from './engine/registry';
import {
  choiceIsLive,
  allSummons,
  currentActor,
  DEBT_LIMIT,
  debtLimitOf,
  DRAW_PER_TURN,
  HAND_LIMIT,
  isParty,
  livingOpponents,
  nextLiving,
  OPENING_HAND,
  PARTY_DEBT_LIMIT,
  PARTY_HAND_BONUS,
  SUMMON_SLOTS,
  findSummon,
  isOver,
  levelOf,
  otherPlayer,
  powersOf,
  remainingHp,
  type GameState,
  type SummonInstance,
} from './engine/state';
import {
  COLORS,
  COLOR_NAME,
  COPY_LIMIT,
  RARITY_NAME,
  type CardDef,
  type ManaKind,
  type PlayerIdx,
  type Power,
  type Rarity,
  type TargetRef,
  type TargetSpec,
} from './engine/types';
import { flipBarFor, frameFor, frameKeyOf, gemFor, prepareFrames } from './ui/frames';
import { mountGuy, showGuy } from './ui/guy';
import { levels, setLevel, setMood, startAudio, type Mood } from './ui/audio';
import {
  playSfx,
  setSfxBase,
  startHold,
  startLast10,
  stopHold,
  stopLast10,
  warmSfx,
  type Sfx,
} from './ui/sfx';
import { sheetsFor, spriteCss } from './ui/atlas';
import { onTintReady, tintedArt } from './ui/tint';
import {
  closeDropdown,
  dropdownHtml,
  mountDropdowns,
  syncDropdowns,
} from './ui/dropdown';
import { currentTheme, initTheme, setTheme, type Theme } from './ui/theme';
import { loadPrefs, savePrefs } from './ui/prefs';

// --- ui state ---------------------------------------------------------------

type SetupMode = 'hotseat' | 'ai';

interface Targeting {
  label: string;
  specs: TargetSpec[];
  collected: TargetRef[];
  /** The hand card being cast, when the targeting came out of a spell drag. */
  hand?: number;
  /** The spell doing the asking, which narrows what it may point at. */
  source?: CardDef;
  build: (targets: TargetRef[]) => Action;
}

type Selection = { kind: 'hand'; index: number } | { kind: 'summon'; ref: TargetRef } | null;

interface DragState {
  mode: 'attack' | 'play';
  /** Attack drags: the attacking unit. */
  source: SourceRef | null;
  /** Play drags: the hand index being dragged out. */
  hand: number;
  targets: string[];
  canSupport: boolean;
  /** A targetless spell or a field: dropping it anywhere on the board casts it. */
  cast: 'spell' | 'stage' | null;
  /** Spells glow over the board instead of seating on their targets. */
  spell: boolean;
  /** A spell that wants targets: pulled clear of the hand it asks for them. */
  aim: boolean;
  /** Set once an aiming spell has been pulled clear. */
  armed: boolean;
  from: { x: number; y: number };
  to: { x: number; y: number };
  over: TargetRef | null;
  overSupport: boolean;
}

interface Ui {
  screen: 'setup' | 'game' | 'build' | 'rules' | 'online';
  builder: BuilderState;
  setupMode: SetupMode;
  /** Flips the copy button's label for a moment after a successful copy. */
  copied: boolean;
  /** The match report was just put on the clipboard, for the button label. */
  reportCopied: boolean;
  online: {
    name: string;
    deckKey: string;
    code: string;
    /** What the lobby is doing right now, which is what the buttons key off. */
    phase: 'idle' | 'seeking' | 'waiting' | 'connecting' | 'playing';
    /** Shown to the player once a private room has a code to share. */
    roomCode: string | null;
    seat: PlayerIdx | null;
    error: string | null;
    /** Seats a hosted game deals: 2 head-to-head, 3 or 4 for party mode. */
    party: 2 | 3 | 4;
    /** Whether a hosted game runs clocks. Off means nobody is ever on one. */
    timers: boolean;
    /** Who is in the room while it fills, from the room's waiting pushes. */
    roster: { players: number; needed: number; names: string[] } | null;
    /** The local player chose to keep watching after being eliminated. */
    spectating: boolean;
  };
  /**
   * A party action the engine sent back for an enemy pick: the player clicks
   * an enemy leader (or their side) and the action goes out again with it.
   */
  enemyPick: { build: (enemy: PlayerIdx) => Action } | null;
  picks: [string, string];
  state: GameState | null;
  botSeat: PlayerIdx | null;
  botBusy: boolean;
  selection: Selection;
  targeting: Targeting | null;
  inspect: string | null;
  /** Where the inspected card is standing, when it is a body on the board. */
  inspectRef: TargetRef | null;
  error: string | null;
  revealAll: boolean;
  /** The reveal-choice overlay is tucked away so the board can be read. */
  choiceHidden: boolean;
  drag: DragState | null;
  /** Card art being warmed before a match starts, so nothing pops in later. */
  preloading: boolean;
  /** A card held down long enough to ask for a closer look. Mobile only. */
  zoom: string | null;
  /** Whose discard pile is open for reading, or null when none is. */
  discardView: PlayerIdx | null;
}

const ui: Ui = {
  screen: 'setup',
  builder: newBuilder(),
  setupMode: 'ai',
  copied: false,
  reportCopied: false,
  online: {
    name: '',
    deckKey: 'deepcurrent',
    code: '',
    phase: 'idle',
    roomCode: null,
    seat: null,
    error: null,
    party: 2,
    timers: true,
    roster: null,
    spectating: false,
  },
  enemyPick: null,
  picks: ['deepcurrent', 'emberchoir'],
  state: null,
  botSeat: null,
  botBusy: false,
  selection: null,
  targeting: null,
  inspect: null,
  inspectRef: null,
  error: null,
  revealAll: false,
  choiceHidden: false,
  drag: null,
  preloading: false,
  zoom: null,
  discardView: null,
};

/**
 * The name and deck picks kept from the last visit. A deck that has been
 * deleted since, or a name the room would now turn away, is left behind rather
 * than restored into a menu the player cannot start a match from.
 */
function restorePrefs(): void {
  const saved = loadPrefs();
  if (saved.name !== null && nameProblem(saved.name) === null) ui.online.name = saved.name;
  const known = (key: string | null): key is string =>
    key !== null && [...everyDeck, ...savedDeckList()].some((d) => d.key === key);
  if (known(saved.picks[0])) ui.picks[0] = saved.picks[0];
  if (known(saved.picks[1])) ui.picks[1] = saved.picks[1];
}

/** Called wherever the name or a pick changes, which is the only way either moves. */
function rememberPrefs(): void {
  savePrefs({ name: ui.online.name, picks: [ui.picks[0], ui.picks[1]] });
}

const root = document.getElementById('app')!;
const BASE = import.meta.env.BASE_URL;
/** Printed in the card's imprint line. A set's year is its year, not today's. */
const SET_YEAR = 2026;
/** The face-down card, worn by HP cards, the deck pile and anything mid-flip. */
const CARD_BACK = 'Cardgame/Extras/Cardback.png';
/** Scattered over a body when wounds land on it. The space in the filename is encoded. */
const WOUND_TOKEN = 'Cardgame/Extras/Wound%20token.png';
/** What a body wears while it is carrying more or less strength than it printed. */
const BUFF_SPARKLE = 'Cardgame/Extras/BuffSparkles.png';
const DEBUFF_ORB = 'Cardgame/Extras/Debuff%20Orbs.png';
/** The one-shot arrows that rise or sink as a number moves. */
const BUFF_ARROW = 'Cardgame/Extras/BuffArrow.png';
const DEBUFF_ARROW = 'Cardgame/Extras/Debuff%20Arrow.png';
/** Worn by a body that will stay sapped through the next time it would unsap. */
const NO_UNSAP = 'Cardgame/Extras/NoUnsap.png';
/** Worn by a body the enemy has to come through. */
const REDIRECT_TOKEN = 'Cardgame/Extras/Redirect.png';
/** Worn by a body no spell or trap may choose. */
const SPELL_IMMUNE_TOKEN = 'Cardgame/Extras/SpellImmune.png';

// --- helpers ----------------------------------------------------------------

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

function refKey(ref: TargetRef): string {
  return JSON.stringify(ref);
}

function actor(): PlayerIdx {
  return ui.state ? currentActor(ui.state) : 0;
}

/**
 * The side the board is drawn from: hotseat flips, versus the bot it does not.
 * Online it is pinned to the seat this client holds. Following the actor would
 * draw the board from the opponent's seat on their turn, and their hand arrives
 * redacted, so it would render as face-down cards.
 */
function viewSeat(): PlayerIdx {
  if (!ui.state) return 0;
  if (ui.online.phase === 'playing' && ui.online.seat !== null) return ui.online.seat;
  if (ui.botSeat !== null) return otherPlayer(ui.botSeat);
  return currentActor(ui.state);
}

function canAct(): boolean {
  return !!ui.state && !isOver(ui.state) && actor() === viewSeat();
}

/**
 * Whether the waiting flip is worth putting to its owner: the cost has to be
 * within reach, and paying it has to change something. Offering a Fish for a
 * summon the debt zone does not hold is a question with one answer.
 */
function flipWorthAsking(state: GameState, player: PlayerIdx): boolean {
  const offer = state.flipQueue[0];
  if (!offer) return true;
  const p = state.players[player];
  const cost = card(offer.cardId).flipCost ?? {};
  return (
    (!cost.mana || canPay(p, cost.mana)) &&
    (!cost.mill || p.deck.length >= cost.mill) &&
    (!cost.discard || p.hand.length >= cost.discard) &&
    flipWouldFire(state, offer)
  );
}

let autoDeclined = -1;

/** A flip that cannot be paid for, or would do nothing, is declined without a prompt. */
/**
 * Whether a trap in hand can actually answer the window that is open.
 *
 * The kind has to match, the cost has to be within reach, and a trap that wants
 * a target needs one to exist. The engine opens the window on merely holding a
 * trap of the right kind, so this is a narrower question than the one it asked.
 */
function trapLive(state: GameState, me: PlayerIdx, def: CardDef): boolean {
  const pending = state.pending;
  if (!pending || def.type !== 'trap') return false;
  if (pending.battle) {
    if (def.spellTrap || pending.battle.trapUsed) return false;
  } else if (!def.spellTrap) {
    return false;
  }
  const p = state.players[me];
  if (!canPay(p, costFor(p, def))) return false;
  return hasTargets(state, me, def);
}

/**
 * Whether a spell or trap has something legal to point at. An optional spec asks
 * for nothing, so a card whose first ask is optional is never stuck for one.
 *
 * The def is handed to targetCandidates rather than left out: a spell sees a
 * narrower board than a power does, and the set has to be the engine's set or
 * the card lights up for a target the engine will refuse.
 */
function hasTargets(state: GameState, me: PlayerIdx, def: CardDef): boolean {
  const spec = def.targets?.[0];
  return !spec || !!spec.optional || targetCandidates(state, me, spec, def).length > 0;
}

/** How many traps in hand could answer the open window. */
function liveTraps(state: GameState, me: PlayerIdx): number {
  return state.players[me].hand.filter((id) => trapLive(state, me, card(id))).length;
}

/** Whether any target a board choice offered is still standing. */
function choiceHasTarget(state: GameState, ch: { refs?: TargetRef[] }): boolean {
  return (ch.refs ?? []).some((r) =>
    r.kind === 'summon' || r.kind === 'leader' ? !!findSummon(state, r) : true,
  );
}

/** Version already answered, so an auto-answer never fires twice for one state. */
let autoChose = -1;

/**
 * A board choice with nothing left to point at answers itself.
 *
 * The queue holds the refs the effect offered, not the bodies still standing, so
 * anything that clears the board between the question and the answer leaves a
 * prompt that cannot be dismissed: no target to click, and no Skip unless the
 * effect happened to be optional. A pickless answer is the one the rules already
 * accept in that spot, so it is sent rather than waited for.
 */
function maybeAutoChoice(): void {
  const state = ui.state;
  const ch = state?.choiceQueue[0];
  if (!state || !ch?.refs || ch.cards || !canAct()) return;
  if (choiceHasTarget(state, ch)) return;
  if (autoChose === state.version) return;
  autoChose = state.version;
  const version = state.version;
  // Off the render that noticed it: dispatching mid-render would re-enter it.
  window.setTimeout(() => {
    if (ui.state === state && state.version === version && state.choiceQueue[0] === ch && canAct()) {
      dispatch({ type: 'RESOLVE_CHOICE' });
    }
  }, 0);
}

/** Version already answered, so an auto-answer never fires twice for one state. */
let autoPassed = -1;

/**
 * A response window with nothing to respond with answers itself.
 *
 * Holding a trap you cannot spring is not a decision, and stopping the game to
 * ask about it reads as a bug. Passed straight back, the window plays out the
 * way it does when the hand holds no trap at all.
 */
function maybeAutoPass(): void {
  const state = ui.state;
  if (!state?.pending || !canAct()) return;
  if (liveTraps(state, viewSeat()) > 0) return;
  if (autoPassed === state.version) return;
  autoPassed = state.version;
  const version = state.version;
  // Off the render that noticed it: dispatching mid-render would re-enter it.
  window.setTimeout(() => {
    if (ui.state === state && state.version === version && state.pending && canAct()) {
      dispatch({ type: 'PASS_RESPONSE' });
    }
  }, 0);
}

function maybeAutoDecline(): void {
  const state = ui.state;
  if (!state || !canAct() || state.flipQueue.length === 0) return;
  if (flipWorthAsking(state, viewSeat())) return;
  if (autoDeclined === state.version) return;
  autoDeclined = state.version;
  const version = state.version;
  // The delay lets the flip animation land before the card is waved away.
  window.setTimeout(() => {
    if (ui.state === state && state.version === version && canAct()) {
      dispatch({ type: 'DECLINE_FLIP' });
    }
  }, 900);
}

function candidateKeys(): Set<string> {
  if (!ui.state) return new Set();
  const ch = ui.state.choiceQueue[0];
  if (ch?.refs && canAct()) return new Set(ch.refs.map(refKey));
  if (!ui.targeting) return new Set();
  const spec = ui.targeting.specs[ui.targeting.collected.length];
  if (!spec) return new Set();
  // A body already picked for an earlier spec is off the table for this one.
  const picked = new Set(ui.targeting.collected.map(refKey));
  const keys = targetCandidates(ui.state, viewSeat(), spec, ui.targeting.source).map(refKey);
  return new Set(keys.filter((k) => !picked.has(k)));
}

/**
 * Bodies the spell being aimed would reach if they were not warded.
 *
 * Running the same spec with no source drops the spell-immunity check, because
 * that check only applies to a spell or a trap. What is in that list and not in
 * the real one is exactly the body the player is trying to point at and cannot,
 * which is the moment the token has something to say.
 */
function wardedKeys(): Set<string> {
  if (!ui.state || !ui.targeting) return new Set();
  const src = ui.targeting.source;
  if (!src || (src.type !== 'spell' && src.type !== 'trap')) return new Set();
  const spec = ui.targeting.specs[ui.targeting.collected.length];
  if (!spec) return new Set();
  const reachable = new Set(
    targetCandidates(ui.state, viewSeat(), spec, undefined).map(refKey),
  );
  for (const k of candidateKeys()) reachable.delete(k);
  return reachable;
}

/** Refs the currently selected or dragged attacker may swing at. */
function attackKeys(): Set<string> {
  if (!ui.state || ui.targeting) return new Set();
  if (ui.drag) return new Set(ui.drag.mode === 'attack' ? ui.drag.targets : []);
  const sel = ui.selection;
  if (!sel || sel.kind !== 'summon') return new Set();
  const source = sel.ref as SourceRef;
  if (source.kind !== 'summon' && source.kind !== 'leader') return new Set();
  return new Set(legalAttackTargets(ui.state, source).map(refKey));
}

/** Refs a hand card mid-drag may be dropped on. */
function playKeys(): Set<string> {
  if (ui.drag?.mode !== 'play') return new Set();
  return new Set(ui.drag.targets);
}

function frameUrl(def: CardDef): string {
  return frameFor(def.type, frameKeyOf(def), BASE);
}

/**
 * Where a card's drawing comes from: the pack, or a recoloured copy of it when
 * the card was minted as a rebuild of another one. Empty for the cards that
 * carry no art at all, which the callers already draw around.
 */
function artCss(def: CardDef | null | undefined): string {
  if (!def?.art) return '';
  // A rebuilt card is recoloured per card, so it is its own image rather than a
  // cell of a sheet. The art box carries the cell's proportions either way.
  if (def.artTint) {
    return `background-image:url('${tintedArt(def.art, def.artTint, BASE)}');background-size:100% 100%`;
  }
  return spriteCss(def.art, BASE);
}

/**
 * The drawing's own file. Only the two places that wash a gradient over a card
 * use this: a gradient layer and a sheet cell cannot share one background
 * shorthand, and both are builder chrome rather than anything on the table.
 */
function artFile(def: CardDef | null | undefined): string {
  if (!def?.art) return '';
  return def.artTint ? tintedArt(def.art, def.artTint, BASE) : `${BASE}${def.art}`;
}

/** A cropping thumbnail: an inner cell-shaped layer the box clips. */
function artFit(def: CardDef | null | undefined): string {
  const css = artCss(def);
  return css ? `<i class="sprfit" style="${css}"></i>` : '';
}

/**
 * Ernum has a pip drawn for it but no cost is written in one, so it is a pip
 * kind here and nowhere in the rules: ManaKind stays what a cost can ask for.
 */
type PipKind = ManaKind | 'E';

/** Art for a mana pip. Every kind is drawn, so a new colour has to bring one. */
const PIP_ART: Record<PipKind, string> = {
  P: 'Cardgame/Extras/PepperPip.png',
  O: 'Cardgame/Extras/OilPip.png',
  R: 'Cardgame/Extras/RobotPip.png',
  F: 'Cardgame/Extras/FishPip.png',
  S: 'Cardgame/Extras/SunPip.png',
  C: 'Cardgame/Extras/NeutralPip.png',
  E: 'Cardgame/Extras/ErnumPip.png',
};

/**
 * The order pips print in, which is the set's reading order rather than the
 * order the rules happen to list the colours in. Kept apart from MANA_KINDS on
 * purpose: that one's order is baked into the cross-engine digest.
 */
const PIP_ORDER: PipKind[] = ['P', 'S', 'R', 'F', 'O', 'C', 'E'];

function pipRun(kind: PipKind, n: number): string {
  // One image per pip rather than one repeated: a cost of three reads as three
  // things, and the row wraps the same way the bullets did.
  return `<span class="pipart pip-${kind}">${
    `<img src="${BASE}${PIP_ART[kind]}" alt="" draggable="false">`.repeat(n)
  }</span>`;
}

function pipHtml(cost: CardDef['cost']): string {
  if (!cost) return '';
  return PIP_ORDER.map((k) => {
    const n = k === 'E' ? 0 : (cost[k] ?? 0);
    return n > 0 ? pipRun(k, n) : '';
  }).join('');
}

/** A power's cost line: mana pips, then the sap symbol when sapping is part of the price. */
function powerCostHtml(p: Power): string {
  return pipHtml(p.cost) + (p.sapSelf ? '<span class="sappip" title="Saps this summon">↷</span>' : '');
}

// --- card rendering ---------------------------------------------------------

interface CardOpts {
  classes?: string[];
  data?: Record<string, string | number>;
  /** Extra custom properties for the card div's style attribute. */
  vars?: Record<string, string | number>;
  /** Live values from the board, when the card is in play. */
  live?: { strength: number; hp: number; max: number; printedStrength: number; printedHp: number };
  /** Extra absolutely-positioned overlays injected inside the card div. */
  extra?: string;
  /**
   * The controller's Effect Damage, when the card is somewhere it has one. Every
   * "deal N" in the text is printed as what it would actually deal.
   */
  edmg?: number;
}

interface RuleBlocks {
  body: string;
  flip: string;
  /** Rendered character count, used to shrink text that would overflow. */
  chars: number;
}

const KEYWORD_RE =
  /\b(Scry|Catch|Mills?|[Hh]eals?|Wound(?:ed|s)?|Power Shields?|Redirection|Stationary|Spell Immunity|Effect Damage)\b/g;

let cardRefRe: RegExp | null = null;

/**
 * One alternation of every card name another card may name, longest first so
 * "Living Curse" wins over "Curse". Names that are also mechanic keywords are
 * left out: Catch is a keyword before it is a card.
 */
function cardRefPattern(): RegExp {
  if (!cardRefRe) {
    const names = allCards()
      .map((d) => d.name)
      .filter((n) => n.length >= 3 && !n.includes(':') && !new RegExp(KEYWORD_RE.source).test(n))
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    cardRefRe = new RegExp(`\\b(${[...new Set(names)].join('|')})\\b`, 'g');
  }
  return cardRefRe;
}

/**
 * Escapes rules text, sets the trigger words in their own colours, bolds the
 * mechanic keywords, and italicises the name of any card this one names, which
 * is also what the hover glossary defines below the keywords.
 */
function ruleText(text: string, edmg = 0): string {
  const html = withEffectDamage(esc(text), edmg)
    .replace(/Battlecry:/g, '<span class="kw-bc">Battlecry:</span>')
    .replace(/Deathrattle:/g, '<span class="kw-dr">Deathrattle:</span>')
    .replace(/Strike:/g, '<span class="kw-st">Strike:</span>')
    .replace(KEYWORD_RE, '<span class="kw-b">$1</span>');
  // Only the text between tags, so a name can never match inside a class name.
  return html
    .split(/(<[^>]+>)/)
    .map((part, i) => (i % 2 ? part : part.replace(cardRefPattern(), '<i class="cardref">$1</i>')))
    .join('');
}

/**
 * Print what a "deal N" would really deal.
 *
 * Effect Damage is added by the engine when the effect runs, so the printed
 * number is the one thing on the card that stops being true the moment a body
 * granting it lands. Only the number straight after "deal" moves: "deal 1 to an
 * enemy summon, 2 times" has a 2 in it that is a count of hits.
 */
function withEffectDamage(escaped: string, edmg: number): string {
  if (edmg <= 0) return escaped;
  return escaped.replace(
    /\b(deals?)(\s+)(\d+)/gi,
    (_m, verb: string, gap: string, n: string) =>
      `${verb}${gap}<span class="edmg">${Number(n) + edmg}</span>`,
  );
}

function rulesBlocks(def: CardDef, edmg = 0): RuleBlocks {
  const parts: string[] = [];
  let chars = 0;
  if (def.factions?.length) {
    const line = def.factions.join(', ');
    chars += line.length + 10;
    parts.push(`<span class="fac">${esc(line)}</span>`);
  }
  if (def.note) {
    chars += def.note.length;
    parts.push(`<span class="note">${esc(def.note)}</span>`);
  }
  if (def.text) {
    chars += def.text.length;
    // A graft or a fusion stacks what each half brought, one paragraph apiece.
    // A card with one paragraph stays inline, exactly as it printed before.
    const paras = def.text.split('\n').filter((t) => t.trim());
    if (paras.length > 1) {
      for (const para of paras) parts.push(`<span class="para">${ruleText(para, edmg)}</span>`);
    } else {
      parts.push(ruleText(def.text, edmg));
    }
  }
  for (const p of def.powers ?? []) {
    // A Power that costs nothing prints no pill at all: an empty one is just an
    // indent in front of the name.
    const price = powerCostHtml(p);
    chars += p.name.length + p.text.length + (price ? 4 : 0);
    parts.push(
      `<span class="pw">${price ? `<span class="cost">${price}</span> ` : ''}<span class="pwname">${esc(p.name)}:</span> ${ruleText(p.text, edmg)}</span>`,
    );
  }
  // A mana price on the flip prints as pips, the way a power's cost does. Its
  // own class: "cost" would catch the spell frame's banner-cost positioning.
  const flipPips = def.flipCost?.mana
    ? `<span class="flipcost">${pipHtml(def.flipCost.mana)}</span> `
    : '';
  const flip = def.flipText
    ? `<span class="fliplabel">FLIP</span> ${flipPips}${ruleText(def.flipText, edmg)}`
    : '';
  if (def.flipText) chars += def.flipText.length;
  // Factions and powers are blocks of their own, so no <br> between parts: a
  // break before a block element would print as a blank line.
  return { body: parts.join(''), flip, chars };
}

/**
 * Text has to fit the printed box; nothing may spill over the art. Five set
 * sizes, not a per-card fit: most cards read at the largest and only long text
 * steps down, so a re-render never costs a layout pass. Every size shares the
 * ramp, because it is a fraction of the card's own width: a body on the board is
 * the same printed card, smaller.
 *
 * The last two gates were placed by rendering the set rather than by guessing.
 * Every printed card fits the third size except Seer Altine, whose 287 spills by
 * ten pixels and drops its second Power off the bottom of the card; the next
 * wordiest is Living Curse at 219, which fits with room to spare. So 250 sits
 * between them. The fifth size is for the minted cards, which carry more than
 * one card's text at once: a graft tops out around 436 and a fusion, which takes
 * both parents' everything, around 485.
 */
function fitFactor(chars: number): number {
  if (chars <= 100) return 0.064;
  if (chars <= 140) return 0.055;
  if (chars <= 250) return 0.047;
  if (chars <= 350) return 0.04;
  return 0.034;
}

/** The flip line shrinks with its length the same way, pips counted in. */
function flipFitFactor(def: CardDef): number {
  const n = (def.flipText?.length ?? 0) + (def.flipCost?.mana ? 4 : 0);
  if (n <= 50) return 0.046;
  if (n <= 68) return 0.042;
  return 0.034;
}

/** Long names shrink to fit the plate rather than clipping at its edge. */
/**
 * Long names shrink to fit the plate rather than reaching its right edge. The
 * steps are measured, not guessed: every name in the set was rendered and asked
 * what factor it needed to sit inside the plate, and each step takes the
 * tightest answer in its range. Character count is only a proxy, so the ranges
 * matter more than they look. Drowned Wanderer at 16 is tighter than Acolyte of
 * Grinkle at 18, because wide glyphs cost more than extra letters.
 */
function nameFactor(name: string): number {
  if (name.length <= 10) return 0.076;
  if (name.length <= 13) return 0.064;
  if (name.length <= 15) return 0.059;
  if (name.length <= 19) return 0.045;
  return 0.043;
}

function renderCard(def: CardDef, opts: CardOpts = {}): string {
  const isBody = def.type === 'summon';
  const classes = ['card', ...(opts.classes ?? [])];
  if (!isBody) classes.push('spellframe');
  const attrs = Object.entries(opts.data ?? {})
    .map(([k, v]) => `data-${k}="${esc(String(v))}"`)
    .join(' ');

  const strength = opts.live ? opts.live.strength : (def.strength ?? 0);
  const hp = opts.live ? opts.live.hp : (def.hp ?? 0);
  let strengthCls = '';
  let hpCls = '';
  if (opts.live) {
    if (opts.live.strength > opts.live.printedStrength) strengthCls = ' buff';
    else if (opts.live.strength < opts.live.printedStrength) strengthCls = ' debuff';
    if (opts.live.hp < opts.live.max) hpCls = ' debuff';
    else if (opts.live.hp > opts.live.printedHp) hpCls = ' buff';
  }
  const badges = isBody
    ? `<div class="txt level">${def.level ?? 1}</div>` +
      `<div class="txt hp${hpCls}">${hp}</div>` +
      `<div class="txt strength${strengthCls}">${strength}</div>`
    : `<div class="txt cost">${pipHtml(def.cost)}</div>`;

  const { body, flip, chars } = rulesBlocks(def, opts.edmg ?? 0);
  const flipBlock = flip
    ? `<img decoding="sync" class="flipbar" src="${flipBarFor(frameKeyOf(def), BASE, isBody)}" alt="" draggable="false">
         <div class="txt fliptext">${flip}</div>`
    : '';
  // Without a flip line the rules box runs deeper; the float keeps text out of
  // the printed attack circle in the bottom-right corner.
  const rulesCls = flip ? ' short' : isBody ? ' deep' : ' deepspell';
  const atkGuard = !flip && isBody ? '<span class="atkspace"></span>' : '';

  const rarity = def.rarity ?? 'C';
  // Collector line on top, credit and imprint under it, so neither row crowds.
  const foot =
    `<div class="txt cardfoot">` +
    `<span class="collector">${esc(def.num ?? def.id)} · ${esc(RARITY_NAME[rarity])}</span>` +
    `<span class="imprint">${esc(def.artist ?? 'klabss')} · &copy;${SET_YEAR} Ernum Rites</span></div>`;
  // The gem is drawn on a whole card canvas, so it needs no placing, and the
  // art box sits in the same spot on both frames.
  const gem = `<img decoding="sync" class="gem" src="${gemFor(rarity, frameKeyOf(def), BASE)}" alt="" title="${esc(RARITY_NAME[rarity])}" draggable="false">`;

  const idAttr = opts.data?.cardid ? '' : ` data-cardid="${esc(def.id)}"`;
  const vars = Object.entries(opts.vars ?? {})
    .map(([k, v]) => `--${k}:${esc(String(v))};`)
    .join('');
  // Everything inside is drawn at one fixed size and scaled to fit, so no text
  // on a card is ever asked for in a font size a browser is allowed to overrule.
  return `<div class="${classes.join(' ')}"${idAttr} style="${vars}--rf:${fitFactor(chars)};--nf:${nameFactor(def.name)};--ffs:${flipFitFactor(def)}" ${attrs}>
    <span class="cardbox">
      <span class="art" style="${artCss(def)}"></span>
      <img decoding="sync" class="frame" src="${frameUrl(def)}" alt="" draggable="false">
      ${gem}
      <div class="txt name">${esc(def.name)}</div>
      ${badges}
      <div class="txt rules${rulesCls}">${atkGuard}${body}</div>
      ${flipBlock}
      ${foot}
    </span>
    ${opts.extra ?? ''}
  </div>`;
}

// --- board ------------------------------------------------------------------

/** HP cards freshly flipped by the last action, keyed by summon uid, for the flip animation. */
let flipFx: Map<string, Set<number>> = new Map();
/** HP cards freshly healed face down, for the reverse flip. */
let unflipFx: Map<string, Set<number>> = new Map();
/** Effect kinds that just hit each summon, for the overlay animations. */
let unitFx: Map<string, string[]> = new Map();
/** A clash that just resolved: the attacker lunges into the defender. */
let smackFx: { from: TargetRef; to: TargetRef } | null = null;
/** A trap just sprung: its card pops up in a white flash, then fades out. */
let trapFx: string | null = null;
/** Log entries from this index on were written by the action just applied. */
let freshLogFrom = Infinity;

/**
 * A card whose own text just did something, announced as a floating callout: a
 * free flip turning over, a Deathrattle, or anything that reacted to what
 * somebody else did. Without one, a card that acts on its own acts invisibly.
 */
interface EffectCallout {
  ref: TargetRef;
  cardId: string;
  /** The line under the name: a flip prints its flip text, a trigger its rules line. */
  says: string;
  order: number;
}
let effectCallouts: EffectCallout[] = [];

/** Cards drawn off a deck by the last action, so each one can fly out of the pile. */
let drawFx: { player: PlayerIdx; count: number }[] = [];

/** How long the sealed-slot overlay takes to fade in or out. Matches .lockfx in the stylesheet. */
const LOCK_FADE_MS = 420;

/**
 * Slots sealed against replacement. Whether the seal is up is read off the state
 * every render, so a reconnect or a scrub through history draws it correctly.
 * These two only carry the transitions: `lockIn` is a one-shot that plays the
 * fade the render after the seal lands, `lockOut` holds a lifted seal on screen
 * long enough to fade it back out.
 */
let lockIn: Set<PlayerIdx> = new Set();
let lockOut: Set<PlayerIdx> = new Set();

/**
 * Wound tokens for one body: the pool that landed, and what became of it. The
 * tokens scatter over the card, then resolve. At the usual two-wounds-to-a-point
 * they pair off and each pair merges into a point of damage; while an amplifier
 * makes every wound a point on its own there is nothing to pair, so they go one
 * at a time. Whatever is left over is under the rate and just fades.
 */
interface WoundFx {
  pool: number;
  rate: number;
  damage: number;
}
let woundFx: Map<string, WoundFx> = new Map();

/** One token, from landing to resolved. Mirrored by .wtok in the stylesheet. */
const WOUND_FX_MS = 860;
/** Gap between one token landing and the next, capped so a big pool cannot stall the game. */
const WOUND_STEP_MS = 45;
const WOUND_STEP_CAP = 5;

/**
 * Where each token sits and, for a pair, where the two of them meet. Hashed off
 * the body and the token index so the scatter is the same on every render of the
 * same event rather than jittering under the animation.
 */
/** A deterministic 0..1 stream off a body's uid, so its scatter never moves. */
function seeded(uid: string): (n: number) => number {
  return (n: number) => {
    let h = (n + 1) * 2654435761;
    for (let i = 0; i < uid.length; i++) h = Math.imul(h, 31) + uid.charCodeAt(i);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * Where a body's marks sit and how each one breathes. Seeded off the body, so no
 * two cards wear the same pattern and one card wears the same pattern for as
 * long as it stands: a scatter redrawn every render would crawl.
 */
function markSpots(uid: string, count: number): string[] {
  const rand = seeded(uid);
  const out: string[] = [];
  // A jittered lattice rather than free scatter: five loose samples clump often
  // enough to read as a mistake, and a card is not a big place.
  const cols = count > 4 ? 3 : 2;
  const rows = Math.ceil(count / cols);
  for (let i = 0; i < count; i++) {
    const x = 10 + ((i % cols) + 0.12 + rand(i) * 0.76) * (80 / cols);
    const y = 10 + (Math.floor(i / cols) + 0.12 + rand(i + 50) * 0.76) * (76 / rows);
    // A stagger apiece and a span apiece, or the whole card pulses in step.
    const delay = (-3 * rand(i + 100)).toFixed(2);
    const span = (2.1 + rand(i + 150) * 1.5).toFixed(2);
    out.push(
      `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--md:${delay}s;--ms:${span}s"></i>`,
    );
  }
  return out;
}

/** The art window, as the frame prints it, in percent of the card. */
const ART_BOX = { x: 4.2, y: 10.7, w: 91.2, h: 46.7 };
/** A token is drawn square at 21% of the card's width, which is 15% of its height. */
const TOKEN_W = 21;
const TOKEN_H = 15;
/** How far either way a token may lean. */
const TOKEN_TILT = 12;
const TOKEN_COLS = 3;
const TOKEN_ROWS = 2;
/**
 * The cells a token takes, in this order. Bottom left first because the subject
 * of a drawing usually sits high and centre, then across the diagonal, so two
 * tokens land apart rather than in a row.
 */
const TOKEN_ORDER = [3, 2, 0, 5, 1, 4];

/**
 * Tokens dropped onto a body's art. Each one takes a cell of a lattice over the
 * art window and sits somewhere inside it at a lean, which reads as placed by
 * hand while making an overlap impossible however many a body collects. Seeded
 * off the body, so a token stays where it was put for as long as the body
 * stands rather than crawling on every render.
 */
function tokenHtml(uid: string, tokens: { art: string; title: string; cls?: string }[]): string {
  if (tokens.length === 0) return '';
  const rand = seeded(`tok${uid}`);
  // A tilted square stands wider than it lies, so a cell has to hold the leaning
  // token's whole bounding box or a corner could reach into its neighbour.
  const swell = Math.cos((TOKEN_TILT * Math.PI) / 180) + Math.sin((TOKEN_TILT * Math.PI) / 180);
  const boxW = TOKEN_W * swell;
  const boxH = TOKEN_H * swell;
  const cellW = ART_BOX.w / TOKEN_COLS;
  const cellH = ART_BOX.h / TOKEN_ROWS;
  const slackX = Math.max(0, cellW - boxW);
  const slackY = Math.max(0, cellH - boxH);
  return tokens
    .map((t, i) => {
      const cell = TOKEN_ORDER[i % TOKEN_ORDER.length];
      const col = cell % TOKEN_COLS;
      const row = Math.floor(cell / TOKEN_COLS);
      const left = ART_BOX.x + col * cellW + (boxW - TOKEN_W) / 2 + rand(i) * slackX;
      const top = ART_BOX.y + row * cellH + (boxH - TOKEN_H) / 2 + rand(i + 40) * slackY;
      const tilt = (rand(i + 80) * 2 - 1) * TOKEN_TILT;
      return (
        `<img decoding="sync" class="overlay token${t.cls ? ` ${t.cls}` : ''}" ` +
        `style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;--tilt:${tilt.toFixed(1)}deg" ` +
        `src="${BASE}${t.art}" alt="" title="${esc(t.title)}" draggable="false">`
      );
    })
    .join('');
}

function woundSpots(uid: string, pool: number, paired: number): { x: number; y: number; mx: number; my: number }[] {
  const rand = (n: number) => {
    let h = n * 2654435761;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    h ^= h >>> 15;
    return ((h * 1103515245 + 12345) >>> 8) / 0xffffff;
  };
  const spots = [];
  for (let i = 0; i < pool; i++) {
    // Spread around a ring so a big pool never stacks up in the middle, with
    // enough jitter that two tokens are never twins. Fractions of the card
    // width, which the stylesheet scales, so the scatter holds at any board size.
    const turn = (i / Math.max(pool, 3)) * Math.PI * 2 + rand(i) * 1.1;
    const reach = 0.16 + rand(i + 100) * 0.15;
    spots.push({ x: Math.cos(turn) * reach, y: Math.sin(turn) * reach, mx: 0, my: 0 });
  }
  // Each pair meets halfway between its two tokens; anything past the paired
  // count is the remainder and stays where it fell.
  for (let i = 0; i + 1 < paired * 2; i += 2) {
    const a = spots[i];
    const c = spots[i + 1];
    const mx = (a.x + c.x) / 2;
    const my = (a.y + c.y) / 2;
    a.mx = c.mx = mx;
    a.my = c.my = my;
  }
  return spots;
}
/** A body that just left the board, kept on screen through its death animation. */
interface CorpseFx {
  key: string;
  html: string;
}
let corpseFx: CorpseFx[] = [];

/** A DOM-safe key for where a corpse stood; refKey's JSON quotes cannot sit in a selector. */
function corpseKey(ref: TargetRef): string {
  if (ref.kind === 'leader') return `leader-${ref.player}`;
  if (ref.kind === 'summon') return `summon-${ref.player}-${ref.slot}`;
  return ref.kind;
}

/** Ids `player`'s discard pile gained this action, in pile order. */
function discardGains(prev: GameState, next: GameState, player: PlayerIdx): string[] {
  const counts = new Map<string, number>();
  for (const id of prev.players[player].discard) counts.set(id, (counts.get(id) ?? 0) + 1);
  const out: string[] = [];
  for (const id of next.players[player].discard) {
    const left = counts.get(id) ?? 0;
    if (left > 0) counts.set(id, left - 1);
    else out.push(id);
  }
  return out;
}

function computeFlipFx(prev: GameState, next: GameState): void {
  flipFx = new Map();
  effectCallouts = [];
  const before = new Map(allSummons(prev).map((x) => [x.summon.uid, x.summon]));
  for (const { ref, summon } of allSummons(next)) {
    const old = before.get(summon.uid);
    if (!old) continue;
    const fresh = new Set<number>();
    summon.hp.forEach((h, i) => {
      if (h.flipped && old.hp[i] && !old.hp[i].flipped) {
        fresh.add(i);
        const hdef = tryCard(h.cardId);
        // Costed flips announce themselves through the pay prompt instead.
        if (hdef?.flip && !hdef.flipCost) {
          effectCallouts.push({
            ref,
            cardId: h.cardId,
            says: hdef.flipText ?? '',
            order: effectCallouts.length,
          });
        }
      }
    });
    if (fresh.size) flipFx.set(summon.uid, fresh);
  }
}

/**
 * Cards that reacted to something, taken from the engine's own record rather
 * than guessed at: it lists what actually fired and changed something, which a
 * diff of the board cannot attribute to the card that caused it.
 */
function computeTriggerCallouts(next: GameState): void {
  for (const fired of next.fx) {
    const def = tryCard(fired.cardId);
    if (!def?.text) continue;
    effectCallouts.push({
      ref: fired.at,
      cardId: fired.cardId,
      says: def.text,
      order: effectCallouts.length,
    });
  }
}

/** Cards a deck gained that its owner did not put there. */
let deckGiftFx: { player: PlayerIdx; cardId: string; count: number }[] = [];

function computeDeckGifts(prev: GameState, next: GameState): void {
  deckGiftFx = [];
  for (let player = 0 as PlayerIdx; player < next.players.length; player++) {
    // A deck that ran out took its whole discard pile back, which is a reshuffle
    // rather than a gift and would otherwise read as forty cards flying in.
    if (next.players[player].deckOuts !== prev.players[player].deckOuts) continue;
    const was = new Map<string, number>();
    for (const id of prev.players[player].deck) was.set(id, (was.get(id) ?? 0) + 1);
    const now = new Map<string, number>();
    for (const id of next.players[player].deck) now.set(id, (now.get(id) ?? 0) + 1);
    for (const [cardId, count] of now) {
      // A redacted deck is all placeholders, and anything shuffled back into it
      // (a scry's leftovers, a recycled discard) reads as the placeholder count
      // growing. That is churn rather than a gift, and nothing worth flying in.
      if (cardId === HIDDEN_ID) continue;
      const gained = count - (was.get(cardId) ?? 0);
      if (gained > 0) deckGiftFx.push({ player, cardId, count: gained });
    }
  }
}

/**
 * Bodies in the old state missing from the new one stay on screen as corpses:
 * the card and its fan render from the old state, the killing flips animate,
 * and the whole thing crumbles after the impact rather than vanishing the
 * instant the action lands.
 */
function computeCorpses(prev: GameState, next: GameState): void {
  corpseFx = [];
  const alive = new Set(allSummons(next).map((x) => x.summon.uid));
  const count = (list: string[], id: string) => list.filter((x) => x === id).length;
  for (const { ref, summon } of allSummons(prev)) {
    if (alive.has(summon.uid)) continue;
    const def = card(summon.cardId);
    const owner = next.players[summon.owner];
    const prevOwner = prev.players[summon.owner];
    // Back to its owner's hand rather than dead: it departs instead of crumbling.
    const bounced = count(owner.hand, summon.cardId) > count(prevOwner.hand, summon.cardId);
    // What the death sent to this owner's discard, in pile order. Online the
    // face-down cards were redacted, so their real identities are read back out
    // of where they landed: the already-flipped cards match themselves out of
    // the pool first, and the hidden ones take what remains in order, which is
    // the order the fan was discarded in.
    const gained = discardGains(prev, next, summon.owner);
    for (const h of summon.hp) {
      if (!h.flipped || h.cardId === HIDDEN_ID) continue;
      const at = gained.indexOf(h.cardId);
      if (at >= 0) gained.splice(at, 1);
    }
    const faceOf = (hdef: CardDef) =>
      `<span class="hart" style="${artCss(hdef)}"></span><img decoding="sync" class="hframe" src="${frameUrl(hdef)}" alt="" draggable="false">`;
    const minis = summon.hp
      .map((h) => {
        // The killing damage flipped whatever was still face down, unless the
        // cards themselves were moved to another summon: only ones that reached
        // the discard pile really turned over here.
        if (!h.flipped && !bounced) {
          let realId: string | null = null;
          if (h.cardId === HIDDEN_ID) {
            realId = gained.shift() ?? null;
          } else {
            const at = gained.indexOf(h.cardId);
            if (at >= 0) {
              gained.splice(at, 1);
              realId = h.cardId;
            }
          }
          const hdef = realId ? tryCard(realId) : null;
          if (realId && hdef) {
            if (hdef.flip && !hdef.flipCost) {
              effectCallouts.push({
                ref,
                cardId: realId,
                says: hdef.flipText ?? '',
                order: effectCallouts.length,
              });
            }
            return `<span class="hpmini flipnow"><span class="flin"><span class="fback"></span><span class="fface">${faceOf(hdef)}</span></span></span>`;
          }
        }
        if (!h.flipped) return `<span class="hpmini back"></span>`;
        const hdef = tryCard(h.cardId);
        return `<span class="hpmini face">${hdef ? faceOf(hdef) : ''}</span>`;
      })
      .join('');
    const n = summon.hp.length;
    const step = hpStep(n);
    const html = `<div class="corpse" data-cref="${corpseKey(ref)}"><div class="corpsein ${bounced ? 'depart' : 'die'}">
      ${renderCard(def, { classes: ['corpsecard'], live: liveStats(prev, summon) })}
      <div class="hpfan" style="--step:${step}px">${minis}</div>
    </div></div>`;
    corpseFx.push({ key: corpseKey(ref), html });
  }
}

/**
 * The wound batches the engine just recorded, gathered per body. A body hit
 * more than once in one action shows a single pool rather than two scatters.
 */
function computeWoundFx(prev: GameState, next: GameState): void {
  woundFx = new Map();
  // Keyed by where the body stands rather than by which body it is, because a
  // pool big enough to kill leaves a corpse in the slot to scatter over.
  const where = new Map<string, string>();
  for (const state of [next, prev]) {
    for (const { ref, summon } of allSummons(state)) {
      if (!where.has(summon.uid)) where.set(summon.uid, corpseKey(ref));
    }
  }
  for (const tick of takeWounds()) {
    const key = where.get(tick.uid);
    if (!key) continue;
    const seen = woundFx.get(key);
    if (seen) {
      seen.pool += tick.added;
      seen.damage += tick.damage;
    } else {
      woundFx.set(key, { pool: tick.from + tick.added, rate: tick.rate, damage: tick.damage });
    }
  }
}
/** Seals that went up or came down this action, so each one animates once. */
function computeLockFx(prev: GameState, next: GameState): void {
  lockIn = new Set();
  for (let player = 0 as PlayerIdx; player < next.players.length; player++) {
    const was = prev.players[player].replaceLocked > 0;
    const now = next.players[player].replaceLocked > 0;
    if (now && !was) {
      lockIn.add(player);
      lockOut.delete(player);
    } else if (was && !now) {
      lockOut.add(player);
      window.setTimeout(() => {
        lockOut.delete(player);
        render();
      }, LOCK_FADE_MS);
    }
  }
}

/**
 * The card a leader was printed as, when it is standing as something else. Only
 * a reform on the way in does that: Kapigras becomes a copy of the enemy leader
 * as it enters. The engine has already swapped the body by the time the client
 * sees any of it, so the card it used to be is only recoverable from the deck's
 * own leader id.
 */
function reformedFrom(state: GameState, ref: TargetRef, summon: SummonInstance): string | null {
  if (ref.kind !== 'leader') return null;
  const named = state.players[ref.player].leaderCardId;
  return summon.cardId !== named ? named : null;
}

/** Bodies drawn as the card they used to be, while their reform is being played. */
const reformFrom = new Map<string, string>();
/** Reforms already played. The body stays changed, so the state alone would replay it. */
const reformShown = new Set<string>();
/** How long a leader stands as itself before it comes apart. */
const REFORM_HOLD_MS = 620;
/** The length of the reformpoof keyframes, after which the card is just the card. */
const REFORM_PLAY_MS = 700;

/**
 * Shows a leader that reformed on the way in as the card it was, then lets it
 * come apart and return as what it became. Seeds the face before the caller
 * renders, so the first paint of the match is Kapigras rather than its answer.
 */
function beginLeaderReform(state: GameState): void {
  const pending: string[] = [];
  for (const { ref, summon } of allSummons(state)) {
    if (reformShown.has(summon.uid)) continue;
    const was = reformedFrom(state, ref, summon);
    if (!was) continue;
    reformShown.add(summon.uid);
    reformFrom.set(summon.uid, was);
    pending.push(summon.uid);
  }
  if (pending.length === 0) return;
  window.setTimeout(() => {
    for (const uid of pending) {
      reformFrom.delete(uid);
      unitFx.set(uid, ['reform']);
    }
    render();
    window.setTimeout(() => {
      for (const uid of pending) unitFx.delete(uid);
      render();
    }, REFORM_PLAY_MS);
  }, REFORM_HOLD_MS);
}

/**
 * What visibly happened to each body this action, read off the state diff so a
 * spell, power, flip or trigger never needs to declare its own effects.
 */
function computeUnitFx(prev: GameState, next: GameState): void {
  unflipFx = new Map();
  unitFx = new Map();
  const before = new Map(allSummons(prev).map((x) => [x.summon.uid, x.summon]));
  const mods = (s: SummonInstance) => s.strengthMods.reduce((n, m) => n + m.amount, 0);
  for (const { summon } of allSummons(next)) {
    const old = before.get(summon.uid);
    if (!old) continue;
    const fx: string[] = [];
    const flippedNow = summon.hp.filter((h) => h.flipped).length;
    const flippedThen = old.hp.filter((h) => h.flipped).length;
    const healedBack = new Set<number>();
    summon.hp.forEach((h, i) => {
      if (!h.flipped && old.hp[i]?.flipped) healedBack.add(i);
    });
    if (healedBack.size) unflipFx.set(summon.uid, healedBack);
    if (flippedNow > flippedThen) fx.push('damage');
    if (healedBack.size > 0 || summon.hp.length > old.hp.length) fx.push('heal');
    const dMods = mods(summon) - mods(old);
    if (dMods > 0 || summon.shields > old.shields) fx.push('buff');
    if (dMods < 0 || summon.wounds > old.wounds) fx.push('debuff');
    // Same body, different card: it shook itself apart and came back as something else.
    if (summon.cardId !== old.cardId) fx.push('reform');
    if (fx.length) unitFx.set(summon.uid, fx);
  }
}

/**
 * Cards that came off the top of a deck and into a hand this action. Read as the
 * run of freshly appended hand cards that matches the deck's old top in order,
 * so a bounce or a revive landing in the same hand is not mistaken for a draw.
 */
function computeDrawFx(prev: GameState, next: GameState): void {
  drawFx = [];
  for (let player = 0 as PlayerIdx; player < next.players.length; player++) {
    const before = prev.players[player];
    const after = next.players[player];
    const gained = after.hand.length - before.hand.length;
    if (gained <= 0) continue;
    const tail = after.hand.slice(after.hand.length - gained);
    const top = before.deck.slice(0, gained);
    let count = 0;
    while (count < gained && tail[count] === top[count]) count++;
    if (count > 0) drawFx.push({ player, count });
  }
}

/** The lunge only plays once the clash really resolved, not on a trap window. */
function computeSmackFx(prev: GameState, next: GameState, action: Action): void {
  smackFx = null;
  if (action.type === 'DECLARE_ATTACK' && !next.pending) {
    smackFx = { from: action.source, to: action.target };
  } else if (
    (action.type === 'PASS_RESPONSE' || action.type === 'CAST_TRAP') &&
    prev.pending?.battle &&
    !next.pending
  ) {
    smackFx = { from: prev.pending.battle.attacker, to: prev.pending.battle.defender };
  }
}

function applyActionFx(
  prev: GameState,
  next: GameState,
  action: Action,
  actor: PlayerIdx,
): void {
  computeSmackFx(prev, next, action);
  computeHandPlayFx(prev, next, action, actor);
  computeDeckOutFx(prev, next);
  computeDebtFx(prev, next);
  computeDrawFx(prev, next);
  computeFlipFx(prev, next);
  computeTriggerCallouts(next);
  computeDeckGifts(prev, next);
  computeUnitFx(prev, next);
  computeWoundFx(prev, next);
  computeLockFx(prev, next);
  computeCorpses(prev, next);
  // A muffled defender's flips turned over without firing, so no callouts.
  if (smackFx && smackFx.to.kind !== 'leader') {
    const atk = findSummon(prev, smackFx.from);
    if (atk && card(atk.cardId).muffleFlips) {
      const dkey = refKey(smackFx.to);
      effectCallouts = effectCallouts.filter((c) => refKey(c.ref) !== dkey);
    }
  }
  // An enemy's hand is redacted, but a sprung trap is public the moment it
  // goes off, so it is read back out of wherever it landed rather than shown
  // as a face-down card popping up.
  if (action.type === 'CAST_TRAP' && prev.pending) {
    const sprung = playedCardId(prev, next, action, prev.pending.player, action.handIndex);
    trapFx = sprung && sprung !== HIDDEN_ID ? sprung : null;
  } else {
    trapFx = null;
  }
  freshLogFrom = prev.log.length;
  recordLogGroups(next, action);
  // Last, so it can read everything the passes above worked out.
  computeSoundFx(prev, next, action, actor);
}


// --- sound -------------------------------------------------------------------

/** One clip and when it should be heard, measured from the render that starts it. */
interface Cue {
  name: Sfx;
  at: number;
  gain?: number;
}
let soundCues: Cue[] = [];

/** The spell voice for a colour, and the one every colourless card borrows. */
const SPELL_BY_COLOR: Record<string, Sfx> = {
  F: 'spellF',
  O: 'spellO',
  P: 'spellP',
  R: 'spellR',
  S: 'spellS',
};

/** What a Neutral card casts with, having no colour of its own to speak in. */
const GENERIC_SPELL: Sfx = 'spellP';

/** Cards that say something of their own instead of their colour's line. */
const CARD_VOICE: Record<string, Sfx> = {
  'o1-Kapigras': 'kapigras',
  'ox-graft': 'graft',
  'm-rg-recomp': 'recompile',
  'm-rg-recompiler': 'recompile',
};

/** Powers with a voice of their own, keyed by the power's printed name. */
const POWER_VOICE: Record<string, Sfx> = {
  Joke: 'joke',
};

function cue(name: Sfx, at = 0, gain?: number): void {
  soundCues.push({ name, at, gain });
}

/** What a card sounds like when it goes off. Never silent, whatever the card. */
function spellVoice(def: CardDef | null): Sfx {
  if (!def) return GENERIC_SPELL;
  return CARD_VOICE[def.id] ?? SPELL_BY_COLOR[def.color] ?? GENERIC_SPELL;
}

/** The card a hand-index action is spending, since the action only holds the index. */
function actedCard(prev: GameState, action: Action, actor: PlayerIdx): CardDef | null {
  if (!('handIndex' in action) || action.handIndex === undefined) return null;
  const seat = action.type === 'CAST_TRAP' && prev.pending ? prev.pending.player : actor;
  const id = prev.players[seat].hand[action.handIndex];
  return id ? card(id) : null;
}

/**
 * What the last action should sound like, read off the same diff the animations
 * use so a spell, a flip and a trigger all get heard without declaring anything.
 */
function computeSoundFx(prev: GameState, next: GameState, action: Action, actor: PlayerIdx): void {
  soundCues = [];
  // Board consequences wait for the lunge, the way the damage numbers do.
  const landed = (trapFx ? 1500 : smackFx ? 310 : 0) + woundLeadMs();

  // --- what the player did --------------------------------------------------
  const spent = actedCard(prev, action, actor);
  switch (action.type) {
    case 'PLAY_SUMMON':
    case 'REPLACE_SUMMON':
      cue('play');
      break;
    case 'PLAY_SUPPORTER':
      cue('supporter');
      break;
    case 'PLAY_STAGE':
      cue('play');
      break;
    case 'CAST_SPELL':
    case 'CAST_TRAP':
      // Every spell makes a noise. Its own if it has one, otherwise its
      // colour's, and a Neutral card has no colour so it borrows the generic.
      cue(spellVoice(spent));
      break;
    case 'ACTIVATE_POWER': {
      const body = findSummon(prev, action.source);
      const def = body ? card(body.cardId) : null;
      const power = def ? (powersOf(body!, def)[action.powerIndex] ?? null) : null;
      const named = power ? POWER_VOICE[power.name] : undefined;
      if (named) cue(named);
      else {
        // Solar prints a big and a small voice; the costly powers get the big one.
        const heavy = (power?.cost?.S ?? 0) >= 3;
        cue(def?.color === 'S' && heavy ? 'solarBig' : spellVoice(def));
      }
      break;
    }
    case 'DECLARE_ATTACK':
      cue('clash', landed);
      break;
    case 'SAP_SUPPORTER':
      cue('sap');
      break;
    default:
      break;
  }

  // A leader arrives on its own during the awake step rather than by an action,
  // so it is heard from the diff like everything else.
  for (let seat = 0 as PlayerIdx; seat < next.players.length; seat = (seat + 1) as PlayerIdx) {
    const arrived = next.players[seat].leader;
    if (prev.players[seat].leader || !arrived) continue;
    cue(CARD_VOICE[card(arrived.cardId).id] ?? 'play');
  }

  // --- what happened on the board ------------------------------------------
  const before = new Map(allSummons(prev).map((x) => [x.summon.uid, x.summon]));
  let healed = false;
  let buffed = false;
  let debuffed = false;
  let shielded = false;
  let caught = 0;
  for (const { summon } of allSummons(next)) {
    const old = before.get(summon.uid);
    if (!old) continue;
    const flippedNow = summon.hp.filter((h) => h.flipped).length;
    const flippedThen = old.hp.filter((h) => h.flipped).length;
    // Catch takes spent cards off a body and back to hand, so the flipped count
    // and the stack shrink together. Damage flips without shortening the stack.
    const lost = old.hp.length - summon.hp.length;
    if (lost > 0 && flippedThen - flippedNow >= lost) caught += lost;
    if (summon.hp.some((h, i) => !h.flipped && old.hp[i]?.flipped)) healed = true;
    if (summon.hp.length > old.hp.length) healed = true;
    // A shield being spent is the moment worth hearing: it is where a blow
    // stopped. Gaining one reads as a buff, which is how it is drawn too.
    if (summon.shields < old.shields) shielded = true;
    if (summon.shields > old.shields) buffed = true;
    const mods = (x: SummonInstance) => x.strengthMods.reduce((a, m) => a + m.amount, 0);
    if (mods(summon) > mods(old)) buffed = true;
    if (mods(summon) < mods(old)) debuffed = true;
  }
  if (caught > 0) cue('fishcatch', landed);
  if (shielded) cue('shield', landed, 1);
  if (healed) cue('heal', landed);
  if (buffed) cue('buff', landed);
  if (debuffed) cue('debuff', landed);

  // One token landing is one wound1, on the same stagger the tokens use. Each
  // pair that merges into damage is a wound2, after the pair has met.
  for (const fx of woundFx.values()) {
    for (let i = 0; i < fx.pool; i++) {
      cue('wound1', landed + WOUND_STEP_MS * Math.min(i, WOUND_STEP_CAP), 0.75);
    }
    for (let i = 0; i < fx.damage; i++) {
      cue('wound2', landed + WOUND_FX_MS * 0.6 + WOUND_STEP_MS * Math.min(i, WOUND_STEP_CAP));
    }
  }

  // --- bodies leaving ------------------------------------------------------
  if (corpseFx.length > 0) {
    cue('die', landed + 120);
    const gone = new Set(allSummons(next).map((x) => x.summon.uid));
    for (const [uid, old] of before) {
      if (gone.has(uid)) continue;
      const owner = next.players[old.owner];
      const eaten = allSummons(next).some(
        (x) => x.summon.hp.some((h) => h.cardId === old.cardId) &&
          (before.get(x.summon.uid)?.hp.length ?? 0) < x.summon.hp.length,
      );
      // Three ways to leave: paid for into the debt zone, swallowed as someone
      // else's HP, or annihilated, which reaches no zone at all.
      if (eaten) cue('eat', landed + 200);
      else if (owner.debt.length > prev.players[old.owner].debt.length) cue('debt', landed + 200);
      else cue('annihilate', landed + 200);
      break;
    }
  }

  // --- debt ----------------------------------------------------------------
  for (let seat = 0 as PlayerIdx; seat < next.players.length; seat = (seat + 1) as PlayerIdx) {
    const d = next.players[seat].debtCount - prev.players[seat].debtCount;
    if (d > 0) cue('debtUp', landed + 240);
    else if (d < 0) cue('debtDown', landed + 240);
    if (next.players[seat].deckOuts > prev.players[seat].deckOuts) cue('reshuffle', landed + 120);
    // Milling shortens the deck without anything reaching a hand.
    const deckLost = prev.players[seat].deck.length - next.players[seat].deck.length;
    const drew = drawFx.find((x) => x.player === seat)?.count ?? 0;
    const discardGrew = next.players[seat].discard.length - prev.players[seat].discard.length;
    if (deckLost > drew && discardGrew > 0) cue('mill', landed + 80);
  }

  // --- cards flying to a hand ----------------------------------------------
  for (const d of drawFx) {
    for (let i = 0; i < Math.min(d.count, 4); i++) cue('draw', i * DRAW_STEP, 0.9);
  }

  // --- cards that speak when they fire, not when they are cast -------------
  for (const callout of effectCallouts) {
    const voice = CARD_VOICE[callout.cardId];
    if (voice) cue(voice, landed + 300);
  }

  // --- the match ending ----------------------------------------------------
  if (!isOver(prev) && isOver(next) && next.winner !== null) {
    const mine = ui.online.phase === 'playing' ? ui.online.seat : viewSeat();
    cue(next.winner === mine ? 'win' : 'lose', landed + 700);
  }
}

/** Fire the cues the last action queued. Called on the render that shows them. */
function playSounds(): void {
  for (const c of soundCues) {
    if (c.at <= 0) playSfx(c.name, { gain: c.gain });
    else window.setTimeout(() => playSfx(c.name, { gain: c.gain }), c.at);
  }
  soundCues = [];
}

/** The animations play on the render just done; later renders show the settled state. */
function clearActionFx(): void {
  flipFx = new Map();
  drawFx = [];
  deckOutFx = [];
  debtFx = new Set();
  handPlayFx = null;
  unflipFx = new Map();
  unitFx = new Map();
  woundFx = new Map();
  lockIn = new Set();
  smackFx = null;
  trapFx = null;
  effectCallouts = [];
  deckGiftFx = [];
  corpseFx = [];
  freshLogFrom = Infinity;
  soundCues = [];
}

/** The card standing at a board ref, its corpse, or the empty slot left behind. */
function boardElFor(ref: TargetRef, cardOnly = false): HTMLElement | null {
  const corpse = () =>
    document.querySelector<HTMLElement>(`.board .corpse[data-cref="${corpseKey(ref)}"]`);
  if (ref.kind === 'leader') {
    return (
      document.querySelector<HTMLElement>(`.board [data-act="leader"][data-player="${ref.player}"]`) ??
      corpse()
    );
  }
  if (ref.kind !== 'summon') return null;
  const standing = document.querySelector<HTMLElement>(
    `.board [data-act="slot"][data-player="${ref.player}"][data-slot="${ref.slot}"]`,
  );
  if (standing) return standing;
  const dead = corpse();
  if (dead || cardOnly) return dead;
  return document.querySelector<HTMLElement>(
    `.board [data-act="empty"][data-player="${ref.player}"][data-slot="${ref.slot}"]`,
  );
}

/** How long a notice sits over the table before it takes itself away. */
const NOTICE_MS = 2600;

/** How long a refused action's reason stays up before it clears itself. */
const ERROR_MS = 3000;
let errorTimer: number | null = null;
/** The message the running timer belongs to, so a new one restarts the clock. */
let errorShown = '';

/**
 * Give the reason an action was refused a lifetime.
 *
 * Sapping something already sapped, and everything else the rules turn down,
 * leaves a line on the table that used to sit there until some later action
 * happened to clear it. It says its piece and goes.
 */
function watchError(): void {
  const now = ui.error ?? '';
  if (now === errorShown) return;
  errorShown = now;
  if (errorTimer !== null) window.clearTimeout(errorTimer);
  errorTimer = null;
  if (!now) return;
  errorTimer = window.setTimeout(() => {
    errorTimer = null;
    // Only if it is still the same message: a newer one owns the screen now.
    if ((ui.error ?? '') !== errorShown) return;
    ui.error = null;
    errorShown = '';
    render();
  }, ERROR_MS);
}

/**
 * A short notice over the middle of the table.
 *
 * For the things that happen to you rather than the things you do: running your
 * deck out, or being told which seat you are in. It takes itself away, because
 * anything that needs a button is a prompt and belongs in the prompt layer.
 */
function popNotice(title: string, body: string, kind = ''): void {
  const stage = document.querySelector('.stage');
  if (!stage) return;
  // Only ever one on screen: two stacked read as one garbled message.
  stage.querySelector('.notice')?.remove();
  const el = document.createElement('div');
  el.className = `notice ${kind}`.trim();
  el.innerHTML = `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}`;
  stage.appendChild(el);
  window.setTimeout(() => el.remove(), NOTICE_MS);
}

/** Whose debt went up on the last action, so their counter can take the hit. */
let debtFx = new Set<PlayerIdx>();

function computeDebtFx(prev: GameState, next: GameState): void {
  debtFx = new Set();
  for (let player = 0 as PlayerIdx; player < next.players.length; player++) {
    if (next.players[player].debtCount > prev.players[player].debtCount) debtFx.add(player);
  }
}

/** Deck-outs the last action caused, and what each one cost. */
let deckOutFx: { player: PlayerIdx; owed: number }[] = [];

function computeDeckOutFx(prev: GameState, next: GameState): void {
  deckOutFx = [];
  // Both seats, and whose notice it is decided at play time: a deck usually runs
  // out on the draw that starts a turn, which on a shared screen is the moment
  // the view changes hands.
  for (let player = 0 as PlayerIdx; player < next.players.length; player++) {
    const times = next.players[player].deckOuts - prev.players[player].deckOuts;
    let owed = 0;
    // Each turn of the pile costs more than the last, so several in one action
    // are several different prices.
    for (let i = 0; i < times; i++) owed += reshuffleCost(prev, player) + i * RESHUFFLE_DEBT_STEP;
    if (owed > 0) deckOutFx.push({ player, owed });
  }
}

function playDeckOut(): void {
  const mine = deckOutFx.find((d) => d.player === viewSeat());
  if (!mine) return;
  popNotice('Out of cards', `Your deck turns over for ${mine.owed} debt.`, 'bad');
}

/** A sprung trap pops up center stage in a white flash, then fades away. */
function playTrapReveal(): void {
  if (!trapFx) return;
  const def = tryCard(trapFx);
  const stageEl = document.querySelector('.stage');
  if (!def || !stageEl) return;
  const el = document.createElement('div');
  el.className = 'trapreveal';
  el.innerHTML = renderCard(def);
  stageEl.appendChild(el);
  window.setTimeout(() => el.remove(), 2100);
}

/** The attacker leans back, lunges into the defender, and snaps home. */
function playSmack(): void {
  if (!smackFx) return;
  const atk = boardElFor(smackFx.from, true);
  const def = boardElFor(smackFx.to);
  if (!atk || !def) return;
  const a = atk.getBoundingClientRect();
  const d = def.getBoundingClientRect();
  const dx = d.left + d.width / 2 - (a.left + a.width / 2);
  const dy = d.top + d.height / 2 - (a.top + a.height / 2);
  const lean = Math.max(-10, Math.min(10, dx * 0.04));

  // An attacker standing in the party carousel would have its swing clipped at
  // the scroller's edge, so a stand-in pinned to the viewport rides the lunge
  // while the real card hides. Sized by the rect, so zoom and scale carry over.
  const clipped = !!atk.closest('.opprow');
  let rider: HTMLElement = atk;
  let done = () => {
    atk.style.zIndex = '';
  };
  if (clipped) {
    const shell = document.createElement('div');
    shell.className = 'smackfly';
    shell.style.cssText =
      `left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;` +
      `--cw:${a.width}px;--cw-board:${a.width}px;--cwn-board:${a.width}`;
    shell.appendChild(atk.cloneNode(true));
    document.body.appendChild(shell);
    atk.style.visibility = 'hidden';
    rider = shell;
    done = () => {
      shell.remove();
      atk.style.visibility = '';
    };
  } else {
    atk.style.zIndex = '70';
  }

  const anim = rider.animate(
    [
      { transform: 'translate(0, 0)', easing: 'ease-in', offset: 0 },
      {
        transform: `translate(${-dx * 0.12}px, ${-dy * 0.12}px) rotate(${-lean}deg)`,
        easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
        offset: 0.34,
      },
      {
        transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) rotate(${lean}deg) scale(1.06)`,
        easing: 'cubic-bezier(0.3, 1.2, 0.4, 1)',
        offset: 0.58,
      },
      { transform: 'translate(0, 0)', offset: 1 },
    ],
    // A clash let through a trap window waits for the reveal to clear first.
    { duration: 560, delay: trapFx ? 1250 : 0 },
  );
  anim.onfinish = done;
  anim.oncancel = done;
}

/**
 * Seats whose card is still in the air.
 *
 * A card is only ever in one place, so the square it is flying towards stays
 * empty until it lands. Held by key rather than by hiding the element: the hand,
 * the board and the other player's fan are all rebuilt from scratch on every
 * render, and a render mid-flight would hand the card straight back.
 */
const inFlight = new Set<string>();

/** Empty the seats whose card is still on its way. Runs after every render. */
function syncFlight(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-flight]')) {
    el.classList.toggle('inflight', inFlight.has(el.dataset.flight!));
  }
}

/** One card's trip out of the pile, and the gap before the next one leaves. */
const DRAW_FLIGHT = 460;
const DRAW_STEP = 300;

/**
 * A drawn card leaves the deck as a back, turns over on the way, and lands on
 * the space it will occupy in the fan, which stays empty until it arrives. Cards
 * go one at a time: two arriving together read as one event rather than two.
 */
function flyDraw(from: DOMRect, to: DOMRect, hold: string | null, delay: number, id?: string): void {
  const el = document.createElement('div');
  el.className = 'drawfly';
  const def = id ? tryCard(id) : null;
  const face = def
    ? `<span class="fface">${renderCard(def, { classes: ['flatcard'] })}</span>`
    : '';
  el.innerHTML = `<span class="flin"><span class="fback"></span>${face}</span>`;
  // Laid out at the pile's size and grown into place by the flight, so the text
  // on the face stays in proportion the whole way across.
  el.style.cssText =
    `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;` +
    `--cw:${from.width}px`;
  document.body.appendChild(el);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const grow = to.width / from.width;
  if (hold) {
    inFlight.add(hold);
    syncFlight();
  }
  const anim = el.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
      {
        transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 26}px) scale(${1 + (grow - 1) * 0.6})`,
        offset: 0.55,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(${grow})`, opacity: face ? 1 : 0, offset: 1 },
    ],
    { duration: DRAW_FLIGHT, delay, easing: 'cubic-bezier(0.3, 0.85, 0.35, 1)', fill: 'backwards' },
  );
  // The turn happens over the middle of the flight, so the card is face up
  // before it settles rather than snapping over on arrival.
  el.querySelector('.flin')?.animate(
    [{ transform: 'rotateY(0)' }, { transform: `rotateY(${face ? 180 : 0}deg)` }],
    { duration: DRAW_FLIGHT * 0.6, delay: delay + DRAW_FLIGHT * 0.2, easing: 'ease-in-out', fill: 'both' },
  );
  const land = () => {
    el.remove();
    if (hold && inFlight.delete(hold)) syncFlight();
  };
  anim.onfinish = land;
  // An animation that never finishes would leave a card in the air and a gap in
  // the fan, so the landing is guaranteed on a timer as well.
  window.setTimeout(land, delay + DRAW_FLIGHT + 400);
}

/**
 * A card the other player just spent out of their hand, so it can be seen
 * leaving. Their hand is face down, so without this a card simply appears on the
 * board and the hand silently shrinks: two changes with nothing connecting them.
 */
interface HandPlayFx {
  /** Where it sat in their fan, so it flies out of the right gap. */
  fromIndex: number;
  cardId: string;
  /** Where it landed, or null for somewhere with no square of its own. */
  to: TargetRef | null;
}
let handPlayFx: HandPlayFx | null = null;

/** Which hand index an action spends, for the actions that spend one. */
function handIndexOf(action: Action): number | null {
  switch (action.type) {
    case 'PLAY_SUMMON':
    case 'CAST_SPELL':
    case 'PLAY_STAGE':
    case 'PLAY_SUPPORTER':
    case 'CAST_TRAP':
    case 'REPLACE_SUMMON':
      return action.handIndex;
    default:
      return null;
  }
}

/**
 * What the card they just played actually was.
 *
 * Their hand is a row of placeholders online, so the id in it says nothing. The
 * card is public the moment it is played, though, so it is read back out of
 * wherever it landed. Offline the hand already holds the real id and this never
 * has to look.
 */
function playedCardId(
  prev: GameState,
  next: GameState,
  action: Action,
  actor: PlayerIdx,
  index: number,
): string | null {
  const fromHand = prev.players[actor].hand[index];
  if (fromHand && fromHand !== HIDDEN_ID) return fromHand;
  const p = next.players[actor];
  switch (action.type) {
    case 'PLAY_SUMMON':
    case 'REPLACE_SUMMON': {
      const slot = 'slot' in action ? action.slot : null;
      const body = slot === null ? null : p.slots[slot];
      return body?.cardId ?? null;
    }
    case 'PLAY_SUPPORTER':
      return p.supporters.at(-1)?.cardId ?? null;
    case 'PLAY_STAGE':
      return p.stage;
    // A spell or a trap is spent, and spent cards land in the discard. Not
    // necessarily last: a battle trap resolves the clash after it is spent,
    // and the clash can discard more, so the gain of the right type is the one.
    case 'CAST_SPELL':
    case 'CAST_TRAP': {
      const want = action.type === 'CAST_TRAP' ? 'trap' : 'spell';
      const gained = discardGains(prev, next, actor);
      return gained.find((id) => tryCard(id)?.type === want) ?? p.discard.at(-1) ?? null;
    }
    default:
      return null;
  }
}

function computeHandPlayFx(
  prev: GameState,
  next: GameState,
  action: Action,
  actor: PlayerIdx,
): void {
  handPlayFx = null;
  // Only the hand you cannot see needs explaining; your own card is under your
  // cursor already.
  if (actor === viewSeat()) return;
  const index = handIndexOf(action);
  if (index === null) return;
  const cardId = playedCardId(prev, next, action, actor, index);
  // Better nothing than a placeholder flying out of their fan.
  if (!cardId || cardId === HIDDEN_ID) return;
  const to =
    action.type === 'PLAY_SUMMON' || action.type === 'REPLACE_SUMMON'
      ? ({ kind: 'summon', player: actor, slot: 'slot' in action ? action.slot : 0 } as TargetRef)
      : null;
  handPlayFx = { fromIndex: index, cardId, to };
}

/**
 * Fly the spent card out of their fan and turn it face up on the way. It lands
 * on its square if it has one, and otherwise settles over the middle of the
 * table, which is where a spell or a trap resolves.
 */
function playHandPlays(): void {
  const fx = handPlayFx;
  if (!fx) return;
  const fan = document.querySelectorAll<HTMLElement>('#topbar .ehfan .ehcard');
  // The fan has already been rebuilt without the spent card, so the gap it left
  // is wherever that index now points, clamped to the end of a shorter fan.
  const seat = fan[Math.min(fx.fromIndex, fan.length - 1)] ?? fan[0];
  const stage = document.querySelector('.stage');
  if (!seat || !stage) return;
  const from = seat.getBoundingClientRect();

  const landing = fx.to ? boardElFor(fx.to, true) : null;
  const to = landing
    ? landing.getBoundingClientRect()
    : (() => {
        const r = stage.getBoundingClientRect();
        return new DOMRect(r.left + r.width / 2 - from.width, r.top + r.height / 2 - from.height,
          from.width * 2, from.height * 2);
      })();
  flyDraw(from, to, fx.to ? corpseKey(fx.to) : null, 0, fx.cardId);
}

function playDraws(): void {
  if (drawFx.length === 0) return;
  const me = viewSeat();
  for (const { player, count } of drawFx) {
    const pile = document.querySelector<HTMLElement>(
      `.board .pile[data-deck="${player}"] .minicard`,
    );
    if (!pile) continue;
    const from = pile.getBoundingClientRect();
    // Both hands are on screen now, so a draw always has somewhere real to land.
    // The other player's card arrives face down: you see that they drew, and
    // that is all you are entitled to see.
    const hand = Array.from(
      document.querySelectorAll<HTMLElement>(
        player === me ? '#hand .handrail .card' : '#topbar .ehfan .ehcard',
      ),
    );
    for (let i = 0; i < count; i++) {
      const index = hand.length - count + i;
      const seat = hand[index] ?? null;
      const to = seat
        ? seat.getBoundingClientRect()
        : new DOMRect(from.left - 10, from.top - 90, from.width * 1.2, from.height * 1.2);
      // Only your own fan keeps the seat empty until the card lands. Theirs is a
      // tight arc of identical backs, so an empty seat in it does not read as a
      // card on its way: it reads as a card-shaped hole, or as a blank white
      // card where the two beside it overlap. Nothing is given away by letting
      // their fan close up while an identical back is still flying into it.
      const hold = seat && player === me ? `hand:${index}` : null;
      flyDraw(from, to, hold, i * DRAW_STEP, player === me ? seat?.dataset.cardid : undefined);
    }
  }
}

/** The gap between two cards travelling into the same deck. */
const GIFT_STEP = 260;

/** Where a card put into somebody's deck flies from: whatever card put it there. */
function giftOrigin(to: PlayerIdx): DOMRect | null {
  const theirs = effectCallouts.filter(
    (c) => (c.ref.kind === 'summon' || c.ref.kind === 'leader') && c.ref.player !== to,
  );
  const pick = theirs[theirs.length - 1];
  const fallback = ui.state ? nextLiving(ui.state, to) : otherPlayer(to);
  const el = pick
    ? (boardElFor(pick.ref) ??
      document.querySelector<HTMLElement>(`.board [data-cardid="${CSS.escape(pick.cardId)}"]`))
    : boardElFor({ kind: 'leader', player: fallback });
  return el ? el.getBoundingClientRect() : null;
}

/**
 * A card somebody else puts in your deck flies there from whatever put it, so a
 * Rot arriving is something you watch rather than something you find later.
 */
function playDeckGifts(): void {
  if (deckGiftFx.length === 0) return;
  for (const { player, cardId, count } of deckGiftFx) {
    const pile = document.querySelector<HTMLElement>(`.board .pile[data-deck="${player}"] .minicard`);
    if (!pile) continue;
    const to = pile.getBoundingClientRect();
    const from = giftOrigin(player);
    if (!from) continue;
    for (let i = 0; i < count; i++) flyDraw(from, to, null, i * GIFT_STEP, cardId);
  }
}

/** Each card that did something of its own gets a callout floating off it, in order. */
function playEffectCallouts(): void {
  if (effectCallouts.length === 0) return;
  const stageEl = document.querySelector<HTMLElement>('.stage');
  if (!stageEl) return;
  const fxd = (trapFx ? 1500 : smackFx ? 310 : 0) + woundLeadMs();
  const step = effectCallouts.length > 4 ? 430 : 640;
  const stacked = new Map<string, number>();
  for (const c of effectCallouts) {
    // A body that died doing it has left its slot, so the corpse standing in its
    // place is what the callout comes off.
    const at =
      boardElFor(c.ref) ??
      document.querySelector<HTMLElement>(`.board [data-cardid="${CSS.escape(c.cardId)}"]`);
    const def = tryCard(c.cardId);
    if (!at || !def) continue;
    const pos = centerOf(at);
    const lift = stacked.get(corpseKey(c.ref)) ?? 0;
    stacked.set(corpseKey(c.ref), lift + 1);
    const el = document.createElement('div');
    el.className = 'flipcallout';
    const art = def.art
      ? `<span class="fcart">${artFit(def)}</span>`
      : '';
    el.innerHTML = `${art}<span class="fctext"><b>${esc(def.name)}</b> ${esc(c.says)}</span>`;
    const delay = fxd + 520 + c.order * step;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y - 82 - lift * 36}px`;
    el.style.animationDelay = `${delay}ms`;
    stageEl.appendChild(el);
    // It is centred on the card it came from, so a card near an edge pushes half
    // the sentence off the screen. Measured once it is in the DOM, because the
    // width depends on how much the card had to say, then held inside the table.
    const half = el.offsetWidth / 2;
    const stageW = stageEl.offsetWidth;
    el.style.left = `${Math.round(Math.max(half + 8, Math.min(stageW - half - 8, pos.x)))}px`;
    window.setTimeout(() => el.remove(), delay + 1700);
  }
}

/** The whole scatter: one token start to finish, plus the stagger before the last one. */
function woundSpanMs(): number {
  let widest = 0;
  for (const fx of woundFx.values()) widest = Math.max(widest, fx.pool);
  return widest === 0 ? 0 : WOUND_FX_MS + WOUND_STEP_MS * Math.min(widest - 1, WOUND_STEP_CAP);
}

/** How long the damage waits on the tokens. Nothing to wait for if none made any. */
function woundLeadMs(): number {
  for (const fx of woundFx.values()) if (fx.damage > 0) return woundSpanMs();
  return 0;
}

/** How long the animations just started need on screen before the bot moves again. */
function fxTailMs(): number {
  const landed = trapFx ? 1500 : smackFx ? 310 : 0;
  const fxd = landed + woundLeadMs();
  let tail = 0;
  if (woundFx.size > 0) tail = Math.max(tail, landed + woundSpanMs() + 260);
  if (trapFx) tail = Math.max(tail, 2100);
  if (smackFx) tail = Math.max(tail, fxd + 900);
  if (corpseFx.length > 0) tail = Math.max(tail, fxd + 1650);
  if (effectCallouts.length > 0) {
    const step = effectCallouts.length > 4 ? 430 : 640;
    tail = Math.max(tail, fxd + 520 + (effectCallouts.length - 1) * step + 1200);
  }
  for (const d of drawFx) {
    tail = Math.max(tail, (d.count - 1) * DRAW_STEP + DRAW_FLIGHT + 120);
  }
  for (const g of deckGiftFx) {
    tail = Math.max(tail, (g.count - 1) * GIFT_STEP + DRAW_FLIGHT + 120);
  }
  return tail;
}

// --- history grouping --------------------------------------------------------

/**
 * One history tile per interaction rather than per log line: the actions that
 * merely settle an interaction already underway (trap windows, flip payments,
 * deferred choices) write into the tile the initiating action opened, so an
 * attack, its flips, and what was paid for them read as one square.
 */
const GROUP_CONTINUERS = new Set([
  'CAST_TRAP',
  'PASS_RESPONSE',
  'PAY_FLIP',
  'DECLINE_FLIP',
  'RESOLVE_CHOICE',
]);

/** Group id per log index, alongside ui.state.log. */
let logGroups: number[] = [];
let logGroupNext = 0;

function resetLogGroups(state: GameState): void {
  logGroups = state.log.map(() => 0);
  logGroupNext = 0;
}

function recordLogGroups(next: GameState, action: Action): void {
  if (!GROUP_CONTINUERS.has(action.type)) logGroupNext++;
  while (logGroups.length < next.log.length) logGroups.push(logGroupNext);
}

/**
 * The HP cards a summon wears, laid out as real face-down cards under the body.
 * Damage turns them over with a flip, and the card waiting on a costed flip
 * decision glows until its owner settles it.
 */
function hpFan(state: GameState, ref: TargetRef, s: SummonInstance): string {
  const n = s.hp.length;
  if (n === 0) return '<div class="hpfan"></div>';
  // Overlap tightens as the fan grows so a leader's double HP still fits the unit.
  const step = hpStep(n);
  const fx = flipFx.get(s.uid);
  const offer = state.flipQueue[0];
  let glowIndex = -1;
  if (offer && refKey(offer.holder) === refKey(ref)) {
    for (let i = s.hp.length - 1; i >= 0; i--) {
      if (s.hp[i].flipped && s.hp[i].cardId === offer.cardId) {
        glowIndex = i;
        break;
      }
    }
  }
  const un = unflipFx.get(s.uid);
  const minis = s.hp
    .map((h, i) => {
      const def = tryCard(h.cardId);
      const face = def
        ? `<span class="hart" style="${artCss(def)}"></span><img decoding="sync" class="hframe" src="${frameUrl(def)}" alt="" draggable="false">`
        : '';
      if (!h.flipped) {
        // A heal turns the card back over in place, face to back.
        if (un?.has(i)) {
          return `<span class="hpmini unflipnow">
            <span class="flin"><span class="fback"></span><span class="fface">${face}</span></span>
          </span>`;
        }
        return `<span class="hpmini back"></span>`;
      }
      const glow = i === glowIndex ? ' flipglow' : '';
      if (fx?.has(i)) {
        // A free flip that fires flashes a gold ring the moment it lands.
        const fired = def?.flip && !def.flipCost ? ' fired' : '';
        return `<span class="hpmini flipnow${glow}${fired}" data-cardid="${esc(h.cardId)}">
          <span class="flin"><span class="fback"></span><span class="fface">${face}</span></span>
        </span>`;
      }
      return `<span class="hpmini face${glow}" data-cardid="${esc(h.cardId)}">${face}</span>`;
    })
    .join('');

  // The fan is part of the body it protects, so a click on it has to resolve to
  // the same target the card does. Its own act, not the card's, so it stays out
  // of drag sources: you attack by dragging the card, not its armour.
  const seat =
    ref.kind === 'leader'
      ? `data-act="hpfan" data-player="${ref.player}" data-slot=""`
      : ref.kind === 'summon'
        ? `data-act="hpfan" data-player="${ref.player}" data-slot="${ref.slot}"`
        : '';
  // No count beside the fan: the tokens scattered on the card are the count.
  return `<div class="hpfan" ${seat} style="--step:${step}px">${minis}</div>`;
}

/** The numbers a body currently wears, for any card drawn from the board. */
function liveStats(state: GameState, s: SummonInstance): NonNullable<CardOpts['live']> {
  const def = card(s.cardId);
  return {
    strength: effectiveStrength(state, s),
    hp: remainingHp(s),
    max: s.hp.length,
    printedStrength: s.override ? s.override.strength : (def.strength ?? 0),
    printedHp: (def.hp ?? 0) * (s.isLeader ? 2 : 1),
  };
}

/**
 * The wound tokens on a body: the ones that landed this action, and otherwise
 * the ones already sitting on it.
 *
 * A wound is a standing debt against the body rather than a thing that happened,
 * and it decides whether the next point finishes it. Drawing them only while the
 * animation ran meant a body carrying one looked identical to a body carrying
 * none the moment the dust settled.
 */
function woundHtml(state: GameState, ref: TargetRef): string {
  const fx = woundFx.get(corpseKey(ref));
  if (!fx || fx.pool <= 0) {
    const body = findSummon(state, ref);
    const held = body?.wounds ?? 0;
    if (held <= 0) return '';
    const rest = woundSpots(corpseKey(ref), held, 0)
      .map(
        (spot, i) =>
          `<img class="wtok held" style="--tx:${spot.x.toFixed(3)};--ty:${spot.y.toFixed(3)}` +
          `;--wi:${Math.min(i, WOUND_STEP_CAP)}" src="${BASE}${WOUND_TOKEN}" alt=""` +
          ` title="${held} wound(s) waiting on this body." draggable="false">`,
      )
      .join('');
    return `<span class="wtoks">${rest}</span>`;
  }
  // At rate 1 a wound is a point on its own, so nothing pairs off and each
  // token that became damage simply goes. Above that they pair, two to a point.
  const paired = fx.rate > 1 ? fx.damage : 0;
  const spots = woundSpots(corpseKey(ref), fx.pool, paired);
  const toks = spots
    .map((s, i) => {
      const merges = i < paired * 2;
      const spends = fx.rate === 1 && i < fx.damage;
      // Anything else is the remainder left under the rate, or a token on a body
      // that died before the pool ran out. It fades without doing anything.
      const cls = merges ? 'wtok merge' : spends ? 'wtok spend' : 'wtok idle';
      const style = `--tx:${s.x.toFixed(3)};--ty:${s.y.toFixed(3)};--mx:${s.mx.toFixed(3)};--my:${s.my.toFixed(3)};--wi:${Math.min(i, WOUND_STEP_CAP)}`;
      return `<img class="${cls}" style="${style}" src="${BASE}${WOUND_TOKEN}" alt="" draggable="false">`;
    })
    .join('');
  return `<span class="wtoks">${toks}</span>`;
}
/**
 * The seal drawn over a summon slot whose owner cannot answer a death with a
 * replacement. Leaders are never replaced, so they never wear it.
 */
function lockHtml(state: GameState, ref: TargetRef): string {
  if (ref.kind !== 'summon') return '';
  const player = ref.player;
  const held = lockOut.has(player);
  if (state.players[player].replaceLocked <= 0 && !held) return '';
  const phase = held ? ' lockout' : lockIn.has(player) ? ' lockin' : '';
  return `<img class="lockfx${phase}" src="${BASE}Cardgame/Extras/Locked.png" alt="" title="Sealed: a summon that dies here cannot be replaced until the end of the turn." draggable="false">`;
}

function unitHtml(state: GameState, ref: TargetRef, caption: string): string {
  const s = findSummon(state, ref);
  const me = viewSeat();
  const key = refKey(ref);

  if (!s) {
    const droppable =
      playKeys().has(key) ||
      (ui.selection?.kind === 'hand' &&
        ref.kind === 'summon' &&
        ref.player === me &&
        card(state.players[me].hand[ui.selection.index] ?? '')?.type === 'summon');
    // A body that just died here stays visible while its death plays out.
    const corpse = corpseFx.find((c) => c.key === corpseKey(ref))?.html ?? '';
    // A leader cell before the leader lands takes no drops and no clicks,
    // except while an enemy pick is asking: the seat can be named before its
    // leader has taken the field.
    if (ref.kind !== 'summon') {
      const pickable =
        !!ui.enemyPick &&
        ref.kind === 'leader' &&
        ref.player !== me &&
        !state.players[ref.player].eliminated;
      return `<div class="unit">
        <div class="caption">${esc(caption)}</div>
        <div class="slot-empty${pickable ? ' droppable targetable' : ''}"${
          pickable ? ` data-act="leader" data-player="${ref.player}"` : ''
        }>no leader yet</div>
        <div class="hpfan"></div>
        ${corpse}
      </div>`;
    }
    return `<div class="unit">
      <div class="caption">${esc(caption)}</div>
      <div class="slot-empty${droppable ? ' droppable' : ''}" data-act="empty" data-player="${ref.player}" data-slot="${ref.slot}">slot ${ref.slot + 1}</div>
      <div class="hpfan"></div>
      ${corpse}
      ${lockHtml(state, ref)}
      ${woundHtml(state, ref)}
    </div>`;
  }

  const def = card(reformFrom.get(s.uid) ?? s.cardId);
  const classes: string[] = [];
  if (s.sapped) classes.push('sapped');
  if (candidateKeys().has(key) || playKeys().has(key)) classes.push('targetable');
  if (
    ui.enemyPick &&
    ref.kind === 'leader' &&
    ref.player !== me &&
    !state.players[ref.player].eliminated
  ) {
    classes.push('targetable');
  }
  if (attackKeys().has(key)) classes.push('attackable');
  if (ui.selection?.kind === 'summon' && refKey(ui.selection.ref) === key) classes.push('selected');

  const live = liveStats(state, s);
  const printedStrength = live.printedStrength;
  const liveStrength = live.strength;
  if (liveStrength > printedStrength) classes.push('buffed');
  else if (liveStrength < printedStrength) classes.push('debuffed');

  // Keyword state drawn onto the card: the Power Shield bubble and the
  // Deathrattle skull, printed or granted mid-game.
  let extra = '';
  if (s.shields > 0) {
    extra += `<img class="overlay shieldfx" src="${BASE}Cardgame/Extras/PowerShield.png" alt="" title="Power Shields: ${s.shields}" draggable="false">`;
    if (s.shields > 1) extra += `<span class="shieldn">${s.shields}</span>`;
  }
  if (s.isLeader && remainingHp(s) <= LAST_BREATH_HP) {
    extra += '<span class="lastbreath"></span>';
  }
  if (def.triggers?.onDeath || s.bestowed) {
    const who = s.bestowed ? `Bestowed Deathrattle: ${esc(tryCard(s.bestowed)?.name ?? '')}` : 'Deathrattle';
    extra += `<img class="overlay rattlefx" src="${BASE}Cardgame/Extras/Deathrattle.png" alt="" title="${who}" draggable="false">`;
  }
  const warded = wardedKeys();
  const tokens: { art: string; title: string; cls?: string }[] = [];
  if (def.redirect) {
    tokens.push({
      art: REDIRECT_TOKEN,
      title: 'Redirection: enemies may only attack this body and only aim spells and traps at it.',
    });
  }
  if (def.spellImmune) {
    tokens.push({
      art: SPELL_IMMUNE_TOKEN,
      title: 'Spell Immunity: no spell or trap may choose this body as a target, from either side.',
      // Only while a spell is being aimed that would otherwise land here. The
      // token is always on the card; this is it answering.
      cls: warded.has(refKey(ref)) ? 'warding' : '',
    });
  }
  if (s.sapLock) {
    tokens.push({
      art: NO_UNSAP,
      title: 'Stays sapped: this body will not unsap the next time it would.',
    });
  }
  extra += tokenHtml(s.uid, tokens);
  if (liveStrength > printedStrength) {
    extra += `<span class="sparkles">${markSpots(`s${s.uid}`, 5).join('')}</span>`;
  } else if (liveStrength < printedStrength) {
    extra += `<span class="blight">${markSpots(`b${s.uid}`, 4).join('')}</span>`;
  }

  // One-shot overlays for what the last action just did to this body.
  const fxKinds = unitFx.get(s.uid);
  if (fxKinds) {
    for (const kind of fxKinds) {
      extra += `<span class="unitfx fx-${kind}"><i></i><i></i><i></i></span>`;
      if (kind === 'damage') classes.push('hitfx');
      if (kind === 'reform') classes.push('reformfx');
    }
  }

  const data: Record<string, string | number> = {
    act: ref.kind === 'leader' ? 'leader' : 'slot',
    player: ref.kind === 'leader' ? ref.player : (ref as { player: PlayerIdx }).player,
    slot: ref.kind === 'summon' ? ref.slot : '',
    cardid: s.cardId,
    flight: corpseKey(ref),
  };

  return `<div class="unit">
    <div class="caption">${esc(caption)}${s.isLeader ? '' : ` · L${levelOf(s, def)}`}</div>
    ${renderCard(def, { classes, data, extra, live, edmg: effectDamageOf(state, s.owner) })}
    ${hpFan(state, ref, s)}
    ${lockHtml(state, ref)}
    ${woundHtml(state, ref)}
  </div>`;
}

function stageUnit(state: GameState, player: PlayerIdx): string {
  const id = state.players[player].stage;
  // Lit while a field card is mid-drag; the ghost snaps here when it comes near.
  const lit = player === viewSeat() && ui.drag?.cast === 'stage';
  const shell = `<div class="unit stagecell${lit ? ' stagelit' : ''}" data-player="${player}">`;
  if (!id) {
    return `${shell}<div class="caption">field</div>
      <div class="slot-empty">no field</div><div class="hpfan"></div></div>`;
  }
  return `${shell}<div class="caption">field</div>
    ${renderCard(card(id), { data: { act: 'peek', cardid: id } })}
    <div class="hpfan"></div></div>`;
}

function supportRow(state: GameState, player: PlayerIdx): string {
  const p = state.players[player];
  const mine = player === viewSeat();
  const cells = p.supporters
    .map((s, i) => {
      const def = card(s.cardId);
      // What it pays, which is not always what colour it is: a neutral card
      // faced here pays colourless whatever colour its art was drawn in.
      const kind = manaKindFor(p, def);
      const pays = kind === 'C' ? 'colorless' : COLOR_NAME[kind];
      // Lying at 90 degrees puts a card's name end on its right, so the stack
      // runs against DOM order: each card covers the one after it, and what
      // stays showing is the half you can read it by.
      return `<span class="support${s.sapped ? ' sapped' : ''}${mine ? ' mine' : ''}"
        style="z-index:${p.supporters.length - i}"
        data-act="support" data-player="${player}" data-index="${i}"
        title="${esc(def.name)} · pays ${esc(pays)}${s.sapped ? ' · spent' : ''}"
        >${renderCard(def, { classes: ['supportcard'] })}</span>`;
    })
    .join('');
  const pool = COLORS.filter((c) => p.mana[c] > 0)
    .map((c) => pipRun(c, p.mana[c]))
    .join('');
  // Sideways cards are wide, so past a few they overlap the way the hand fan
  // does rather than pushing the well off the board. A fraction of the card
  // rather than a pixel count, because the card scales with the viewport.
  // Measured over 40 bot games, the peak count runs 2 to 8 with a median of 3,
  // so most rows never overlap at all and the tail degrades to a fan.
  const n = p.supporters.length;
  const overlap =
    n > 9 ? -0.98 : n > 7 ? -0.85 : n > 6 ? -0.73 : n > 5 ? -0.58 : n > 4 ? -0.36 : 0;
  const droppable = mine && ui.drag?.mode === 'play' && ui.drag.canSupport;
  // The whole well is the drop target, labelled so it reads as a place rather
  // than as whatever happens to be sitting in it.
  return `<div class="supportrow${droppable ? ' droppable' : ''}" style="--soverlap:${overlap}" data-act="supportrow" data-player="${player}">
    <span class="zlabel supportlabel">supporters</span>
    ${cells}${pool ? `<span class="manapool">${pool}</span>` : ''}
  </div>`;
}

/** The debt zone as a stack of card tops, name and level peeking out of each. */
function debtStackHtml(state: GameState, player: PlayerIdx): string {
  const p = state.players[player];
  const shown = p.debt.slice(-9).reverse();
  const more = p.debt.length - shown.length;
  const rows = shown
    .map((id, i) => {
      const def = card(id);
      const isBody = def.type === 'summon';
      // Newest sits on top of the pile, so z-order runs against DOM order.
      return `<div class="debtcard" style="--dc:var(--c-${frameKeyOf(def)});z-index:${shown.length - i}" data-cardid="${esc(id)}">
        <span class="dlv">${isBody ? (def.level ?? 1) : '·'}</span><span class="dnm">${esc(def.name)}</span>
      </div>`;
    })
    .join('');
  // The stack heats up as the count nears the limit: a red outline that
  // thickens and pulses faster, and a count that grows and reddens with it.
  const d = p.debtCount;
  const limit = debtLimitOf(state);
  const tier = d >= limit - 2 ? 3 : d >= limit - 5 ? 2 : d >= limit - 8 ? 1 : 0;
  return `<div class="debtzone${tier ? ` danger${tier}` : ''}${debtFx.has(player) ? ' jolt' : ''}">
    <span class="zlabel">debt <span class="debtnum">${d}</span>/${limit}</span>
    <div class="debtstack">${rows || '<span class="zempty">empty</span>'}</div>
    ${more > 0 ? `<span class="zmore">+${more} more</span>` : ''}
  </div>`;
}

/** The deck as a face-down stack and the discard pile showing its top card. */
function pilesHtml(state: GameState, player: PlayerIdx): string {
  const p = state.players[player];
  const top = p.discard[p.discard.length - 1];
  const topDef = top ? card(top) : null;
  const discard = topDef
    ? `<div class="minicard face" data-cardid="${esc(top)}">
        <span class="hart" style="${artCss(topDef)}"></span>
        <img decoding="sync" class="hframe" src="${frameUrl(topDef)}" alt="" draggable="false">
      </div>`
    : '<div class="minicard hollow"></div>';
  // An empty deck is an empty space, the way the discard pile is: a card back
  // over nothing reads as cards still to come.
  const deck =
    p.deck.length === 0
      ? '<div class="minicard hollow"></div>'
      : '<div class="minicard back stacked"></div>';
  // Deck-outs cost more each time, so the next bill is shown before it lands
  // rather than arriving as a surprise in the log.
  const owed = reshuffleCost(state, player);
  const warn =
    p.deck.length <= 5 ? `<span class="pilewarn" title="Drawing on an empty deck costs ${owed} debt and turns the discard over">${owed}</span>` : '';
  return `<div class="piles">
    <div class="pile${p.deck.length <= 5 ? ' pile-low' : ''}" title="Deck: ${p.deck.length} cards" data-deck="${player}">
      ${deck}${warn}
      <span class="pilecount">${p.deck.length}</span><span class="zlabel">deck</span>
    </div>
    <div class="pile discardpile${p.discard.length > 0 ? ' readable' : ''}"
      title="Discard: ${p.discard.length} cards${p.discard.length > 0 ? '. Press and hold to read it.' : ''}"
      data-discard="${player}">
      ${discard}
      <span class="pilecount">${p.discard.length}</span><span class="zlabel">discard</span>
    </div>
  </div>`;
}

function sideHtml(state: GameState, player: PlayerIdx, mine: boolean): string {
  const slots = state.players[player].slots
    .map((_, i) => unitHtml(state, { kind: 'summon', player, slot: i }, `slot ${i + 1}`))
    .join('\n    ');
  // Debt hangs off the leader rather than sitting in a column of its own. It is
  // the leader's debt, it is what kills the leader, and pinned to the board edge
  // it drifted across everything else every time the window changed size. On the
  // leader it travels with the card and scales with it.
  const lane = `<div class="lane">
    <div class="leadercell">
      ${unitHtml(state, { kind: 'leader', player }, 'leader')}
      ${debtStackHtml(state, player)}
    </div>
    ${slots}
    ${stageUnit(state, player)}
  </div>`;
  const support = supportRow(state, player);
  // The first column is empty on purpose: it is the room the leader's debt hangs
  // into, reserved in card widths so it scales with the card it belongs to.
  const out = state.players[player].eliminated ? ' eliminated' : '';
  return `<div class="side ${mine ? 'mine' : 'theirs'}${out}" data-player="${player}">
    <div class="debtgutter"></div>
    <div class="midcol">${mine ? lane + support : support + lane}</div>
    <div class="zonecol">${pilesHtml(state, player)}</div>
  </div>`;
}

/** First card named in a log line, for the play-by-play tiles. */
/**
 * A deck is named after its leader and a player is named after their deck, so
 * every line that opens with a player's name opens with a card's name. Taking
 * the names out first stops "Rain God copy copy begins turn 1" from putting Rain
 * God on the tile of somebody who is not playing it.
 */
function withoutNames(text: string, state: GameState): string {
  let out = text;
  // An empty name would split the line into single characters.
  for (const p of state.players) if (p.name) out = out.split(p.name).join(' ');
  return out;
}

function cardInText(text: string): string | null {
  let best: string | null = null;
  let at = Infinity;
  for (const entry of cardNameIndex()) {
    const m = entry.re.exec(text);
    if (m && m.index < at) {
      at = m.index;
      best = entry.id;
    }
  }
  return best;
}

/** The play-by-play strip: one art tile per interaction, hover to read it. */
function historyHtml(state: GameState): string {
  const me = viewSeat();
  // The group map can fall out of step across a hot reload; degrade to one
  // group per line rather than mislabel anything.
  if (logGroups.length !== state.log.length) {
    logGroups = state.log.map((_, i) => i);
    logGroupNext = state.log.length;
  }
  interface Tile {
    gid: number;
    texts: string[];
    player: PlayerIdx | null;
    last: number;
  }
  const groups: Tile[] = [];
  state.log.forEach((e, i) => {
    const gid = logGroups[i];
    const cur = groups[groups.length - 1];
    if (cur && cur.gid === gid) {
      cur.texts.push(e.text);
      cur.last = i;
      if (cur.player === null) cur.player = e.player;
    } else {
      groups.push({ gid, texts: [e.text], player: e.player, last: i });
    }
  });
  const tiles = groups
    .slice(-11)
    .map((g) => {
      let id: string | null = null;
      for (const t of g.texts) {
        id = cardInText(withoutNames(t, state));
        if (id) break;
      }
      const def = id ? card(id) : null;
      const side = g.player === null ? 'sys' : g.player === me ? 'mine' : 'theirs';
      const fresh = g.last >= freshLogFrom ? ' fresh' : '';
      const face = def?.art
        ? `<span class="hisart">${artFit(def)}</span>`
        : '<span class="hisart plain">·</span>';
      const pop = `<div class="histpop">
        ${def ? renderCard(def) : ''}
        <div class="histlines">${g.texts.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
      </div>`;
      return `<div class="histile ${side}${fresh}"${
        g.player === null ? '' : ` data-player="${g.player}"`
      }>${face}${pop}</div>`;
    })
    .join('');
  return tiles;
}

/** Whether the player still has any play, attack or power left this turn. */
function anyActionsLeft(state: GameState, me: PlayerIdx): boolean {
  const p = state.players[me];
  if (p.supportersLeft > 0 && p.hand.length > 0) return true;
  const emptySlot = p.slots.some((s) => !s);
  for (const id of p.hand) {
    const def = card(id);
    if (def.type === 'summon' && emptySlot) return true;
    if ((def.type === 'spell' || def.type === 'stage') && canPay(p, costFor(p, def))) return true;
  }
  const sources: SourceRef[] = [
    { kind: 'leader', player: me },
    ...p.slots.map((_, i) => ({ kind: 'summon', player: me, slot: i }) as SourceRef),
  ];
  for (const source of sources) {
    const s = findSummon(state, source);
    if (!s) continue;
    if (legalAttackTargets(state, source).length > 0) return true;
    const powers = powersOf(s, card(s.cardId));
    for (let i = 0; i < powers.length; i++) {
      if (!powerBlockers(state, me, source, i)) return true;
    }
  }
  return false;
}

/** The turn button, on the right edge where a thumb or cursor rests. */
function endTurnHtml(state: GameState): string {
  const busy =
    !!state.pending || state.flipQueue.length > 0 || state.replaceQueue.length > 0 || !!ui.targeting;
  const ready = canAct() && !busy && !isOver(state);
  // Green means the turn is spent: nothing left to play, swing or activate.
  const done = ready && !anyActionsLeft(state, viewSeat());
  // With three enemies "Enemy Turn" says too little, so the button names them.
  const enemyLabel = isParty(state)
    ? `${esc(state.players[state.active].name.split(' ')[0])}'s Turn`
    : 'Enemy Turn';
  const label = !canAct() ? enemyLabel : busy ? 'Waiting…' : 'End Turn';
  return `<button class="endturn${ready ? ' ready' : ''}${done ? ' alldone' : ''}" data-act="btn" data-cmd="end-turn"
    ${ready ? '' : 'disabled'}>${label}</button>`;
}

/** The board's last markup, so an unchanged board is left standing. */
let lastBoardHtml = '';
/** Whose turn the party carousel last slid to, so each turn slides once. */
let lastActiveSlid: PlayerIdx | null = null;
/** The same for the play-by-play strip, which redraws on the same renders. */
let lastHistoryHtml = '';

function renderHistory(): void {
  const state = ui.state;
  const el = document.getElementById('history');
  if (!state || !el) return;
  const html = historyHtml(state);
  if (html === lastHistoryHtml) return;
  lastHistoryHtml = html;
  el.innerHTML = html;
}

/** Seat the view slider's knob against wherever the carousel actually is. */
function syncOppSlider(): void {
  const row = document.querySelector<HTMLElement>('.opprow');
  const slider = document.querySelector<HTMLInputElement>('.oppslider');
  if (!row || !slider) return;
  const room = Math.max(1, row.scrollWidth - row.clientWidth);
  slider.value = String(Math.round((row.scrollLeft / room) * 1000));
}

let slideAnim: number | null = null;
/** Where the glide is headed: a seat to chase, or a plain offset. */
let slideGoal: { seat: number } | { x: number; fromKnob?: boolean } | null = null;

/** Whether the glide is chasing the slider's knob, so nothing rewrites the knob. */
function sliderDriving(): boolean {
  return slideGoal !== null && 'x' in slideGoal && !!slideGoal.fromKnob;
}

/**
 * One eased step a frame toward the current goal. Driven by hand rather than
 * scroll-behavior smooth because a board rebuild mid-glide restores the old
 * offset and cancels a native smooth scroll; this one just re-finds its goal
 * next frame and carries on. A knob drag retargets the same glide, so the
 * boards chase the hand smoothly instead of teleporting.
 */
function stepOppSlide(): void {
  slideAnim = null;
  const row = document.querySelector<HTMLElement>('.opprow');
  if (!row || slideGoal === null) return;
  let target: number;
  if ('x' in slideGoal) {
    target = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, slideGoal.x));
  } else {
    const seat = row.querySelectorAll<HTMLElement>('.oppseat')[slideGoal.seat];
    if (!seat) {
      slideGoal = null;
      return;
    }
    const rowRect = row.getBoundingClientRect();
    const seatRect = seat.getBoundingClientRect();
    target =
      row.scrollLeft + seatRect.left + seatRect.width / 2 - (rowRect.left + rowRect.width / 2);
  }
  const fromSlider = sliderDriving();
  const d = target - row.scrollLeft;
  if (Math.abs(d) < 0.6) {
    row.scrollLeft = target;
    slideGoal = null;
    if (!fromSlider) syncOppSlider();
    return;
  }
  const before = row.scrollLeft;
  row.scrollLeft += d * 0.2;
  if (!fromSlider) syncOppSlider();
  // Pinned against the end of the range: no closer to get.
  if (row.scrollLeft === before) {
    slideGoal = null;
    return;
  }
  slideAnim = requestAnimationFrame(stepOppSlide);
}

function glideOppRow(goal: { seat: number } | { x: number; fromKnob?: boolean }): void {
  slideGoal = goal;
  if (slideAnim === null) slideAnim = requestAnimationFrame(stepOppSlide);
}

function renderBoard(): void {
  const state = ui.state;
  const el = document.getElementById('board');
  if (!state || !el) return;
  const me = viewSeat();
  const them = otherPlayer(me);
  el.classList.toggle('castready', !!ui.drag?.cast);
  // While a lunge is playing, flips and damage overlays hold until the impact;
  // a trap reveal pushes everything back further still.
  el.classList.toggle('smacking', !!smackFx);
  // Dimmed while the other side is the one being waited on, whether that is
  // their turn or them answering something on yours. A board you may not touch
  // should look it, rather than reading as one that has stopped responding.
  // On the app rather than the board: the hand is a sibling of the board, not
  // a descendant, and it dims with it.
  root.classList.toggle('waiting', actor() !== me && !isOver(state));
  // Wounds land when the blow does, and the damage they make waits until they
  // have finished resolving, so the flip is the answer to the tokens rather
  // than something happening over the top of them.
  const landed = trapFx ? 1500 : smackFx ? 310 : 0;
  el.style.setProperty('--woundfxd', `${landed}ms`);
  el.style.setProperty('--fxd', `${landed + woundLeadMs()}ms`);
  el.classList.toggle('party', isParty(state));
  // Party: the opponents' boards sit next to each other in turn order, one in
  // view at a time, and the row slides to whoever's turn begins.
  const opps: PlayerIdx[] = [];
  for (let step = 1; step < state.players.length; step++) {
    opps.push(((me + step) % state.players.length) as PlayerIdx);
  }
  const oppRow = isParty(state)
    ? `<div class="opprow">${opps
        .map(
          (p) => `<div class="oppseat">
          <div class="oppname${state.active === p && !isOver(state) ? ' turnnow' : ''}">${esc(
            state.players[p].name,
          )}${state.players[p].eliminated ? '<span class="outtag">eliminated</span>' : ''}</div>
          ${sideHtml(state, p, false)}
        </div>`,
        )
        .join('')}</div>
      <input type="range" class="oppslider" data-act="oppslider" min="0" max="1000" value="0"
        aria-label="Scroll between opponents">`
    : sideHtml(state, them, false);
  const html = `
    ${oppRow}
    <div class="divider">${fuseHtml()}</div>
    ${sideHtml(state, me, true)}
    ${actionBarHtml(state)}
    ${endTurnHtml(state)}
  `;
  // Hover, drag and pointer moves all re-render, and almost none of them change
  // the board. Writing it again would throw away every decoded card face on the
  // table and make the browser rasterise them all a second time, which is the
  // flicker this guards against rather than any real saving in string work.
  if (html === lastBoardHtml) return;
  lastBoardHtml = html;
  // A rebuilt carousel forgets where it was swiped to; hand the offset back.
  const rowScroll = el.querySelector<HTMLElement>('.opprow')?.scrollLeft ?? 0;
  el.innerHTML = html;
  if (rowScroll > 0) {
    const row = el.querySelector<HTMLElement>('.opprow');
    if (row) row.scrollLeft = rowScroll;
  }
  syncOppSlider();
  // The carousel slides itself to whoever's turn began, once per turn, and
  // stays wherever it was scrolled to for the rest of it.
  if (isParty(state) && state.active !== lastActiveSlid && !isOver(state)) {
    lastActiveSlid = state.active;
    const at = opps.indexOf(state.active);
    if (at >= 0) glideOppRow({ seat: at });
  }
  syncFuse(el);
}

// --- action bar and prompts -------------------------------------------------

/**
 * Only errors surface here: the how-to-play line it used to carry sat over the
 * board, so it is parked until there is a proper tutorial to hang it on.
 */
function actionBarHtml(state: GameState): string {
  if (state.winner !== null || !canAct()) return '';
  if (ui.targeting || state.pending || state.replaceQueue.length > 0) return '';
  if (!ui.error) return '';
  return `<div class="actionbar"><span class="status error">${esc(ui.error)}</span></div>`;
}

function promptHtml(state: GameState): string {
  const me = viewSeat();
  const p = state.players[me];
  const btn = (cmd: string, label: string, cls = '') =>
    `<button class="${cls}" data-act="btn" data-cmd="${cmd}">${esc(label)}</button>`;
  const dead = (label: string) => `<button disabled>${esc(label)}</button>`;

  if (isOver(state)) {
    // A drawn match has no winner to name: the caps end one, and so does a blow
    // that takes both leaders.
    const title = state.winner === null ? 'Draw' : `${esc(state.players[state.winner].name)} wins`;
    return `<div class="banner">
      <h2>${title}</h2>
      <p>${esc(state.winReason ?? '')}</p>
      <div class="row">${btn('new-game', 'New match', 'primary')}</div>
    </div>`;
  }

  // A party player knocked out picks between watching and leaving. Choosing to
  // stay stands the overlay down and leaves the grayed board.
  if (p.eliminated && !ui.online.spectating) {
    return `<div class="banner">
      <h2>You are eliminated</h2>
      <p>The game continues without you. Stay to watch it end, or return to the menu.</p>
      <div class="row">${btn('spectate', 'Keep watching', 'primary')}${btn('leave-match', 'Leave')}</div>
    </div>`;
  }

  if (ui.enemyPick) {
    return `<div class="fxbanner">
      <span class="fxtext"><b>Choose an enemy.</b> Click their leader.</span>
      ${btn('cancel-enemy', 'Cancel')}
    </div>`;
  }

  const ch = state.choiceQueue[0];
  if (ch && choiceIsLive(state) && canAct()) {
    const sourceName = tryCard(ch.source)?.name ?? 'Choose';
    if (ch.cards) {
      const none = (ch.legal?.length ?? 0) === 0;
      // Tucked away to read the board. The overlay is still built and still
      // laid out, only turned invisible: the buttons then keep the place they
      // had, and the one that hides is the same one that brings it back.
      const peeking = ui.choiceHidden;
      const grid = ch.cards
        .map((id, index) => {
          const legal = ch.legal?.includes(index) ?? false;
          return renderCard(card(id), {
            classes: legal ? ['targetable'] : ['dimmed'],
            data: legal ? { act: 'pick', index, cardid: id } : { cardid: id },
          });
        })
        .join('');
      // Where the leftovers land, which is only worth saying when they land
      // somewhere of yours. A raid reads the other player's deck, so the cards
      // go home rather than under anything of yours, and it says nothing.
      const restGo =
        ch.effect === 'scry-discard'
          ? 'discard pile'
          : ch.effect === 'static-raid'
            ? null
            : 'deck';
      const note = none
        ? '<p>No viable scry targets</p>'
        : `<p>Pick a card.${restGo ? ` The rest go back under your ${restGo}.` : ''}</p>`;
      const toggle = peeking
        ? btn('choice-show', 'Show', 'primary')
        : btn('choice-hide', 'Hide');
      const row = none
        ? btn('skip-choice', 'Continue', 'primary')
        : `${ch.optional ? btn('skip-choice', 'Take none') : ''}${toggle}`;
      // The buttons hang under the cards and align with their left edge, so
      // they sit in one place however many cards are on offer.
      return `<div class="prompt choice${peeking ? ' peeking' : ''}">
        <h2>${esc(sourceName)}</h2>
        ${note}
        <div class="choicebody">
          <div class="revealgrid">${grid}</div>
          <div class="row">${row}</div>
        </div>
      </div>`;
    }
    const zoneKind = ch.refs?.[0]?.kind;
    if (zoneKind === 'debt' || zoneKind === 'discard') {
      const owner = (ch.refs![0] as { player: PlayerIdx }).player;
      const cands = candidateKeys();
      const zone = zoneKind === 'debt' ? state.players[owner].debt : state.players[owner].discard;
      const cardsHtml = zone
        .map((id, index) =>
          renderCard(card(id), {
            classes: cands.has(refKey({ kind: zoneKind, player: owner, index }))
              ? ['targetable']
              : ['dimmed'],
            data: { act: zoneKind, player: owner, index, cardid: id },
          }),
        )
        .join('');
      return `<div class="prompt choice">
        <h2>${esc(sourceName)}</h2>
        <p>${esc(ch.prompt)} Legal picks are ringed.</p>
        <div class="debtpick">${cardsHtml || '<p>The pile is empty.</p>'}</div>
        <div class="row">${ch.optional ? btn('skip-choice', 'Skip') : ''}</div>
      </div>`;
    }
    // A board pick: the board itself is the picker, so a slim banner explains
    // the effect and an arrow runs from its source card to the cursor.
    const srcDef = tryCard(ch.source);
    const art = srcDef?.art
      ? `<span class="fxart">${artFit(srcDef)}</span>`
      : '';
    // A choice keeps its Skip when the effect offered one, and gains one when
    // there is nothing left to point at, which is the other case the rules let
    // you answer with no pick.
    const canSkip = ch.optional || !choiceHasTarget(state, ch);
    // Two copies of the same body ask the same question twice, in the same
    // words, one after the other. Without a count the second reads as the first
    // one refusing to go away.
    const waiting = state.choiceQueue.length;
    return `<div class="fxbanner">
      ${art}
      <span class="fxtext"><b>${esc(sourceName)}</b> ${esc(ch.prompt)} Click a ringed target.</span>
      ${waiting > 1 ? `<span class="fxmore">${waiting} to answer</span>` : ''}
      ${canSkip ? btn('skip-choice', 'Skip') : ''}
    </div>`;
  }

  if (ui.targeting) {
    const spec = ui.targeting.specs[ui.targeting.collected.length];
    // Debt and discard cards live in piles with no board presence, so the
    // prompt itself lays the pile out to pick from.
    let pile = '';
    if (spec?.kind === 'debt' || spec?.kind === 'discard') {
      const kind = spec.kind;
      // Enemy piles fan out in a party game; a name over each keeps them apart.
      const owners = spec.side === 'enemy' ? livingOpponents(state, me) : [me];
      const cands = candidateKeys();
      const cardsHtml = owners
        .map((owner) => {
          const zone = kind === 'debt' ? state.players[owner].debt : state.players[owner].discard;
          const cardsOf = zone
            .map((id, index) =>
              renderCard(card(id), {
                classes: cands.has(refKey({ kind, player: owner, index })) ? ['targetable'] : [],
                data: { act: kind, player: owner, index, cardid: id },
              }),
            )
            .join('');
          const label =
            owners.length > 1 ? `<p class="pileowner">${esc(state.players[owner].name)}</p>` : '';
          return label + cardsOf;
        })
        .join('');
      pile = `<div class="debtpick">${cardsHtml || '<p>The pile is empty.</p>'}</div>`;
    }
    return `<div class="prompt">
      <h2>${esc(ui.targeting.label)}</h2>
      <p>Choose ${esc(spec?.label ?? 'a target')}. Legal targets are ringed.</p>
      ${pile}
      <div class="row">${spec?.optional ? btn('skip-target', 'Skip') : ''}${btn('cancel', 'Cancel')}</div>
    </div>`;
  }

  if (!canAct()) return '';

  if (state.pending) {
    // A trap only offers itself when it answers this window and its cost,
    // spell tax included, is within reach.
    const live = (def: CardDef) => trapLive(state, me, def);
    const picked = ui.selection?.kind === 'hand' ? card(p.hand[ui.selection.index] ?? '') : null;
    const traps = liveTraps(state, me);
    const spring = picked && live(picked) ? btn('trap', `Spring ${picked.name}`, 'primary') : '';
    const attacker = state.pending.battle?.attacker;
    const rival = state.pending.spell
      ? state.pending.spell.caster
      : attacker && attacker.kind !== 'color'
        ? attacker.player
        : otherPlayer(me);
    const what = state.pending.spell
      ? `${esc(state.players[rival].name)} casts ${esc(card(state.pending.spell.cardId).name)}.`
      : `${esc(state.players[rival].name)} is attacking.`;
    return `<div class="prompt urgent">
      <h2>${state.pending.spell ? 'Spell cast' : 'Battle declared'}</h2>
      <p>${what} ${traps > 0 ? 'Click a trap in your hand to spring it, or let' : 'Let'} it through.</p>
      <div class="row">${spring}${btn('pass-response', 'Let it through', spring ? '' : 'primary')}</div>
    </div>`;
  }

  if (state.flipQueue.length > 0) {
    const offer = state.flipQueue[0];
    const def = card(offer.cardId);
    const cost = def.flipCost ?? {};
    const needsDiscard = !!cost.discard;
    const picked = ui.selection?.kind === 'hand' ? ui.selection.index : -1;
    // A cost the player has no way of covering, or a flip with nothing to work
    // on, never prompts; it is declined for them a beat after the card turns over.
    if (!flipWorthAsking(state, me)) return '';
    const affordable =
      (!cost.mana || canPay(p, cost.mana)) &&
      (!cost.mill || p.deck.length >= cost.mill) &&
      (!needsDiscard || picked >= 0);
    const priceParts: string[] = [];
    if (cost.mana) priceParts.push(pipHtml(cost.mana));
    if (cost.mill) priceParts.push(`mill ${cost.mill}`);
    if (needsDiscard) {
      priceParts.push(picked >= 0 ? `discard ${esc(card(p.hand[picked] ?? '').name)}` : 'discard a card');
    }
    return `<div class="prompt urgent flipprompt">
      <h2>${esc(def.name)} flipped</h2>
      ${renderCard(def, { classes: ['flipfocus'] })}
      <p>Cost: ${priceParts.join(', ')}${needsDiscard && picked < 0 ? '. Click one in your hand.' : ''}</p>
      <div class="row">
        ${affordable ? btn('pay-flip', 'Pay and trigger', 'primary') : ''}
        ${btn('decline-flip', 'Decline', affordable ? '' : 'primary')}
      </div>
    </div>`;
  }

  if (state.replaceQueue.length > 0) {
    const slot = state.replaceQueue[0].slot;
    const picked = ui.selection?.kind === 'hand' ? card(p.hand[ui.selection.index] ?? '') : null;
    const place =
      picked && picked.type === 'summon'
        ? btn(`summon:${slot}`, `Place ${picked.name}`, 'primary')
        : '';
    return `<div class="prompt urgent">
      <h2>Slot ${slot + 1} is empty</h2>
      <p>Play a summon into it, or leave it open.</p>
      <div class="row">${place}${btn('decline-replace', 'Leave it open')}</div>
    </div>`;
  }

  // What a selected card offers is a menu, and a menu is for a card you clicked
  // on. Mid-drag it is a panel sitting over the row you are dragging towards, so
  // it waits until the pointer is up.
  if (ui.drag) return '';

  if (ui.selection?.kind === 'hand') {
    const id = p.hand[ui.selection.index];
    if (!id) return '';
    const def = card(id);
    const buttons: string[] = [];
    if (p.supportersLeft > 0) {
      buttons.push(btn('supporter', `Face as supporter (${def.color})`));
    }
    if (def.type === 'summon') {
      p.slots.forEach((s, i) => {
        if (!s) buttons.push(btn(`summon:${i}`, `Summon to slot ${i + 1}`, 'primary'));
      });
    }
    if (def.type === 'spell') {
      buttons.push(
        !canPay(p, costFor(p, def))
          ? dead('Not enough mana')
          : !hasTargets(state, me, def)
            ? dead('No legal target')
            : btn('cast', 'Cast', 'primary'),
      );
    }
    if (def.type === 'stage') {
      buttons.push(
        canPay(p, costFor(p, def)) ? btn('stage', 'Set the field', 'primary') : dead('Not enough mana'),
      );
    }
    if (def.type === 'trap') {
      buttons.push(dead('Traps play only in a response window'));
    }
    return `<div class="prompt">
      <h2>${esc(def.name)}</h2>
      <p>${ruleText(def.text ?? def.flipText ?? '')}</p>
      <div class="row">${buttons.join('')}${btn('cancel', 'Cancel')}</div>
    </div>`;
  }

  const sel = ui.selection?.kind === 'summon' ? ui.selection : null;
  if (sel) {
    const s = findSummon(state, sel.ref);
    if (!s) return '';
    const def = card(s.cardId);
    const source = sel.ref as SourceRef;
    const buttons = powersOf(s, def).map((pw, i) => {
      const why = powerBlockers(state, me, source, i);
      const price = powerCostHtml(pw);
      return `<button data-act="btn" data-cmd="power:${i}" ${why ? `disabled title="${esc(why)}"` : ''}>${esc(pw.name)}${price ? ` ${price}` : ''}</button>`;
    });
    if (buttons.length === 0) return '';
    return `<div class="prompt">
      <h2>${esc(def.name)}</h2>
      <p>Drag it onto a ringed target to attack, or use a power.</p>
      <div class="row">${buttons.join('')}${btn('cancel', 'Cancel')}</div>
    </div>`;
  }

  return '';
}

function renderPrompt(): void {
  const el = document.getElementById('prompt');
  if (!el || !ui.state) return;
  el.innerHTML = promptHtml(ui.state);
}

// --- hand -------------------------------------------------------------------

/**
 * Whether a card in hand can be played for what it does, right now.
 *
 * Not whether it can be faced as a supporter: every card can do that, and a hand
 * that glows from end to end says nothing. This is the summon that has a slot
 * and the mana, and the spell that has the mana and something legal to hit.
 */
function playableNow(state: GameState, me: PlayerIdx, index: number): boolean {
  if (!canAct()) return false;
  const p = state.players[me];
  const id = p.hand[index];
  if (!id) return false;
  const def = card(id);
  // A response window is the one moment a trap can be sprung, and the only card
  // that can be played at all.
  if (state.pending) return trapLive(state, me, def);
  if (state.flipQueue.length > 0) return false;
  if (!canPay(p, costFor(p, def))) return false;
  if (def.type === 'summon') {
    if (state.replaceQueue.length > 0) return state.replaceQueue[0].player === me;
    return p.slots.some((slot) => !slot);
  }
  // A replacement is owed a body; nothing else may be played until it is paid.
  if (state.replaceQueue.length > 0) return false;
  if (def.type === 'stage') return true;
  if (def.type !== 'spell') return false;
  return hasTargets(state, me, def);
}

/** How long a card takes to slide from where it sat to where the new fan puts it. */
const FAN_SLIDE = 260;
/** How much a hand card grows under the pointer. Must match the hover rule. */
const HOVER_GROW = 1.45;
/** Air between the raised card and the next card's strip. */
const FAN_AIR = 4;
/** Cards stop shrinking before they stop being cards; the hover reads them. */
const MIN_HAND_CW = 74;

/** Hand cards paired with a key that survives a rebuild: card id and which copy. */
function fanSeats(rail: HTMLElement): [string, HTMLElement][] {
  const seen = new Map<string, number>();
  return [...rail.querySelectorAll<HTMLElement>('.card')].map((c) => {
    const id = c.dataset.cardid ?? '';
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return [`${id}#${n}`, c] as [string, HTMLElement];
  });
}

/**
 * The fan opens and closes rather than jumping.
 *
 * The hand is rebuilt from scratch on every render, so a card arriving or
 * leaving would move every other card in a single frame. Each card's place is
 * read before the rebuild and handed back to its replacement as an offset,
 * which is then transitioned away. Layout offsets rather than screen rects, so
 * the turn on each card, the lift under the pointer and the table's own scale
 * all stay out of it. The rail's own offset is part of the place: it is centred
 * under the lane, so a hand one card wider pushes every card in it sideways.
 */
function slideFan(rebuild: () => void): void {
  const railOf = () => document.querySelector<HTMLElement>('#hand .handrail');
  const was = new Map<string, number>();
  const before = railOf();
  if (before) {
    const base = before.offsetLeft;
    for (const [key, c] of fanSeats(before)) was.set(key, base + c.offsetLeft);
  }
  rebuild();
  const rail = railOf();
  if (!rail || was.size === 0) return;
  // Every offset is read before the first one is written, or each write would
  // force the layout that the next read waits on.
  const base = rail.offsetLeft;
  const moved = fanSeats(rail)
    .map(([key, c]) => [c, (was.get(key) ?? base + c.offsetLeft) - base - c.offsetLeft] as [HTMLElement, number])
    .filter(([, dx]) => Math.abs(dx) >= 1);
  if (moved.length === 0) return;
  for (const [c, dx] of moved) {
    c.style.setProperty('--fx', `${Math.round(dx)}px`);
    c.classList.add('sliding');
  }
  // A fresh element has no previous value to transition from, so the offset is
  // made its starting style here and taken away on the far side of the reflow.
  void rail.offsetWidth;
  for (const [c] of moved) c.style.removeProperty('--fx');
  window.setTimeout(() => {
    for (const [c] of moved) c.classList.remove('sliding');
  }, FAN_SLIDE);
}

function renderHand(): void {
  const state = ui.state;
  const el = document.getElementById('hand');
  if (!state || !el) return;
  const me = viewSeat();
  const p = state.players[me];
  const cands = candidateKeys();
  const edmg = effectDamageOf(state, me);

  const cards = p.hand
    .map((id, i) => {
      const def = card(id);
      const classes: string[] = [];
      if (ui.selection?.kind === 'hand' && ui.selection.index === i) classes.push('selected');
      // Mid-drag the card rides the cursor as a ghost, so its hand copy hides.
      if (ui.drag?.mode === 'play' && ui.drag.hand === i) classes.push('ghosted');
      if (cands.has(refKey({ kind: 'hand', player: me, index: i }))) classes.push('targetable');
      if (playableNow(state, me, i)) classes.push('playable');
      if (state.pending && !trapLive(state, me, def)) classes.push('dimmed');
      if (state.replaceQueue.length > 0 && def.type !== 'summon') classes.push('dimmed');
      if (state.flipQueue.length > 0 && !card(state.flipQueue[0].cardId).flipCost?.discard) {
        classes.push('dimmed');
      }
      return renderCard(def, {
        classes,
        data: { act: 'hand', index: i, cardid: id, flight: `hand:${i}` },
        vars: { i, n: p.hand.length },
        edmg,
      });
    })
    .join('');

  const n = p.hand.length;
  const k = stageScale();
  // Measured off a card already on screen, with any width this pass set last
  // time taken back off first, so what is measured is the size the card wants
  // rather than the answer to the last question. Reading --cw-hand instead gives
  // back the clamp() as written rather than what it resolved to.
  //
  // The layout width, not the rect: every card in the fan is turned a little, and
  // a turned card's rect is its corners, which reads a tenth wider than the card
  // and grows with the turn. The table's own scale is out of it for the same
  // reason, so nothing here needs dividing back.
  el.style.removeProperty('--cw-hand');
  el.style.removeProperty('--cwn-hand');
  const natural =
    document.querySelector<HTMLElement>('#hand .handrail .card')?.offsetWidth || 112;
  // The fan is centred on the lane, not on the window, so the room it has is
  // twice the shorter side of that centre rather than the whole width. Rects come
  // back in screen pixels and the answer is spent in the table's own.
  const shift = parseFloat(
    getComputedStyle(document.getElementById('app')!).getPropertyValue('--hand-shift'),
  ) || 0;
  const centre = window.innerWidth / 2 + shift * k;
  const room = Math.max(0, (2 * Math.min(centre, window.innerWidth - centre) - 16) / k);
  // The strip of itself each card keeps uncovered is the whole target you have
  // to hit, and the card you are pointing at rises and grows over its
  // neighbours. So a strip has to reach past half the raised card for the next
  // one along to still be reachable: any tighter and the fan skips a card.
  const reach = (w: number) => (w * (1 + HOVER_GROW)) / 4 + FAN_AIR;
  let cardW = natural;
  if (n > 1 && (room - cardW) / (n - 1) < reach(cardW)) {
    // Cards come down rather than stack into a wall: this is the width whose own
    // reach the room can just afford across a hand this long.
    const afford = (room - FAN_AIR * (n - 1)) / (1 + ((1 + HOVER_GROW) / 4) * (n - 1));
    cardW = Math.max(MIN_HAND_CW, Math.min(natural, afford));
    el.style.setProperty('--cw-hand', `${Math.round(cardW)}px`);
    el.style.setProperty('--cwn-hand', String(Math.round(cardW)));
  }
  // Width of the fan is cardW + (n - 1) * (cardW + overlap). The loosest spacing
  // that fits wins, never looser than seven tenths of a card and never tighter
  // than a fifth of one.
  const fitted = n > 1 ? (room - cardW) / (n - 1) - cardW : -cardW * 0.3;
  const overlap = Math.round(Math.max(-cardW * 0.82, Math.min(-cardW * 0.3, fitted)));
  const other = state.players[otherPlayer(me)];
  const peek = ui.revealAll
    ? `: ${esc(other.hand.map((h) => card(h).name).join(', ')) || 'nothing'}`
    : '';
  // No counts line: their hand is drawn across the top, the deck and discard
  // carry their own numbers, and debt has a meter of its own.
  slideFan(() => {
    el.innerHTML = `
    <div class="handrail" style="--overlap:${overlap}px">${cards || '<span class="empty">hand empty</span>'}</div>
    ${peek ? `<div class="handcount">${peek}</div>` : ''}`;
  });
}

// --- rail -------------------------------------------------------------------

/** The body the preview is looking at, when the hovered card is one in play. */
function inspectedSummon(state: GameState, id: string): SummonInstance | null {
  const ref = ui.inspectRef;
  if (!ref || (ref.kind !== 'summon' && ref.kind !== 'leader')) return null;
  const s = findSummon(state, ref);
  return s && s.cardId === id ? s : null;
}

/**
 * The cards currently working on a body, printed as portraits under the preview
 * so a green or red number always names its cause. Strength sources carry the
 * amount they are worth; a lent power or Deathrattle says what it lent.
 */
function buffSourcesHtml(state: GameState, s: SummonInstance): string {
  const chips: { cardId: string; tag: string; kind: string; what: string }[] = [];
  for (const src of strengthSourcesOf(state, s)) {
    chips.push({
      cardId: src.cardId,
      tag: `${src.amount > 0 ? '+' : '−'}${Math.abs(src.amount)}`,
      kind: src.amount > 0 ? 'up' : 'down',
      what: `${src.amount > 0 ? '+' : '−'}${Math.abs(src.amount)} attack`,
    });
  }
  if (s.bestowed) {
    chips.push({ cardId: s.bestowed, tag: '☠', kind: 'up', what: 'lends its Deathrattle' });
  }
  if (chips.length === 0) return '';
  const boxes = chips
    .map((c) => {
      const def = tryCard(c.cardId);
      return `<span class="bsrc ${c.kind}" title="${esc(def?.name ?? c.cardId)}: ${esc(c.what)}">
        <span class="bsrcart">${artFit(def)}</span>
        <span class="bsrctag">${c.tag}</span>
      </span>`;
    })
    .join('');
  return `<div class="bsrcrow">${boxes}</div>`;
}

function renderRail(): void {
  const state = ui.state;
  const el = document.getElementById('rail');
  if (!state || !el) return;

  const id = ui.inspect;
  const def = id ? tryCard(id) : null;
  // On a phone the rail is a sheet over the board rather than a column beside
  // it, so it only takes the screen while it has something to say.
  el.classList.toggle('open', !!def);
  if (!def) {
    el.innerHTML = `<div class="inspector"><span class="hint">Hover a card to read it here.</span></div>`;
    return;
  }
  // A body in play is previewed as it stands rather than as it was printed.
  const s = inspectedSummon(state, def.id);
  el.innerHTML = `<div class="inspector">
    ${renderCard(def, s ? { live: liveStats(state, s) } : {})}
    ${s ? buffSourcesHtml(state, s) : ''}
  </div>`;
}

// --- topbar -----------------------------------------------------------------

/**
 * The other player's hand, face down, across the top of the table.
 *
 * It is the only place their card count is legible at a glance, and giving the
 * cards real positions is what lets a play or a draw actually travel: before
 * this, a card the opponent drew flew to a guessed point in empty space.
 *
 * Everything that used to live up here went away. Debt is already printed beside
 * both players on the board, so the meters were saying it twice, and whose turn
 * it is is what the End Turn button says.
 */
/**
 * The width the table is drawn for. The board wants about 620px of lane, the
 * inspector rail takes 268, and the gutters either side account for the rest.
 */
const DESIGN_W = 1180;
/** Below this the table stops being a table and becomes a phone screen. */
const MOBILE_W = 760;

/**
 * Desktop shrinks, it does not reflow.
 *
 * Card sizes are set off viewport height, so narrowing the window took space
 * away without taking any size away, and the board grew into the rail. Rather
 * than rebuild every measurement against width, the whole table is drawn at its
 * design width and scaled to fit. Proportions hold exactly, everything just gets
 * smaller, which is what a card table should do.
 *
 * Below the mobile width, scaling stops and a different layout takes over: past
 * a point, smaller is not readable, and the answer is a different arrangement
 * rather than the same one further away.
 */
function syncLayout(): number {
  const app = document.getElementById('app');
  if (!app) return 1;
  const w = window.innerWidth;
  const mobile = w < MOBILE_W;
  document.body.classList.toggle('mobile', mobile);
  document.body.classList.toggle('desktop', !mobile);

  if (mobile || w >= DESIGN_W) {
    app.style.removeProperty('width');
    app.style.removeProperty('height');
    app.style.removeProperty('transform');
    app.style.removeProperty('transform-origin');
    return 1;
  }
  const scale = w / DESIGN_W;
  app.style.width = `${DESIGN_W}px`;
  // Undo the scale on the height so the table still fills the window vertically.
  // Floored: a fractional height rounds up into a two pixel scrollbar.
  app.style.height = `${Math.floor(window.innerHeight / scale)}px`;
  app.style.transformOrigin = 'top left';
  app.style.transform = `scale(${scale})`;
  return scale;
}

/**
 * Line both hands up with the slots they play into.
 *
 * The lane is not centred in the window, or even in the board: a debt gutter on
 * the left and the inspector rail on the right push it off by a few dozen
 * pixels, through a chain of grids and padding that is not worth reproducing in
 * arithmetic. So it is measured instead, and published as the offset from the
 * window's centre for the two fans to shift by.
 */
function syncHandAxis(): void {
  // The lane itself, not the column holding it: the two share a centre at full
  // width and stop sharing one as things tighten, and the lane is what the hands
  // are being lined up with.
  const lanes = document.querySelectorAll('.board .lane');
  const mid = lanes[lanes.length - 1] ?? document.querySelector('.board .midcol');
  const root = document.getElementById('app');
  if (!mid || !root) return;
  // A narrow board is clipped rather than laid out smaller, so the lane's centre
  // can sit past the edge of the window and shifting onto it takes the fans out
  // with it. They want the width far more than the alignment, so on a small
  // screen they keep the window's own centre and the lane goes unmatched.
  if (document.body.classList.contains('mobile')) {
    root.style.setProperty('--hand-shift', '0px');
    return;
  }
  const box = mid.getBoundingClientRect();
  const app = root.getBoundingClientRect();
  // Both read post-transform, so the difference is in screen pixels; the shift is
  // applied inside the scaled box and has to be expressed in its units.
  const scale = app.width / root.offsetWidth || 1;
  const shift = (box.left + box.width / 2 - (app.left + app.width / 2)) / scale;
  root.style.setProperty('--hand-shift', `${shift.toFixed(1)}px`);
}

/**
 * How much height the lane leaves the supporter well.
 *
 * The well grows with the viewport, but so does the lane above it, and the lane
 * is served first. On a short wide window the lane spends the whole budget and
 * the well asks for more than is left: its bottom edge ran past the board, which
 * crops, so the well under your own lane came out visibly shorter than the one
 * over theirs. The interpolation stays as the size the well wants; this measures
 * the ceiling it has to fit inside, and the smaller of the two wins.
 *
 * Layout heights rather than rects, so the desktop shrink stays out of it. Taken
 * across both sides, since the two wells have to match each other.
 */
function syncWell(): void {
  // Both of these are read where the card sizes are declared, which is :root, so
  // that is where they have to be written: a value set further down the tree
  // never reaches a var() resolved above it.
  const root = document.documentElement;
  // Measured against a lane drawn at the size it wants, not at a cap left over
  // from the last window size.
  root.style.removeProperty('--board-cap');
  root.style.removeProperty('--board-cap-n');
  const first = wellRoom();
  if (!first) return;
  let { room } = first;
  if (room < WELL_MIN) {
    // The lane is taking more than it can afford, and the cards are the only
    // part of it with any give: everything else in a unit is a fixed height. So
    // they come down by exactly what the well is short. Measured off a card that
    // is on screen rather than off --cw-board, because a custom property reads
    // back as the clamp() it was written as and not as the length it resolved to.
    const box = document.querySelector<HTMLElement>('.board .lane .card, .board .lane .slot-empty');
    // Reading a layout box flushes the style change above, so the measurement
    // is of the lane at full size rather than at whatever cap it just lost.
    const tall = box?.offsetHeight ?? 0;
    const wide = box?.offsetWidth ?? 0;
    const fits = tall - (WELL_MIN - room);
    if (tall > 0 && fits > 0) {
      root.style.setProperty('--board-cap', `${Math.floor((wide * fits) / tall)}px`);
      root.style.setProperty('--board-cap-n', String(Math.floor((wide * fits) / tall)));
      room = wellRoom()?.room ?? room;
    }
  }
  // The well is the card it holds plus its own padding.
  root.style.setProperty('--well-room', `${Math.max(0, Math.round(room - WELL_PAD))}px`);
  root.style.setProperty('--well-room-n', String(Math.max(0, Math.round(room - WELL_PAD))));
}

/** What the lane leaves the well on the tighter of the two sides. */
function wellRoom(): { room: number; sideH: number; laneH: number; gap: number } | null {
  let best: { room: number; sideH: number; laneH: number; gap: number } | null = null;
  for (const side of document.querySelectorAll<HTMLElement>('.board .side')) {
    const lane = side.querySelector<HTMLElement>('.lane');
    const mid = side.querySelector<HTMLElement>('.midcol');
    if (!lane || !mid) continue;
    const gap = parseFloat(getComputedStyle(mid).rowGap) || 0;
    const sideH = side.clientHeight;
    const laneH = lane.offsetHeight;
    const room = sideH - laneH - gap;
    if (!best || room < best.room) best = { room, sideH, laneH, gap };
  }
  return best;
}

/** The padding a well carries around the supporter lying in it. */
const WELL_PAD = 6;
/** The shortest a well is allowed to be: --sw's own floor plus that padding. */
const WELL_MIN = 44;

/**
 * Press and hold to magnify a card.
 *
 * On a phone the inspector panel is too small to be worth the room it costs, so
 * it is gone and this takes its place: hold a card and it fills the screen, with
 * a button to put it away. The same gesture a collection uses.
 *
 * Only on mobile. On a desktop the rail is beside the board already and holding
 * the mouse still is not something anyone does on purpose.
 */
const HOLD_MS = 420;
/** Sliding this far means the finger was going somewhere, not asking a question. */
const HOLD_SLOP = 10;
let holdTimer: number | null = null;
let holdFrom: { x: number; y: number } | null = null;

function cancelHold(): void {
  if (holdTimer !== null) window.clearTimeout(holdTimer);
  holdTimer = null;
  holdFrom = null;
}

function armHold(ev: PointerEvent): void {
  // The discard pile opens on desktop and mobile alike. Its contents are public
  // but only the top card is drawn, so a press is the only way to see the rest,
  // and nothing else responds to a press there.
  const pile = (ev.target as HTMLElement).closest<HTMLElement>('[data-discard]');
  if (pile) {
    const player = Number(pile.dataset.discard) as PlayerIdx;
    if (!ui.state?.players[player]?.discard.length) return;
    holdFrom = { x: ev.clientX, y: ev.clientY };
    holdTimer = window.setTimeout(() => {
      holdTimer = null;
      ui.discardView = player;
      suppressClick = true;
      cancelHold();
      render();
    }, HOLD_MS);
    return;
  }
  if (!document.body.classList.contains('mobile')) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-cardid]');
  const id = el?.dataset.cardid;
  if (!id || !tryCard(id)) return;
  holdFrom = { x: ev.clientX, y: ev.clientY };
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    ui.zoom = id;
    // The press has been spent on the zoom; whatever it would have done next
    // must not also happen.
    suppressClick = true;
    cancelHold();
    render();
  }, HOLD_MS);
}

function holdMoved(ev: PointerEvent): void {
  if (!holdFrom || holdTimer === null) return;
  if (Math.hypot(ev.clientX - holdFrom.x, ev.clientY - holdFrom.y) > HOLD_SLOP) cancelHold();
}

/** The magnified card, over everything, with one way out and three ways to take it. */
function zoomHtml(): string {
  const def = ui.zoom ? tryCard(ui.zoom) : null;
  if (!def) return '';
  return `<div class="promptlayer zoomlayer" data-act="btn" data-cmd="zoom:">
    <div class="prompt cardzoom">
      ${renderCard(def)}
      <div class="row"><button data-act="btn" data-cmd="zoom:">Close</button></div>
    </div>
  </div>`;
}

/**
 * Lists every card in one discard pile, in the order it was discarded. Both
 * discard piles are public, so either player's pile can be opened.
 */
function discardHtml(): string {
  const state = ui.state;
  const player = ui.discardView;
  if (!state || player === null) return '';
  const pile = state.players[player].discard;
  const name = state.players[player].name;
  return `<div class="promptlayer discardlayer" data-act="btn" data-cmd="discard:">
    <div class="prompt choice discardview">
      <h2>${esc(name)}'s discard</h2>
      <p>${pile.length} card${pile.length === 1 ? '' : 's'}, oldest first.</p>
      <div class="revealgrid">${pile.map((id) => renderCard(card(id))).join('')}</div>
      <div class="row"><button data-act="btn" data-cmd="discard:">Close</button></div>
    </div>
  </div>`;
}

function renderDiscard(): void {
  let host = document.getElementById('discardview');
  if (ui.discardView === null) {
    host?.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'discardview';
    // On the body for the same reason the zoom overlay is. A transformed
    // ancestor turns position:fixed into position:absolute.
    document.body.appendChild(host);
    host.addEventListener('click', (ev) => {
      const hit = (ev.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
      if (!hit || !hit.dataset.cmd?.startsWith('discard:')) return;
      ui.discardView = null;
      render();
    });
  }
  host.innerHTML = discardHtml();
}

/**
 * Pull either fan in if it ended up wider than the room it has.
 *
 * The overlap is worked out before layout, from a card width and a centre that
 * are both predictions. Predictions drift, so this measures what was actually
 * drawn and corrects it, which is shorter than making the prediction perfect and
 * survives whatever changes next.
 *
 * The player's hand is bounded by the window; the other player's is bounded by
 * the buttons beside it, which are the only thing up there it can collide with.
 */
function fitFans(): void {
  const gap = 14;
  // Rects come back in screen pixels and the answers are written back into the
  // table's own, which a narrow desktop draws smaller than it lays out. Every
  // measurement below is divided back before it is spent.
  const k = stageScale();

  const rail = document.querySelector<HTMLElement>('#hand .handrail');
  const hand = rail ? [...rail.querySelectorAll<HTMLElement>('.card')] : [];
  if (rail && hand.length > 1) {
    const first = hand[0].getBoundingClientRect();
    const last = hand[hand.length - 1].getBoundingClientRect();
    const centre = (first.left + last.right) / 2;
    const room = 2 * Math.min(centre, window.innerWidth - centre) - gap;
    if (last.right - first.left > room) {
      // The layout width for the arithmetic, the rect only for what the fan
      // takes up: a turned card's rect is its corners, so the fan bleeds past
      // its end cards, and that bleed is room the pitch cannot spend. Mixing the
      // two takes the bleed off every card instead of off the two ends, which
      // crushes a long hand to a fifth of the strip it should have.
      const cardW = hand[0].offsetWidth;
      const bleed = first.width / k - cardW;
      // Floored at the pitch the first pass already calls the tightest the fan
      // may be. Without it a hand wider than its room drives the step negative
      // and lays the cards out right to left, back over themselves.
      const step = Math.max(cardW * 0.18, (room / k - cardW - bleed) / (hand.length - 1));
      rail.style.setProperty('--overlap', `${Math.round(step - cardW)}px`);
    }
  }

  const fan = document.querySelector<HTMLElement>('#topbar .ehfan');
  const cards = fan ? [...fan.querySelectorAll<HTMLElement>('.ehcard')] : [];
  const tools = document.querySelector('#topbar .topright');
  if (fan && cards.length > 1 && tools) {
    const first = cards[0].getBoundingClientRect();
    const last = cards[cards.length - 1].getBoundingClientRect();
    const limit = tools.getBoundingClientRect().left - gap;
    if (last.right > limit) {
      const centre = (first.left + last.right) / 2;
      const room = (2 * Math.min(centre, limit - centre)) / k;
      // The width the card is drawn at, not the width it measures: these cards
      // are turned, so their rects are wider than the cards inside them.
      const cardW = ehCardWidth();
      const step = Math.max(8, (room - cardW) / (cards.length - 1));
      fan.style.width = `${Math.round(cardW + (cards.length - 1) * step)}px`;
      // Only the spacing moves; the turn and the dip stay as they were.
      cards.forEach((c, i) => c.style.setProperty('--x', `${(i * step).toFixed(1)}px`));
    }
  }
}

/**
 * How far apart the cards in an HP fan may sit.
 *
 * The budget used to be a flat 92 pixels, which is right for a full-size board
 * and far too wide once a unit is 94 pixels across: a leader's six cards spread
 * to 118 and ran into the body beside it. Measured off what a unit and an HP
 * card actually came out as, so it tightens with everything else.
 */
function hpStep(n: number): number {
  if (n <= 1) return 0;
  // Measured on screen, spent in the table's own units; the fallbacks are design
  // sizes and are already in them.
  const k = stageScale();
  const unitRect = document.querySelector('.board .lane .unit')?.getBoundingClientRect().width;
  const miniRect = document.querySelector('.board .hpmini')?.getBoundingClientRect().width;
  const unit = unitRect ? unitRect / k : 112;
  const mini = miniRect ? miniRect / k : 38;
  const budget = Math.max(24, unit - mini - 4);
  return Math.max(4, Math.min(16, Math.floor(budget / (n - 1))));
}

function renderZoom(): void {
  let host = document.getElementById('zoom');
  if (!ui.zoom) {
    host?.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'zoom';
    // On the body rather than inside #app, because the shell carries a transform
    // when the table is scaled and a transformed ancestor makes position:fixed
    // behave like position:absolute. That also puts it outside the delegated
    // click handler, so it listens for itself.
    document.body.appendChild(host);
    host.addEventListener('click', (ev) => {
      const hit = (ev.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
      // The backdrop carries the same command, so clicking away closes it too.
      if (!hit || !hit.dataset.cmd?.startsWith('zoom:')) return;
      ui.zoom = null;
      render();
    });
  }
  host.innerHTML = zoomHtml();
}

/**
 * The width the bar draws a held card at.
 *
 * The fan is placed card by card in script, so the geometry has to know how wide
 * a card really is. A phone brings --ehcard-w down and assuming the desktop size
 * spaced the cards for a card that was not on screen: the hand stopped
 * overlapping and read as a row rather than a held fan.
 */
function ehCardWidth(): number {
  return parseFloat(getComputedStyle(document.body).getPropertyValue('--ehcard-w')) || 66;
}

/**
 * One opponent's held fan, pivoting from a grip above the screen. `shrink`
 * scales the cards down when several opponents share the bar.
 *
 * Every card is placed by hand rather than left to margins, because a card
 * turned about a point overhead also slides sideways, outward at the ends and
 * not at all in the middle. Left to itself that eats the spacing and the fan
 * bunches in the centre, so the slide is measured and subtracted back out.
 */
function enemyHandHtml(state: GameState, them: PlayerIdx, shrink: number, solo: boolean): string {
  const other = state.players[them];
  const n = other.hand.length;
  const CARD_W = ehCardWidth() * shrink;
  const CARD_H = CARD_W * 1.4;
  /** Where the grip sits above the card's own centre, matching transform-origin. */
  const PIVOT = CARD_H * 1.05;

  // Opened up by how many cards there are. At full spread a two card hand turns
  // its pair a full eleven degrees each, and since a turn about an overhead pivot
  // also slides the card outward, the two end up further apart than their own
  // width: a fan of two that is not a fan and not even touching.
  const widest = n > 9 ? 4.5 : n > 6 ? 6 : n > 3 ? 8 : 11;
  const spread = widest * Math.min(1, (n - 1) / 4);
  // A share of a card rather than a pixel count, so the spacing comes down with
  // the card on a phone. The three shares are the 20, 26 and 36 pixel steps this
  // was tuned at, over the 66 pixel card they were tuned against.
  const step = CARD_W * (n > 9 ? 0.303 : n > 6 ? 0.394 : 0.545);
  const fanW = n === 0 ? 0 : CARD_W + (n - 1) * step;
  // What the fan measures at its widest. The name is placed off this rather than
  // off the fan it happens to be beside, so it stays put as cards come and go
  // instead of sliding along with every draw and play.
  const widestStep = CARD_W * 0.303;
  const fanWMax = CARD_W + (HAND_LIMIT - 1) * widestStep;

  const backs = other.hand
    .map((id, i) => {
      // -1 at the left edge of the fan, 0 in the middle, 1 at the right.
      const t = n === 1 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);
      // Negative on the left: about a pivot overhead a positive turn swings the
      // bottom of the card left, the opposite of a hand gripped from below.
      const rot = -t * spread;
      const rad = (rot * Math.PI) / 180;
      // The sideways slide the turn causes, taken back off the placement so the
      // cards stay evenly spaced however far the fan is opened.
      const x = i * step - PIVOT * Math.sin(rad);
      // The swing dips barely two pixels on its own, so the depth of the arc is
      // set here. Quadratic: deepest in the middle, flattening at the ends.
      const dip = (1 - t * t) * Math.min(14, 4 + n * 1.2);
      const face = ui.revealAll
        ? `<span class="ehface">${artFit(tryCard(id))}</span>`
        : '';
      return `<span class="ehcard" data-ehand="${i}"
        style="--x:${x.toFixed(1)}px;--rot:${rot.toFixed(2)}deg;--dip:${dip.toFixed(1)}px;--z:${i}">${face}</span>`;
    })
    .join('');

  const active = state.active === them && !isOver(state);
  const cls = solo
    ? 'enemyhand'
    : `enemyhand seatfan${active ? ' ehactive' : ''}${other.eliminated ? ' ehout' : ''}`;
  const sizing = solo ? '' : `;--ehcard-w:${CARD_W.toFixed(1)}px`;
  return `<div class="${cls}" style="--fanw:${fanW}px;--fanw-max:${fanWMax}px${sizing}">
      <span class="ehwho"><span class="ehname">${esc(other.name)}</span><span class="ehcount">${
        other.eliminated ? 'out' : n
      }</span></span>
      <span class="ehfan">${backs || '<span class="ehempty">no cards</span>'}</span>
    </div>`;
}

function renderTopbar(): void {
  const state = ui.state;
  const el = document.getElementById('topbar');
  if (!state || !el) return;
  const me = viewSeat();
  const opps: PlayerIdx[] = [];
  for (let step = 1; step < state.players.length; step++) {
    opps.push(((me + step) % state.players.length) as PlayerIdx);
  }
  const solo = opps.length === 1;
  const shrink = solo ? 1 : opps.length === 2 ? 0.8 : 0.66;
  const fans = opps.map((p) => enemyHandHtml(state, p, shrink, solo)).join('');

  // Party bars carry several fans, so the mixer, theme toggle and the reveal
  // checkbox make way; volume and theme are still on the menu screens, and
  // online hands arrive hidden whatever the checkbox says.
  el.innerHTML = `
    ${solo ? fans : `<div class="ehrow">${fans}</div>`}
    <span class="topright">
      ${solo ? mixerHtml() : ''}
      ${
        solo && ui.botSeat === null
          ? `<label><input type="checkbox" data-act="reveal" ${ui.revealAll ? 'checked' : ''}> reveal hands</label>`
          : ''
      }
      ${!isOver(state) ? '<button class="danger" data-act="btn" data-cmd="concede">Concede</button>' : ''}
    </span>`;
}

/**
 * Danger is your own leader down to its last two cards, or your debt close
 * enough to the limit that one bad turn ends it. Off the table, or once the
 * match is settled, it is over and the music says so.
 */
function moodNow(): Mood {
  const state = ui.state;
  if (ui.screen !== 'game' || !state || isOver(state)) return 'normal';
  const p = state.players[viewSeat()];
  const onTheRopes = !!p.leader && remainingHp(p.leader) <= LAST_BREATH_HP;
  return onTheRopes || p.debtCount > DANGER_DEBT ? 'danger' : 'normal';
}

/** A leader at or under this is on its last legs: red ring, danger music. */
const LAST_BREATH_HP = 5;
/** Debt past this is close enough to the limit to count as trouble. */
const DANGER_DEBT = 20;

/** The two levels as sliders, for wherever there is room to put them. */
function mixerHtml(): string {
  const at = levels();
  const row = (bus: 'music' | 'sfx', label: string) =>
    `<label class="vol"><span>${label}</span><input type="range" min="0" max="100" step="1"
      value="${Math.round(at[bus] * 100)}" data-act="vol" data-bus="${bus}" aria-label="${label} volume"></label>`;
  return `<span class="mixer">${row('music', 'Music')}${row('sfx', 'Sound')}${themeHtml()}</span>`;
}

/** Light or dark ground, named outright rather than left to a glyph to imply. */
function themeHtml(): string {
  const now = currentTheme();
  const one = (t: Theme, label: string) =>
    `<button data-act="theme" data-cmd="${t}" class="${now === t ? 'on' : ''}"
      aria-pressed="${now === t}">${label}</button>`;
  return `<span class="themeset" role="group" aria-label="Colour scheme">${one('dark', 'Dark')}${one('light', 'Light')}</span>`;
}

// --- attack and effect arrows ------------------------------------------------

/** Last pointer position in stage coordinates, for the effect-target arrow. */
let pointerAt: { x: number; y: number } | null = null;

/** Whether a board choice is waiting on the viewer, so an arrow should track the cursor. */
function boardChoiceActive(): boolean {
  const ch = ui.state?.choiceQueue[0];
  if (!ch || !ch.refs || !canAct()) return false;
  const kind = ch.refs[0]?.kind;
  return kind !== 'debt' && kind !== 'discard';
}

/** Whether a spell in hand is waiting on the viewer to point at something. */
function aimActive(): boolean {
  return ui.targeting?.hand !== undefined && canAct();
}

/**
 * Where a casting arrow springs from: the card in hand being cast. Its top edge
 * rather than its middle, because the hand sits over the arrow layer and would
 * swallow a tail drawn from inside the card.
 */
function aimArrowFrom(): { x: number; y: number } | null {
  const index = ui.targeting?.hand;
  if (index === undefined) return null;
  const el = document.querySelector(`#hand .handrail .card[data-index="${index}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return toStage(r.left + r.width / 2, r.top + 6);
}

/** Where the effect-target arrow springs from: the flip or power's source card. */
function choiceArrowFrom(): { x: number; y: number } | null {
  const ch = ui.state?.choiceQueue[0];
  if (!ch) return null;
  let el: Element | null = null;
  if (ch.at && (ch.at.kind === 'summon' || ch.at.kind === 'leader')) el = boardElFor(ch.at, true);
  // The flipped HP mini and the summon both carry the card id.
  el ??= document.querySelector(`.board [data-cardid="${ch.source}"]`);
  return el ? centerOf(el) : null;
}

function arrowSvg(
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Bow the curve sideways so it reads as a lunge rather than a ruler line.
  const bow = Math.min(90, dist * 0.28);
  const cx = (from.x + to.x) / 2 + (dy / dist) * bow;
  const cy = (from.y + to.y) / 2 - (dx / dist) * bow;
  // Tangent at the end of a quadratic curve points away from its control point.
  const angle = (Math.atan2(to.y - cy, to.x - cx) * 180) / Math.PI;
  return `
    <path d="M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}"
      fill="none" stroke="#04091f" stroke-width="13" stroke-linecap="round" opacity="0.35"/>
    <path d="M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}"
      fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
    <g transform="translate(${to.x} ${to.y}) rotate(${angle})">
      <polygon points="26,0 -10,15 -3,0 -10,-15" fill="${color}" stroke="#04091f" stroke-width="3"
        stroke-linejoin="round"/>
    </g>
    <circle cx="${from.x}" cy="${from.y}" r="9" fill="${color}" stroke="#04091f" stroke-width="3"/>`;
}

/**
 * The spell that a response window is waiting on, displayed over the table until
 * the window closes. The prompt names the spell in text, which is not enough to
 * decide against, so the card itself stays on screen.
 */
let lastDeclareHtml = '';

function renderDeclaration(): void {
  const el = document.getElementById('declare');
  if (!el) return;
  const spell = ui.state?.pending?.spell;
  const html = spell ? renderCard(card(spell.cardId), { classes: ['declcard'] }) : '';
  // Rewriting it on every render would restart the fade-in animation.
  if (html === lastDeclareHtml) return;
  lastDeclareHtml = html;
  // The opponent's card is still animating toward this position, so delay the
  // fade-in to avoid revealing the spell before the animation arrives.
  el.style.setProperty('--declwait', handPlayFx ? `${DRAW_FLIGHT}ms` : '0ms');
  el.innerHTML = html;
}

/** Returns the element an arrow should point at, or null for an off-board ref. */
function declEl(ref: TargetRef): HTMLElement | null {
  if (ref.kind === 'supporter') {
    return document.querySelector<HTMLElement>(
      `.board [data-act="support"][data-player="${ref.player}"][data-index="${ref.index}"]`,
    );
  }
  return boardElFor(ref, true);
}

/**
 * Tilts the attacker toward its target and holds that position until the
 * response window closes. The offset stops well short of the target, because
 * the attack has not resolved yet and an overlap would suggest that it had.
 */
function syncLunge(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.board .card.lunging')) {
    el.classList.remove('lunging');
    el.style.transform = '';
  }
  const battle = ui.state?.pending?.battle;
  if (!battle) return;
  const atk = boardElFor(battle.attacker, true);
  const def = boardElFor(battle.defender, true);
  if (!atk || !def) return;
  const a = atk.getBoundingClientRect();
  const d = def.getBoundingClientRect();
  const dx = d.left + d.width / 2 - (a.left + a.width / 2);
  const dy = d.top + d.height / 2 - (a.top + a.height / 2);
  // The same angle playSmack uses, at 22% of its distance. Sapped summons carry
  // a 7 degree tilt from CSS that this inline transform would otherwise drop.
  const lean = Math.max(-10, Math.min(10, dx * 0.04)) + (atk.classList.contains('sapped') ? 7 : 0);
  atk.style.transform = `translate(${dx * 0.22}px, ${dy * 0.22}px) rotate(${lean}deg) scale(1.05)`;
  atk.classList.add('lunging');
}

/**
 * Draws an arrow from an attacker to its target, or from a displayed spell to
 * each of its targets. These stay up for the whole response window so a player
 * choosing a trap can see what they would be answering.
 */
function declarationArrows(): string {
  const pending = ui.state?.pending;
  if (!pending) return '';
  const at = (ref: TargetRef) => {
    const el = declEl(ref);
    return el ? centerOf(el) : null;
  };
  if (pending.battle) {
    const from = at(pending.battle.attacker);
    const to = at(pending.battle.defender);
    return from && to ? arrowSvg(from, to, '#f84c48') : '';
  }
  if (!pending.spell) return '';
  const held = document.querySelector('#declare .declcard');
  const from = held ? centerOf(held) : null;
  if (!from) return '';
  return pending.spell.targets
    .map(at)
    .filter((to): to is { x: number; y: number } => to !== null)
    .map((to) => arrowSvg(from, to, '#d8a800'))
    .join('');
}

function renderArrow(): void {
  const svg = document.getElementById('arrows');
  if (!svg) return;
  // Drawn first so a drag or aim arrow adds to it instead of replacing it.
  let html = declarationArrows();
  const d = ui.drag;
  if (d && d.mode === 'attack') {
    // The arrow runs hot red once it is over a legal target.
    html += arrowSvg(d.from, d.to, d.over ? '#f84c48' : '#00d3e3');
  } else if (!d && pointerAt) {
    // Play drags carry the card itself under the cursor; no arrow for those.
    const from = aimActive() ? aimArrowFrom() : boardChoiceActive() ? choiceArrowFrom() : null;
    if (from) html += arrowSvg(from, pointerAt, '#d8a800');
  }
  if (html || svg.innerHTML) svg.innerHTML = html;
}

// --- render -----------------------------------------------------------------

function mountGame(): void {
  root.innerHTML = `
    <header class="topbar" id="topbar"></header>
    <main class="stage">
      <section class="board" id="board"></section>
      <!-- Outside the board on purpose: the board clips its overflow, and a
           hover card that is centred on a tile near either end reaches past it. -->
      <div class="history" id="history"></div>
      <aside class="rail" id="rail"></aside>
      <!-- Under the arrows: a spell held here is what they are drawn from. -->
      <div class="declare" id="declare"></div>
      <svg class="arrows" id="arrows"></svg>
      <div class="promptlayer" id="prompt"></div>
    </main>
    <footer class="hand" id="hand"></footer>`;
  lastBoardHtml = '';
  lastDeclareHtml = '';
  lastHistoryHtml = '';
  lastActiveSlid = null;
}

/**
 * The open dropdown's list. Hovering a card repaints the screen, and a repaint
 * rebuilds the list, so a mouse resting over one while the wheel turns would
 * otherwise send it back to the top on every notch.
 */
const OPEN_DDLIST = '.dropdown.open .ddlist';

/** Rebuilding a screen's HTML resets its scroll, so carry the positions over. */
function keepScroll(selectors: string[], rebuild: () => void): void {
  const kept = selectors.map((sel) => ({
    sel,
    top: document.querySelector(sel)?.scrollTop ?? 0,
  }));
  rebuild();
  for (const { sel, top } of kept) {
    const el = document.querySelector(sel);
    if (el && top) el.scrollTop = top;
  }
}

/** The screen the last paint drew, so a change of screen can be noticed. */
let lastScreen: (typeof ui)['screen'] | '' = '';

function render(): void {
  // The drag can end down any number of paths, and all of them repaint. One
  // check here beats a stopHold() beside every one of them.
  if (!ui.drag) stopHold();
  watchError();
  if (ui.screen !== lastScreen) {
    lastScreen = ui.screen;
    // Text selected on the rules page outlives the page it was selected on, and
    // collapses into a caret blinking in whatever gets built in its place.
    window.getSelection()?.removeAllRanges();
  }
  // The stray blinking caret: a click on static text leaves a collapsed
  // selection behind, and every innerHTML rebuild re-lands it somewhere new,
  // where it is painted as a caret blinking in the middle of nothing. Collapsed
  // means nothing is highlighted, so there is nothing to preserve and it is
  // swept every paint. A real highlight is left alone, and so is a field being
  // typed in, whose caret lives inside the input rather than in this selection.
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  const stray = window.getSelection();
  if (!typing && stray && stray.isCollapsed && stray.rangeCount > 0) {
    stray.removeAllRanges();
  }
  // Every screen, not just the table: the setup list has to fit too.
  syncLayout();
  document.body.classList.toggle('party', !!ui.state && isParty(ui.state));
  // The board is rebuilt from scratch on every action, and a fresh element
  // starts its animation over. Handing the marks the time as a negative delay
  // drops each one back into the phase it was already in.
  document.documentElement.style.setProperty('--fxnow', `-${Math.round(performance.now())}ms`);
  setMood(moodNow());
  if (ui.screen === 'rules') {
    root.innerHTML = renderRules();
    return;
  }
  if (ui.screen === 'online') {
    keepScroll([OPEN_DDLIST], () => {
      root.innerHTML = renderOnline();
      syncDropdowns();
    });
    return;
  }
  const onSetup = ui.screen === 'setup' || !ui.state;
  showGuy(onSetup && ui.screen !== 'build');
  if (ui.screen === 'build') {
    // syncDropdowns runs inside the rebuild, not after it: it is what puts the
    // open class back, and without it the list cannot be found to restore.
    keepScroll(['.bookscroll', '.deckscroll', OPEN_DDLIST], () => {
      root.innerHTML = renderBuilder();
      syncDropdowns();
    });
    return;
  }
  if (onSetup) {
    keepScroll(['.setup'], () => {
      root.innerHTML = renderSetup();
    });
    return;
  }
  if (!document.getElementById('board')) mountGame();
  // Attack drags carry no ghost, so the hover freeze is kept in step here too.
  document.body.classList.toggle('dragging', !!ui.drag || ghost !== null);
  renderTopbar();
  renderBoard();
  renderHistory();
  // The well is sized off what the lane left it, so the board has to exist first.
  syncWell();
  // Between the board and the hands: the lane has to exist to be measured,
  // and both fans need the answer before they lay themselves out.
  syncHandAxis();
  renderHand();
  renderRail();
  renderPrompt();
  syncFlight();
  renderZoom();
  renderDiscard();
  fitFans();
  // These three measure board elements, so they run after fitFans. The hand
  // fans set their own size there, the rows above them take the remaining
  // height, and measuring earlier returns positions that are about to change.
  renderDeclaration();
  syncLunge();
  renderArrow();
  maybeAutoChoice();
  maybeAutoPass();
  maybeAutoDecline();
}

// --- setup ------------------------------------------------------------------

function deckCardHtml(d: StarterDeck): string {
  const identity = deckIdentity(d.leaderId);
  const leader = card(d.leaderId);
  const pips = identity.map((c) => pipRun(c, 1)).join('');
  const p0 = ui.picks[0] === d.key;
  const p1 = ui.picks[1] === d.key;
  const left = ui.setupMode === 'ai' ? 'You' : 'Player 1';
  const right = ui.setupMode === 'ai' ? 'Bot' : 'Player 2';
  return `<div class="deckcard ${p0 ? 'p0' : ''} ${p1 ? 'p1' : ''}">
    <div>
      <strong>${esc(d.name)}</strong> <span class="manapool">${pips}</span>
      <div class="blurb">${esc(d.blurb)}</div>
      <div class="blurb">${d.cards.length} cards · leader ${esc(leader.name)} (${esc(RARITY_NAME[leader.rarity ?? 'C'])})</div>
    </div>
    <div class="picks">
      <button data-act="btn" data-cmd="pick0:${d.key}" ${p0 ? 'disabled' : ''}>${left}</button>
      <button data-act="btn" data-cmd="pick1:${d.key}" ${p1 ? 'disabled' : ''}>${right}</button>
    </div>
  </div>`;
}

/**
 * The comprehensive rules, numbered so a card's text can cite a clause. Every
 * number here is interpolated from the constant the engine actually uses, so a
 * rules change cannot leave this page quietly wrong.
 */
function renderRules(): string {
  const sec = (n: string, body: string) => `<p class="rule"><b>${n}</b>${body}</p>`;
  return `<div class="setup rulesview"><div class="inner">
    <header class="platebar"><img class="sigil" src="${BASE}favicon.png" alt="" width="63" height="44"><h1>Rules</h1></header>
    <button class="modetile back" data-act="btn" data-cmd="to-setup">Back to menu</button>

    <h2>Summary</h2>
    <p class="lede">Place one card a turn face down as a supporter. Its color pays for
      Powers, spells, and traps. Summons are free and have HP, attack, level, and Powers.
      Cards drawn from your deck stand as their HP. When a summon dies, it goes to your debt
      zone and adds its level to your debt. Reach ${DEBT_LIMIT} debt and you lose. Destroy the
      enemy leader to win. A leader can be chosen from any summon and a deck may only use its
      leader's colors for its cards. Two to four players can play. A game of three or four
      is a party game. A defeated player is eliminated and the last player standing wins.</p>

    <h2>1. The Game</h2>
    ${sec('1-1.', `Ernum Rites is a game for two to four players. Each player brings one leader and one deck of ${DECK_SIZE} cards. A game of three or four players is a party game and follows section 2-3.`)}
    ${sec('1-1-1.', `A deck may hold at most ${COPY_LIMIT} copies of any one card.`)}
    ${sec('1-1-2.', 'A card is legal in a deck only if every color on it appears on the leader. A Neutral card has no color and is legal in any deck.')}
    ${sec('1-2.', 'Players take turns. Two players alternate. A party game passes the turn around the table in seat order.')}
    ${sec('1-2-1.', 'No player may attack during their own first turn.')}
    ${sec('1-2-2.', 'The player who takes the first turn does not draw on that turn.')}
    ${sec('1-3.', 'A character is a summon or a leader. Anything that affects a character affects both kinds unless it says otherwise.')}
    ${sec('1-4.', 'Card text overrides these rules. Where a card and a rule disagree, follow the card. A rule here applies only when no card says otherwise.')}
    ${sec('1-4-1.', 'Where one effect allows something and another forbids it, the effect that forbids wins, whichever arrived first. &ldquo;The enemy cannot play supporters&rdquo; stops &ldquo;You may play another supporter this turn&rdquo;, and the permission does nothing.')}

    <h2>2. Winning and Losing</h2>
    ${sec('2-1.', 'The game ends when a player is defeated. The other player wins.')}
    ${sec('2-1-1.', 'Two things defeat you.')}
    ${sec('2-1-1-1.', `Your debt reaches ${DEBT_LIMIT} or more, or ${PARTY_DEBT_LIMIT} or more in a party game.`)}
    ${sec('2-1-1-2.', 'Your leader dies.')}
    ${sec('2-2.', 'Both players can be defeated at once. The attacking player wins if both leaders are still in play. The game is a draw otherwise.')}
    ${sec('2-3.', 'A party game seats three or four players. Every rule applies with the changes below.')}
    ${sec('2-3-1.', `Everyone opens with ${PARTY_HAND_BONUS} extra cards, and the debt limit is ${PARTY_DEBT_LIMIT}.`)}
    ${sec('2-3-2.', 'A defeated player is eliminated rather than ending the game. Their cards leave the board for their discard pile and their turns are skipped. The last player standing wins.')}
    ${sec('2-3-3.', 'A card that names &ldquo;the enemy&rdquo; means one enemy of your choice, picked by clicking their leader. Anything that affects every enemy or every character still affects them all, and anything aimed at a target can aim at any enemy.')}
    ${sec('2-3-4.', 'An attack offers its response window to the player being attacked. A spell offers a window to each enemy holding a Spell Trap, one at a time in turn order. The first trap sprung answers the spell, and nobody after that is asked.')}
    ${sec('2-3-5.', 'A player who leaves a running party game concedes. They are eliminated and the game goes on without them.')}

    <h2>3. Debt</h2>
    ${sec('3-1.', 'Debt only rises. It never falls unless a card says it does.')}
    ${sec('3-1-1.', 'A summon of yours that dies goes to your debt zone. You take debt equal to its level.')}
    ${sec('3-1-2.', 'A Deathrattle is text that fires as its summon dies. It resolves before the debt is paid, so it can still change what that death costs. A summon fires its own Deathrattle before any Deathrattle another card gave it.')}
    ${sec('3-1-3.', 'An annihilated summon reaches no zone. It charges no debt and its Deathrattle does not fire, and nothing can raise it or recycle it. Other cards still see that it died.')}
    ${sec('3-1-4.', 'An eaten summon goes under the eating summon as an HP card. It charges no debt.')}
    ${sec('3-2.', `Drawing from an empty deck costs you ${RESHUFFLE_DEBT} debt. Your discard pile is then shuffled to become your new deck.`)}
    ${sec('3-2-1.', `Each later time you do this in the same game costs ${RESHUFFLE_DEBT_STEP} more than the time before.`)}
    ${sec('3-2-2.', 'You pay that debt even with no discard pile to shuffle. In that case you draw nothing.')}
    ${sec('3-3.', `Milling from an empty deck costs ${MILL_DEBT} debt for each card you cannot mill.`)}

    <h2>4. The Leader</h2>
    ${sec('4-1.', 'Your leader enters play on its own at the start of your first turn. You cannot play it from your hand, replace it, or return it to your hand.')}
    ${sec('4-1-1.', 'A leader enters with double its printed HP plus two.')}
    ${sec('4-1-2.', 'A leader fires its Battlecry when it enters.')}
    ${sec('4-2.', 'A leader attacks and uses Powers like any summon. It can be attacked too.')}
    ${sec('4-2-1.', 'You may attack a leader only while its own slots are empty. A card may override this.')}
    ${sec('4-2-2.', 'A defending leader deals no damage. An attacker takes nothing back from it.')}
    ${sec('4-3.', 'A leader never reaches the debt zone. Its controller loses instead.')}

    <h2>5. Zones</h2>
    ${sec('5-1.', `Each player has a hand, a deck, a discard pile, and a debt zone. On the board each player has ${SUMMON_SLOTS} summon slots, a supporter row, and a field.`)}
    ${sec('5-2.', `Your hand holds at most ${HAND_LIMIT} cards. Anything past that goes straight to your discard pile, including cards you draw.`)}
    ${sec('5-3.', 'You may control one field. A new field sends the old one to your discard pile.')}

    <h2>6. Sapping</h2>
    ${sec('6-1.', 'A sapped card has already been spent this turn.')}
    ${sec('6-1-1.', 'A sapped character cannot attack or use a Power.')}
    ${sec('6-1-2.', 'A sapped supporter cannot pay for anything.')}
    ${sec('6-2.', 'Everything you control unsaps during your awake step.')}
    ${sec('6-3.', 'Attacking saps the attacker. Most Powers sap their owner. Paying a cost saps the supporters it spends.')}

    <h2>7. Turn Structure</h2>
    ${sec('7-1.', 'A turn has four steps in this order: awake, draw, main, end.')}
    ${sec('7-1-1.', 'Awake step. Your leader enters if it has not yet. Start-of-turn effects fire. Everything you control unsaps.')}
    ${sec('7-1-2.', `Draw step. Draw ${DRAW_PER_TURN} cards. The player who takes the first turn skips this step on that turn.`)}
    ${sec('7-1-3.', 'Main step. Play cards, use Powers, and declare attacks. You may do these in any order and as often as the rules allow.')}
    ${sec('7-1-4.', 'End step. Effects that last until end of turn expire.')}
    ${sec('7-2.', `Each player opens the game with ${OPENING_HAND} cards (${OPENING_HAND + PARTY_HAND_BONUS} in a party game).`)}

    <h2>8. Playing Cards and Paying</h2>
    ${sec('8-1.', 'Once a turn you may place a card from your hand face down in your supporter row. Any card can be a supporter.')}
    ${sec('8-1-1.', 'A supporter enters unsapped. You may spend it the same turn you place it.')}
    ${sec('8-1-2.', 'Spending a supporter gives one mana of its color. A Neutral card gives one colorless mana.')}
    ${sec('8-1-3.', 'Paying a cost saps the supporters it spends.')}
    ${sec('8-2.', 'A colored pip needs mana of that color. A colorless pip takes mana of any color.')}
    ${sec('8-3.', 'A Power is an ability printed on a character with its own cost. Use it during your main step by paying that cost.')}
    ${sec('8-3-1.', 'A sapped character cannot use a Power.')}
    ${sec('8-3-2.', 'Using a Power saps its owner unless the Power says otherwise. A Power that does not sap can be used again the same turn while you can pay for it.')}
    ${sec('8-4.', 'Play a summon from your hand into one of your empty slots. Summons cost no mana.')}
    ${sec('8-4-1.', 'A summon takes face-down cards off your deck as HP. It takes one card for each point of its printed HP.')}
    ${sec('8-4-2.', 'A deck that runs out midway gives the rest at random from your discard pile.')}
    ${sec('8-4-3.', 'A summon arrives with less HP than printed when your deck and discard pile are both empty. A summon that arrives with no HP dies at once.')}
    ${sec('8-5.', 'A spell resolves from your hand and then goes to your discard pile.')}
    ${sec('8-6.', 'A field is played from your hand and stays in play. See 5-3.')}

    <h2>9. Combat</h2>
    ${sec('9-1.', 'During your main step any unsapped character you control may declare an attack.')}
    ${sec('9-1-1.', 'A Stationary character never attacks. It still deals damage while defending.')}
    ${sec('9-1-2.', 'Declaring an attack saps the attacker.')}
    ${sec('9-2.', 'You must attack an enemy summon while the enemy has one in a slot. You may attack their leader only once those slots are empty.')}
    ${sec('9-2-1.', 'Redirection overrides this. An enemy character with Redirection is the only legal target of your Powers, attacks, spells, and traps.')}
    ${sec('9-2-2.', 'A leader with Redirection can be attacked even with its slots full.')}
    ${sec('9-3.', 'Attacker and defender deal their attack to each other at the same time.')}
    ${sec('9-3-1.', 'A defending leader is the exception and deals nothing back. See 4-2-2.')}

    <h2>10. Traps</h2>
    ${sec('10-1.', 'Play a trap from your hand during a response window, never during your main step. A response window can open on your own turn as well as your opponent&rsquo;s.')}
    ${sec('10-2.', 'A trap costs mana like any other card. It goes to your discard pile once it resolves.')}
    ${sec('10-3.', 'A trap without the Spell Trap keyword answers attacks. A Spell Trap answers spells.')}
    ${sec('10-4.', 'You get a response window when your opponent declares an attack and you hold a trap that answers attacks. Spring one trap or decline.')}
    ${sec('10-4-1.', 'Only one trap may be sprung in a battle.')}
    ${sec('10-4-2.', 'The attack resolves once the window closes. A trap that removed either character ends the battle with no damage.')}
    ${sec('10-5.', 'You get a response window when your opponent casts a spell and you hold a Spell Trap.')}

    <h2>11. HP and Damage</h2>
    ${sec('11-1.', 'A character&rsquo;s life total is the face-down cards attached to it. Each attached card is one HP.')}
    ${sec('11-1-1.', 'Damage flips face-down HP cards face up. One card flips for each point of damage.')}
    ${sec('11-1-2.', 'A character dies the moment its last face-down card flips. It does not wait for more damage.')}
    ${sec('11-2.', 'A card flipped as HP resolves its flip text before the next card flips.')}
    ${sec('11-2-1.', 'A free flip resolves at once and happens before the death check. A free flip that puts HP back can therefore save a character the damage would otherwise kill.')}
    ${sec('11-2-2.', 'A flip with a cost is optional and waits. You are asked to pay after the damage finishes, which is too late to save a character that damage killed.')}
    ${sec('11-2-3.', 'A flip cost may ask for mana, for cards milled off your deck, or for cards discarded from your hand.')}
    ${sec('11-3.', 'A Power Shield stops one instance of damage whatever its size. It is spent doing so.')}
    ${sec('11-3-1.', 'Shields are checked once as the damage starts. A shield granted part-way through by a flip does not stop the rest of that damage. It stops the next instance instead.')}
    ${sec('11-4.', 'HP cards go to their controller&rsquo;s discard pile when the character leaves play.')}

    <h2>12. Wounds</h2>
    ${sec('12-1.', 'A Wound sits on a character until it converts. It is not damage until then.')}
    ${sec('12-2.', 'Every second Wound converts into 1 damage. Those two Wounds are then removed.')}

    <h2>13. Replacing a Dead Summon</h2>
    ${sec('13-1.', 'A summon of yours may die during your opponent&rsquo;s turn. You may place a summon from your hand into the empty slot at once.')}
    ${sec('13-1-1.', 'This follows the normal rules for playing a summon. It costs no mana and takes HP off your deck as usual.')}
    ${sec('13-1-2.', 'You may decline and leave the slot empty.')}
    ${sec('13-1-3.', 'Neither player may act until you answer.')}
    ${sec('13-2.', 'Nothing is offered for a summon that dies on your own turn. Your main step already lets you fill the slot.')}
    ${sec('13-3.', 'An effect may stop you replacing dead summons for a number of turns. Section 13-1 does not apply while it lasts.')}

    <h2>14. Keywords</h2>
    ${sec('14-1.', 'Battlecry fires once, as its summon enters play. A summon put into a slot any other way still counts as entering.')}
    ${sec('14-2.', 'Strike fires when its summon declares an attack, before the battle resolves.')}
    ${sec('14-3.', 'Reborn returns the summon to its slot with 1 HP the first time it would die, once per summon. That death reaches no zone and charges no debt, and no Deathrattle fires for it.')}
    ${sec('14-4.', 'Frenzy fires the first time its summon takes damage and survives, once per summon. A summon that dies to the hit never frenzies.')}
    ${sec('14-5.', 'A Stationary character never declares an attack. It still deals its attack back when something attacks it.')}
    ${sec('14-6.', 'Redirection forces the enemy to attack this character and to aim every spell and trap at it. A leader with Redirection is the only legal target, so you may attack it even with its slots full.')}
    ${sec('14-7.', 'Spell Immunity stops any spell or trap from targeting this character, from either side of the table. Combat and triggers still reach it.')}
    ${sec('14-8.', 'Effect Damage raises the damage its controller deals with spells, Powers and flips by that much. It does not change combat damage.')}
    ${sec('14-9.', 'Scry N looks at the top N cards of your deck, takes the first match to your hand, and puts the rest on the bottom.')}
    ${sec('14-10.', 'Mill moves cards from the top of a deck into its discard pile.')}
    ${sec('14-11.', 'Healing a character turns its flipped HP cards back face down. Healing debt lowers the debt counter instead.')}
    ${sec('14-12.', 'Catch takes a spent, face-up HP card off the board and returns it to its owner&rsquo;s hand.')}
  </div></div>`;
}

/**
 * The online lobby. Matchmaking only: once a room pairs, the ordinary board
 * takes over and the net client feeds it.
 */
function renderOnline(): string {
  const o = ui.online;
  const busy = o.phase !== 'idle';
  // The name reaches the other player, so nothing that starts a match is
  // offered until it is one they can be shown.
  const badName = nameProblem(o.name);
  const blocked = busy || badName !== null;
  // Only starter decks online: the room rebuilds a deck from its key alone, so a
  // custom deck, which lives only in this browser, cannot be used against another
  // player. The room rejects an unknown key, and offering one here would only be
  // an option that always fails.
  // A deck you built travels to the room with the join, so it can be brought
  // online like any other. The group is dropped when there is nothing in it.
  const deckGroups = [
    { label: 'Your decks', options: savedDeckList().map((d) => ({ value: d.key, label: d.name })) },
    { label: 'Starter decks', options: starterDecks.map((d) => ({ value: d.key, label: d.name })) },
  ].filter((g) => g.options.length > 0);
  // A match that dropped leaves its report behind: the player is on this screen
  // precisely because they cannot ask the board what happened any more.
  const status = o.error
    ? `<p class="lobbyerr lobbystatus">${esc(o.error)}</p>`
      + '<p class="lobbystatus"><button data-act="btn" data-cmd="copy-report">'
      + `${ui.reportCopied ? 'Copied' : 'Copy match report'}</button></p>`
    : badName && o.name.trim().length > 0
      ? `<p class="lobbyerr lobbystatus">${esc(badName)}</p>`
    : o.phase === 'seeking'
      ? '<p class="lobbynote">Looking for an opponent&hellip;</p>'
      : o.phase === 'waiting'
        ? `<p class="lobbynote">${
            o.roster && o.roster.needed > 2
              ? `Waiting for players (${o.roster.players}/${o.roster.needed}).`
              : 'Waiting for an opponent.'
          }${o.roomCode ? ' Share this code:' : ''}</p>${
            o.roomCode
              ? `<div class="codeshare"><input class="lobbyinput roomcode" data-act="ocopy"
                  readonly value="${esc(o.roomCode)}"><button class="lobbybtn copybtn"
                  data-act="btn" data-cmd="o-copy">${ui.copied ? 'Copied' : 'Copy'}</button></div>`
              : ''
          }${
            o.roster && o.roster.needed > 2 && o.roster.names.length > 0
              ? `<p class="lobbynote roster">${o.roster.names.map(esc).join(' &middot; ')}</p>`
              : ''
          }`
        : o.phase === 'connecting'
          ? '<p class="lobbynote">Joining the room&hellip;</p>'
          : '<p class="lobbyerr lobbystatus"></p>';
  return `<div class="setup onlineview"><div class="inner">
    <header class="platebar"><img class="sigil" src="${BASE}favicon.png" alt="" width="63" height="44"><h1>Online</h1></header>
    <div class="lobby">
      <label class="lobbyrow"><span>Name</span>
        <input class="lobbyinput" data-act="oname" value="${esc(o.name)}" maxlength="24"
          placeholder="What they will see"></label>

      <div class="lobbyrow"><span>Deck</span>${dropdownHtml({
        name: 'odeck',
        value: o.deckKey,
        placeholder: 'pick a deck…',
        groups: deckGroups,
      })}</div>

      <div class="lobbyrow"><span>Players</span><div class="seats partyseats">${(
        [
          [2, 'Duel'],
          [3, '3 Player'],
          [4, '4 Player'],
        ] as const
      )
        .map(
          ([n, label]) =>
            `<button data-act="btn" data-cmd="o-party:${n}" class="seattile${
              o.party === n ? ' on' : ''
            }" ${busy ? 'disabled' : ''}>${label}</button>`,
        )
        .join('')}</div></div>

      <div class="lobbyrow"><span>Timers</span><div class="seats">${(
        [
          [1, 'On'],
          [0, 'Off'],
        ] as const
      )
        .map(
          ([on, label]) =>
            `<button data-act="btn" data-cmd="o-timers:${on}" class="seattile${
              o.timers === !!on ? ' on' : ''
            }" ${busy ? 'disabled' : ''}>${label}</button>`,
        )
        .join('')}</div></div>

      <p class="lobbynote">${
        o.timers
          ? `Turns last ${CLOCK_SECONDS.turn} seconds, responses last ${CLOCK_SECONDS.response} seconds. Playing a card gives a little turn time back.`
          : 'No timers. Everyone gets as long as they want. This only works in a game you host.'
      }${o.party > 2 ? ' Party games are hosted: share the code with everyone joining.' : ''}</p>

      ${status}

      <button class="lobbybtn" data-act="btn" data-cmd="o-seek" ${
        blocked || o.party > 2 ? 'disabled' : ''
      } ${o.party > 2 ? 'title="Random games are head-to-head. Host to play a party game."' : ''}>Seek a random game</button>
      <button class="lobbybtn" data-act="btn" data-cmd="o-host" ${blocked ? 'disabled' : ''}>Host a private game</button>

      <hr class="lobbyrule">

      <label class="lobbyrow"><span>Code</span>
        <input class="lobbyinput" data-act="ocode" value="${esc(o.code)}" maxlength="8"
          placeholder="ABCD1234"></label>
      <button class="lobbybtn" data-act="btn" data-cmd="o-join" ${blocked ? 'disabled' : ''}>Join a private game</button>

      <hr class="lobbyrule">

      <button class="lobbybtn" data-act="btn" data-cmd="o-back">${
        busy ? 'Cancel' : 'Main Menu'
      }</button>
    </div>
  </div></div>`;
}

function renderSetup(): string {
  // Local play is the only venue wired up, so it sits selected and the seat
  // toggle under it picks who takes the other chair.
  const seat = (m: SetupMode, label: string) =>
    `<button data-act="btn" data-cmd="mode:${m}" class="seattile${ui.setupMode === m ? ' on' : ''}">${label}</button>`;
  return `<div class="setup menuview"><div class="inner">
    <header class="platebar"><img class="sigil" src="${BASE}favicon.png" alt="" width="63" height="44"><h1>Ernum Rites</h1></header>
    <div class="modes">
      <button class="modetile on" data-act="btn" data-cmd="mode:${ui.setupMode}">Local Play</button>
      <button class="modetile" ${
        onlineAvailable()
          ? 'data-act="btn" data-cmd="to-online"'
          : 'disabled title="This build has no match server configured"'
      }>Online</button>
      <button class="modetile" data-act="btn" data-cmd="to-build">Deckbuilder</button>
      <button class="modetile" data-act="btn" data-cmd="to-rules">Rules</button>
      ${mixerHtml()}</div>
    <div class="seats"><span class="seatlabel">Opponent</span>${seat('ai', 'Bot')}${seat('hotseat', 'Player')}</div>
    ${
      savedDeckList().length > 0
        ? `<h2>Your decks</h2><div class="decks">${savedDeckList().map(deckCardHtml).join('')}</div>`
        : ''
    }
    <h2>Decks</h2>
    <div class="decks">${starterDecks.map(deckCardHtml).join('')}</div>
    <button class="primary go" data-act="btn" data-cmd="start" ${ui.preloading ? 'disabled' : ''}>${
      ui.preloading ? 'Loading cards…' : 'Start match'
    }</button>
  </div>
  <footer class="credits">
    <p>Music and sound effects by <span class="who">Lemonadey</span></p>
    <p>All other rights reserved, 2026, Krazvalt</p>
  </footer></div>`;
}


// --- deckbuilder ------------------------------------------------------------

function savedDeckList(): StarterDeck[] {
  return savedDecks().map((d) => ({
    key: d.key,
    name: d.name,
    // A deck saved before blurbs existed has none, so the card count stands in.
    blurb: d.blurb?.trim() || `${d.cards.length} cards.`,
    leaderId: d.leaderId,
    cards: d.cards,
  }));
}

/**
 * One card in the browser book: the card itself is the add button. The book is
 * a collection holding two copies of everything, so the cell draws the copies
 * still unspent as a stack and putting one in the deck visibly spends it.
 */
function browseCardHtml(def: CardDef, have: number): string {
  const b = ui.builder;
  const note = b.dev
    ? `<button class="tiny" data-act="btn" data-cmd="suggest:${def.id}">note</button>`
    : '';
  const inspect = `<button class="tiny" data-act="btn" data-cmd="binspect:${def.id}">?</button>${note}`;
  // Whichever summon is currently leading the deck shows the seat instead of a
  // copy count, and clicking it drags the card back out of the seat.
  if (b.leaderId === def.id) {
    return `<div class="bcell">
      <div class="copystack">
      ${renderCard(def, {
        classes: ['browse', 'isleader'],
        data: { act: 'btn', cmd: `bleader:${def.id}`, bdrag: def.id },
      })}
      </div>
      <div class="bcap">
        <span class="bcount leaderchip">your leader</span>
        <span class="bcapbtns">${inspect}</span>
      </div>
    </div>`;
  }
  const full = !canAdd(b, def.id);
  const left = Math.max(0, COPY_LIMIT - have);
  // Even a card the deck cannot take stays draggable: a summon may still be
  // headed for the leader slot.
  return `<div class="bcell">
    <div class="copystack s${left}">
    ${renderCard(def, {
      classes: ['browse', ...(left === 0 || full ? ['full'] : [])],
      data: full ? { bdrag: def.id } : { act: 'btn', cmd: `badd:${def.id}`, bdrag: def.id },
    })}
    </div>
    <div class="bcap">
      <span class="bcount${left === 0 ? ' spent' : ''}">×${left}</span>
      <span class="bcapbtns">${inspect}</span>
    </div>
  </div>`;
}

/**
 * Renders one copy of one card in the deck view. These cells carry no drag
 * handle, because dragging toward the deck adds a copy and every card here is
 * already in it. Clicking removes the copy, matching the deck list beside it.
 */
function deckViewCardHtml(def: CardDef): string {
  const b = ui.builder;
  const note = b.dev
    ? `<button class="tiny" data-act="btn" data-cmd="suggest:${def.id}">note</button>`
    : '';
  const chip = def.type === 'summon' ? `L${def.level ?? 1}` : pipHtml(def.cost) || '·';
  return `<div class="bcell dcell" title="Click the card to take this copy out">
    <div class="copystack">
    ${renderCard(def, { classes: ['browse'], data: { act: 'btn', cmd: `bdrop:${def.id}` } })}
    </div>
    <div class="bcap">
      <span class="bcount">${chip}</span>
      <span class="bcapbtns"><button class="tiny" data-act="btn" data-cmd="binspect:${def.id}">?</button>${note}</span>
    </div>
  </div>`;
}

function renderBuilder(): string {
  const b = ui.builder;
  const have = counts(b.cards);
  const identity = deckIdentity(b.leaderId);
  const pips = identity.map((c) => pipRun(c, 1)).join('');
  const issues = problems(b);

  const leader = tryCard(b.leaderId);

  // The color tabs filter the full card list, so the row is hidden while the
  // deck view is showing.
  const tabs = b.viewingDeck
    ? ''
    : `<nav class="tabs">${BROWSE_TABS.map((t) => {
        const label = t === 'M' ? 'Mixed' : t === 'N' ? 'Neutral' : COLOR_NAME[t];
        const dot =
          t === 'M'
            ? '<span class="tabdot dual"></span>'
            : t === 'N'
              ? '<span class="tabdot neutral"></span>'
              : `<span class="tabdot" style="background: var(--c-${t})"></span>`;
        return `<button data-act="btn" data-cmd="btab:${t}" class="tab${b.tab === t ? ' on' : ''}">${dot}${label}</button>`;
      }).join('')}</nav>`;

  const rarityChips = RARITY_FILTERS.map((r) => {
    const on = b.rarities.includes(r);
    return `<button data-act="btn" data-cmd="brarity:${r}" class="rchip r-${r}${on ? ' on' : ''}"
      title="${esc(RARITY_NAME[r])} only">${esc(RARITY_NAME[r])}</button>`;
  }).join('');

  const hit = (d: CardDef) => matchesSearch(d, b.search, b.rarities);
  // The deck view drops the category headings and shows one flat grid holding
  // every copy, which is what the toggle is for.
  const browser = b.viewingDeck
    ? (() => {
        const shown = deckCards(b.cards).filter(hit);
        if (shown.length === 0) {
          return `<p class="hint">${
            b.cards.length > 0 ? 'No matches in this deck.' : 'This deck is empty.'
          }</p>`;
        }
        return `<div class="bookgrid deckgrid">${shown.map(deckViewCardHtml).join('')}</div>`;
      })()
    : browseSections(b.tab)
        .map((sec) => ({ ...sec, cards: sec.cards.filter(hit) }))
        .filter((sec) => sec.cards.length > 0)
        .map(
          (sec) => `<h4 class="bookhead"><span>${esc(sec.title)}</span></h4>
        <div class="bookgrid">${sec.cards.map((d) => browseCardHtml(d, have.get(d.id) ?? 0)).join('')}</div>`,
        )
        .join('') || '<p class="hint">No matches.</p>';

  const leaderGroups = leaderChoices().map((g) => ({
    label: g.label,
    options: g.cards.map((d) => ({ value: d.id, label: d.name })),
  }));
  const deckRows = [...have.entries()]
    .map(([id, n]) => ({ def: card(id), n }))
    .sort((x, y) => {
      const rank = (d: CardDef) =>
        d.type === 'summon' ? (d.level ?? 1) : d.type === 'spell' ? 4 : d.type === 'trap' ? 5 : 6;
      return rank(x.def) - rank(y.def) || x.def.name.localeCompare(y.def.name);
    })
    .map((r) => {
      const chip = r.def.type === 'summon' ? `L${r.def.level ?? 1}` : pipHtml(r.def.cost) || '·';
      const art = r.def.art
        ? `, url('${artFile(r.def)}')`
        : '';
      return `<button class="deckrow" data-act="btn" data-cmd="bdrop:${r.def.id}"
        title="Click or drag out to remove"
        style="background-image: linear-gradient(90deg, rgba(24, 34, 65, 0.97) 0%, rgba(24, 34, 65, 0.86) 52%, rgba(24, 34, 65, 0.3) 100%)${art}">
        <span class="rowchip">${chip}</span>
        <span class="rowname">${esc(r.def.name)}</span>
        <span class="rowcount">x${r.n}</span>
      </button>`;
    })
    .join('');

  const importGroups = [
    { label: 'Starter decks', options: starterDecks.map((d) => ({ value: d.key, label: d.name })) },
    { label: 'Your decks', options: savedDeckList().map((d) => ({ value: d.key, label: d.name })) },
  ].filter((g) => g.options.length > 0);

  const notes = suggestions();
  const devPanel = b.dev
    ? `<div class="devpanel">
        <strong>Dev mode.</strong> Every card has a note button. ${notes.length} suggestion(s) held.
        <button data-act="btn" data-cmd="bexport-notes" ${notes.length === 0 ? 'disabled' : ''}>Export markdown</button>
        <button data-act="btn" data-cmd="bclear-notes" ${notes.length === 0 ? 'disabled' : ''}>Clear</button>
      </div>`
    : '';

  const inspected = ui.inspect ? tryCard(ui.inspect) : null;
  const inspectBox = inspected
    ? `<div class="promptlayer binspectlayer"><div class="prompt binspect">
        ${renderCard(inspected)}
        <div class="row"><button data-act="btn" data-cmd="binspect:">Close</button></div>
      </div></div>`
    : '';

  // Saving asks for a name and a line about the deck. The dialog carries which
  // button opened it, so Save and play still plays once the name is in.
  const saveBox = b.saving
    ? (() => {
        const bad = deckNameProblem(b.name);
        return `<div class="promptlayer savelayer"><div class="prompt">
        <h3>${
          b.saving === 'copy'
            ? 'Save a copy'
            : b.editingKey
              ? 'Save changes'
              : 'Save this deck'
        }</h3>
        <label class="savefield"><span>Name</span>
          <input id="savename" data-act="dname" value="${esc(b.name)}"
            maxlength="${DECK_NAME_MAX}"
            autocomplete="off" spellcheck="false"></label>
        <label class="savefield"><span>About</span>
          <span class="blurbwrap">
            <textarea id="saveblurb" data-act="dblurb" rows="2"
              maxlength="${DECK_BLURB_MAX}">${esc(b.blurb)}</textarea>
            <span class="charcount">(Limit: ${b.blurb.length}/${DECK_BLURB_MAX} characters)</span>
          </span></label>
        <p class="lobbyerr saveerr">${bad && b.name.length > 0 ? esc(bad) : ''}</p>
        <div class="row">
          <button class="primary" data-act="btn" data-cmd="bsave-confirm" ${bad ? 'disabled' : ''}>${
            b.saving === 'play' ? 'Save and play' : b.saving === 'copy' ? 'Save the copy' : 'Save'
          }</button>
          <button data-act="btn" data-cmd="bsave-cancel">Cancel</button>
        </div>
      </div></div>`;
      })()
    : '';

  const suggestBox = b.suggestFor
    ? `<div class="promptlayer"><div class="prompt">
        <h3>Suggest a change to ${esc(card(b.suggestFor).name)}</h3>
        <p class="blurb">${esc(card(b.suggestFor).text || 'No rules text.')}</p>
        <textarea id="suggestnote" rows="4" placeholder="What should change, and why?"></textarea>
        <div class="row">
          <button class="primary" data-act="btn" data-cmd="bsuggest-save">Add</button>
          <button data-act="btn" data-cmd="bsuggest-cancel">Cancel</button>
        </div>
      </div></div>`
    : '';

  const savedRows = savedDeckList()
    .map(
      (d) => `<div class="mydeck">
        <span class="mdname">${esc(d.name)}</span>
        <span class="mdmeta">${d.cards.length} · ${esc(card(d.leaderId).name)}</span>
        <button class="tiny" data-act="btn" data-cmd="bedit:${d.key}">Edit</button>
        <button class="tiny danger" data-act="btn" data-cmd="bdelete:${d.key}">✕</button>
      </div>`,
    )
    .join('');

  return `<div class="buildwrap builder">
    <header class="bheader">
      <button data-act="btn" data-cmd="to-setup">Main Menu</button>
      <span class="wordmark">Deckbuilder</span>
      <button class="viewtoggle${b.viewingDeck ? ' on' : ''}" data-act="btn" data-cmd="bview">${
        b.viewingDeck ? 'View cards' : 'View deck'
      }</button>
      ${tabs}
    </header>
    ${devPanel}
    <div class="bmain">
      <section class="book">
        <div class="bookscroll">${browser}</div>
        <div class="bookbar">
          <input id="bsearch" type="text" placeholder="Search name, text or rarity" value="${esc(b.search)}"
            data-act="bsearch" autocomplete="off" spellcheck="false">
          <div class="rchips">${rarityChips}</div>
          <label class="ddfield"><span>Start from</span>${dropdownHtml({
            name: 'dimport',
            value: '',
            placeholder: 'an example deck…',
            groups: importGroups,
          })}</label>
        </div>
      </section>
      <aside class="deckpanel">
        <div class="leaderplate" style="background-image: linear-gradient(90deg, rgba(20, 42, 107, 0.92) 0%, rgba(28, 52, 123, 0.62) 55%, rgba(20, 42, 107, 0.28) 100%)${leader?.art ? `, url('${artFile(leader)}')` : ''}">
          <input id="deckname" class="deckname" value="${esc(b.name)}" data-act="dname"
            autocomplete="off" spellcheck="false">
        </div>
        <div class="leaderbox">
          ${
            leader
              ? `${renderCard(leader, { data: { act: 'btn', cmd: `binspect:${leader.id}` } })}
          <div class="leaderfacts">
            <strong>${esc(leader.name)}</strong>
            <span class="manapool">${pips}</span>
            <span class="hstat">${leader.strength ?? 0} strength · ${leader.hp ?? 0} HP</span>
            ${(leader.powers ?? [])
              .map(
                (pw) =>
                  `<span class="hpower"><b>${esc(pw.name)}</b> ${pipHtml(pw.cost)}<br>${esc(pw.text)}</span>`,
              )
              .join('')}
            ${leader.text ? `<span class="hpower">${esc(leader.text)}</span>` : ''}
            <span class="hint">Drag the card out to swap leaders.</span>
          </div>`
              : '<div class="leaderslot">No leader. Drag any summon here.</div>'
          }
        </div>
        <div class="leaderrow ddfield"><span>Leader</span>${dropdownHtml({
          name: 'dleader',
          value: b.leaderId ?? '',
          placeholder: 'pick or drag one in…',
          groups: leaderGroups,
          search: 'Search leaders…',
        })}</div>
        ${issues.length ? `<ul class="issues">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        <div class="deckscroll">
          <div class="deckrows">${deckRows || '<p class="blurb">Empty. Click or drag cards from the book.</p>'}</div>
          <h4 class="mydecks-h"><span>My decks</span></h4>
          <div class="mydecks">${savedRows || '<p class="blurb">None saved yet.</p>'}</div>
        </div>
        <div class="deckfoot">
          <span class="countpill ${issues.length ? 'bad' : 'good'}"
            ${issues.length ? `title="${esc(issues.join(' '))}"` : ''}>${b.cards.length}/${DECK_SIZE}</span>
          <button class="primary" data-act="btn" data-cmd="bsave" ${issues.length ? 'disabled' : ''}>Save</button>
          <button data-act="btn" data-cmd="bplay" ${issues.length ? 'disabled' : ''}>Save and play</button>
          <button class="savecopy" data-act="btn" data-cmd="bcopy" ${issues.length ? 'disabled' : ''}
            title="Keep this one and start a new deck from it">Save as copy</button>
        </div>
        <div class="deckfoot2">
          <button data-act="btn" data-cmd="bexport-deck">Export list</button>
          <button data-act="btn" data-cmd="bimport-deck">Import list</button>
          <button class="danger" data-act="btn" data-cmd="bclear">Empty it</button>
        </div>
      </aside>
    </div>
    ${inspectBox}
    ${suggestBox}
    ${saveBox}
  </div>`;
}

// --- online ------------------------------------------------------------------

/**
 * Where the match server lives. Same origin in dev, where vite proxies /api to
 * a local `wrangler dev`. In a build the site and the worker sit on different
 * hosts, so the worker's URL is baked in at build time instead.
 */
function serverBase(): string {
  return import.meta.env.VITE_SERVER_URL || window.location.origin;
}

/**
 * Whether there is anything to connect to. A build with no server configured
 * would otherwise offer a button that can only ever fail.
 */
function onlineAvailable(): boolean {
  if (import.meta.env.VITE_SERVER_URL) return true;
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}


/**
 * One client for the session. It is built on the first attempt to play online
 * and reused after that, so a cancelled search leaves nothing behind.
 */
let net: NetClient | null = null;
/** Kept so a cancel can take the room out of the queue rather than orphan it. */
let pendingRoom: { roomId: string; code?: string; hosted?: boolean } | null = null;

/** The clock the room last sent, watched so the last ten seconds can be heard. */
let onlineClock: Clock | null = null;
let ropeWatch: number | null = null;
/** The window the ring is sounding for, so the way it ended can be judged. */
let ringingFor: Clock | null = null;

/**
 * Gate the warning on whoever is actually on the clock. Driven by its own timer
 * rather than the render loop, because the board only repaints when something
 * happens and the whole point of this sound is the stretch where nothing does.
 */
function ropeTick(): void {
  if (ui.online.phase !== 'playing') {
    stopRopeWatch();
    return;
  }
  // The room's clock carries its own grace, which is not part of the window the
  // player is acting inside, so the warning counts the one they are given.
  const clock = onlineClock ? asDisplayed(onlineClock) : null;
  const seat = ui.online.seat;
  const skew = net?.status.skewMs ?? 0;
  const now = Date.now();
  const burning =
    !!clock &&
    seat !== null &&
    clock.player === seat &&
    !!ui.state &&
    !isOver(ui.state) &&
    secondsLeft(clock, now, skew) > 0 &&
    isRoping(clock, now, skew);

  if (burning) {
    // Keyed on the window rather than a flag, so ticks inside one window do not
    // restart the clip and a genuinely new window is not swallowed by its tail.
    if (ringingFor?.endsAt !== clock.endsAt) {
      stopLast10();
      if (startLast10()) ringingFor = clock;
    }
    return;
  }

  const ended = ringingFor;
  if (!ended) return;
  ringingFor = null;
  // A window that reached zero is a turn the player let run out, and the ring
  // going off is the whole point of it, so it is left to finish. Anything else
  // means they acted, and the sound gets out of the way.
  if (secondsLeft(ended, now, skew) > 0) stopLast10();
}

/**
 * The turn clock drawn on the line between the boards. The elapsed time goes out
 * as a negative animation delay, so a render in the middle of a turn picks the
 * burn up where it was rather than starting it again. Empty off the clock, which
 * is every game that is not online.
 */
function fuseHtml(): string {
  const clock = onlineClock ? asDisplayed(onlineClock) : null;
  if (!clock || clock.totalMs <= 0) return '';
  // Stable for the whole window. The elapsed offset is applied after the write
  // instead of being baked in here, because a string carrying the current time
  // would differ on every hover and cost the board its decoded card faces.
  // data-ends is what makes a new window a different string, so the burn is
  // restarted even when the turn changed nothing else on the table.
  return `<span class="fuse" data-ends="${clock.endsAt}" style="--burn:${clock.totalMs}ms"><span class="fusefill"></span><span class="fusespark"></span></span>`;
}

/**
 * Rebuild the bar against the clock after time has passed unwatched.
 *
 * A hidden tab has its animations and timers throttled, so coming back to one
 * leaves the burn short of where the clock actually is, by however long the tab
 * was away. The room's deadline is the truth, so the element is made again and
 * seated against it rather than left to carry on from where it was paused. Only
 * the bar is rebuilt: redoing the board here would cost every decoded card face
 * on the table for a strip three pixels tall.
 */
function resyncFuse(): void {
  const divider = document.querySelector<HTMLElement>('.board .divider');
  if (!divider) return;
  divider.innerHTML = fuseHtml();
  syncFuse(divider);
}

/**
 * The old state with the card they just played put back into their hand.
 *
 * Their hand arrives as a row of placeholders, and the placeholder is a spell
 * that costs nothing and asks for no targets, so replaying their move against it
 * does not fail: it quietly does something else. Anything the real card would
 * have built is then never built, and a card this side has never heard of turns
 * up in a later state with nothing to look it up by.
 *
 * The played card is public the moment it lands, so it is read back out of the
 * new state and slotted in where it came from. The copy is local and thrown away
 * with the replay.
 */
function replaySource(prev: GameState, next: GameState, move: { action: Action; actor: PlayerIdx }): GameState {
  const index = handIndexOf(move.action);
  if (index === null) return prev;
  const hand = prev.players[move.actor].hand;
  if (hand[index] !== HIDDEN_ID) return prev;
  const real = playedCardId(prev, next, move.action, move.actor, index);
  if (!real || real === HIDDEN_ID) return prev;
  const copy: GameState = structuredClone(prev);
  copy.players[move.actor].hand[index] = real;
  return copy;
}

/** Put the burn where the clock has actually reached, before the first paint. */
function syncFuse(el: HTMLElement): void {
  const fuse = el.querySelector<HTMLElement>('.fuse');
  const clock = onlineClock ? asDisplayed(onlineClock) : null;
  if (!fuse || !clock || clock.totalMs <= 0) return;
  const left = clock.endsAt - (Date.now() + (net?.status.skewMs ?? 0));
  const burnt = Math.max(0, Math.min(clock.totalMs - left, clock.totalMs));
  fuse.style.setProperty('--burnt', `${-burnt}ms`);
}

function startRopeWatch(): void {
  if (ropeWatch === null) ropeWatch = window.setInterval(ropeTick, 250);
}

function stopRopeWatch(): void {
  if (ropeWatch !== null) window.clearInterval(ropeWatch);
  ropeWatch = null;
  onlineClock = null;
  ringingFor = null;
  stopLast10();
}

function netClient(): NetClient {
  if (net) return net;
  net = new NetClient(serverBase(), {
    onSeated(seat, _kind, code) {
      note(`seated as seat ${seat}${code ? ` in room ${code}` : ''}`);
      ui.online.seat = seat;
      ui.online.roomCode = code ?? ui.online.roomCode;
      desyncStrikes = 0;
      rejoinTried = false;
      render();
    },
    onWaiting(players, code, needed, names) {
      ui.online.phase = 'waiting';
      if (code) ui.online.roomCode = code;
      ui.online.roster =
        needed !== undefined ? { players, needed, names: names ?? [] } : null;
      render();
    },
    onState(state, seat, clock, move) {
      note(
        move
          ? `v${state.version} seat ${move.actor} ${move.action.type}`
          : `v${state.version} resync`,
      );
      // Seating happens on arrival, which for the host is while still alone in
      // the room. The match starts on the first state the room pushes.
      const opening = ui.online.phase !== 'playing';
      if (opening) playSfx('lobby');
      const prev = ui.state;
      let animated = false;
      // The room applied the move, so nothing on this side recorded the wounds
      // it dealt on the way through. Replaying it against the old copy fills
      // that log and the result is discarded: the animations are drawn against
      // the room's state, not this one. Redaction can make the replay disagree
      // in detail, which costs a wound count rather than a wrong board.
      if (!opening && prev && move) {
        captureWounds();
        const replay = applyAction(replaySource(prev, state, move), move.actor, move.action);
        if (replay.ok) {
          // Against the replay rather than the room's copy, because the two
          // sides of every comparison then come from the same redaction: a card
          // drawn here leaves a hidden deck as a placeholder and matches the
          // placeholder it came from, while a card handed back from debt keeps
          // its real id and does not. Comparing to the room's copy instead
          // makes anything arriving in hand look drawn. The board still comes
          // from the room; only what is animated is read off this.
          applyActionFx(prev, replay.state, move.action, move.actor);
          animated = true;
        } else {
          // Nothing trustworthy to animate, and the wound log has to be emptied
          // or it leaks into whatever is drawn next.
          takeWounds();
        }
      }
      // The room is the authority, so its copy replaces this one outright.
      ui.state = state;
      ui.online.seat = seat;
      ui.online.phase = 'playing';
      onlineClock = clock;
      startRopeWatch();
      ui.botSeat = null;
      ui.screen = 'game';
      ui.error = null;
      // Before the paint, so a leader that just entered reformed is drawn as the
      // card it entered as rather than flashing straight to its answer.
      beginLeaderReform(ui.state);
      render();
      // A no-op while every image is held; the retry for any failed fetch.
      void warmArt(packArt);
      if (opening) {
        playOpeningDraw(seat);
        return;
      }
      if (!animated) return;
      playSounds();
      playTrapReveal();
      playSmack();
      playEffectCallouts();
      playDraws();
      playDeckGifts();
      playHandPlays();
      playDeckOut();
      // The animations play on the render just done; later renders show the
      // settled state rather than replaying them. Cleared here and not on a
      // timer: anything left standing is re-applied by the next render, which
      // plays it a second time.
      clearActionFx();
    },
    onRejected(reason) {
      note(`room refused the move: ${reason}`);
      ui.error = reason;
      render();
    },
    onTimedOut(_player, action) {
      ui.error = `A clock ran out. ${action} was played automatically.`;
      render();
    },
    onOpponentLeft() {
      note('the other player left');
      failOnline('Your opponent left the match.');
    },
    onPlayerLeft(_seat, name) {
      // A party drop is an elimination rather than the end: the room concedes
      // for them and the state push that follows carries the consequences.
      popNotice(name, 'Eliminated', 'bad');
    },
    onError(reason) {
      note(`error: ${reason}`);
      // A lobby that has not started survives a dropped socket: the close freed
      // the seat, the code is still live, and joining with it again takes the
      // seat back. So a host or guest whose connection quietly died while
      // waiting walks back in on their own. One quiet try; a second failure in
      // a row reads as a real outage and falls through to the lobby screen.
      const o = ui.online;
      if (!rejoinTried && o.roomCode && (o.phase === 'waiting' || o.phase === 'connecting')) {
        rejoinTried = true;
        o.code = o.roomCode;
        void startOnline('join');
        return;
      }
      failOnline(reason);
    },
    onDesync() {
      note('this copy stopped matching the room');
      // The push that exposed the drift also carried the room's copy, and the
      // mirror already took it, so staying seated costs nothing. Leaving would
      // cost plenty: in a party room a closed socket is a concession. Only a
      // client that keeps on drifting is truly broken and goes back out.
      desyncStrikes++;
      if (desyncStrikes >= 3) {
        failOnline('This client fell out of step with the room.');
      } else {
        popNotice('Out of step', 'Resynced with the room', 'bad');
      }
    },
  });
  return net;
}

/** Digest disagreements this match. One is survivable; a streak is a bug. */
let desyncStrikes = 0;

/** Whether the one quiet lobby rejoin has been spent. Reset on being seated. */
let rejoinTried = false;

/** Drop back to the lobby with something to read. */
function failOnline(reason: string): void {
  stopRopeWatch();
  net?.close();
  pendingRoom = null;
  // A finished match cannot fail. The result is already on screen and the socket
  // has nothing left to carry, so the loser closing their tab, a dropped
  // connection and a desync all just disconnect and leave the result standing.
  // The seat stays set on purpose: the board is drawn from it, and clearing it
  // would flip the table under whoever is still reading the result.
  if (ui.state && isOver(ui.state) && ui.online.phase === 'playing') {
    render();
    return;
  }
  // A lobby code outlives the socket that carried it there, so hand it to the
  // join box: whoever got dropped is one click from taking their seat back.
  if (ui.online.roomCode && ui.online.phase !== 'playing') {
    ui.online.code = ui.online.roomCode;
  }
  ui.online.phase = 'idle';
  ui.online.roomCode = null;
  ui.online.seat = null;
  ui.online.roster = null;
  ui.online.spectating = false;
  ui.enemyPick = null;
  ui.online.error = reason;
  ui.screen = 'online';
  render();
}

async function startOnline(how: 'public' | 'host' | 'join'): Promise<void> {
  const o = ui.online;
  const bad = nameProblem(o.name);
  if (bad) {
    o.error = bad;
    render();
    return;
  }
  if (how === 'join' && o.code.trim().length === 0) {
    o.error = 'Enter the code you were given.';
    render();
    return;
  }
  o.error = null;
  o.roomCode = null;
  o.phase = how === 'public' ? 'seeking' : 'connecting';
  render();

  const client = netClient();
  const reply =
    how === 'public'
      ? await client.findPublicGame()
      : how === 'host'
        ? await client.hostPrivateGame(o.party === 2 ? undefined : o.party, !o.timers)
        : await client.joinPrivateGame(o.code);

  if (!reply.ok) {
    failOnline(reply.reason);
    return;
  }
  pendingRoom = { roomId: reply.roomId, code: reply.code, hosted: how === 'host' };
  o.roomCode = reply.code ?? null;
  o.phase = 'connecting';
  render();
  // A saved deck is not one the room can look up, so it travels with the join.
  const saved = savedDecks().find((d) => d.key === o.deckKey);
  const deck = saved ? { leaderId: saved.leaderId, cards: saved.cards } : undefined;
  client.connect(reply.roomId, reply.kind, o.deckKey, o.name.trim(), reply.code, deck);
  // The wait for an opponent is dead air, so anything the boot warm missed
  // downloads now rather than racing the opening push.
  void warmArt(packArt);
}

/** Leave cleanly, so a half-made room does not sit in the queue. */
function leaveOnline(): void {
  if (pendingRoom && ui.online.phase !== 'playing') {
    // Only the host's cancel retires the code. A guest backing out of a party
    // lobby holds the same code as everyone else, and sending it here would
    // kill the lobby for every player still on their way.
    void net?.cancelQueue(pendingRoom.roomId, pendingRoom.hosted ? pendingRoom.code : undefined);
  }
  net?.close();
  pendingRoom = null;
  ui.online.phase = 'idle';
  ui.online.roomCode = null;
  ui.online.seat = null;
  ui.online.roster = null;
  ui.online.spectating = false;
  ui.enemyPick = null;
  ui.online.error = null;
}

// --- dispatch ---------------------------------------------------------------

function dispatch(action: Action): void {
  if (!ui.state) return;
  // Conceding is not a play and is not gated on the turn: the engine settles it
  // before it asks whose turn it is, and a player who wants out should not have
  // to wait for their opponent to finish.
  if (!canAct() && action.type !== 'CONCEDE') {
    // A picker can outlive the turn it was built in: a push can hand the wait
    // to another player between opening it and clicking the target. Swallowing
    // the click here reads as a dead button, so say what is being waited on.
    ui.error = 'Waiting on another player.';
    render();
    return;
  }
  // Online, the room decides. This side sends and waits for the push rather
  // than moving its own copy on ahead of the authority.
  if (ui.online.phase === 'playing' && net) {
    const sent = net.play(action);
    if (!sent.ok) {
      if (sent.reason === NEEDS_ENEMY) {
        // The card says "the enemy" and there is more than one: hold the action
        // and ask for a leader click, then send it again with the pick on it.
        ui.enemyPick = { build: (enemy) => ({ ...action, enemy }) as Action };
        ui.selection = null;
        ui.targeting = null;
        ui.error = null;
        ui.drag = null;
        render();
        return;
      }
      ui.error = sent.reason;
    } else {
      // The room owns the state from here, but the prompts that produced this
      // action belong to this side and are finished with. Left standing, the
      // picker stays on screen after the battlecry it was collecting for has
      // already resolved, and the next click pushes a second ref into it and
      // builds an action the room can only refuse.
      ui.selection = null;
      ui.targeting = null;
      ui.choiceHidden = false;
      ui.error = null;
    }
    ui.drag = null;
    render();
    return;
  }
  // Only the real move is recorded. The bot has already finished searching by
  // now, so nothing it simulated lands in the same buffer.
  captureWounds();
  // Whoever is giving up, not whoever is on the clock: crediting the concession
  // to the active player would hand the match to the wrong side.
  const by = action.type === 'CONCEDE' ? viewSeat() : actor();
  // A reducer exception leaves the state untouched; naming it beats a click
  // that silently does nothing.
  let res: ReturnType<typeof applyAction>;
  try {
    res = applyAction(ui.state, by, action);
  } catch (err) {
    console.error('applyAction threw', action.type, err);
    res = {
      ok: false,
      error: `That move hit a bug: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    // Nothing happened, so stop recording rather than leave the buffer open for
    // the bot to search into.
    takeWounds();
    ui.error = res.error;
  } else {
    applyActionFx(ui.state, res.state, action, by);
    ui.state = res.state;
    ui.error = null;
    ui.selection = null;
    ui.targeting = null;
    ui.choiceHidden = false;
  }
  ui.drag = null;
  // Before the paint, so a leader that just entered reformed is drawn as the
  // card it entered as rather than flashing straight to its answer.
  beginLeaderReform(ui.state);
  render();
  playSounds();
  playTrapReveal();
  playSmack();
  playEffectCallouts();
  playDraws();
  playDeckGifts();
  playHandPlays();
  playDeckOut();
  const wait = Math.max(pacingFor(action), fxTailMs());
  // The animations play on the render just done; later renders show the
  // settled state rather than replaying them.
  clearActionFx();
  scheduleBot(wait);
}

const BOT_DELAY = 750;
const BOT_ACTION_CAP = 400;
let botActions = 0;

/**
 * How long the just-applied action deserves on screen before the bot moves
 * again, so a turn reads as a sequence rather than a blur.
 */
function pacingFor(action: Action): number {
  switch (action.type) {
    case 'DECLARE_ATTACK':
      return 1500;
    case 'CAST_TRAP':
      return 2100;
    case 'CAST_SPELL':
    case 'ACTIVATE_POWER':
      return 1250;
    case 'PAY_FLIP':
    case 'DECLINE_FLIP':
      return 1000;
    case 'PLAY_SUMMON':
    case 'REPLACE_SUMMON':
    case 'PLAY_STAGE':
      return 950;
    case 'END_TURN':
      return 1100;
    default:
      return BOT_DELAY;
  }
}

function scheduleBot(delay = BOT_DELAY): void {
  const state = ui.state;
  if (!state || ui.botSeat === null || isOver(state)) return;
  if (actor() !== ui.botSeat) {
    ui.botBusy = false;
    botActions = 0;
    return;
  }
  if (botActions++ > BOT_ACTION_CAP) {
    ui.error = 'Bot hit its action cap and stopped.';
    ui.botBusy = false;
    return;
  }
  ui.botBusy = true;
  setTimeout(botStep, delay);
}

function botStep(): void {
  const state = ui.state;
  if (!state || ui.botSeat === null || actor() !== ui.botSeat) {
    ui.botBusy = false;
    return render();
  }
  const action = chooseAction(state, ui.botSeat);
  captureWounds();
  const res = applyAction(state, ui.botSeat, action);
  if (!res.ok) {
    takeWounds();
    ui.error = `Bot stuck: ${res.error}`;
    ui.botBusy = false;
    return render();
  }
  applyActionFx(state, res.state, action, ui.botSeat);
  ui.state = res.state;
  render();
  playSounds();
  playTrapReveal();
  playSmack();
  playEffectCallouts();
  playDraws();
  playDeckGifts();
  playHandPlays();
  playDeckOut();
  const wait = Math.max(pacingFor(action), fxTailMs());
  clearActionFx();
  scheduleBot(wait);
}

/**
 * Start collecting targets for a card or a Power. The source card is required:
 * targetCandidates narrows a spell or trap to what it may legally point at, and
 * without it a Spell Immune character is offered as a target the engine refuses.
 */
function beginAction(
  label: string,
  specs: TargetSpec[] | undefined,
  source: CardDef,
  build: (t: TargetRef[]) => Action,
): void {
  if (!specs || specs.length === 0) {
    dispatch(build([]));
    return;
  }
  ui.targeting = { label, specs, collected: [], source, build };
  ui.error = null;
  render();
}

/** Play or replace a summon, collecting battlecry targets first when any exist. */
function beginSummonPlay(handIndex: number, slot: number | null): void {
  const state = ui.state;
  if (!state) return;
  const id = state.players[viewSeat()].hand[handIndex];
  if (!id) return;
  const def = card(id);
  const specs = def.targets ?? [];
  const build = (targets: TargetRef[]): Action =>
    slot === null
      ? { type: 'REPLACE_SUMMON', handIndex, targets }
      : { type: 'PLAY_SUMMON', handIndex, slot, targets };
  const live = specs.some((sp) => targetCandidates(state, viewSeat(), sp, def).length > 0);
  if (!live) return dispatch(build([]));
  beginAction(def.name, specs, def, build);
}

/** Route a board click into the front of the choice queue when it is waiting. */
function offerChoice(ref: TargetRef): boolean {
  const state = ui.state;
  const ch = state?.choiceQueue[0];
  if (!state || !ch?.refs || !canAct()) return false;
  if (!ch.refs.some((r) => refKey(r) === refKey(ref))) return false;
  dispatch({ type: 'RESOLVE_CHOICE', pick: ref });
  return true;
}

/**
 * Hand a spell over to the targeting layer: the card stays in the hand, lifted,
 * with an arrow running from it to the cursor until every spec has a ref. A
 * two-target spell simply asks twice.
 */
function beginCast(def: CardDef, handIndex: number, specs: TargetSpec[], picked: TargetRef[]): void {
  ui.targeting = {
    label: def.name,
    specs,
    collected: picked,
    hand: handIndex,
    source: def,
    build: (targets) => ({ type: 'CAST_SPELL', handIndex, targets }),
  };
  ui.selection = { kind: 'hand', index: handIndex };
  ui.error = null;
  render();
}

function offerTarget(ref: TargetRef): boolean {
  const t = ui.targeting;
  if (!t) return false;
  if (!candidateKeys().has(refKey(ref))) return false;
  t.collected.push(ref);
  if (t.collected.length >= t.specs.length) dispatch(t.build(t.collected));
  else render();
  return true;
}

/**
 * An enemy-pick click. The prompt asks for the leader, but anything standing
 * on a living enemy's side names that player just as well.
 */
function offerEnemy(ref: TargetRef): boolean {
  const pick = ui.enemyPick;
  if (!pick || !ui.state || ref.kind === 'color') return false;
  const enemy = ref.player;
  if (enemy === viewSeat() || ui.state.players[enemy].eliminated) return false;
  ui.enemyPick = null;
  dispatch(pick.build(enemy));
  return true;
}

/**
 * Deckbuilder commands. Returns true when the command was one of ours, so the
 * main handler can carry on with the match commands otherwise.
 */
/**
 * Reads a list back off disk. The picked deck lands in the builder rather than
 * in the saved list, so an import can be looked over and edited before it is
 * kept, and it never overwrites a saved deck of the same name.
 */
function importDeckFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,text/plain';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const parsed = parseDeckList(text);
      if (!parsed.leaderId && parsed.cards.length === 0) {
        ui.error = `${file.name} has no deck list in it.`;
        return render();
      }
      const b = ui.builder;
      b.name = parsed.name || 'Imported deck';
      if (parsed.leaderId) b.leaderId = parsed.leaderId;
      b.cards = parsed.cards;
      // An import is a new deck in the workspace, not an edit of a saved one.
      b.editingKey = null;
      ui.error =
        parsed.skipped.length > 0
          ? `Imported ${parsed.cards.length} cards. Skipped ${parsed.skipped.length} line(s) naming cards this set does not have.`
          : null;
      render();
    });
  });
  input.click();
}

function handleBuilderCommand(cmd: string): boolean {
  const b = ui.builder;
  const [head, arg] = cmd.includes(':') ? [cmd.slice(0, cmd.indexOf(':')), cmd.slice(cmd.indexOf(':') + 1)] : [cmd, ''];

  switch (head) {
    case 'to-build':
      ui.screen = 'build';
      // A card hovered during the last match would otherwise open the
      // inspect overlay the moment the builder appears.
      ui.inspect = null;
      ui.inspectRef = null;
      break;
    case 'to-setup':
      closeDropdown();
      // Leaving for the menu ends any online session. Without this the phase is
      // still 'playing' after a match finishes, and the lobby greys out every
      // queue button because it goes on believing you are in a game.
      leaveOnline();
      ui.screen = 'setup';
      break;
    case 'to-rules':
      ui.screen = 'rules';
      ui.inspect = null;
      ui.inspectRef = null;
      break;
    case 'to-online':
      ui.screen = 'online';
      ui.online.error = null;
      // Open on whatever is set for player one downstairs, so the choice made
      // on the menu carries over rather than being made twice.
      ui.online.deckKey = ui.picks[0];
      ui.inspect = null;
      ui.inspectRef = null;
      break;
    case 'o-party': {
      const n = Number(arg);
      if ((n === 2 || n === 3 || n === 4) && ui.online.phase === 'idle') ui.online.party = n;
      break;
    }
    case 'o-timers':
      if (ui.online.phase === 'idle') ui.online.timers = arg === '1';
      break;
    case 'o-seek':
      void startOnline('public');
      break;
    case 'o-host':
      void startOnline('host');
      break;
    case 'o-join':
      void startOnline('join');
      break;
    case 'o-back':
      closeDropdown();
      leaveOnline();
      ui.screen = 'setup';
      break;
    case 'copy-report': {
      // Built at the moment it is asked for, so it describes the board the
      // player is looking at rather than whatever it looked like when the
      // trouble started.
      const text = closeReport({
        reason: ui.state && isOver(ui.state)
          ? (ui.state.winReason ?? 'the match ended')
          : (ui.online.error ?? ui.error ?? 'the match stopped'),
        state: ui.state,
        seat: ui.online.seat,
        roomCode: ui.online.roomCode,
        online: ui.online.phase === 'playing',
      });
      // Selecting nothing to fall back on, so the text goes to the console as
      // well: without a secure context the clipboard is simply refused, and a
      // player who cannot copy it can still read it out of the log.
      console.info(text);
      void navigator.clipboard?.writeText(text).catch(() => {});
      ui.reportCopied = true;
      render();
      window.setTimeout(() => {
        ui.reportCopied = false;
        render();
      }, 1600);
      break;
    }
    case 'o-copy': {
      const code = ui.online.roomCode;
      if (!code) break;
      // Selecting the field first means the code is still copyable by hand if
      // the clipboard is refused, which it is without a secure context.
      const box = document.querySelector<HTMLInputElement>('[data-act="ocopy"]');
      box?.select();
      void navigator.clipboard?.writeText(code).catch(() => {});
      ui.copied = true;
      render();
      window.setTimeout(() => {
        ui.copied = false;
        if (ui.screen === 'online') render();
      }, 1200);
      break;
    }
    case 'btab':
      b.tab = arg as BrowseTab;
      break;
    case 'brarity': {
      // Chips are a toggle set: none lit and all four lit both mean everything.
      const r = arg as Rarity;
      b.rarities = b.rarities.includes(r) ? b.rarities.filter((x) => x !== r) : [...b.rarities, r];
      if (b.rarities.length === RARITY_FILTERS.length) b.rarities = [];
      break;
    }
    case 'badd':
      if (canAdd(b, arg)) b.cards.push(arg);
      break;
    case 'bleader':
      // An empty arg drags the leader back out, leaving the slot to fill again.
      if (!arg || canBeLeader(arg)) b.leaderId = arg;
      break;
    case 'bdrop': {
      const at = b.cards.lastIndexOf(arg);
      if (at >= 0) b.cards.splice(at, 1);
      break;
    }
    case 'bclear':
      b.cards = [];
      break;
    case 'binspect':
      ui.inspect = arg;
      ui.inspectRef = null;
      break;
    case 'bview':
      b.viewingDeck = !b.viewingDeck;
      break;
    case 'bsave':
    case 'bplay':
      if (!isLegal(b)) break;
      b.saving = head === 'bplay' ? 'play' : 'save';
      break;
    case 'bcopy':
      if (!isLegal(b)) break;
      // Clearing editingKey is what makes this a copy. Every later save creates
      // a new deck, so the original keeps its cards even if the player cancels
      // the dialog.
      b.saving = 'copy';
      b.name = copyName(b.name);
      b.editingKey = null;
      break;
    case 'bsave-cancel':
      b.saving = null;
      break;
    case 'bsave-confirm': {
      // The dialog disables the button without a name, so this is the second
      // guard rather than the first.
      if (!isLegal(b) || deckNameProblem(b.name)) break;
      const playing = b.saving === 'play';
      const key = b.editingKey ?? `mine-${Date.now().toString(36)}`;
      const blurb = b.blurb.trim();
      const deck: SavedDeck = {
        key,
        name: b.name.trim(),
        leaderId: b.leaderId,
        cards: [...b.cards],
        ...(blurb ? { blurb } : {}),
      };
      saveDeck(deck);
      b.editingKey = key;
      b.saving = null;
      if (playing) {
        ui.picks = [key, ui.picks[1]];
        rememberPrefs();
        ui.screen = 'setup';
      }
      break;
    }
    case 'bedit': {
      const d = savedDecks().find((x) => x.key === arg);
      if (!d) break;
      ui.builder = { ...newBuilder(), name: d.name, blurb: d.blurb ?? '', leaderId: d.leaderId, cards: [...d.cards], editingKey: d.key, dev: b.dev };
      break;
    }
    case 'bdelete':
      deleteDeck(arg);
      if (b.editingKey === arg) b.editingKey = null;
      // A pick pointing at a deleted deck would make Start match throw.
      if (ui.picks[0] === arg) ui.picks[0] = 'deepcurrent';
      if (ui.picks[1] === arg) ui.picks[1] = 'emberchoir';
      rememberPrefs();
      break;
    case 'bexport-deck':
      download(`${b.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'deck'}.txt`, deckMarkdown(b), 'text/plain');
      break;
    case 'bimport-deck':
      importDeckFile();
      break;
    case 'suggest':
      b.suggestFor = arg;
      break;
    case 'bsuggest-cancel':
      b.suggestFor = null;
      break;
    case 'bsuggest-save': {
      const box = document.getElementById('suggestnote') as HTMLTextAreaElement | null;
      const note = box?.value.trim();
      if (b.suggestFor && note) addSuggestion(b.suggestFor, note);
      b.suggestFor = null;
      break;
    }
    case 'bexport-notes': {
      const notes = suggestions();
      if (notes.length > 0) download('card-suggestions.md', suggestionsMarkdown(notes));
      break;
    }
    case 'bclear-notes':
      clearSuggestions();
      break;
    default:
      return false;
  }
  render();
  return true;
}

/**
 * Every warmed image, held for the life of the page. Holding the paths alone is
 * not enough: once the loader's own Image goes out of scope the browser is free
 * to drop what it fetched, and every render rebuilds the board from HTML, so a
 * dropped sheet leaves cards flipping over transparent while it refetches. What
 * a held image pins is the encoded bytes, under a megabyte for the whole pack;
 * the decoded bitmaps stay the browser's to manage, and a sheet it re-decodes
 * comes off the pinned bytes without touching the network.
 */
const warmedArt = new Map<string, HTMLImageElement>();

function warmArt(paths: string[]): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const path of paths) {
    if (warmedArt.has(path)) continue;
    const img = new Image();
    warmedArt.set(path, img);
    jobs.push(
      new Promise<void>((resolve) => {
        img.onload = () => {
          // Decode up front too, so the first paint of a card is not the frame
          // that decodes it.
          void img.decode?.().catch(() => undefined).then(() => resolve());
        };
        img.onerror = () => {
          // A failure must not stand as warmed, or the art it covers would
          // never get another try at loading.
          warmedArt.delete(path);
          resolve();
        };
        img.src = `${BASE}${path}`;
      }),
    );
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Overlays, tokens and pips any match can show, whatever the decks are. */
const PACK_EXTRAS: string[] = [
  'Cardgame/Extras/PowerShield.png',
  'Cardgame/Extras/Deathrattle.png',
  'Cardgame/Extras/Locked.png',
  WOUND_TOKEN,
  NO_UNSAP,
  REDIRECT_TOKEN,
  SPELL_IMMUNE_TOKEN,
  CARD_BACK,
  ...Object.values(PIP_ART),
];

/**
 * Every image the game can show: each sheet, any drawing on no sheet, and the
 * shared extras. Warmed once at boot and held from then on, so no card ever
 * flips over transparent waiting for a fetch. Re-warming it is a no-op while
 * everything is held, which is what lets each state push and each return to a
 * visible tab retry whatever a flaky connection dropped.
 */
function allArtPaths(): string[] {
  const arts: string[] = [];
  for (const def of allCards()) if (def.art) arts.push(def.art);
  const paths: string[] = sheetsFor(arts);
  paths.push(...PACK_EXTRAS);
  return paths;
}

const packArt: string[] = allArtPaths();

/**
 * The opening hand is dealt rather than drawn: no action produced it, so the
 * diff that normally notices a draw never runs over it and it has to announce
 * itself. One sound per card rather than the usual cap, because a deal is meant
 * to sound like a deal.
 */
function playOpeningDraw(seat: PlayerIdx): void {
  const count = ui.state?.players[seat].hand.length ?? 0;
  if (count === 0) return;
  drawFx = [{ player: seat, count }];
  for (let i = 0; i < count; i++) cue('draw', i * DRAW_STEP, 0.9);
  playSounds();
  playDraws();
  playHandPlays();
}

function startMatch(decks: [DeckList, DeckList]): void {
  const seed = Math.floor(Math.random() * 0x7fffffff);
  // Who opens is a coin toss, taken off the seed rather than a second roll so
  // the seed on its own still reproduces the whole match.
  ui.state = createGame(decks, seed, (seed & 1) as PlayerIdx);
  ui.screen = 'game';
  ui.botSeat = ui.setupMode === 'ai' ? 1 : null;
  ui.botBusy = false;
  ui.selection = null;
  ui.targeting = null;
  ui.inspect = null;
  ui.inspectRef = null;
  ui.choiceHidden = false;
  // Versions start over with the match, so the answered-already marks have to.
  autoPassed = -1;
  autoDeclined = -1;
  resetLogGroups(ui.state);
  reformFrom.clear();
  reformShown.clear();
  // The first seat's leader reforms while the match is being built, before any
  // action exists, so this is the only chance to show what it came in as.
  beginLeaderReform(ui.state);
  mountGame();
  render();
  // Several things size themselves off what is already on screen: the HP fan's
  // spacing, the hand's overlap, the lane axis. On the very first paint there is
  // nothing there yet, so they take their fallbacks. One more pass settles them.
  requestAnimationFrame(() => render());
  playOpeningDraw(viewSeat());
  const seat = viewSeat();
  popNotice(
    `You are Player ${seat + 1}`,
    seat === ui.state.startingPlayer
      ? 'You go first.'
      : `Player ${ui.state.startingPlayer + 1} goes first.`,
  );
  clearActionFx();
  scheduleBot();
}

function handleCommand(cmd: string): void {
  if (cmd.startsWith('discard:')) {
    const arg = cmd.slice(8);
    ui.discardView = arg === '' ? null : (Number(arg) as PlayerIdx);
    return render();
  }
  if (cmd.startsWith('zoom:')) {
    ui.zoom = cmd.slice(5) || null;
    return render();
  }
  if (handleBuilderCommand(cmd)) return;
  if (cmd === 'start') {
    if (ui.preloading) return;
    const pick = (key: string, seatNo: number): DeckList => {
      const d = [...everyDeck, ...savedDeckList()].find((x) => x.key === key)!;
      const who = ui.setupMode === 'ai' ? (seatNo === 1 ? 'You' : 'Bot') : `P${seatNo}`;
      return { name: `${d.name} (${who})`, leaderId: d.leaderId, cards: d.cards };
    };
    const decks: [DeckList, DeckList] = [pick(ui.picks[0], 1), pick(ui.picks[1], 2)];
    // The pack warmed at boot, so this is normally instant; on a first visit
    // still downloading, a slow network gets cut off rather than holding the
    // match hostage.
    ui.preloading = true;
    render();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
    void Promise.race([warmArt(packArt), timeout]).then(() => {
      ui.preloading = false;
      startMatch(decks);
    });
    return;
  }
  if (cmd.startsWith('mode:')) {
    ui.setupMode = cmd.slice(5) as SetupMode;
    return render();
  }
  if (cmd.startsWith('pick0:')) {
    ui.picks[0] = cmd.slice(6);
    rememberPrefs();
    return render();
  }
  if (cmd.startsWith('pick1:')) {
    ui.picks[1] = cmd.slice(6);
    rememberPrefs();
    return render();
  }
  if (cmd === 'new-game') {
    // The match is over, so the online session that produced it is over too.
    // Without this the phase stays 'playing' and the lobby greys out every queue
    // button, because it goes on believing there is a game still running.
    leaveOnline();
    ui.screen = 'setup';
    ui.state = null;
    ui.botSeat = null;
    ui.botBusy = false;
    ui.selection = null;
    ui.targeting = null;
    return render();
  }
  const state = ui.state;
  if (!state) return;
  const me = viewSeat();
  const p = state.players[me];

  if (cmd === 'cancel') {
    ui.selection = null;
    ui.targeting = null;
    ui.enemyPick = null;
    ui.error = null;
    return render();
  }
  if (cmd === 'cancel-enemy') {
    ui.enemyPick = null;
    return render();
  }
  if (cmd === 'spectate') {
    ui.online.spectating = true;
    return render();
  }
  if (cmd === 'leave-match') {
    leaveOnline();
    ui.screen = 'setup';
    ui.state = null;
    ui.selection = null;
    ui.targeting = null;
    return render();
  }
  if (cmd === 'skip-choice') {
    return dispatch({ type: 'RESOLVE_CHOICE' });
  }
  if (cmd === 'choice-hide') {
    ui.choiceHidden = true;
    return render();
  }
  if (cmd === 'choice-show') {
    ui.choiceHidden = false;
    return render();
  }
  if (cmd === 'skip-target' && ui.targeting) {
    const t = ui.targeting;
    if (t.collected.length + 1 >= t.specs.length) dispatch(t.build(t.collected));
    else {
      t.specs = t.specs.filter((_, i) => i !== t.collected.length);
      render();
    }
    return;
  }
  if (cmd === 'end-turn') return dispatch({ type: 'END_TURN' });
  if (cmd === 'concede') return dispatch({ type: 'CONCEDE' });
  if (cmd === 'pass-response') return dispatch({ type: 'PASS_RESPONSE' });
  if (cmd === 'decline-replace') return dispatch({ type: 'DECLINE_REPLACE' });
  if (cmd === 'decline-flip') return dispatch({ type: 'DECLINE_FLIP' });
  if (cmd === 'pay-flip') {
    const offer = state.flipQueue[0];
    if (!offer) return;
    const needsDiscard = !!card(offer.cardId).flipCost?.discard;
    if (!needsDiscard) return dispatch({ type: 'PAY_FLIP' });
    const sel = ui.selection;
    if (sel?.kind !== 'hand') {
      ui.error = 'Click a card in your hand to discard first.';
      return render();
    }
    return dispatch({ type: 'PAY_FLIP', handIndex: sel.index });
  }

  if (cmd.startsWith('power:')) {
    const index = Number(cmd.slice(6));
    const sel = ui.selection;
    if (!sel || sel.kind !== 'summon') return;
    const s = findSummon(state, sel.ref);
    if (!s) return;
    const power = powersOf(s, card(s.cardId))[index];
    if (!power) return;
    const source = sel.ref as SourceRef;
    beginAction(power.name, power.targets, card(s.cardId), (targets) => ({
      type: 'ACTIVATE_POWER',
      source,
      powerIndex: index,
      targets,
    }));
    return;
  }

  const sel = ui.selection;
  if (!sel || sel.kind !== 'hand') return;
  const handIndex = sel.index;
  const id = p.hand[handIndex];
  if (!id) return;
  const def = card(id);

  if (cmd === 'supporter') return dispatch({ type: 'PLAY_SUPPORTER', handIndex });
  if (cmd === 'stage') return dispatch({ type: 'PLAY_STAGE', handIndex });
  if (cmd.startsWith('summon:')) {
    const slot = Number(cmd.slice(7));
    return beginSummonPlay(handIndex, state.replaceQueue.length > 0 ? null : slot);
  }
  if (cmd === 'cast') {
    return beginAction(def.name, def.targets, def, (targets) => ({
      type: 'CAST_SPELL',
      handIndex,
      targets,
    }));
  }
  if (cmd === 'trap') {
    return beginAction(def.name, def.targets, def, (targets) => ({
      type: 'CAST_TRAP',
      handIndex,
      targets,
    }));
  }
}

// --- pointer handling -------------------------------------------------------

function refFromEl(el: HTMLElement): TargetRef | null {
  const act = el.dataset.act;
  const player = Number(el.dataset.player) as PlayerIdx;
  if (act === 'slot' || act === 'empty') {
    return { kind: 'summon', player, slot: Number(el.dataset.slot) };
  }
  if (act === 'leader') return { kind: 'leader', player };
  // An HP fan stands for the body wearing it; a leader's fan carries no slot.
  if (act === 'hpfan') {
    return el.dataset.slot === ''
      ? { kind: 'leader', player }
      : { kind: 'summon', player, slot: Number(el.dataset.slot) };
  }
  if (act === 'support') return { kind: 'supporter', player, index: Number(el.dataset.index) };
  if (act === 'hand') return { kind: 'hand', player: viewSeat(), index: Number(el.dataset.index) };
  if (act === 'debt') return { kind: 'debt', player, index: Number(el.dataset.index) };
  if (act === 'discard') return { kind: 'discard', player, index: Number(el.dataset.index) };
  return null;
}

/**
 * Whether something waiting in a queue has to be settled before a swing.
 *
 * The same list the engine refuses a main-phase action on. Without it a press on
 * your own body starts an attack drag while a choice is still open, and the drag
 * swallows the click that would have answered the choice: the prompt never goes
 * away, an arrow springs from the ally as if it were attacking, and every other
 * action comes back with the engine telling you to settle the choice first.
 */
function swingBlocked(state: GameState): boolean {
  return (
    !!state.pending ||
    state.choiceQueue.length > 0 ||
    state.flipQueue.length > 0 ||
    state.replaceQueue.length > 0
  );
}

function sourceFromEl(el: HTMLElement): SourceRef | null {
  const act = el.dataset.act;
  const player = Number(el.dataset.player) as PlayerIdx;
  if (act === 'slot') return { kind: 'summon', player, slot: Number(el.dataset.slot) };
  if (act === 'leader') return { kind: 'leader', player };
  return null;
}

function stageRect(): DOMRect {
  return (document.querySelector('.stage') as HTMLElement).getBoundingClientRect();
}

/**
 * Screen pixels per stage pixel.
 *
 * A narrow desktop draws the table at its design width and scales the whole
 * thing down, so measured rects come back in screen pixels while anything drawn
 * inside the table (the arrows, the flip callouts) is laid out in the table's
 * own units. Without dividing one by the other the error grows with the
 * distance from the top left corner.
 */
function stageScale(): number {
  const app = document.getElementById('app');
  if (!app?.offsetWidth) return 1;
  return app.getBoundingClientRect().width / app.offsetWidth || 1;
}

/** A viewport point in stage coordinates. */
function toStage(x: number, y: number): { x: number; y: number } {
  const s = stageRect();
  const k = stageScale();
  return { x: (x - s.left) / k, y: (y - s.top) / k };
}

function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return toStage(r.left + r.width / 2, r.top + r.height / 2);
}

/** A press that becomes a drag only after the pointer moves a few pixels. */
let pendingDrag: { x: number; y: number; el: HTMLElement; drag: DragState } | null = null;
/** Set when a drag really happened, so the click that follows it is ignored. */
let suppressClick = false;

/**
 * The card that follows the cursor during a drag. It trails the pointer with
 * some easing, tilts with the motion, and snaps onto a legal drop target under
 * the cursor, shrinking toward board size as it lands.
 */
let ghost: {
  el: HTMLElement;
  x: number;
  y: number;
  tx: number;
  ty: number;
  tilt: number;
  rot: number;
  trot: number;
  scale: number;
  tscale: number;
  lastX: number;
  raf: number;
} | null = null;

function spawnGhost(src: HTMLElement, x: number, y: number): void {
  killGhost();
  const r = src.getBoundingClientRect();
  const el = src.cloneNode(true) as HTMLElement;
  el.classList.add('dragghost');
  el.classList.remove('ghosted', 'selected');
  // Appending keeps the card's inline --rf and --nf font variables intact. The
  // transition must go, or the ghost animates in from the viewport corner.
  el.style.cssText += `;position:fixed;left:0;top:0;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none;z-index:999;transition:none;`;
  el.style.setProperty('--cw', `${r.width}px`);
  el.style.setProperty('--cwn', String(r.width));
  document.body.appendChild(el);
  // Hover effects on the cards left behind would fight the drag for attention.
  document.body.classList.add('dragging');
  ghost = { el, x, y, tx: x, ty: y, tilt: 0, rot: 0, trot: 0, scale: 1, tscale: 1, lastX: x, raf: 0 };
  applyGhost();
  ghost.raf = requestAnimationFrame(ghostStep);
}

/** Aims the ghost: at the pointer, or seated on a snap point when one is given. */
function moveGhost(
  x: number,
  y: number,
  snap?: { x: number; y: number; rot?: number } | null,
): void {
  if (!ghost) return;
  const dx = x - ghost.lastX;
  ghost.lastX = x;
  // Lean into the motion a little, then settle back upright.
  ghost.tilt = Math.max(-13, Math.min(13, ghost.tilt * 0.8 + dx * 0.5));
  if (snap) {
    ghost.tx = snap.x;
    ghost.ty = snap.y;
    ghost.tscale = 0.82;
    ghost.trot = snap.rot ?? 0;
  } else {
    ghost.tx = x;
    ghost.ty = y;
    ghost.tscale = 1;
    ghost.trot = 0;
  }
}

/**
 * The cues a dragged card carries: castglow over a spot that would cast it,
 * castmid over the middle of the table where a spell with nobody to hit goes,
 * and aiming once a targeting spell has been pulled clear of the hand.
 */
function setGhostCue(name: 'castglow' | 'castmid' | 'aiming', on: boolean): void {
  ghost?.el.classList.toggle(name, on);
}

/** The line above the hand a spell has to clear before it will ask for targets. */
const AIM_CLEARANCE = 24;

/** Whether a drag has been pulled clear of the hand it came out of. */
function pulledClear(ev: PointerEvent): boolean {
  const rail = document.querySelector('#hand .handrail');
  if (!rail) return true;
  return ev.clientY < rail.getBoundingClientRect().top - AIM_CLEARANCE;
}

/** The band across the middle of the table, where a targetless spell is cast. */
function overMiddle(ev: PointerEvent): boolean {
  const line = document.querySelector('.board .divider');
  if (!line) return false;
  const r = line.getBoundingClientRect();
  if (ev.clientX < r.left || ev.clientX > r.right) return false;
  return Math.abs(ev.clientY - (r.top + r.height / 2)) < 110;
}

function ghostStep(): void {
  if (!ghost) return;
  ghost.x += (ghost.tx - ghost.x) * 0.32;
  ghost.y += (ghost.ty - ghost.y) * 0.32;
  ghost.scale += (ghost.tscale - ghost.scale) * 0.25;
  ghost.rot += (ghost.trot - ghost.rot) * 0.22;
  ghost.tilt *= 0.94;
  applyGhost();
  ghost.raf = requestAnimationFrame(ghostStep);
}

function applyGhost(): void {
  const g = ghost!;
  g.el.style.transform = `translate(${g.x - g.el.offsetWidth / 2}px, ${g.y - g.el.offsetHeight * 0.55}px) rotate(${g.rot + g.tilt}deg) scale(${g.scale})`;
}

function killGhost(): void {
  if (!ghost) return;
  cancelAnimationFrame(ghost.raf);
  ghost.el.remove();
  ghost = null;
  document.body.classList.remove('dragging');
}

function centerClient(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

interface BuildDrag {
  id: string;
  mode: 'add' | 'remove' | 'leader';
}
let buildDrag: BuildDrag | null = null;
let buildPending: {
  x: number;
  y: number;
  id: string;
  mode: 'add' | 'remove' | 'leader';
  el: HTMLElement;
} | null = null;

const DRAG_SLOP = 6;

function startBuildDrag(ev: PointerEvent): void {
  // A finger on a card is how the list is scrolled, and the browser decides
  // which it is long before the drag threshold is crossed: it takes the gesture
  // for a scroll, cancels the pointer, and the card is left mid-drag with no
  // release to end it. Tapping a card already adds it and tapping a row already
  // removes it, so touch keeps the scroll and the drag stays a mouse gesture.
  if (ev.pointerType === 'touch') return;
  const t = ev.target as HTMLElement;
  const leaderCard = t.closest<HTMLElement>('.leaderbox .card[data-cardid]');
  if (leaderCard) {
    buildPending = { x: ev.clientX, y: ev.clientY, id: leaderCard.dataset.cardid!, mode: 'leader', el: leaderCard };
    return;
  }
  const cardEl = t.closest<HTMLElement>('.bcell .card[data-bdrag]');
  if (cardEl) {
    buildPending = { x: ev.clientX, y: ev.clientY, id: cardEl.dataset.bdrag!, mode: 'add', el: cardEl };
    return;
  }
  const row = t.closest<HTMLElement>('.deckrow');
  if (row?.dataset.cmd?.startsWith('bdrop:')) {
    buildPending = { x: ev.clientX, y: ev.clientY, id: row.dataset.cmd.slice(6), mode: 'remove', el: row };
  }
}

function moveBuildDrag(ev: PointerEvent): void {
  if (buildPending && !buildDrag) {
    if (Math.hypot(ev.clientX - buildPending.x, ev.clientY - buildPending.y) <= DRAG_SLOP) return;
    spawnGhost(buildPending.el, ev.clientX, ev.clientY);
    buildDrag = { id: buildPending.id, mode: buildPending.mode };
    buildPending = null;
    if (buildDrag.mode === 'add') {
      document.querySelector('.deckpanel')?.classList.add('dropready');
      if (canBeLeader(buildDrag.id)) document.querySelector('.leaderbox')?.classList.add('leaderdrop');
    }
  }
  if (!buildDrag) return;
  moveGhost(ev.clientX, ev.clientY);
}

function endBuildDrag(ev: PointerEvent): void {
  buildPending = null;
  const d = buildDrag;
  if (!d) return;
  buildDrag = null;
  killGhost();
  document.querySelector('.deckpanel')?.classList.remove('dropready');
  document.querySelector('.leaderbox')?.classList.remove('leaderdrop');
  suppressClick = true;
  const at = document.elementFromPoint(ev.clientX, ev.clientY);
  const inLeader = !!at?.closest('.leaderbox');
  const inPanel = !!at?.closest('.deckpanel');
  if (d.mode === 'add') {
    // The leader slot takes whatever can stand as a leader; everywhere else on
    // the panel adds to the 48, leader cards included.
    if (inLeader && canBeLeader(d.id)) handleCommand(`bleader:${d.id}`);
    else if (inPanel) handleCommand(`badd:${d.id}`);
  }
  if (d.mode === 'remove' && !inPanel) handleCommand(`bdrop:${d.id}`);
  if (d.mode === 'leader' && !inLeader) handleCommand('bleader:');
}

/** Legal drops for dragging a hand card out: slots, spell targets, the supporter row. */
function startPlayDrag(ev: PointerEvent, el: HTMLElement): void {
  const state = ui.state!;
  const me = viewSeat();
  const p = state.players[me];
  if (state.pending || state.flipQueue.length > 0 || state.choiceQueue.length > 0) return;
  const index = Number(el.dataset.index);
  const id = p.hand[index];
  if (!id) return;
  const def = card(id);
  const targets: string[] = [];
  if (def.type === 'summon') {
    if (state.replaceQueue.length > 0) {
      targets.push(refKey({ kind: 'summon', player: me, slot: state.replaceQueue[0].slot }));
    } else {
      p.slots.forEach((slot, i) => {
        if (!slot) targets.push(refKey({ kind: 'summon', player: me, slot: i }));
      });
    }
  }
  if (def.type === 'spell' && def.targets?.length && canPay(p, costFor(p, def))) {
    for (const t of targetCandidates(state, me, def.targets[0], def)) targets.push(refKey(t));
  }
  // A spell that asks for no targets, or a field, casts on any board drop.
  let cast: DragState['cast'] = null;
  if (state.replaceQueue.length === 0 && canPay(p, costFor(p, def))) {
    if (def.type === 'spell' && !def.targets?.length) cast = 'spell';
    if (def.type === 'stage') cast = 'stage';
  }
  const canSupport = p.supportersLeft > 0 && state.replaceQueue.length === 0;
  if (targets.length === 0 && !canSupport && !cast) return;
  pendingDrag = {
    x: ev.clientX,
    y: ev.clientY,
    el,
    drag: {
      mode: 'play',
      source: null,
      hand: index,
      targets,
      canSupport,
      cast,
      spell: def.type === 'spell',
      aim: def.type === 'spell' && targets.length > 0,
      armed: false,
      from: centerOf(el),
      to: toStage(ev.clientX, ev.clientY),
      over: null,
      overSupport: false,
    },
  };
}

const DROP_SELECTOR = '[data-act="slot"],[data-act="leader"],[data-act="empty"],[data-act="supportrow"]';

function dropTarget(ev: PointerEvent): HTMLElement | null {
  return (
    document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(DROP_SELECTOR) ?? null
  );
}

/** The hand fan can overlap the supporter row, so hit-test its rect directly. */
function overOwnSupportRow(ev: PointerEvent): boolean {
  const row = document.querySelector(`[data-act="supportrow"][data-player="${viewSeat()}"]`);
  if (!row) return false;
  const r = row.getBoundingClientRect();
  return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
}

root.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  suppressClick = false;
  armHold(ev);
  if (ui.screen === 'build') return startBuildDrag(ev);
  if (!ui.state || !canAct() || ui.targeting) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act="slot"],[data-act="leader"]');
  if (el) {
    // A body that cannot swing yet is still a body that can be pointed at, so
    // the press is left alone for the click behind it to answer with.
    if (swingBlocked(ui.state)) return;
    const source = sourceFromEl(el);
    if (!source || source.player !== viewSeat()) return;
    const targets = legalAttackTargets(ui.state, source).map(refKey);
    if (targets.length === 0) return;
    ui.drag = {
      mode: 'attack',
      source,
      hand: -1,
      targets,
      canSupport: false,
      cast: null,
      spell: false,
      aim: false,
      armed: false,
      from: centerOf(el),
      to: toStage(ev.clientX, ev.clientY),
      over: null,
      overSupport: false,
    };
    ui.selection = { kind: 'summon', ref: source };
    // A pointer cancelled between down and capture throws; the drag still works.
    try {
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    } catch {
      /* nothing to capture */
    }
    ev.preventDefault();
    render();
    return;
  }
  const handEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-act="hand"]');
  if (handEl) startPlayDrag(ev, handEl);
});

/**
 * The stylesheet needs the viewport as plain numbers: the unitless card-width
 * twins that drive --cardscale are number arithmetic, and CSS cannot turn vh
 * or vw into a number on every browser this game meets.
 */
function syncViewport(): void {
  const root = document.documentElement.style;
  root.setProperty('--vwn', String(window.innerWidth));
  root.setProperty('--vhn', String(window.innerHeight));
}

window.addEventListener('resize', () => {
  // First: everything measured below sits downstream of the card sizes.
  syncViewport();
  const wasMobile = document.body.classList.contains('mobile');
  syncLayout();
  // Crossing into the phone layout changes the size a held card is drawn at, and
  // both fans are placed card by card in script off that size, so they have to be
  // laid out again rather than left spaced for a card that is no longer there.
  if (document.body.classList.contains('mobile') !== wasMobile) return render();
  syncWell();
  syncHandAxis();
  fitFans();
  renderArrow();
});

window.addEventListener('pointermove', (ev) => {
  holdMoved(ev);
  if (ui.screen === 'build') return moveBuildDrag(ev);
  if (ui.screen === 'game' && document.querySelector('.stage')) {
    pointerAt = toStage(ev.clientX, ev.clientY);
  }
  if (pendingDrag && !ui.drag) {
    if (Math.hypot(ev.clientX - pendingDrag.x, ev.clientY - pendingDrag.y) <= DRAG_SLOP) return;
    // Clone before render() replaces the hand element the drag came from.
    spawnGhost(pendingDrag.el, ev.clientX, ev.clientY);
    ui.drag = pendingDrag.drag;
    pendingDrag = null;
    startHold();
    render();
  }
  const d = ui.drag;
  if (!d) {
    // No drag, but a spell being aimed or a board choice keeps the arrow chasing
    // the cursor.
    if (aimActive() || boardChoiceActive()) renderArrow();
    return;
  }
  d.to = toStage(ev.clientX, ev.clientY);
  const under = dropTarget(ev);
  const ref = under && under.dataset.act !== 'supportrow' ? refFromEl(under) : null;
  d.over = ref && d.targets.includes(refKey(ref)) ? ref : null;
  d.overSupport = d.mode === 'play' && d.canSupport && overOwnSupportRow(ev);
  if (d.mode === 'play') {
    // The ghost seats itself on whatever legal drop the pointer is over: a
    // slot or target, the supporter row (turning sideways, since that is how
    // a supporter lies), or the field cell when one is near. Spells never
    // seat on bodies; they glow over anything that would cast them instead.
    let snap: { x: number; y: number; rot?: number } | null = null;
    const row = document.querySelector(`[data-act="supportrow"][data-player="${viewSeat()}"]`);
    row?.classList.toggle('supportdrop', d.overSupport);
    if (d.overSupport) {
      if (row) snap = { ...centerClient(row), rot: 90 };
    } else if (d.over && under && !d.spell) {
      snap = centerClient(under);
    } else if (d.cast === 'stage') {
      const cell = document.querySelector(`.stagecell[data-player="${viewSeat()}"]`);
      if (cell) {
        const c = centerClient(cell);
        const near = Math.hypot(ev.clientX - c.x, ev.clientY - c.y) < 110;
        cell.classList.toggle('stagedrop', near);
        if (near) snap = c;
      }
    }
    const overBoard = !!document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.board');
    const casting = d.cast === 'spell' && overBoard && !d.overSupport;
    d.armed = d.aim && !d.overSupport && pulledClear(ev);
    setGhostCue('castglow', d.spell && !d.overSupport && (d.over !== null || casting));
    setGhostCue('castmid', casting && overMiddle(ev));
    setGhostCue('aiming', d.armed);
    moveGhost(ev.clientX, ev.clientY, snap);
  }
  renderArrow();
});

window.addEventListener('pointercancel', (ev) => {
  cancelHold();
  // The browser takes the gesture over rather than handing back a release, so
  // this is the only chance to put a half-finished drag down.
  buildPending = null;
  if (buildDrag) {
    buildDrag = null;
    killGhost();
    document.querySelector('.deckpanel')?.classList.remove('dropready');
    document.querySelector('.leaderbox')?.classList.remove('leaderdrop');
    render();
  }
  if (ui.drag || ghost) {
    ui.drag = null;
    killGhost();
    render();
  }
  void ev;
});

window.addEventListener('pointerup', (ev) => {
  cancelHold();
  if (ui.screen === 'build') return endBuildDrag(ev);
  killGhost();
  if (pendingDrag && !ui.drag) {
    pendingDrag = null;
    return;
  }
  const d = ui.drag;
  if (!d) return;
  suppressClick = true;
  const under = dropTarget(ev);
  const ref = under && under.dataset.act !== 'supportrow' ? refFromEl(under) : null;

  if (d.mode === 'attack') {
    const source = d.source!;
    const legal = ref && d.targets.includes(refKey(ref));
    ui.drag = null;
    if (legal && ref) dispatch({ type: 'DECLARE_ATTACK', source, target: ref });
    else render();
    return;
  }

  const handIndex = d.hand;
  const state = ui.state;
  ui.drag = null;
  if (!state) return render();
  const me = viewSeat();
  const id = state.players[me].hand[handIndex];
  if (!id) return render();
  const def = card(id);

  if (d.canSupport && overOwnSupportRow(ev)) {
    return dispatch({ type: 'PLAY_SUPPORTER', handIndex });
  }
  if (ref && d.targets.includes(refKey(ref))) {
    if (def.type === 'summon') {
      return beginSummonPlay(
        handIndex,
        state.replaceQueue.length > 0 ? null : (ref as { slot: number }).slot,
      );
    }
    if (def.type === 'spell') {
      const specs = def.targets ?? [];
      if (specs.length <= 1) return dispatch({ type: 'CAST_SPELL', handIndex, targets: [ref] });
      // The drop supplies the first target; the rest are picked by clicking.
      return beginCast(def, handIndex, specs, [ref]);
    }
  }
  // Pulled clear of the hand and let go over nothing in particular: the spell
  // stays in hand and asks for its targets on the board, one arrow at a time.
  if (d.aim && d.armed) return beginCast(def, handIndex, def.targets ?? [], []);
  // A targetless spell or a field cast by dropping it anywhere on the board.
  if (d.cast && document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.board')) {
    if (d.cast === 'spell') return dispatch({ type: 'CAST_SPELL', handIndex, targets: [] });
    return dispatch({ type: 'PLAY_STAGE', handIndex });
  }
  render();
});

root.addEventListener('input', (ev) => {
  const el = ev.target as HTMLElement;
  if (el.dataset.act === 'vol') {
    // No render: rebuilding the slider mid-drag would drop the drag.
    setLevel(el.dataset.bus as 'music' | 'sfx', Number((el as HTMLInputElement).value) / 100);
    return;
  }
  if (el.dataset.act === 'oppslider') {
    // No render here: the knob retargets the glide and the boards chase it
    // smoothly, taking over from any turn-change slide in progress.
    const row = document.querySelector<HTMLElement>('.opprow');
    if (row) {
      const room = row.scrollWidth - row.clientWidth;
      glideOppRow({ x: (Number((el as HTMLInputElement).value) / 1000) * room, fromKnob: true });
    }
    return;
  }
  // These three fields update a label or a button beside themselves. A full
  // render would replace the field mid-keystroke and flash, so each patches the
  // one thing it changes and leaves the rest of the page alone.
  if (el.dataset.act === 'dname') {
    ui.builder.name = (el as HTMLInputElement).value;
    const bad = deckNameProblem(ui.builder.name);
    const save = document.querySelector<HTMLButtonElement>('[data-cmd="bsave-confirm"]');
    if (save) save.disabled = bad !== null;
    const err = document.querySelector<HTMLElement>('.saveerr');
    if (err) err.textContent = bad && ui.builder.name.length > 0 ? bad : '';
  }
  if (el.dataset.act === 'dblurb') {
    ui.builder.blurb = (el as HTMLTextAreaElement).value;
    const count = document.querySelector<HTMLElement>('.charcount');
    if (count) {
      count.textContent = `(Limit: ${ui.builder.blurb.length}/${DECK_BLURB_MAX} characters)`;
    }
  }
  if (el.dataset.act === 'oname') {
    ui.online.name = (el as HTMLInputElement).value;
    ui.online.error = null;
    rememberPrefs();
    const bad = nameProblem(ui.online.name);
    for (const cmd of ['o-seek', 'o-host', 'o-join']) {
      const btn = document.querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`);
      if (btn) btn.disabled = bad !== null || ui.online.phase !== 'idle';
    }
    const err = document.querySelector<HTMLElement>('.lobbystatus');
    if (err) err.textContent = bad && ui.online.name.trim().length > 0 ? bad : '';
  }
  if (el.dataset.act === 'ocode') {
    ui.online.code = (el as HTMLInputElement).value.toUpperCase();
    (el as HTMLInputElement).value = ui.online.code;
  }
  if (el.dataset.act === 'bsearch') {
    const box = el as HTMLInputElement;
    const caret = box.selectionStart ?? box.value.length;
    ui.builder.search = box.value;
    // The re-render replaces the input, so hand focus and the caret back.
    render();
    const fresh = document.getElementById('bsearch') as HTMLInputElement | null;
    if (fresh) {
      fresh.focus();
      fresh.setSelectionRange(caret, caret);
    }
  }
});
mountDropdowns({
  root,
  onPick: (name, value) => {
    if (name === 'dleader') {
      ui.builder.leaderId = value;
      return render();
    }
    if (name === 'odeck') {
      ui.online.deckKey = value;
      // The lobby opens on player one's deck downstairs, so a pick made up here
      // moves that same choice rather than a second one nothing would remember.
      ui.picks[0] = value;
      rememberPrefs();
      // Changing the deck while already queued has to reach the room, or the
      // match deals the deck that was picked when the seat was taken.
      if (net && (ui.online.phase === 'connecting' || ui.online.phase === 'waiting')) {
        const saved = savedDecks().find((d) => d.key === value);
        net.changeDeck(
          value,
          ui.online.name.trim(),
          saved ? { leaderId: saved.leaderId, cards: saved.cards } : undefined,
        );
      }
      return render();
    }
    if (name === 'dimport') {
      if (!value) return;
      const from = [...everyDeck, ...savedDeckList()].find((d) => d.key === value);
      if (from) {
        ui.builder = {
          ...newBuilder(),
          name: `${from.name} copy`,
          leaderId: from.leaderId,
          cards: [...from.cards],
          dev: ui.builder.dev,
          tab: ui.builder.tab,
          rarities: [...ui.builder.rarities],
        };
      }
      return render();
    }
  },
});
// Keeps the view slider's knob under the carousel as it moves for any other
// reason: a finger swipe, or the smooth slide to whoever's turn began. Scroll
// does not bubble, so the listener rides the capture phase.
window.addEventListener(
  'scroll',
  (ev) => {
    // Not while the knob is the one driving: rewriting it mid-drag would
    // wrestle the hand holding it.
    if (
      ev.target instanceof HTMLElement &&
      ev.target.classList.contains('opprow') &&
      !sliderDriving()
    ) {
      syncOppSlider();
    }
  },
  true,
);

// The table has no up-and-down scrolling, so over the board the wheel looks
// along it instead, riding the same glide as everything else. Sideways
// trackpad panning keeps its native handling on the row itself.
root.addEventListener(
  'wheel',
  (ev) => {
    if (!ui.state || !isParty(ui.state)) return;
    if (!(ev.target instanceof HTMLElement) || !ev.target.closest('#board')) return;
    if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
    const row = document.querySelector<HTMLElement>('.opprow');
    if (!row || row.scrollWidth <= row.clientWidth) return;
    ev.preventDefault();
    // Line-mode deltas (Firefox wheels) arrive in rows rather than pixels.
    const step = (ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY) * 1.2;
    const base = slideGoal && 'x' in slideGoal ? slideGoal.x : row.scrollLeft;
    const room = row.scrollWidth - row.clientWidth;
    glideOppRow({ x: Math.max(0, Math.min(room, base + step)) });
  },
  { passive: false },
);

root.addEventListener('click', (ev) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'btn') return handleCommand(el.dataset.cmd ?? '');
  // The view slider handles itself through input events; a click on it must
  // not fall through to the render at the bottom and rebuild it mid-drag.
  if (act === 'oppslider') return;
  if (act === 'theme') {
    setTheme(el.dataset.cmd === 'light' ? 'light' : 'dark');
    return render();
  }
  if (act === 'devmode') {
    ui.builder.dev = (el as HTMLInputElement).checked;
    return render();
  }
  if (act === 'reveal') {
    ui.revealAll = (el as HTMLInputElement).checked;
    return render();
  }
  if (act === 'pick') {
    // Clicking a revealed card takes it outright; no confirm step.
    return dispatch({ type: 'RESOLVE_CHOICE', index: Number(el.dataset.index) });
  }

  const state = ui.state;
  if (!state) return;
  if (el.dataset.cardid) {
    ui.inspect = el.dataset.cardid;
    ui.inspectRef = refFromEl(el);
  }
  if (!canAct()) return render();

  const ref = refFromEl(el);
  if (ref && offerEnemy(ref)) return;
  if (ref && offerChoice(ref)) return;
  if (ref && offerTarget(ref)) return;

  const me = viewSeat();

  if (act === 'hand') {
    ui.selection = { kind: 'hand', index: Number(el.dataset.index) };
    ui.error = null;
    return render();
  }

  if (act === 'empty') {
    const sel = ui.selection;
    if (sel?.kind === 'hand' && Number(el.dataset.player) === me) {
      const id = state.players[me].hand[sel.index];
      if (id && card(id).type === 'summon') {
        return beginSummonPlay(
          sel.index,
          state.replaceQueue.length > 0 ? null : Number(el.dataset.slot),
        );
      }
    }
    return render();
  }

  if (act === 'slot' || act === 'leader') {
    const target = refFromEl(el)!;
    const sel = ui.selection;
    if (sel?.kind === 'summon' && Number(el.dataset.player) !== me) {
      if (attackKeys().has(refKey(target))) {
        return dispatch({ type: 'DECLARE_ATTACK', source: sel.ref as SourceRef, target });
      }
    }
    ui.selection = Number(el.dataset.player) === me ? { kind: 'summon', ref: target } : null;
    ui.error = null;
    return render();
  }

  if (act === 'support') {
    if (Number(el.dataset.player) !== me) return render();
    return dispatch({ type: 'SAP_SUPPORTER', index: Number(el.dataset.index) });
  }

  render();
});

root.addEventListener('mouseover', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-cardid]');
  if (!el || !ui.state) return;
  const id = el.dataset.cardid!;
  // The same card in two places is not the same preview: one of them may be
  // standing on the board wearing buffs.
  const ref = refFromEl(el);
  const key = (r: TargetRef | null) => (r ? refKey(r) : '');
  if (ui.inspect === id && key(ui.inspectRef) === key(ref)) return;
  ui.inspect = id;
  ui.inspectRef = ref;
  renderRail();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    // The magnified card is the top thing on screen, so it goes first.
    if (ui.zoom) {
      ui.zoom = null;
      return render();
    }
    if (ui.discardView !== null) {
      ui.discardView = null;
      return render();
    }
    ui.drag = null;
    killGhost();
    handleCommand('cancel');
  }
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).ernumrites = { ui, dispatch, render, colorsOf };
}

// --- the hover glossary ------------------------------------------------------

/** Keyword detectors and the one-line definitions the tooltip shows. */
const KEYWORD_HELP: [RegExp, string, string][] = [
  [/Battlecry:/, 'Battlecry', 'Fires once, as this summon enters play.'],
  [/Deathrattle:/, 'Deathrattle', 'Fires as this summon dies, before its debt is paid.'],
  [/Strike:/, 'Strike', 'Fires when this summon declares an attack, before the clash.'],
  [/\bScry \d/, 'Scry N', 'Look at the top N cards of your deck, take the first match to your hand, and put the rest on the bottom.'],
  [/\bCatch\b/, 'Catch', "A spent, face-up HP card leaves the board and returns to its owner's hand."],
  [/\bMills?\b/, 'Mill', 'Cards move from the top of a deck into its discard pile.'],
  [/\b(?:[Hh]eals?|Fully heal)\b/, 'Heal', 'Healing a character turns its flipped HP cards back face down. Healing debt lowers the debt counter.'],
  [/\bWound(?:ed|s)?\b/, 'Wounds', 'Every 2 Wounds on a body immediately become 1 damage, so a single Wound lingers as a visible mark.'],
  [/\bPower Shields?\b/, 'Power Shield', 'Blocks the next instance of damage completely, then breaks.'],
  [/\bRedirection\b/, 'Redirection', 'Enemies may only attack this body and only aim spells and traps at it.'],
  [/\bStationary\b/, 'Stationary', 'Never declares an attack, but still deals its attack back when attacked.'],
  [/\bSpell Immunity\b/, 'Spell Immunity', 'No spell or trap may choose this body as a target, from either side.'],
  [/\bSpell Trap\b/, 'Spell Trap', 'Springs when the enemy casts a spell, and countering it means the spell never resolves.'],
  [/\bEffect Damage\b/, 'Effect Damage', 'Damage from your spells, Powers and flips is increased by this much.'],
  [/\bcharacters?\b/, 'Character', 'A summon or a leader.'],
  [/\b(?:un)?sap(?:ped|s|ping)?\b/i, 'Sap', 'A sapped card cannot attack or use Powers until its next turn. ↷ on a Power means sapping this summon is part of the cost.'],
];

function glossaryText(def: CardDef): string {
  return [def.text ?? '', def.flipText ?? '', ...(def.powers ?? []).map((p) => p.text)].join(' ');
}

let nameIndex: { id: string; re: RegExp }[] | null = null;

/** Card names worth linking when another card's text mentions them. */
function cardNameIndex(): { id: string; re: RegExp }[] {
  if (!nameIndex) {
    nameIndex = allCards()
      .filter((d) => d.name.length >= 3 && !d.name.includes(':'))
      .map((d) => ({
        id: d.id,
        re: new RegExp(`\\b${d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
      }));
  }
  return nameIndex;
}

function refCardLine(d: CardDef): string {
  // For a curse the flip is the whole card, so the hand boilerplate is noise.
  const bits = [d.text, d.flipText ? `FLIP: ${d.flipText}` : ''].filter(
    (t) => t && t !== 'Does nothing in your hand.',
  );
  const rules = bits.join(' ') || (d.powers ?? []).map((p) => p.text).join(' ');
  if (d.type === 'summon') {
    return `${d.strength ?? 0}/${d.hp ?? 0} level ${d.level ?? 1} summon. ${rules}`.trim();
  }
  return `${d.type}. ${rules}`.trim();
}

function tooltipHtml(def: CardDef): string {
  const all = glossaryText(def);
  const rows: string[] = [];
  for (const [re, term, help] of KEYWORD_HELP) {
    const sapCost = term === 'Sap' && (def.powers ?? []).some((p) => p.sapSelf);
    if (re.test(all) || sapCost) {
      rows.push(`<div class="tiprow"><b>${esc(term)}</b> ${esc(help)}</div>`);
    }
  }
  const refs: string[] = [];
  for (const entry of cardNameIndex()) {
    if (entry.id === def.id || refs.length >= 3) continue;
    if (!entry.re.test(all)) continue;
    const rdef = card(entry.id);
    refs.push(`<div class="tiprow"><b>${esc(rdef.name)}</b> ${esc(refCardLine(rdef))}</div>`);
  }
  if (!rows.length && !refs.length) return '';
  return (
    rows.join('') +
    (refs.length ? `<div class="tiphead">Named on this card</div>${refs.join('')}` : '')
  );
}

function initCardTips(): void {
  const tip = document.createElement('div');
  tip.id = 'cardtip';
  document.body.appendChild(tip);
  let timer = 0;
  let showingFor: string | null = null;

  const hide = () => {
    window.clearTimeout(timer);
    tip.classList.remove('show');
    showingFor = null;
  };

  document.addEventListener('pointerover', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-cardid]');
    if (!el) {
      hide();
      return;
    }
    const id = el.dataset.cardid!;
    if (id === showingFor) return;
    window.clearTimeout(timer);
    const def = tryCard(id);
    if (!def) {
      hide();
      return;
    }
    timer = window.setTimeout(() => {
      const html = tooltipHtml(def);
      if (!html) {
        hide();
        return;
      }
      tip.innerHTML = html;
      showingFor = id;
      const r = el.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 296, r.right + 10))}px`;
      tip.classList.add('show');
      const h = tip.getBoundingClientRect().height;
      tip.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, r.top))}px`;
    }, 350);
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener(
    'scroll',
    () => {
      if (showingFor) hide();
    },
    true,
  );
}

initCardTips();

/**
 * The wheel over a play-by-play tile scrolls that tile's hover card rather than
 * the page. A long exchange runs past the card's rules box, and reaching the
 * text to scroll it means leaving the tile the card is hanging off.
 */
document.addEventListener(
  'wheel',
  (ev) => {
    const tile = (ev.target as HTMLElement).closest<HTMLElement>('.histile');
    const lines = tile?.querySelector<HTMLElement>('.histpop .histlines');
    if (!lines || lines.scrollHeight <= lines.clientHeight) return;
    // Let the page have the wheel back once the list is at the end it is being
    // pushed toward, so the gesture does not dead-end on the strip.
    const atTop = lines.scrollTop <= 0;
    const atBottom = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 1;
    if ((ev.deltaY < 0 && atTop) || (ev.deltaY > 0 && atBottom)) return;
    lines.scrollTop += ev.deltaY;
    ev.preventDefault();
  },
  { passive: false },
);

/**
 * The stylesheet draws every face-down card, but a url() written there would be
 * resolved against the stylesheet rather than the deployed base path, so the
 * one place that knows the base hands it over.
 */
document.documentElement.style.setProperty('--cardback', `url('${BASE}${CARD_BACK}')`);
for (const [name, art] of [
  ['--buff-sparkle', BUFF_SPARKLE],
  ['--debuff-orb', DEBUFF_ORB],
  ['--buff-arrow', BUFF_ARROW],
  ['--debuff-arrow', DEBUFF_ARROW],
] as const) {
  document.documentElement.style.setProperty(name, `url('${BASE}${art}')`);
}

initTheme();
restorePrefs();
mountGuy(BASE);

// A browser will not make a sound until the page has been clicked, so the first
// click anywhere is what wakes the music. Every click after it only resumes a
// context the browser may have suspended in the meantime, which is why this is
// not a one-shot listener, and why it listens on the way down: a handler that
// stops the event further in must not also stop the sound.
window.addEventListener(
  'pointerdown',
  () => {
    startAudio(BASE);
    setSfxBase(BASE);
    warmSfx();
  },
  { capture: true },
);

// Time passes while a tab is hidden but its animations and timers do not keep
// up, so the clock bar and the warning that rides it are put back in step with
// the room the moment the tab is looked at again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  resyncFuse();
  ropeTick();
  // A backgrounded tab is where the browser sheds what it can. Anything still
  // held survives that; this refetches whatever an earlier warm failed to get.
  void warmArt(packArt);
});

syncViewport();
render();
void prepareFrames(BASE).then(render);
onTintReady(render);

// The whole pack warms at boot and stays held for the life of the page. That
// was once the thing that pushed browsers into evicting art mid-game, but that
// was when the pack was three hundred loose faces each holding its own decoded
// bitmap. As sheets it pins under a megabyte of encoded bytes, and the browser
// decodes and drops the bitmaps as it pleases without ever needing the network.
void warmArt(packArt);

