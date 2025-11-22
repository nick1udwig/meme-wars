use crate::game::GameState;
use crate::types::{CardDefinition, Lobby};
use serde::{Deserialize, Serialize};

// Lightweight container for UI sync. Carries catalog, live game, and lobby list.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct GameSnapshot {
    pub catalog: Vec<CardDefinition>,
    pub game: Option<GameState>,
    pub lobbies: Vec<Lobby>,
}
