use crate::catalog::find_definition;
use crate::constants::*;
use crate::crypto::commitment_for;
use crate::rng::{
    FairRandomState, RandomEvent, RandomEventKind, StartingHandCycle, StartingHandEvent,
};
use crate::types::*;
use hyperware_process_lib::our;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// Game engine state and mutation logic. Functionality mirrors the previous monolithic lib.rs
// but is organized here to make it easier to reason about individual phases.

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct PlayerState {
    pub seat: Seat,
    pub node_id: String,
    pub deck: Vec<CardInstance>,
    pub hand: Vec<CardInstance>,
    pub kitchen: Vec<CardInstance>,
    pub abyss: Vec<CardInstance>,
    pub mana: u8,
    pub max_mana: u8,
    pub score: i32,
    pub cost_discount: i32,
    pub mana_tax_next: i32,
    pub commit: Option<TurnCommit>,
    pub feed_locked: bool,
    pub pinned_slots: Vec<usize>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct GameState {
    pub feed: Vec<CardInstance>,
    pub players: Vec<PlayerState>,
    pub turn: u32,
    pub initiative: Seat,
    pub phase: Phase,
    pub stakes: u8,
    pub pending_stakes: Option<String>,
    pub winner: Option<Seat>,
    pub game_seed: u64,
    pub next_instance: u64,
    pub rng: FairRandomState,
    pub events: Vec<GameEvent>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct GameEvent {
    pub event: GameEventKind,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum GameEventKind {
    Random(RandomEvent),
    StartingHand(StartingHandEvent),
}

impl GameState {
    pub fn ready_to_resolve(&self) -> bool {
        self.players.iter().all(|p| {
            p.commit
                .as_ref()
                .and_then(|c| c.revealed.as_ref())
                .is_some()
        })
    }

    pub fn player_node(&self, seat: &Seat) -> Option<String> {
        self.players
            .iter()
            .find(|p| &p.seat == seat)
            .map(|p| p.node_id.clone())
    }

    pub fn state_hash(&self) -> StateHash {
        let mut hasher = Sha256::new();
        let data = serde_json::to_vec(self).unwrap_or_default();
        hasher.update(data);
        StateHash {
            turn: self.turn,
            hash: format!("{:x}", hasher.finalize()),
        }
    }

    pub fn check_win_condition(&self) -> Option<Seat> {
        let host = self.players.iter().find(|p| p.seat == Seat::Host)?;
        let opp = self.players.iter().find(|p| p.seat == Seat::Opponent)?;

        // Check if either player has reached the winning score
        let host_won = host.score >= SCORE_TO_WIN;
        let opp_won = opp.score >= SCORE_TO_WIN;

        match (host_won, opp_won) {
            (true, true) => {
                // Both reached target - higher score wins, tie goes to host
                if opp.score > host.score {
                    Some(Seat::Opponent)
                } else {
                    Some(Seat::Host)
                }
            }
            (true, false) => Some(Seat::Host),
            (false, true) => Some(Seat::Opponent),
            (false, false) => None,
        }
    }

    pub fn plan_for(&self, seat: Seat) -> Option<TurnPlan> {
        self.players
            .iter()
            .find(|p| p.seat == seat)
            .and_then(|p| p.commit.as_ref())
            .and_then(|c| c.revealed.clone())
    }

    pub fn record_commit(&mut self, seat: Seat, hash: String) -> Result<(), String> {
        if self.phase == Phase::GameOver {
            return Err("game is over".into());
        }
        let player = self
            .players
            .iter_mut()
            .find(|p| p.seat == seat)
            .ok_or("seat not found")?;
        player.commit = Some(TurnCommit {
            hash,
            salt: None,
            revealed: None,
            turn: self.turn,
        });
        if self.phase != Phase::Reveal {
            self.phase = Phase::Commit;
        }
        Ok(())
    }

    pub fn record_reveal(&mut self, seat: Seat, plan: TurnPlan, salt: String) -> Result<(), String> {
        if self.phase == Phase::GameOver {
            return Err("game is over".into());
        }
        let expected_hash = commitment_for(&plan, &salt);
        {
            let player = self
                .players
                .iter_mut()
                .find(|p| p.seat == seat)
                .ok_or("seat not found")?;
            if let Some(commit) = &player.commit {
                if commit.turn != self.turn {
                    return Err("commit turn mismatch".into());
                }
                if commit.hash != expected_hash {
                    return Err("commit hash mismatch".into());
                }
            }
            player.commit = Some(TurnCommit {
                hash: expected_hash.clone(),
                salt: Some(salt),
                revealed: Some(plan.clone()),
                turn: self.turn,
            });
        }
        self.resolve_if_ready()
    }

    pub fn resolve_if_ready(&mut self) -> Result<(), String> {
        if self.ready_to_resolve() {
            let host_plan = self.plan_for(Seat::Host).unwrap_or_default();
            let opp_plan = self.plan_for(Seat::Opponent).unwrap_or_default();
            // Process BASED calls before resolution
            self.process_based_calls(host_plan.based, opp_plan.based);
            // If one player called BASED, wait for response before resolving
            if self.pending_stakes.is_some() {
                self.phase = Phase::StakePending;
                return Ok(());
            }
            self.phase = Phase::Resolving;
            self.resolve_turn(host_plan, opp_plan)?;
        } else {
            self.phase = Phase::Reveal;
        }
        Ok(())
    }

    pub fn call_based(&mut self, seat: Seat) -> Result<(), String> {
        let caller = self
            .player_node(&seat)
            .ok_or_else(|| "seat not found".to_string())?;
        if let Some(existing) = &self.pending_stakes {
            if existing != &caller {
                self.stakes = self.stakes.saturating_mul(2).max(1);
                self.pending_stakes = None;
                if self.phase != Phase::GameOver {
                    self.phase = Phase::Commit;
                }
                return Ok(());
            }
        }
        self.pending_stakes = Some(caller);
        self.phase = Phase::StakePending;
        Ok(())
    }

    pub fn accept_based(&mut self, _seat: Seat) -> Result<(), String> {
        if self.pending_stakes.is_none() {
            return Err("no pending stakes to accept".into());
        }
        self.stakes = self.stakes.saturating_mul(2).max(1);
        self.pending_stakes = None;
        // After accepting BASED, resolve the turn if both have revealed
        if self.ready_to_resolve() {
            let host_plan = self.plan_for(Seat::Host).unwrap_or_default();
            let opp_plan = self.plan_for(Seat::Opponent).unwrap_or_default();
            self.phase = Phase::Resolving;
            self.resolve_turn(host_plan, opp_plan)?;
        } else if self.phase != Phase::GameOver {
            self.phase = Phase::Commit;
        }
        Ok(())
    }

    pub fn fold_based(&mut self, seat: Seat) -> Result<(), String> {
        if self.pending_stakes.is_none() {
            return Err("no pending stakes to fold".into());
        }
        self.pending_stakes = None;
        self.phase = Phase::GameOver;
        self.winner = Some(seat.other());
        Ok(())
    }

    /// Process BASED calls from both players after reveals.
    /// If both called: double stakes. If one called: set pending_stakes.
    fn process_based_calls(&mut self, host_based: bool, opp_based: bool) {
        match (host_based, opp_based) {
            (true, true) => {
                // Both called - double stakes
                self.stakes = self.stakes.saturating_mul(2).max(1);
            }
            (true, false) => {
                // Host called, opponent must respond next turn
                if let Some(node) = self.player_node(&Seat::Host) {
                    self.pending_stakes = Some(node);
                }
            }
            (false, true) => {
                // Opponent called, host must respond next turn
                if let Some(node) = self.player_node(&Seat::Opponent) {
                    self.pending_stakes = Some(node);
                }
            }
            (false, false) => {}
        }
    }

    pub fn resolve_turn(&mut self, host_plan: TurnPlan, opponent_plan: TurnPlan) -> Result<(), String> {
        self.phase = Phase::Resolving;
        self.apply_turn_for_seat(Seat::Host, host_plan.clone())?;
        self.apply_turn_for_seat(Seat::Opponent, opponent_plan.clone())?;
        let initiative = self.initiative.clone();
        self.resolve_exploits(&initiative, &host_plan, &opponent_plan)?;
        self.resolve_posts(&host_plan.posts, &opponent_plan.posts)?;
        self.apply_feed_yield();
        self.apply_cook_and_decay();
        self.cleanup_board();

        // Check for win condition
        if let Some(winner) = self.check_win_condition() {
            self.winner = Some(winner);
            self.phase = Phase::GameOver;
            return Ok(());
        }

        self.turn += 1;
        self.initiative = self.initiative.other();
        for player in self.players.iter_mut() {
            player.commit = None;
            player.reset_for_new_turn();
            player.draw_card()?;
        }
        self.phase = Phase::Commit;
        Ok(())
    }

    fn apply_turn_for_seat(&mut self, seat: Seat, plan: TurnPlan) -> Result<(), String> {
        {
            let (player, _) = split_players_mut(&mut self.players, &seat);
            if plan.plays_to_kitchen.len() > 1 {
                return Err("only one meme can be played from hand to kitchen per turn".into());
            }
            let mut mana_spent = 0i32;
            for id in plan.plays_to_kitchen.iter() {
                let cost = card_cost(&player.hand, id, player.cost_discount)?;
                mana_spent += cost as i32;
            }
            for exploit in plan.exploits.iter() {
                let cost = card_cost(&player.hand, &exploit.card_id, player.cost_discount)?;
                mana_spent += cost as i32;
            }
            if mana_spent > player.mana as i32 {
                return Err(format!(
                    "{} insufficient mana: need {}, have {}",
                    player.node_id, mana_spent, player.mana
                ));
            }
            player.mana = player.mana.saturating_sub(mana_spent as u8);
        }
        for id in plan.plays_to_kitchen.iter() {
            self.play_to_kitchen(&seat, id)?;
        }
        for exploit in plan.exploits.iter() {
            self.validate_exploit_target_seat(&seat, exploit)?;
        }
        Ok(())
    }

    fn validate_exploit_target_seat(&self, seat: &Seat, action: &ExploitAction) -> Result<(), String> {
        let player = self
            .players
            .iter()
            .find(|p| &p.seat == seat)
            .ok_or("seat not found")?;
        let opponent = self
            .players
            .iter()
            .find(|p| &p.seat == &seat.other())
            .ok_or("opponent not found")?;
        let card = player
            .hand
            .iter()
            .find(|c| c.instance_id == action.card_id)
            .ok_or("exploit not in hand")?;

        // Get the exploit effect to determine valid targets
        let effect = match &card.class {
            CardKind::Exploit(e) => e,
            _ => return Err("card is not an exploit".into()),
        };

        // Validate target based on exploit effect type
        match (effect, &action.target) {
            // Single-target damage exploits
            (ExploitEffect::Damage(_), Some(Target::Card(target_id))) => {
                // Must target enemy cards
                let target_in_kitchen = opponent.kitchen.iter().find(|c| c.instance_id == *target_id);
                let target_in_feed = self.feed.iter().find(|c| c.instance_id == *target_id && c.owner == seat.other());

                if let Some(target) = target_in_kitchen {
                    if has_taunt(&opponent.kitchen) && !target.keywords.contains(&Keyword::Taunt) {
                        return Err("must target taunt card first".into());
                    }
                    if target.keywords.contains(&Keyword::Stealth) {
                        return Err("target is stealth".into());
                    }
                    Ok(())
                } else if target_in_feed.is_some() {
                    Ok(())
                } else {
                    Err("target not found in enemy kitchen or feed".into())
                }
            }
            (ExploitEffect::Damage(_), Some(Target::EnemyKitchen)) => {
                // Can target enemy kitchen zone
                Ok(())
            }
            (ExploitEffect::Damage(_), Some(Target::FeedSlot(slot))) => {
                // Can target feed slot
                if *slot >= self.feed.len() {
                    return Err("invalid feed slot".into());
                }
                Ok(())
            }
            (ExploitEffect::Damage(_), None) => {
                return Err("damage exploit requires a target".into());
            }

            // Area damage targets enemy kitchen zone
            (ExploitEffect::AreaDamageKitchen(_), _) => {
                // No specific target needed, targets all enemy kitchen
                Ok(())
            }

            // Buff exploits target own cards
            (ExploitEffect::Boost(_) | ExploitEffect::Protect | ExploitEffect::Double, Some(Target::Card(target_id))) => {
                // Must target own cards
                let target_in_kitchen = player.kitchen.iter().find(|c| c.instance_id == *target_id);
                let target_in_feed = self.feed.iter().find(|c| c.instance_id == *target_id && c.owner == *seat);

                if target_in_kitchen.is_none() && target_in_feed.is_none() {
                    Err("target not found in your kitchen or feed".into())
                } else {
                    Ok(())
                }
            }
            (ExploitEffect::Boost(_) | ExploitEffect::Protect | ExploitEffect::Double, None) => {
                return Err("buff exploit requires a target".into());
            }

            // Debuff/removal exploits target enemy cards
            (ExploitEffect::Debuff(_) | ExploitEffect::Execute | ExploitEffect::Silence, Some(Target::Card(target_id))) => {
                // Must target enemy cards
                let target_in_kitchen = opponent.kitchen.iter().find(|c| c.instance_id == *target_id);
                let target_in_feed = self.feed.iter().find(|c| c.instance_id == *target_id && c.owner == seat.other());

                if let Some(target) = target_in_kitchen {
                    if has_taunt(&opponent.kitchen) && !target.keywords.contains(&Keyword::Taunt) {
                        return Err("must target taunt card first".into());
                    }
                    if target.keywords.contains(&Keyword::Stealth) {
                        return Err("target is stealth".into());
                    }
                    Ok(())
                } else if target_in_feed.is_some() {
                    Ok(())
                } else {
                    Err("target not found in enemy kitchen or feed".into())
                }
            }
            (ExploitEffect::Debuff(_) | ExploitEffect::Execute | ExploitEffect::Silence, None) => {
                return Err("debuff/removal exploit requires a target".into());
            }

            // Feed slot targeting exploits
            (ExploitEffect::PinSlot(_) | ExploitEffect::MoveUp(_) | ExploitEffect::NukeBelow(_), Some(Target::FeedSlot(slot))) => {
                if *slot >= self.feed.len() {
                    return Err("invalid feed slot".into());
                }
                Ok(())
            }
            (ExploitEffect::PinSlot(_) | ExploitEffect::MoveUp(_) | ExploitEffect::NukeBelow(_), None) => {
                return Err("feed manipulation exploit requires a target slot".into());
            }

            // Zone-targeting exploits (no specific target)
            (ExploitEffect::LockFeed | ExploitEffect::ShuffleFeed | ExploitEffect::WipeBottom(_), _) => {
                // These target zones, not specific cards
                Ok(())
            }

            // Self-targeting exploits (no target needed)
            (ExploitEffect::ResurrectLast | ExploitEffect::DiscountNext | ExploitEffect::SpawnShitposts(_), _) => {
                // These don't need targets
                Ok(())
            }

            // Opponent-targeting exploits (target opponent directly)
            (ExploitEffect::Tax(_) | ExploitEffect::ManaBurn(_), _) => {
                // These target the opponent directly
                Ok(())
            }

            _ => Ok(()),
        }
    }

    fn resolve_exploits(
        &mut self,
        initiative: &Seat,
        host_plan: &TurnPlan,
        opponent_plan: &TurnPlan,
    ) -> Result<(), String> {
        let order = match initiative {
            Seat::Host => vec![(Seat::Host, host_plan), (Seat::Opponent, opponent_plan)],
            Seat::Opponent => vec![(Seat::Opponent, opponent_plan), (Seat::Host, host_plan)],
        };
        for (seat, plan) in order {
            for exploit in plan.exploits.iter() {
                self.cast_exploit(seat.clone(), exploit.clone())?;
            }
        }
        Ok(())
    }

    fn cast_exploit(&mut self, seat: Seat, action: ExploitAction) -> Result<(), String> {
        let (effect, mut card) = {
            let (player, _) = split_players_mut(&mut self.players, &seat);
            let card_idx = player
                .hand
                .iter()
                .position(|c| c.instance_id == action.card_id)
                .ok_or("exploit not found in hand")?;
            let card = player.hand.remove(card_idx);
            player.cost_discount = 0;
            match &card.class {
                CardKind::Exploit(effect) => (effect.clone(), card),
                _ => return Err("card is not an exploit".into()),
            }
        };
        self.apply_exploit_effect(effect, &seat, action.target)?;
        card.location = Location::Abyss;
        let (player, _) = split_players_mut(&mut self.players, &seat);
        player.abyss.push(card);
        Ok(())
    }

    fn apply_exploit_effect(
        &mut self,
        effect: ExploitEffect,
        seat: &Seat,
        target: Option<Target>,
    ) -> Result<(), String> {
        match effect {
            ExploitEffect::Damage(params) => {
                self.apply_damage_targeted(seat, target.unwrap_or(params.target.clone()), params.amount)
            }
            ExploitEffect::AreaDamageKitchen(amount) => {
                let (_, opp) = split_players_mut(&mut self.players, seat);
                for card in opp.kitchen.iter_mut() {
                    apply_damage(card, amount, false);
                }
                Ok(())
            }
            ExploitEffect::Boost(amount) => {
                let (player, _) = split_players_mut(&mut self.players, seat);
                if let Some(Target::Card(id)) = target {
                    if let Some(card) =
                        find_card_mut_for_owner(&mut player.kitchen, &mut self.feed, seat, &id)
                    {
                        card.current_virality += amount;
                    }
                }
                Ok(())
            }
            ExploitEffect::Debuff(amount) => {
                let (_, opp) = split_players_mut(&mut self.players, seat);
                if let Some(Target::Card(id)) = target {
                    if let Some(card) =
                        find_enemy_card_mut_for_owner(&mut opp.kitchen, &mut self.feed, seat, &id)
                    {
                        card.current_virality -= amount;
                    }
                }
                Ok(())
            }
            ExploitEffect::ResurrectLast => self.resurrect_last(seat),
            ExploitEffect::Protect => {
                if let Some(Target::Card(id)) = target {
                    let (player, _) = split_players_mut(&mut self.players, seat);
                    if let Some(card) =
                        find_card_mut_for_owner(&mut player.kitchen, &mut self.feed, seat, &id)
                    {
                        card.protected_until_end = true;
                    }
                }
                Ok(())
            }
            ExploitEffect::Double => {
                if let Some(Target::Card(id)) = target {
                    let (player, _) = split_players_mut(&mut self.players, seat);
                    if let Some(card) =
                        find_card_mut_for_owner(&mut player.kitchen, &mut self.feed, seat, &id)
                    {
                        card.current_virality *= 2;
                    }
                }
                Ok(())
            }
            ExploitEffect::Execute => {
                if let Some(Target::Card(id)) = target {
                    let (_, opp) = split_players_mut(&mut self.players, seat);
                    if let Some(card) = remove_card(&mut opp.kitchen, &id) {
                        self.to_abyss(seat.other(), card);
                    } else if let Some(idx) = self
                        .feed
                        .iter()
                        .position(|c| c.instance_id == id && c.owner == seat.other())
                    {
                        let card = self.feed.remove(idx);
                        let owner_seat = card.owner.clone();
                        self.to_abyss(owner_seat, card);
                    }
                }
                Ok(())
            }
            ExploitEffect::PinSlot(slot) => {
                let slot_to_pin = match target {
                    Some(Target::FeedSlot(s)) => s,
                    _ => slot,
                };
                let (_, opp) = split_players_mut(&mut self.players, seat);
                opp.pinned_slots.push(slot_to_pin);
                Ok(())
            }
            ExploitEffect::MoveUp(slot) => {
                let slot_to_move = match target {
                    Some(Target::FeedSlot(s)) => s,
                    _ => slot,
                };
                self.shift_feed_up(slot_to_move)
            }
            ExploitEffect::LockFeed => {
                let (_, opp) = split_players_mut(&mut self.players, seat);
                opp.feed_locked = true;
                Ok(())
            }
            ExploitEffect::NukeBelow(params) => {
                if let Some(Target::FeedSlot(slot)) = target {
                    if let Some(card) = self.feed.get(slot) {
                        if card.current_virality < params.threshold {
                            let removed = self.feed.remove(slot);
                            let owner_seat = removed.owner.clone();
                            self.to_abyss(owner_seat, removed);
                        }
                    }
                }
                Ok(())
            }
            ExploitEffect::Tax(params) => {
                let (_, opp) = split_players_mut(&mut self.players, seat);
                opp.mana_tax_next += params.amount as i32;
                Ok(())
            }
            ExploitEffect::ShuffleFeed => {
                self.fair_shuffle_feed();
                Ok(())
            }
            ExploitEffect::DiscountNext => {
                let (player, _) = split_players_mut(&mut self.players, seat);
                player.cost_discount = 1;
                Ok(())
            }
            ExploitEffect::ManaBurn(params) => {
                let (_, opp) = split_players_mut(&mut self.players, seat);
                opp.mana = opp.mana.saturating_sub(params.amount);
                Ok(())
            }
            ExploitEffect::WipeBottom(count) => {
                for _ in 0..count {
                    if let Some(card) = self.feed.pop() {
                        let owner_seat = card.owner.clone();
                        self.to_abyss(owner_seat, card);
                    }
                }
                Ok(())
            }
            ExploitEffect::SpawnShitposts(count) => {
                let mut spawned_cards = Vec::new();
                for _ in 0..count {
                    if let Some(def) = find_definition("d06") {
                        let card = self.new_instance_from_def(def, seat.clone(), Location::Hand);
                        spawned_cards.push(card);
                    }
                }
                if !spawned_cards.is_empty() {
                    let (player, _) = split_players_mut(&mut self.players, seat);
                    player.hand.extend(spawned_cards);
                }
                Ok(())
            }
            ExploitEffect::Silence => {
                if let Some(Target::Card(id)) = target {
                    let (_, opp) = split_players_mut(&mut self.players, &seat);
                    if let Some(card) =
                        find_enemy_card_mut_for_owner(&mut opp.kitchen, &mut self.feed, &seat, &id)
                    {
                        card.abilities.clear();
                        card.keywords.retain(|k| matches!(k, Keyword::Shielded(_)));
                    }
                }
                Ok(())
            }
        }
    }

    fn apply_damage_targeted(&mut self, seat: &Seat, target: Target, amount: i32) -> Result<(), String> {
        match target {
            Target::Card(id) => {
                let (_, opp) = split_players_mut(&mut self.players, seat);
                if let Some(card) = find_card_mut(&mut opp.kitchen, &id) {
                    apply_damage(card, amount, false);
                } else if let Some(card) = self
                    .feed
                    .iter_mut()
                    .find(|c| c.instance_id == id && c.owner == seat.other())
                {
                    apply_damage(card, amount, false);
                }
                Ok(())
            }
            Target::FeedSlot(slot) => {
                if let Some(card) = self.feed.get_mut(slot) {
                    apply_damage(card, amount, false);
                }
                Ok(())
            }
            Target::AnyKitchen | Target::EnemyKitchen => {
                let (_, opp) = split_players_mut(&mut self.players, seat);
                if let Some(card) = opp.kitchen.first_mut() {
                    apply_damage(card, amount, false);
                }
                Ok(())
            }
        }
    }

    fn resolve_posts(&mut self, host_posts: &[PostAction], opponent_posts: &[PostAction]) -> Result<(), String> {
        if self.feed_lock_active() {
            return Ok(());
        }
        let mut entries: Vec<(Seat, CardInstance)> = vec![];
        for post in host_posts {
            if let Some(card) = self.take_from_kitchen(Seat::Host, &[post.clone()]) {
                entries.push((Seat::Host, card));
            }
        }
        for post in opponent_posts {
            if let Some(card) = self.take_from_kitchen(Seat::Opponent, &[post.clone()]) {
                entries.push((Seat::Opponent, card));
            }
        }
        if entries.is_empty() {
            return Ok(());
        }
        entries.sort_by(|a, b| {
            b.1.current_virality
                .cmp(&a.1.current_virality)
                .then_with(|| {
                    if a.0 == self.initiative {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    }
                })
        });
        for (seat, card) in entries {
            let mut target_index = if card.keywords.contains(&Keyword::Heavy) {
                self.feed.len()
            } else {
                0
            };
            for (idx, existing) in self.feed.iter().enumerate() {
                if let Some(max_cost) = existing.keywords.iter().find_map(|k| {
                    if let Keyword::Gatekeeper(GatekeeperKeyword { max_cost }) = k {
                        Some(*max_cost)
                    } else {
                        None
                    }
                }) {
                    if card.cost < max_cost {
                        target_index = target_index.max(idx + 1);
                    }
                }
            }
            let card_id = card.instance_id.clone();
            let insert_at = target_index.min(self.feed.len());
            self.feed.insert(insert_at, card);
            self.apply_on_post_effects(&seat, card_id);
            if self.feed.len() > FEED_SIZE {
                if let Some(removed) = self.feed.pop() {
                    let owner_seat = removed.owner.clone();
                    self.to_abyss(owner_seat, removed);
                }
            }
            self.reindex_feed();
        }
        Ok(())
    }

    fn apply_on_post_effects(&mut self, seat: &Seat, instance_id: String) {
        let mut spawn_tasks: Vec<SpawnParams> = Vec::new();
        let mut gain_mana: u8 = 0;
        let mut ping_top: Option<i32> = None;
        let mut pending_swap = false;
        let mut pending_knockback: Option<usize> = None;
        let mut pending_randomize: Vec<(String, RandomRange)> = Vec::new();

        if let Some(mut idx) = self.feed.iter().position(|c| c.instance_id == instance_id) {
            {
                let (_before, tail) = self.feed.split_at_mut(idx);
                let (card, after) = tail.split_first_mut().unwrap();
                for ability in card.abilities.clone() {
                    if ability.trigger != AbilityTrigger::OnPost {
                        continue;
                    }
                    match ability.effect {
                        AbilityEffect::BuffSelf(amount) => {
                            card.current_virality += amount;
                        }
                        AbilityEffect::SelfDestructNext => {
                            card.volatile = Some(card.current_virality + 1000);
                        }
                        AbilityEffect::RandomizeVirality(range) => {
                            pending_randomize.push((card.instance_id.clone(), range));
                        }
                        AbilityEffect::Spawn(params) => spawn_tasks.push(params),
                        AbilityEffect::GainMana(amount) => {
                            gain_mana = gain_mana.saturating_add(amount)
                        }
                        AbilityEffect::PingOpponentTop(amount) => ping_top = Some(amount),
                        AbilityEffect::DamageBelow(_) | AbilityEffect::DrainBelow(_) => {}
                        AbilityEffect::SwapBelow => {
                            if !after.is_empty() {
                                pending_swap = true;
                            }
                        }
                        AbilityEffect::Knockback(steps) => {
                            if !after.is_empty() {
                                pending_knockback = Some(steps);
                            }
                        }
                        AbilityEffect::BuffOtherKitchen(_) => {}
                    }
                }
                if pending_swap {
                    if idx + 1 < self.feed.len() {
                        self.feed.swap(idx, idx + 1);
                        idx += 1;
                    }
                }
                if let Some(steps) = pending_knockback {
                    let target_idx = idx + 1;
                    if target_idx < self.feed.len() {
                        let new_idx = (target_idx + steps).min(self.feed.len() - 1);
                        self.feed.swap(target_idx, new_idx);
                    }
                }
                let abilities = self.feed[idx].abilities.clone();
                for ability in abilities {
                    if ability.trigger != AbilityTrigger::OnPost {
                        continue;
                    }
                    match ability.effect {
                        AbilityEffect::DamageBelow(amount) => {
                            if let Some(target) = self.feed.get_mut(idx + 1) {
                                apply_damage(target, amount, false);
                            }
                        }
                        AbilityEffect::DrainBelow(amount) => {
                            if let Some(target) = self.feed.get_mut(idx + 1) {
                                let drained = amount.min(target.current_virality);
                                target.current_virality -= drained;
                                if let Some(card_mut) = self.feed.get_mut(idx) {
                                    card_mut.current_virality += drained;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        if gain_mana > 0 {
            let (player, _) = split_players_mut(&mut self.players, seat);
            player.mana = player.mana.saturating_add(gain_mana);
        }

        for (card_id, range) in pending_randomize {
            let bound = (range.max - range.min + 1).max(1) as u64;
            let roll = self
                .record_random(bound, RandomEventKind::RandomizeVirality(card_id.clone()))
                as i32;
            if let Some(card) = self.feed.iter_mut().find(|c| c.instance_id == card_id) {
                card.current_virality = range.min + roll;
            }
        }

        if !spawn_tasks.is_empty() {
            for params in spawn_tasks {
                for _ in 0..params.count {
                    if let Some(def) = find_definition(&params.variant_id) {
                        let target_location = match params.location {
                            SpawnLocation::Kitchen => Location::Kitchen,
                            SpawnLocation::Hand => Location::Hand,
                        };
                        let spawned =
                            self.new_instance_from_def(def, seat.clone(), target_location.clone());
                        let (player, _) = split_players_mut(&mut self.players, seat);
                        match target_location {
                            Location::Kitchen => player.kitchen.push(spawned),
                            Location::Hand => player.hand.push(spawned),
                            _ => {}
                        }
                    }
                }
            }
        }

        if let Some(amount) = ping_top {
            if let Some(target) = self.feed.first_mut() {
                if target.owner != *seat {
                    apply_damage(target, amount, false);
                }
            }
        }

        let aura_bonus = {
            let (player, _) = split_players_mut(&mut self.players, seat);
            player.kitchen.iter().find_map(|c| aura_amount(&c.abilities))
        };
        if let Some(amount) = aura_bonus {
            let (player, _) = split_players_mut(&mut self.players, seat);
            for ally in player.kitchen.iter_mut() {
                ally.cook_rate = BASE_COOK + amount;
            }
        }
    }

    fn apply_feed_yield(&mut self) {
        for (index, card) in self.feed.iter().enumerate() {
            let (owner, _) = split_players_mut(&mut self.players, &card.owner);
            let points = (BASE_FEED_YIELD + (index as i32 * FEED_YIELD_STEP))
                * card.yield_rate;
            owner.score += points;
        }
    }

    fn apply_cook_and_decay(&mut self) {
        for player in self.players.iter_mut() {
            for card in player.kitchen.iter_mut() {
                if card.frozen_turns > 0 {
                    card.frozen_turns -= 1;
                } else {
                    card.current_virality += card.cook_rate;
                }
                if card.keywords.contains(&Keyword::HealKitchen) {
                    card.current_virality = card.base_virality;
                }
                if let Some(decay) = card.volatile {
                    card.current_virality -= decay;
                }
                card.protected_until_end = false;
            }
        }
        for card in self.feed.iter_mut() {
            if let Some(decay) = card.volatile {
                card.current_virality -= decay;
            }
        }
    }

    fn cleanup_board(&mut self) {
        self.feed.retain(|card| card.current_virality > 0);
        for player in self.players.iter_mut() {
            let mut survivors = Vec::new();
            for mut card in player.kitchen.drain(..) {
                if card.current_virality <= 0 {
                    card.location = Location::Abyss;
                    player.abyss.push(card);
                } else {
                    card.location = Location::Kitchen;
                    survivors.push(card);
                }
            }
            player.kitchen = survivors;
        }
        self.reindex_feed();
    }

    fn play_to_kitchen(&mut self, seat: &Seat, instance_id: &str) -> Result<(), String> {
        let mut card = {
            let (player, _) = split_players_mut(&mut self.players, seat);
            let idx = player
                .hand
                .iter()
                .position(|c| c.instance_id == instance_id)
                .ok_or("card not in hand")?;
            player.hand.remove(idx)
        };
        if !matches!(card.class, CardKind::Meme(_)) {
            return Err("only memes can be played to kitchen".into());
        }
        card.location = Location::Kitchen;
        card.played_turn = self.turn;
        let mut spawned_kitchen: Vec<CardInstance> = Vec::new();
        let mut spawned_hand: Vec<CardInstance> = Vec::new();
        for ability in card.abilities.clone() {
            if ability.trigger == AbilityTrigger::OnPlayKitchen {
                if let AbilityEffect::Spawn(params) = ability.effect {
                    for _ in 0..params.count {
                        if let Some(def) = find_definition(&params.variant_id) {
                            let target_location = match params.location {
                                SpawnLocation::Kitchen => Location::Kitchen,
                                SpawnLocation::Hand => Location::Hand,
                            };
                            let spawned = self.new_instance_from_def(
                                def,
                                seat.clone(),
                                target_location.clone(),
                            );
                            match target_location {
                                Location::Kitchen => spawned_kitchen.push(spawned),
                                Location::Hand => spawned_hand.push(spawned),
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
        let (player, _) = split_players_mut(&mut self.players, seat);
        player.kitchen.push(card);
        player.kitchen.extend(spawned_kitchen);
        player.hand.extend(spawned_hand);
        Ok(())
    }

    fn feed_lock_active(&self) -> bool {
        self.players.iter().any(|p| p.feed_locked)
    }

    fn take_from_kitchen(&mut self, seat: Seat, posts: &[PostAction]) -> Option<CardInstance> {
        let (player, _) = split_players_mut(&mut self.players, &seat);
        let id = posts.first()?.card_id.clone();
        if let Some(idx) = player.kitchen.iter().position(|c| c.instance_id == id) {
            let mut card = player.kitchen.remove(idx);
            if card.frozen_turns > 0 && !card.keywords.contains(&Keyword::Haste) {
                player.kitchen.push(card);
                return None;
            }
            if card.played_turn == self.turn && !card.keywords.contains(&Keyword::Haste) {
                player.kitchen.push(card);
                return None;
            }
            card.location = Location::Feed(FeedSlot { slot: 0 });
            Some(card)
        } else {
            None
        }
    }

    fn resurrect_last(&mut self, seat: &Seat) -> Result<(), String> {
        let (player, _) = split_players_mut(&mut self.players, seat);
        if let Some(mut card) = player.abyss.pop() {
            card.location = Location::Hand;
            player.hand.push(card);
        }
        Ok(())
    }

    fn shift_feed_up(&mut self, slot: usize) -> Result<(), String> {
        if slot == 0 || slot >= self.feed.len() {
            return Ok(());
        }
        let pinned = self.players.iter().any(|p| p.pinned_slots.contains(&slot))
            || self
                .feed
                .get(slot)
                .map(|c| c.keywords.contains(&Keyword::Anchor))
                .unwrap_or(false);
        if pinned {
            return Ok(());
        }
        self.feed.swap(slot - 1, slot);
        self.reindex_feed();
        Ok(())
    }

    pub fn new_instance_from_def(
        &mut self,
        def: &CardDefinition,
        owner: Seat,
        location: Location,
    ) -> CardInstance {
        let instance_id = format!("{}-{}", def.id, self.next_instance);
        self.next_instance += 1;
        match &def.class {
            CardKind::Meme(meme) => CardInstance {
                instance_id,
                variant_id: def.id.clone(),
                name: def.name.clone(),
                owner,
                cost: def.cost,
                class: def.class.clone(),
                base_virality: meme.base_virality,
                current_virality: meme.base_virality,
                cook_rate: meme.cook_rate,
                yield_rate: meme.yield_rate,
                keywords: meme.keywords.clone(),
                abilities: meme.abilities.clone(),
                volatile: meme.volatile,
                frozen_turns: meme.initial_freeze.unwrap_or(0),
                protected_until_end: false,
                shield: meme
                    .keywords
                    .iter()
                    .find_map(|k| match k {
                        Keyword::Shielded(ShieldedKeyword { amount }) => Some(*amount),
                        _ => None,
                    })
                    .unwrap_or(0),
                played_turn: self.turn,
                location,
            },
            CardKind::Exploit(_) => CardInstance {
                instance_id,
                variant_id: def.id.clone(),
                name: def.name.clone(),
                owner,
                cost: def.cost,
                class: def.class.clone(),
                base_virality: 0,
                current_virality: 0,
                cook_rate: 0,
                yield_rate: 0,
                keywords: vec![],
                abilities: vec![],
                volatile: None,
                frozen_turns: 0,
                protected_until_end: false,
                shield: 0,
                played_turn: self.turn,
                location,
            },
        }
    }

    fn to_abyss(&mut self, seat: Seat, mut card: CardInstance) {
        card.location = Location::Abyss;
        let (player, _) = split_players_mut(&mut self.players, &seat);
        player.abyss.push(card);
    }

    fn reindex_feed(&mut self) {
        for (idx, card) in self.feed.iter_mut().enumerate() {
            card.location = Location::Feed(FeedSlot { slot: idx });
        }
    }

    fn record_random(&mut self, bound: u64, kind: RandomEventKind) -> u64 {
        let result = self.rng.generate(bound, self.turn, kind);
        if let Some(ev) = self.rng.history.last().cloned() {
            self.events.push(GameEvent {
                event: GameEventKind::Random(ev),
            });
        }
        result
    }

    fn fair_shuffle_feed(&mut self) {
        if self.feed.len() <= 1 {
            return;
        }
        for i in (1..self.feed.len()).rev() {
            let idx = self.record_random((i + 1) as u64, RandomEventKind::ShuffleFeed) as usize;
            self.feed.swap(i, idx);
        }
        self.reindex_feed();
    }
}

impl PlayerState {
    pub fn new(seat: Seat, node_id: String, deck: Vec<CardInstance>) -> Self {
        Self {
            seat,
            node_id,
            deck,
            hand: vec![],
            kitchen: vec![],
            abyss: vec![],
            mana: STARTING_MANA,
            max_mana: STARTING_MANA,
            score: 0,
            cost_discount: 0,
            mana_tax_next: 0,
            commit: None,
            feed_locked: false,
            pinned_slots: vec![],
        }
    }

    pub fn draw_starting_hand(
        &mut self,
        count: usize,
        events: &mut Vec<GameEvent>,
    ) -> Result<(), String> {
        if count == 0 {
            return Ok(());
        }
        if count == 2 {
            let mut cycles: Vec<StartingHandCycle> = Vec::new();
            let mut safety = self.deck.len() + 2;
            while safety > 0 {
                safety -= 1;
                if self.deck.len() < 2 {
                    return Err("deck too small for starting hand".into());
                }
                let mut pulled = vec![
                    self.deck.pop().ok_or("deck empty")?,
                    self.deck.pop().ok_or("deck empty")?,
                ];
                pulled.reverse();
                let has_meme = pulled.iter().any(|c| matches!(c.class, CardKind::Meme(_)));
                let ids: Vec<String> = pulled.iter().map(|c| c.instance_id.clone()).collect();
                if has_meme {
                    for mut card in pulled {
                        card.location = Location::Hand;
                        card.played_turn = 0;
                        if self.hand.len() >= MAX_HAND_SIZE {
                            card.location = Location::Abyss;
                            self.abyss.push(card);
                        } else {
                            self.hand.push(card);
                        }
                    }
                    events.push(GameEvent {
                        event: GameEventKind::StartingHand(StartingHandEvent {
                            seat: self.seat.clone(),
                            cycles,
                            chosen: ids,
                        }),
                    });
                    return Ok(());
                }
                for card in pulled.into_iter().rev() {
                    self.deck.insert(0, card);
                }
                cycles.push(StartingHandCycle { card_ids: ids });
            }
            return Err("unable to produce a valid starting hand containing a meme".into());
        }
        for _ in 0..count {
            self.draw_card()?;
        }
        Ok(())
    }

    pub fn draw_card(&mut self) -> Result<(), String> {
        if let Some(mut card) = self.deck.pop() {
            card.location = Location::Hand;
            card.played_turn = 0;
            if self.hand.len() >= MAX_HAND_SIZE {
                card.location = Location::Abyss;
                self.abyss.push(card);
            } else {
                self.hand.push(card);
            }
        }
        Ok(())
    }

    pub fn reset_for_new_turn(&mut self) {
        if self.max_mana < MANA_CAP {
            self.max_mana += 1;
        }
        let penalty = self.mana_tax_next.max(0) as u8;
        self.mana = self.max_mana.saturating_sub(penalty);
        self.mana_tax_next = 0;
        self.pinned_slots.clear();
        self.feed_locked = false;
    }
}

// Deck/game creation helpers extracted from the previous AppState impl.
pub fn build_game(
    catalog: &[CardDefinition],
    next_instance: &mut u64,
    seed: u64,
    host_deck: Vec<String>,
    opponent_deck: Vec<String>,
    opponent_id: String,
) -> Result<GameState, String> {
    let (host_memes, host_exploits) = validate_deck_composition(catalog, &host_deck)?;
    let (opp_memes, opp_exploits) = validate_deck_composition(catalog, &opponent_deck)?;
    let host_valid =
        host_deck.len() == MAX_DECK_SIZE && host_memes == MEME_LIMIT && host_exploits == EXPLOIT_LIMIT;
    let opponent_valid = opponent_deck.len() == MAX_DECK_SIZE
        && opp_memes == MEME_LIMIT
        && opp_exploits == EXPLOIT_LIMIT;
    let mut rng_state = FairRandomState::new(seed);
    let mut host_deck_instances = instantiate_deck(catalog, host_deck, Seat::Host, next_instance)?;
    rng_state.shuffle(
        &mut host_deck_instances,
        0,
        RandomEventKind::ShuffleDeck(Seat::Host),
    );
    let mut opp_deck_instances =
        instantiate_deck(catalog, opponent_deck, Seat::Opponent, next_instance)?;
    rng_state.shuffle(
        &mut opp_deck_instances,
        0,
        RandomEventKind::ShuffleDeck(Seat::Opponent),
    );
    let mut host = PlayerState::new(Seat::Host, our().node.clone(), host_deck_instances);
    let mut opponent = PlayerState::new(Seat::Opponent, opponent_id, opp_deck_instances);
    let mut events: Vec<GameEvent> = rng_state
        .history
        .iter()
        .cloned()
        .map(|event| GameEvent {
            event: GameEventKind::Random(event),
        })
        .collect();
    if host_valid {
        host.draw_starting_hand(STARTING_HAND, &mut events)?;
    }
    if opponent_valid {
        opponent.draw_starting_hand(STARTING_HAND, &mut events)?;
    }
    let mut game = GameState {
        feed: vec![],
        players: vec![host, opponent],
        turn: 0,
        initiative: Seat::Host,
        phase: Phase::Commit,
        stakes: 1,
        pending_stakes: None,
        winner: None,
        game_seed: seed,
        next_instance: *next_instance,
        rng: rng_state,
        events,
    };
    if !host_valid || !opponent_valid {
        game.phase = Phase::GameOver;
        game.winner = match (host_valid, opponent_valid) {
            (false, true) => Some(Seat::Opponent),
            (true, false) => Some(Seat::Host),
            _ => None,
        };
    }
    Ok(game)
}

fn validate_deck_composition(catalog: &[CardDefinition], ids: &[String]) -> Result<(usize, usize), String> {
    let mut memes = 0usize;
    let mut exploits = 0usize;
    for id in ids {
        let def = catalog
            .iter()
            .find(|c| &c.id == id)
            .ok_or_else(|| format!("card {} not found", id))?;
        match def.class {
            CardKind::Meme(_) => memes += 1,
            CardKind::Exploit(_) => exploits += 1,
        }
    }
    Ok((memes, exploits))
}

fn instantiate_deck(
    catalog: &[CardDefinition],
    ids: Vec<String>,
    owner: Seat,
    next_instance: &mut u64,
) -> Result<Vec<CardInstance>, String> {
    let mut deck = Vec::new();
    for id in ids {
        let def = catalog
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or_else(|| format!("card {} not found", id))?;
        deck.push(instantiate_card(next_instance, &def, owner.clone()));
    }
    Ok(deck)
}

fn instantiate_card(next_instance: &mut u64, def: &CardDefinition, owner: Seat) -> CardInstance {
    let instance_id = format!("{}-{}", def.id, *next_instance);
    *next_instance += 1;
    match &def.class {
        CardKind::Meme(meme) => CardInstance {
            instance_id,
            variant_id: def.id.clone(),
            name: def.name.clone(),
            owner,
            cost: def.cost,
            class: def.class.clone(),
            base_virality: meme.base_virality,
            current_virality: meme.base_virality,
            cook_rate: meme.cook_rate,
            yield_rate: meme.yield_rate,
            keywords: meme.keywords.clone(),
            abilities: meme.abilities.clone(),
            volatile: meme.volatile,
            frozen_turns: meme.initial_freeze.unwrap_or(0),
            protected_until_end: false,
            shield: meme
                .keywords
                .iter()
                .find_map(|k| match k {
                    Keyword::Shielded(ShieldedKeyword { amount }) => Some(*amount),
                    _ => None,
                })
                .unwrap_or(0),
            played_turn: 0,
            location: Location::Deck,
        },
        CardKind::Exploit(_) => CardInstance {
            instance_id,
            variant_id: def.id.clone(),
            name: def.name.clone(),
            owner,
            cost: def.cost,
            class: def.class.clone(),
            base_virality: 0,
            current_virality: 0,
            cook_rate: 0,
            yield_rate: 0,
            keywords: vec![],
            abilities: vec![],
            volatile: None,
            frozen_turns: 0,
            protected_until_end: false,
            shield: 0,
            played_turn: 0,
            location: Location::Deck,
        },
    }
}

pub fn split_players_mut<'a>(
    players: &'a mut [PlayerState],
    seat: &'a Seat,
) -> (&'a mut PlayerState, &'a mut PlayerState) {
    if seat == &Seat::Host {
        let (left, right) = players.split_at_mut(1);
        (&mut left[0], &mut right[0])
    } else {
        let (left, right) = players.split_at_mut(1);
        (&mut right[0], &mut left[0])
    }
}

fn card_cost(cards: &[CardInstance], id: &str, discount: i32) -> Result<u8, String> {
    let card = cards
        .iter()
        .find(|c| c.instance_id == id)
        .ok_or("card not found")?;
    let mut cost = card.cost as i32 - discount;
    if cost < 0 {
        cost = 0;
    }
    Ok(cost as u8)
}

fn apply_damage(card: &mut CardInstance, amount: i32, ignore_protect: bool) {
    if card.protected_until_end && !ignore_protect {
        return;
    }
    let mut dmg = amount;
    if card.shield > 0 && !ignore_protect {
        dmg = (amount - card.shield).max(0);
    }
    if card.keywords.contains(&Keyword::Fragile) && dmg > 0 {
        card.current_virality = 0;
    } else {
        card.current_virality -= dmg;
    }
}

fn find_card_mut<'a>(cards: &'a mut [CardInstance], id: &str) -> Option<&'a mut CardInstance> {
    cards.iter_mut().find(|c| c.instance_id == id)
}

pub fn find_card_mut_for_owner<'a>(
    kitchen: &'a mut Vec<CardInstance>,
    feed: &'a mut Vec<CardInstance>,
    owner: &Seat,
    id: &str,
) -> Option<&'a mut CardInstance> {
    if let Some(card) = kitchen.iter_mut().find(|c| c.instance_id == id) {
        return Some(card);
    }
    feed.iter_mut()
        .find(|c| c.instance_id == id && &c.owner == owner)
}

pub fn find_enemy_card_mut_for_owner<'a>(
    kitchen: &'a mut Vec<CardInstance>,
    feed: &'a mut Vec<CardInstance>,
    owner: &Seat,
    id: &str,
) -> Option<&'a mut CardInstance> {
    if let Some(card) = kitchen.iter_mut().find(|c| c.instance_id == id) {
        return Some(card);
    }
    feed.iter_mut()
        .find(|c| c.instance_id == id && &c.owner == &owner.other())
}

fn remove_card(cards: &mut Vec<CardInstance>, id: &str) -> Option<CardInstance> {
    if let Some(idx) = cards.iter().position(|c| c.instance_id == id) {
        Some(cards.remove(idx))
    } else {
        None
    }
}

fn has_taunt(cards: &[CardInstance]) -> bool {
    cards.iter().any(|c| c.keywords.contains(&Keyword::Taunt))
}

fn aura_amount(abilities: &[Ability]) -> Option<i32> {
    abilities.iter().find_map(|a| match &a.effect {
        AbilityEffect::BuffOtherKitchen(amount) => Some(*amount),
        _ => None,
    })
}

pub fn validate_state_hash(game: &GameState, remote: &StateHash) -> Result<(), String> {
    let local = game.state_hash();
    if local.turn != remote.turn || local.hash != remote.hash {
        Err("state hash mismatch".into())
    } else {
        Ok(())
    }
}
