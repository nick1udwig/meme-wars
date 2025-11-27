use crate::types::*;
use std::sync::OnceLock;

// Card catalog definition and helpers. Kept separate so balance tweaks stay isolated from engine.
// Card data is loaded from cards.json at compile time.

const CARDS_JSON: &str = include_str!("cards.json");

pub fn build_catalog() -> Vec<CardDefinition> {
    serde_json::from_str(CARDS_JSON).expect("Failed to parse cards.json")
}

pub fn default_deck() -> Vec<String> {
    vec![
        "n01", // Meme
        "n02", // Meme
        "n03", // Meme
        "t05", // Meme (Pepe)
        "n06", "n07", "c06", "c07", "t01", "t02", "m02", "d08",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

pub fn find_definition(id: &str) -> Option<&'static CardDefinition> {
    static CATALOG: OnceLock<Vec<CardDefinition>> = OnceLock::new();
    let catalog = CATALOG.get_or_init(build_catalog);
    catalog.iter().find(|d| d.id == id)
}
