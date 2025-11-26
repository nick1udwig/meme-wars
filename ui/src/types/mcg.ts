// Type definitions for the Hyperapp Skeleton App
// These should match the types defined in your Rust backend

// Store state interface
export interface McgState {
  // Connection state
  nodeId: string | null;
  isConnected: boolean;
  
  // App data (backend snapshot)
  snapshot: GameSnapshot | null;
  
  // UI state
  isLoading: boolean;
  error: string | null;
}

// --- Backend data mirrors ---

export type Seat = 'Host' | 'Opponent';

export interface GameSnapshot {
  catalog: CardDefinition[];
  game: GameState | null;
  lobbies?: Lobby[];
}

export interface Lobby {
  id: string;
  host: string;
  mode: string;
  stakes: number;
  description: string;
  opponent: string | null;
  started: boolean;
}

export interface GameState {
  feed: CardInstance[];
  players: PlayerState[];
  turn: number;
  initiative: Seat;
  phase: Phase;
  stakes: number;
  pending_stakes: string | null;
  winner: Seat | null;
  game_seed: number;
  next_instance: number;
}

export type Phase = 'Lobby' | 'Commit' | 'Reveal' | 'Resolving' | 'StakePending' | 'GameOver';

export interface PlayerState {
  seat: Seat;
  node_id: string;
  deck: CardInstance[];
  hand: CardInstance[];
  kitchen: CardInstance[];
  abyss: CardInstance[];
  mana: number;
  max_mana: number;
  score: number;
  cost_discount: number;
  mana_tax_next: number;
  commit: TurnCommit | null;
  feed_locked: boolean;
  pinned_slots: number[];
}

export interface TurnCommit {
  hash: string;
  salt: string | null;
  revealed: TurnPlan | null;
  turn: number;
}

export interface TurnPlan {
  plays_to_kitchen: string[];
  posts: PostAction[];
  exploits: ExploitAction[];
}

export interface PostAction {
  card_id: string;
}

export interface ExploitAction {
  card_id: string;
  target: Target | null;
}

export type Location =
  | 'Deck'
  | 'Hand'
  | 'Kitchen'
  | 'Abyss'
  | { Feed: FeedSlot };

export interface FeedSlot {
  slot: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  cost: number;
  description: string;
  image?: string;
  class: CardKind;
}

export type CardKind =
  | { Meme: MemeBlueprint }
  | { Exploit: ExploitEffect };

export interface MemeBlueprint {
  base_virality: number;
  cook_rate: number;
  yield_rate: number;
  keywords: Keyword[];
  abilities: Ability[];
  volatile: number | null;
  initial_freeze: number | null;
}

export type Keyword =
  | 'Haste'
  | 'Stealth'
  | 'Fragile'
  | { Shielded: ShieldedKeyword }
  | 'Taunt'
  | 'Anchor'
  | 'Heavy'
  | { Gatekeeper: GatekeeperKeyword }
  | 'HealKitchen';

export interface ShieldedKeyword {
  amount: number;
}

export interface GatekeeperKeyword {
  max_cost: number;
}

export type AbilityTrigger =
  | 'OnPlayKitchen'
  | 'OnPost'
  | 'OnAbyss'
  | 'OnFeedTurnEnd'
  | 'AuraKitchen';

export type AbilityEffect =
  | { DamageBelow: number }
  | { DrainBelow: number }
  | 'SwapBelow'
  | { Knockback: number }
  | { Spawn: SpawnParams }
  | { BuffSelf: number }
  | { BuffOtherKitchen: number }
  | { GainMana: number }
  | { PingOpponentTop: number }
  | 'SelfDestructNext'
  | { RandomizeVirality: RandomRange };

export interface Ability {
  trigger: AbilityTrigger;
  effect: AbilityEffect;
}

export interface SpawnParams {
  variant_id: string;
  count: number;
  location: SpawnLocation;
}

export type SpawnLocation = 'Kitchen' | 'Hand';

export interface RandomRange {
  min: number;
  max: number;
}

export type ExploitEffect =
  | { Damage: DamageParams }
  | { AreaDamageKitchen: number }
  | { Boost: number }
  | { Debuff: number }
  | 'ResurrectLast'
  | 'Protect'
  | 'Double'
  | 'Execute'
  | { PinSlot: number }
  | { MoveUp: number }
  | 'LockFeed'
  | { NukeBelow: NukeParams }
  | { Tax: TaxParams }
  | { ShuffleFeed: null }
  | 'DiscountNext'
  | { ManaBurn: ManaBurnParams }
  | { WipeBottom: number }
  | { SpawnShitposts: number }
  | 'Silence';

export interface DamageParams {
  amount: number;
  target: Target;
}

export interface NukeParams {
  threshold: number;
}

export interface TaxParams {
  amount: number;
}

export interface ManaBurnParams {
  amount: number;
}

export type Target =
  | 'AnyKitchen'
  | 'EnemyKitchen'
  | { FeedSlot: number }
  | { Card: string };

export interface CardInstance {
  instance_id: string;
  variant_id: string;
  name: string;
  owner: Seat;
  cost: number;
  class: CardKind;
  base_virality: number;
  current_virality: number;
  cook_rate: number;
  yield_rate: number;
  keywords: Keyword[];
  abilities: Ability[];
  volatile: number | null;
  frozen_turns: number;
  protected_until_end: boolean;
  shield: number;
  played_turn: number;
  location: Location;
}
