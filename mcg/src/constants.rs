// Core tuning and size constants for the game. These are kept in one place so both
// the game engine and catalog can share them without duplication.
pub const GAME_NAME: &str = "Meme Wars: The Feed";
pub const FEED_SIZE: usize = 3;
pub const STARTING_HAND: usize = 2;
pub const MAX_HAND_SIZE: usize = 4;
pub const MAX_DECK_SIZE: usize = 12;
pub const MEME_LIMIT: usize = 4;
pub const EXPLOIT_LIMIT: usize = 8;
pub const STARTING_MANA: u8 = 2;
pub const MANA_CAP: u8 = 10;
pub const BASE_COOK: i32 = 1;
pub const BASE_FEED_YIELD: i32 = 10;
pub const FEED_YIELD_STEP: i32 = 5;
pub const SCORE_TO_WIN: i32 = 30;
pub const WS_PATH: &str = "/ws";
