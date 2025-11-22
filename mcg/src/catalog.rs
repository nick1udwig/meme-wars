use crate::constants::BASE_COOK;
use crate::types::*;
use std::sync::OnceLock;

// Card catalog definition and helpers. Kept separate so balance tweaks stay isolated from engine.

pub fn build_catalog() -> Vec<CardDefinition> {
    let mut cards = Vec::new();
    cards.extend(normies());
    cards.extend(chefs());
    cards.extend(trolls());
    cards.extend(mods());
    cards.extend(degens());
    cards
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

fn base_meme(
    id: &str,
    name: &str,
    cost: u8,
    base_virality: i32,
    cook_rate: i32,
    keywords: Vec<Keyword>,
    abilities: Vec<Ability>,
    volatile: Option<i32>,
    initial_freeze: Option<u32>,
) -> CardDefinition {
    CardDefinition {
        id: id.to_string(),
        name: name.to_string(),
        cost,
        class: CardKind::Meme(MemeBlueprint {
            base_virality,
            cook_rate,
            yield_rate: 1,
            keywords,
            abilities,
            volatile,
            initial_freeze,
        }),
    }
}

fn base_exploit(id: &str, name: &str, cost: u8, effect: ExploitEffect) -> CardDefinition {
    CardDefinition {
        id: id.to_string(),
        name: name.to_string(),
        cost,
        class: CardKind::Exploit(effect),
    }
}

fn normies() -> Vec<CardDefinition> {
    vec![
        base_meme("n01", "Doge", 1, 4, BASE_COOK, vec![], vec![], None, None),
        base_meme(
            "n02",
            "Cat Video",
            2,
            6,
            BASE_COOK,
            vec![],
            vec![],
            None,
            None,
        ),
        base_meme(
            "n03",
            "Success Kid",
            3,
            8,
            BASE_COOK,
            vec![],
            vec![],
            None,
            None,
        ),
        base_meme(
            "n04",
            "Disaster Girl",
            4,
            10,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPost,
                effect: AbilityEffect::DamageBelow(2),
            }],
            None,
            None,
        ),
        base_meme(
            "n05",
            "Gigachad",
            6,
            15,
            BASE_COOK,
            vec![],
            vec![],
            None,
            None,
        ),
        base_exploit("n06", "Repost", 2, ExploitEffect::ResurrectLast),
        base_exploit("n07", "Viral Hit", 3, ExploitEffect::Boost(5)),
        base_meme(
            "n08",
            "Lurker",
            2,
            4,
            BASE_COOK,
            vec![Keyword::Stealth],
            vec![],
            None,
            None,
        ),
        base_meme(
            "n09",
            "First!",
            1,
            2,
            BASE_COOK,
            vec![Keyword::Haste],
            vec![],
            None,
            None,
        ),
        base_meme(
            "n10",
            "This is Fine",
            3,
            12,
            BASE_COOK,
            vec![],
            vec![],
            Some(3),
            None,
        ),
    ]
}

fn chefs() -> Vec<CardDefinition> {
    vec![
        base_meme("c01", "Let Him Cook", 2, 2, 3, vec![], vec![], None, None),
        base_meme(
            "c02",
            "Wojak",
            1,
            1,
            4,
            vec![Keyword::Fragile],
            vec![],
            None,
            None,
        ),
        base_meme(
            "c03",
            "Gordon",
            3,
            4,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::AuraKitchen,
                effect: AbilityEffect::BuffOtherKitchen(2),
            }],
            None,
            None,
        ),
        base_meme(
            "c04",
            "Bread",
            1,
            1,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPlayKitchen,
                effect: AbilityEffect::Spawn(SpawnParams {
                    variant_id: "c04".to_string(),
                    count: 1,
                    location: SpawnLocation::Kitchen,
                }),
            }],
            None,
            None,
        ),
        base_meme(
            "c05",
            "Diamond Hands",
            4,
            5,
            BASE_COOK,
            vec![Keyword::Shielded(ShieldedKeyword { amount: 2 })],
            vec![],
            None,
            None,
        ),
        base_exploit("c06", "HODL", 2, ExploitEffect::Protect),
        base_exploit("c07", "To The Moon", 4, ExploitEffect::Double),
        base_meme(
            "c08",
            "Oven Mitts",
            2,
            3,
            BASE_COOK,
            vec![Keyword::HealKitchen],
            vec![],
            None,
            None,
        ),
        base_meme(
            "c09",
            "Slowpoke",
            1,
            6,
            BASE_COOK,
            vec![],
            vec![],
            None,
            Some(3),
        ),
        base_meme(
            "c10",
            "Sous Chef",
            2,
            3,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPlayKitchen,
                effect: AbilityEffect::BuffSelf(3),
            }],
            None,
            None,
        ),
    ]
}

