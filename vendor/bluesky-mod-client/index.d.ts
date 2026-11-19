// Types for bluesky-mod-client. The API's full shapes are in docs/API.md;
// the fields typed here are the ones a page most often reads.

export type Band = 'PROTECTED' | 'CONNECTED' | 'PERIPHERAL' | 'NOTABLE' | 'UNKNOWN';
export type Tier = 'owner' | 'writer' | 'reader';
export type Family = 'name' | 'band' | 'label' | 'agent' | 'none';
export type Label = 'hostile' | 'arguing' | 'neutral';

export const API_VERSION: 1;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string);
}

export type Auth =
  | 'cookie'
  | { token: string | (() => string | Promise<string>) }
  /** A service-auth token from the account's PDS: aud the bot's DID, no lxm. */
  | { serviceAuth: () => Promise<string> };

export interface ClientOptions {
  /** Where the bot's panel is served, like https://mod.example.com. */
  baseUrl?: string;
  auth?: Auth;
  fetch?: typeof fetch;
  /** Called when the bot answers 401. */
  onSignedOut?: () => void;
}

export interface Me {
  apiVersion: number;
  did: string;
  tier: Tier;
  canWrite: boolean;
  via: 'cookie' | 'atproto' | 'token';
  expiresAt: string | null;
  bot: { did: string | null; handle: string | null };
  owner: { did: string; handle: string | null };
  hasModel: boolean;
  dryRun: boolean;
}

export interface ListRow {
  did: string;
  handle: string | null;
  band: Band | null;
  bandThen: Band | null;
  vouches: number | null;
  followers: number | null;
  protectedReason: string | null;
  rescored: boolean;
  via: string | null;
  family: Family;
  code: string | null;
  addedAt: string | null;
  keptBand: Band | null;
  label: Label | null;
  quote: string | null;
}

export interface QueueRow extends ListRow {
  reason: 'close' | 'closer';
}

export interface Page<Row> {
  total: number;
  matched: number;
  rows: Row[];
  [key: string]: unknown;
}

export interface PlanSummary {
  code: string;
  createdAt: string;
  list: string | null;
  approved: boolean;
  uri: string | null;
  kind: string | null;
  total: number;
  byBand: Record<Band, number>;
  labels: Record<Label, number>;
  added: number;
  live: number;
  state: 'waiting' | 'adding' | 'added' | 'cancelled' | 'undone';
  [key: string]: unknown;
}

export interface PlanRow {
  did: string;
  band: Band;
  vouches: number | null;
  kinds: string[];
  label: Label | null;
  quote: string | null;
  protected: boolean;
  added: boolean;
  undone: boolean;
  via: string | null;
  listed: boolean;
  blocksYou: boolean;
  [key: string]: unknown;
}

export interface Plan extends PlanSummary {
  /** False for a typed block or removal, which is not a scan. */
  scan: boolean;
  words: string[];
  rows: PlanRow[];
}

export interface CommandReply {
  ok: true;
  action: string;
  text: string;
  outcome: 'done' | 'failed' | null;
  options: { label: string; command: string; commands: string[]; takesBack: boolean }[];
  /** The bot is asking which list; every option names one. */
  choice: boolean;
}

export interface Rate {
  count: number;
  windowMs: number;
}

export interface ShieldState {
  running: boolean;
  canAct?: boolean;
  problem?: string | null;
  attack?: { on: boolean; since: string | null; until: string | null; why: string | null; mode: string; trip: Rate | null };
  triggers?: { mode: string; replies: Rate | null; quotes: Rate | null; replyRule: string[] | null };
  stream?: { on: boolean; live: boolean; coversMs: number; held: number };
  limits?: { post: string; kind: 'replies' | 'quotes'; why: string; appliedAt: string; restoreAfter: string | null }[];
  guards?: { post: string; mode: 'ask' | 'auto'; until: string }[];
}

type Json = Record<string, any>;

export interface Client {
  request(method: 'GET' | 'POST', path: string, opts?: { params?: Json; body?: Json }): Promise<any>;
  get(path: string, params?: Json): Promise<any>;
  post(path: string, body?: Json): Promise<any>;

  me(): Promise<Me>;
  health(): Promise<Json>;
  settings(): Promise<Json>;
  people(): Promise<Json>;
  signIn(code: string, opts?: { token?: boolean }): Promise<{ ok: true; token?: string; expiresAt?: string }>;
  signOut(): Promise<{ ok: true }>;
  signOutEverywhere(): Promise<{ ok: true }>;

  lists(): Promise<{ multi: boolean; lists: { rkey: string; name: string; n: number }[] }>;
  overview(opts?: { days?: number; list?: string }): Promise<Json>;
  list(opts?: {
    band?: Band | 'UNSCORED';
    family?: Family;
    q?: string;
    sort?: 'closest' | 'recent';
    offset?: number;
    limit?: number;
    list?: string;
  }): Promise<Page<ListRow>>;
  radar(opts?: { list?: string }): Promise<Json>;
  members(opts?: { list?: string }): Promise<{ list: string; complete: boolean; dids: string[] }>;
  queue(opts?: { band?: Band; offset?: number; limit?: number }): Promise<Page<QueueRow>>;
  keep(did: string, band: Band): Promise<{ ok: true }>;
  reopen(did: string): Promise<{ ok: true }>;
  protectedAccounts(opts?: { q?: string; offset?: number; limit?: number }): Promise<Json>;
  activity(opts?: { filter?: 'added' | 'removed' | 'undone'; offset?: number; limit?: number }): Promise<{ more: boolean; events: Json[] }>;

