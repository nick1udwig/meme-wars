use crate::types::Seat;
use rand::{Rng, RngCore, SeedableRng};
use rand_pcg::Pcg64Mcg;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// Fair randomness uses a commit+reveal PCG stream per player. History is stored so peers can
// verify draws and shuffles after the fact.

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum RandomEventKind {
    ShuffleDeck(Seat),
    ShuffleFeed,
    RandomizeVirality(String),
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct RandomContribution {
    pub seat: Seat,
    pub value: u64,
    pub salt: String,
    pub commitment: String,
    pub signature: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct RandomEvent {
    pub turn: u32,
    pub bound: u64,
    pub result: u64,
    pub kind: RandomEventKind,
    pub contributions: Vec<RandomContribution>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct StartingHandCycle {
    pub card_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct StartingHandEvent {
    pub seat: Seat,
    pub cycles: Vec<StartingHandCycle>,
    pub chosen: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct FairRandomState {
    pub host_seed: u64,
    pub opponent_seed: u64,
    pub host_draws: u64,
    pub opponent_draws: u64,
    pub history: Vec<RandomEvent>,
}

impl RandomContribution {
    pub fn new(seat: Seat, value: u64, salt: String) -> Self {
        let commitment = contribution_commitment(value, &salt);
        let signature = contribution_signature(&commitment, &seat);
        Self {
            seat,
            value,
            salt,
            commitment,
            signature,
        }
    }
}

impl FairRandomState {
    pub fn new(seed: u64) -> Self {
        Self {
            host_seed: derive_seed(seed, "host"),
            opponent_seed: derive_seed(seed, "opponent"),
            host_draws: 0,
            opponent_draws: 0,
            history: Vec::new(),
        }
    }

    pub fn generate(&mut self, bound: u64, turn: u32, kind: RandomEventKind) -> u64 {
        if bound == 0 {
            return 0;
        }
        let host_value = {
            let mut rng = pcg_from_seed(self.host_seed);
            for _ in 0..self.host_draws {
                let _ = rng.next_u64();
            }
            let value = rng.gen_range(0..bound);
            self.host_draws += 1;
            RandomContribution::new(
                Seat::Host,
                value,
                format!("turn-{}-host-draw-{}-{:?}", turn, self.host_draws, &kind),
            )
        };
        let opponent_value = {
            let mut rng = pcg_from_seed(self.opponent_seed);
            for _ in 0..self.opponent_draws {
                let _ = rng.next_u64();
            }
            let value = rng.gen_range(0..bound);
            self.opponent_draws += 1;
            RandomContribution::new(
                Seat::Opponent,
                value,
                format!(
                    "turn-{}-opponent-draw-{}-{:?}",
                    turn, self.opponent_draws, &kind
                ),
            )
        };
        let result = (host_value.value + opponent_value.value) % bound;
        let event = RandomEvent {
            turn,
            bound,
            result,
            kind,
            contributions: vec![host_value, opponent_value],
        };
        self.history.push(event);
        result
    }

    pub fn shuffle<T>(&mut self, items: &mut [T], turn: u32, kind: RandomEventKind) {
        if items.len() <= 1 {
            return;
        }
        for i in (1..items.len()).rev() {
            let idx = self.generate((i + 1) as u64, turn, kind.clone()) as usize;
            items.swap(i, idx);
        }
    }
}

pub fn contribution_commitment(value: u64, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.to_le_bytes());
    hasher.update(salt.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn contribution_signature(commitment: &str, seat: &Seat) -> String {
    let mut hasher = Sha256::new();
    hasher.update(commitment.as_bytes());
    hasher.update(format!("{:?}", seat).as_bytes());
    hasher.update(hyperware_process_lib::our().node.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn derive_seed(base: u64, label: &str) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(base.to_le_bytes());
    hasher.update(label.as_bytes());
    let hash = hasher.finalize();
    let mut seed_bytes = [0u8; 8];
    seed_bytes.copy_from_slice(&hash[..8]);
    u64::from_le_bytes(seed_bytes)
}

pub fn pcg_from_seed(seed: u64) -> Pcg64Mcg {
    // Expand the u64 into 16 bytes to seed the PCG generator deterministically.
    let mut hasher = Sha256::new();
    hasher.update(seed.to_le_bytes());
    let digest = hasher.finalize();
    let mut seed_bytes = [0u8; 16];
    seed_bytes.copy_from_slice(&digest[..16]);
    Pcg64Mcg::from_seed(seed_bytes)
}
