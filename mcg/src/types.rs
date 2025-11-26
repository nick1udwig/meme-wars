use serde::{Deserialize, Serialize};

// Shared data types that describe cards, abilities, and turn plans. These are kept lean and
// immutable so the game engine can own the mutation logic elsewhere.

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub enum Seat {
    Host,
    Opponent,
}

impl Seat {
    pub fn other(&self) -> Seat {
        match self {
            Seat::Host => Seat::Opponent,
            Seat::Opponent => Seat::Host,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct CardDefinition {
    pub id: String,
    pub name: String,
    pub cost: u8,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    pub class: CardKind,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum CardKind {
    Meme(MemeBlueprint),
    Exploit(ExploitEffect),
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct MemeBlueprint {
    pub base_virality: i32,
    pub cook_rate: i32,
    pub yield_rate: i32,
    pub keywords: Vec<Keyword>,
    pub abilities: Vec<Ability>,
    pub volatile: Option<i32>,
    pub initial_freeze: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Keyword {
    Haste,
    Stealth,
    Fragile,
    Shielded(ShieldedKeyword),
    Taunt,
    Anchor,
    Heavy,
    Gatekeeper(GatekeeperKeyword),
    HealKitchen,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct ShieldedKeyword {
    pub amount: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct GatekeeperKeyword {
    pub max_cost: u8,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum AbilityTrigger {
    OnPlayKitchen,
    OnPost,
    OnAbyss,
    OnFeedTurnEnd,
    AuraKitchen,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum AbilityEffect {
    DamageBelow(i32),
    DrainBelow(i32),
    SwapBelow,
    Knockback(usize),
    Spawn(SpawnParams),
    BuffSelf(i32),
    BuffOtherKitchen(i32),
    GainMana(u8),
    PingOpponentTop(i32),
    SelfDestructNext,
    RandomizeVirality(RandomRange),
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct SpawnParams {
    pub variant_id: String,
    pub count: u8,
    pub location: SpawnLocation,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct RandomRange {
    pub min: i32,
    pub max: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum SpawnLocation {
    Kitchen,
    Hand,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Ability {
    pub trigger: AbilityTrigger,
    pub effect: AbilityEffect,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum ExploitEffect {
    Damage(DamageParams),
    AreaDamageKitchen(i32),
    Boost(i32),
    Debuff(i32),
    ResurrectLast,
    Protect,
    Double,
    Execute,
    PinSlot(usize),
    MoveUp(usize),
    LockFeed,
    NukeBelow(NukeParams),
    Tax(TaxParams),
    ShuffleFeed,
    DiscountNext,
    ManaBurn(ManaBurnParams),
    WipeBottom(usize),
    SpawnShitposts(usize),
    Silence,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct DamageParams {
    pub amount: i32,
    pub target: Target,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct NukeParams {
    pub threshold: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct TaxParams {
    pub amount: u8,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct ManaBurnParams {
    pub amount: u8,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Target {
    AnyKitchen,
    EnemyKitchen,
    FeedSlot(usize),
    Card(String),
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct CardInstance {
    pub instance_id: String,
    pub variant_id: String,
    pub name: String,
    pub owner: Seat,
    pub cost: u8,
    pub class: CardKind,
    pub base_virality: i32,
    pub current_virality: i32,
    pub cook_rate: i32,
    pub yield_rate: i32,
    pub keywords: Vec<Keyword>,
    pub abilities: Vec<Ability>,
    pub volatile: Option<i32>,
    pub frozen_turns: u32,
    pub protected_until_end: bool,
    pub shield: i32,
    pub played_turn: u32,
    pub location: Location,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Location {
    Deck,
    Hand,
    Kitchen,
    Feed(FeedSlot),
    Abyss,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct FeedSlot {
    pub slot: usize,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct TurnPlan {
    pub plays_to_kitchen: Vec<String>,
    pub posts: Vec<PostAction>,
    pub exploits: Vec<ExploitAction>,
}

impl Default for TurnPlan {
    fn default() -> Self {
        Self {
            plays_to_kitchen: vec![],
            posts: vec![],
            exploits: vec![],
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct PostAction {
    pub card_id: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct ExploitAction {
    pub card_id: String,
    pub target: Option<Target>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct TurnCommit {
    pub hash: String,
    pub salt: Option<String>,
    pub revealed: Option<TurnPlan>,
    pub turn: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum Phase {
    Lobby,
    Commit,
    Reveal,
    Resolving,
    StakePending,
    GameOver,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Lobby {
    pub id: String,
    pub host: String,
    pub mode: String,
    pub stakes: u8,
    pub description: String,
    pub opponent: Option<String>,
    pub started: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct LobbyConfig {
    pub mode: String,
    pub stakes: u8,
    pub description: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct StateHash {
    pub turn: u32,
    pub hash: String,
}