  account(actor: string): Promise<Json>;
  profiles(dids: string[]): Promise<{ profiles: Record<string, Json> }>;
  check(link: string): Promise<Json>;
  scans(opts?: { state?: PlanSummary['state']; before?: string; limit?: number }): Promise<{
    scans: PlanSummary[];
    counts: Record<string, number>;
    more: boolean;
    next: string | null;
  }>;
  scan(code: string): Promise<Plan>;
  startScan(link: string, kind?: 'everyone' | 'likers' | 'reposters' | 'repliers' | 'quoters'): Promise<{ code: string }>;
  watches(): Promise<{ live: Json[]; ended: Json[] }>;
  stopWatch(uri: string): Promise<{ ok: boolean }>;

  graph(): Promise<Json>;
  vouches(opts: { dids: string[] } | { min?: number; limit?: number }): Promise<{
    takenAt: string | null;
    scoring: 'full' | 'simple' | null;
    vouches: Record<string, number>;
  }>;
  rebuild(): Promise<{ started: boolean; reason?: string }>;
  rescore(): Promise<{ started: boolean; reason?: string }>;
  models(opts?: { days?: number }): Promise<Json>;
  shield(): Promise<ShieldState>;

  command(text: string): Promise<CommandReply>;
}

export function createClient(opts?: ClientOptions): Client;

// Bands
export const BANDS: Band[];
export const CLOSE: Exclude<Band, 'UNKNOWN'>[];
export function viaFamily(via: string | null | undefined): Family;
export function bandName(band: Band | 'UNSCORED' | null | undefined): string;
export const BAND_RULE: Record<Band, string>;

// Commands
export interface Selection {
  bands: Band[];
  sectors?: ('quote' | 'reply' | 'repost' | 'like')[];
  hostileOnly?: boolean;
}
export const SECTOR_KINDS: Record<'quote' | 'reply' | 'repost' | 'like', string[]>;
export const NAMED_PER_COMMAND: number;
export function primaryKind(kinds?: string[]): 'quote' | 'reply' | 'repost' | 'like' | 'other';
export function addable(row: PlanRow): boolean;
export function selected(rows: PlanRow[], sel: Selection): PlanRow[];
export function approveCommand(code: string, sel: Selection, opts?: { asOf?: string | null }): string | null;
export function approveByName(code: string, dids: string[]): string[];
export function onList(command: string, rkey?: string | null): string;
export function blockCommand(actor: string): string;
export function unblockCommand(actor: string): string;
export function undoCommand(code: string): string;
export function cancelCommand(code: string): string;
export function triageCommand(code: string): string;

// Words and numbers
export function nf(n: number | null | undefined): string;
export function compact(n: number | null | undefined): string;
export function plural(n: number, one: string, many?: string): string;
export function duration(minutes: number): string;
export function writeCost(n: number, opts?: { kind?: 'create' | 'delete' }): {
  writes: number;
  points: number;
  minutes: number;
  time: string;
};
export function ago(isoTime: string, now?: number): string;
export function until(isoTime: string, now?: number): string;
export function dayMonth(isoTime: string, now?: number): string;
export function clock(isoTime: string, now?: number): string;
export function bytes(n: number | null | undefined): string;
export function shortDid(did: string): string;
export function postLink(uri: string, handle?: string | null): string | null;
export function postAuthor(uri: string): string | null;
export const KIND_WORDS: Record<string, string>;
export const FAMILY_WORDS: Record<Family, string>;
export function viaWords(via: string | null | undefined): string;

// The radar's layout. Distances are fractions of the circle's radius.
export type Ring = 'PROTECTED' | 'CONNECTED' | 'PERIPHERAL' | 'OUTER';
export interface Placed {
  ring: Ring;
  x: number;
  y: number;
  r: number;
  angle: number;
}
export const RINGS: Record<Ring, [number, number]>;
export const EDGES: Record<Ring, number>;
export function ringOf(band: Band | string | null): Ring;
export function ringAt(r: number): Ring | null;
export function spots(text: string): [number, number];
export function sectorAngles(n: number): { start: number; end: number; mid: number }[];
export function sectorAt(angle: number, n: number): number;
export function place<T extends { id: string; band: Band | string; sector?: number }>(
  points: T[],
  sectorCount: number,
): (T & Placed)[];
export function texture(counts: number[], opts?: { max?: number }): ({ sector: number } & Omit<Placed, 'ring'>)[];
export function nearest<T extends { x: number; y: number }>(placed: T[], x: number, y: number, within: number): T | null;
export function walkOrder<T extends Placed>(placed: T[]): T[];