fn trolls() -> Vec<CardDefinition> {
    vec![
        base_exploit(
            "t01",
            "Review Bomb",
            1,
            ExploitEffect::Damage(DamageParams {
                amount: 3,
                target: Target::EnemyKitchen,
            }),
        ),
        base_exploit(
            "t02",
            "Dox",
            2,
            ExploitEffect::Damage(DamageParams {
                amount: 5,
                target: Target::EnemyKitchen,
            }),
        ),
        base_exploit(
            "t03",
            "Cringe Compilation",
            4,
            ExploitEffect::AreaDamageKitchen(2),
        ),
        base_exploit(
            "t04",
            "Ratio + L",
            3,
            ExploitEffect::NukeBelow(NukeParams { threshold: 5 }),
        ),
        base_meme(
            "t05",
            "Pepe",
            2,
            4,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPost,
                effect: AbilityEffect::DrainBelow(2),
            }],
            None,
            None,
        ),
        base_meme(
            "t06",
            "Trollface",
            3,
            5,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPost,
                effect: AbilityEffect::SwapBelow,
            }],
            None,
            None,
        ),
        base_meme(
            "t07",
            "Reply Guy",
            1,
            2,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPost,
                effect: AbilityEffect::PingOpponentTop(1),
            }],
            None,
            None,
        ),
        base_exploit("t08", "FUD", 2, ExploitEffect::Debuff(3)),
        base_exploit("t09", "Cancel Culture", 5, ExploitEffect::Execute),
        base_meme(
            "t10",
            "Soyjak",
            2,
            3,
            BASE_COOK,
            vec![Keyword::Taunt],
            vec![],
            None,
            None,
        ),
    ]
}

fn mods() -> Vec<CardDefinition> {
    vec![
        base_meme(
            "m01",
            "Ban Hammer",
            5,
            8,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPost,
                effect: AbilityEffect::Knockback(2),
            }],
            None,
            None,
        ),
        base_exploit("m02", "Pinned Post", 2, ExploitEffect::PinSlot(0)),
        base_exploit("m03", "Shadowban", 3, ExploitEffect::Silence),
        base_meme(
            "m04",
            "AutoMod",
            3,
            6,
            BASE_COOK,
            vec![Keyword::Gatekeeper(GatekeeperKeyword { max_cost: 3 })],
            vec![],
            None,
            None,
        ),
        base_exploit("m05", "Bump", 1, ExploitEffect::MoveUp(1)),
        base_exploit("m06", "Thread Locked", 4, ExploitEffect::LockFeed),
        base_meme(
            "m07",
            "Stickied",
            2,
            4,
            BASE_COOK,
            vec![Keyword::Anchor],
            vec![],
            None,
            None,
        ),
        base_meme(
            "m08",
            "Jannie",
            1,
            3,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnAbyss,
                effect: AbilityEffect::GainMana(1),
            }],
            None,
            None,
        ),
        base_meme(
            "m09",
            "Echo Chamber",
            4,
            5,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnFeedTurnEnd,
                effect: AbilityEffect::BuffSelf(2),
            }],
            None,
            None,
        ),
        base_exploit("m10", "Whitelist", 0, ExploitEffect::DiscountNext),
    ]
}

fn degens() -> Vec<CardDefinition> {
    vec![
        base_exploit("d01", "Rug Pull", 6, ExploitEffect::WipeBottom(3)),
        base_meme(
            "d02",
            "Ape In",
            3,
            1,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPost,
                effect: AbilityEffect::RandomizeVirality(RandomRange { min: 1, max: 15 }),
            }],
            None,
            None,
        ),
        base_meme(
            "d03",
            "Copy Pasta",
            2,
            3,
            BASE_COOK,
            vec![],
            vec![Ability {
                trigger: AbilityTrigger::OnPost,
                effect: AbilityEffect::Spawn(SpawnParams {
                    variant_id: "d06".to_string(),
                    count: 2,
                    location: SpawnLocation::Kitchen,
                }),
            }],
            None,
            None,
        ),
        base_meme(
            "d04",
            "Vaporware",
            1,
            10,
            BASE_COOK,
            vec![Keyword::Fragile],
            vec![],
            None,
            None,
        ),
        base_meme(
            "d05",
            "Pump & Dump",
            2,
            2,
            BASE_COOK,
            vec![],
            vec![
                Ability {
                    trigger: AbilityTrigger::OnPost,
                    effect: AbilityEffect::BuffSelf(10),
                },
                Ability {
                    trigger: AbilityTrigger::OnFeedTurnEnd,
                    effect: AbilityEffect::SelfDestructNext,
                },
            ],
            None,
            None,
        ),
        base_meme(
            "d06",
            "Shitpost",
            0,
            1,
            BASE_COOK,
            vec![],
            vec![],
            None,
            None,
        ),
        base_exploit("d07", "Bot Farm", 3, ExploitEffect::SpawnShitposts(3)),
        base_exploit(
            "d08",
            "Gas Fees",
            2,
            ExploitEffect::Tax(TaxParams { amount: 2 }),
        ),
        base_exploit("d09", "Fork", 4, ExploitEffect::ShuffleFeed),
        base_meme(
            "d10",
            "Bag Holder",
            5,
            20,
            BASE_COOK,
            vec![Keyword::Heavy],
            vec![],
            None,
            None,
        ),
    ]
}

pub fn find_definition(id: &str) -> Option<&'static CardDefinition> {
    static CATALOG: OnceLock<Vec<CardDefinition>> = OnceLock::new();
    let catalog = CATALOG.get_or_init(build_catalog);
    catalog.iter().find(|d| d.id == id)
}
