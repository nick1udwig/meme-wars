use hyperware_process_lib::http::server::{self, WsMessageType};
use hyperware_process_lib::{
    homepage::add_to_homepage,
    hyperapp::{get_server, send},
    our, println, Address, LazyLoadBlob, ProcessId, Request,
};
use rand::Rng;
use serde::{Deserialize, Serialize};

mod catalog;
mod constants;
mod crypto;
mod game;
mod net;
mod rng;
mod snapshot;
mod types;

use catalog::{build_catalog, default_deck};
use constants::{GAME_NAME, WS_PATH};
use crypto::commitment_for;
use game::{build_game, validate_state_hash, GameState};
use net::{
    JoinLobbyPayload, StakeNotice, WireCommit, WireMessage, WireReply, WireReveal, WsClientMessage,
    WsEnvelope, WsServerMessage, WsTarget,
};
use snapshot::GameSnapshot;
use types::*;

const ICON: &str = include_str!("./icon");

#[derive(Default, Serialize, Deserialize)]
pub struct MemeWarsState {
    catalog: Vec<CardDefinition>,
    game: Option<GameState>,
    next_instance: u64,
    lobbies: Vec<Lobby>,
    lobby_seq: u64,
    discovered_lobbies: Vec<Lobby>,
    #[serde(skip)]
    // Track all websocket paths that have been opened so we can broadcast on each.
    ws_paths: Vec<String>,
}

fn process_id() -> ProcessId {
    ProcessId::new(Some("meme-wars"), "meme-wars", "nick.hypr")
}

// Hyperprocess entrypoint. Behavior is unchanged from the monolithic version; logic has been
// reorganized into modules for clarity.
#[hyperapp_macro::hyperapp(
    name = "Meme Wars",
    ui = Some(hyperware_process_lib::http::server::HttpBindingConfig::default()),
    endpoints = vec![
        hyperware_process_lib::hyperapp::Binding::Http {
            path: "/api",
            config: hyperware_process_lib::http::server::HttpBindingConfig::default(),
        },
        hyperware_process_lib::hyperapp::Binding::Ws {
            path: WS_PATH,
            config: hyperware_process_lib::http::server::WsBindingConfig::default(),
        },
    ],
    save_config = hyperware_process_lib::hyperapp::SaveOptions::OnDiff,
    wit_world = "meme-wars-nick-dot-hypr-v0"
)]
impl MemeWarsState {
    #[init]
    async fn initialize(&mut self) {
        add_to_homepage(GAME_NAME, Some(ICON), Some("/"), None);
        self.catalog = build_catalog();
        self.next_instance = 1;
        self.lobbies = Vec::new();
        self.lobby_seq = 1;
        self.discovered_lobbies = Vec::new();
        println!("{} backend ready on node {}", GAME_NAME, our().node);
    }

    #[local]
    #[http]
    async fn get_snapshot(&self) -> Result<GameSnapshot, String> {
        Ok(self.compose_snapshot())
    }

    #[local]
    #[http]
    async fn new_game(&mut self, opponent: Option<String>) -> Result<GameSnapshot, String> {
        let opponent_id = opponent.unwrap_or_else(|| "opponent.os".to_string());
        let seed = 42u64;
        let host_deck = default_deck();
        let opponent_deck = default_deck();
        let game =
            build_game(&self.catalog, &mut self.next_instance, seed, host_deck, opponent_deck, opponent_id)?;
        self.next_instance = game.next_instance;
        self.game = Some(game);
        let snapshot = self.compose_snapshot();
        self.broadcast_snapshot();
        Ok(snapshot)
    }

    #[local]
    #[http]
    async fn host_lobby(&mut self, config: LobbyConfig) -> Result<GameSnapshot, String> {
        let id = format!("lobby-{}", self.lobby_seq);
        self.lobby_seq += 1;
        let lobby = Lobby {
            id,
            host: our().node,
            mode: config.mode,
            stakes: config.stakes,
            description: config.description,
            opponent: None,
            started: false,
            host_deck: config.deck,
            opponent_deck: vec![],
        };
        self.lobbies.push(lobby);
        let snapshot = self.compose_snapshot();
        self.broadcast_snapshot();
        Ok(snapshot)
    }

    #[local]
    #[http]
    async fn join_lobby(&mut self, params: (String, Vec<String>)) -> Result<GameSnapshot, String> {
        let (lobby_id, deck) = params;
        let lobby = self
            .lobbies
            .iter_mut()
            .find(|l| l.id == lobby_id)
            .ok_or("Lobby not found")?;
        if lobby.opponent.is_some() {
            return Err("Lobby already has an opponent".into());
        }
        lobby.opponent = Some(our().node);
        lobby.opponent_deck = deck;
        let snapshot = self.compose_snapshot();
        self.broadcast_snapshot();
        Ok(snapshot)
    }

    #[local]
    #[http]
    async fn start_lobby_game(&mut self, lobby_id: String) -> Result<GameSnapshot, String> {
        let lobby_index = self
            .lobbies
            .iter()
            .position(|l| l.id == lobby_id)
            .ok_or("Lobby not found")?;
        let opponent_id = self.lobbies[lobby_index]
            .opponent
            .clone()
            .ok_or("Need an opponent to start")?;
        let seed = rand::thread_rng().gen::<u64>();
        let host_deck = self.lobbies[lobby_index].host_deck.clone();
        let opponent_deck = self.lobbies[lobby_index].opponent_deck.clone();
        let game = build_game(
            &self.catalog,
            &mut self.next_instance,
            seed,
            host_deck,
            opponent_deck,
            opponent_id.clone(),
        )?;
        self.next_instance = game.next_instance;
        if let Some(lobby) = self.lobbies.get_mut(lobby_index) {
            lobby.started = true;
        }
        self.game = Some(game.clone());
        let _ = self
            .send_wire_message(&opponent_id, WireMessage::SyncGame(game.clone()))
            .await;
        let snapshot = self.compose_snapshot();
        self.broadcast_snapshot();
        Ok(snapshot)
    }

    #[local]
    #[http]
    async fn fetch_remote_lobbies(&mut self, node: String) -> Result<GameSnapshot, String> {
        if node == our().node {
            return Err("cannot fetch remote lobbies from self".into());
        }
        let reply = self
            .send_wire_message(&node, WireMessage::RequestSnapshot)
            .await?;
        if let WireReply::Snapshot(snapshot) = reply {
            self.discovered_lobbies = snapshot.lobbies.clone();
            let merged = self.compose_snapshot();
            self.broadcast_snapshot();
            return Ok(merged);
        }
        Err("unexpected reply".into())
    }

    #[local]
    #[http]
    async fn join_remote_lobby(
        &mut self,
        params: (String, String, Vec<String>),
    ) -> Result<GameSnapshot, String> {
        let (host_node, lobby_id, deck) = params;
        let reply = self
            .send_wire_message(
                &host_node,
                WireMessage::JoinLobby(JoinLobbyPayload {
                    lobby_id,
                    node_id: our().node.clone(),
                    deck,
                }),
            )
            .await?;
        match reply {
            WireReply::Snapshot(snapshot) => {
                self.discovered_lobbies = snapshot.lobbies.clone();
                if let Some(game) = snapshot.game.clone() {
                    self.next_instance = game.next_instance;
                    self.game = Some(game);
                }
                let merged = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(merged)
            }
            _ => Err("unexpected reply".into()),
        }
    }

    #[local]
    #[http]
    async fn sync_remote_game(&mut self, host_node: String) -> Result<GameSnapshot, String> {
        let reply = self
            .send_wire_message(&host_node, WireMessage::RequestSnapshot)
            .await?;
        match reply {
            WireReply::Snapshot(snapshot) => {
                self.discovered_lobbies = snapshot.lobbies.clone();
                if let Some(game) = snapshot.game.clone() {
                    self.next_instance = game.next_instance;
                    self.game = Some(game);
                }
                let merged = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(merged)
            }
            _ => Err("unexpected reply".into()),
        }
    }

    #[local]
    #[http]
    async fn reset(&mut self) -> Result<(), String> {
        self.lobbies.retain(|l| !l.started);
        self.discovered_lobbies.retain(|l| !l.started);
        self.game = None;
        self.broadcast_snapshot();
        Ok(())
    }

    #[local]
    #[http]
    async fn compute_commit(&self, params: (TurnPlan, String)) -> Result<String, String> {
        let (plan, salt) = params;
        Ok(commitment_for(&plan, &salt))
    }

    #[local]
    #[http]
    async fn commit_turn(&mut self, params: (Seat, String, u32)) -> Result<GameSnapshot, String> {
        let (seat, hash, turn) = params;
        let opponent_node = {
            let game = self.game.as_mut().ok_or("no active game")?;
            if game.turn != turn {
                return Err(format!(
                    "commit turn mismatch: game {}, got {}",
                    game.turn, turn
                ));
            }
            let node = game
                .players
                .iter()
                .find(|p| p.seat == seat.other())
                .map(|p| p.node_id.clone());
            game.record_commit(seat.clone(), hash.clone())?;
            self.next_instance = game.next_instance;
            node
        };
        if let Some(node) = opponent_node {
            let _ = self
                .send_wire_message(&node, WireMessage::Commit(WireCommit { seat, hash, turn }))
                .await;
        }
        let snapshot = self.compose_snapshot();
        self.broadcast_snapshot();
        Ok(snapshot)
    }

    #[local]
    #[http]
    async fn reveal_turn(
        &mut self,
        params: (Seat, TurnPlan, String, u32),
    ) -> Result<GameSnapshot, String> {
        let (seat, plan, salt, turn) = params;
        let (opponent_node, prev_turn, host_is_me) = {
            let game = self.game.as_mut().ok_or("no active game")?;
            if game.turn != turn {
                return Err(format!(
                    "reveal turn mismatch: game {}, got {}",
                    game.turn, turn
                ));
            }
            let opponent_node = game
                .players
                .iter()
                .find(|p| p.seat == seat.other())
                .map(|p| p.node_id.clone());
            let host_is_me = game
                .players
                .iter()
                .find(|p| p.seat == Seat::Host)
                .map(|p| p.node_id == our().node)
                .unwrap_or(false);
            let prev_turn = game.turn;
            game.record_reveal(seat.clone(), plan.clone(), salt.clone())?;
            self.next_instance = game.next_instance;
            (opponent_node, prev_turn, host_is_me)
        };
        if let Some(node) = opponent_node.clone() {
            let _ = self
                .send_wire_message(
                    &node,
                    WireMessage::Reveal(WireReveal {
                        seat,
                        plan,
                        salt,
                        turn,
                    }),
                )
                .await;
        }
        let snapshot = self.compose_snapshot();
        self.broadcast_snapshot();
        if host_is_me {
            if let (Some(node), Some(game_state)) = (opponent_node, self.game.clone()) {
                if game_state.turn > prev_turn {
                    let _ = self
                        .send_wire_message(&node, WireMessage::DebugState(game_state))
                        .await;
                }
            }
        }
        Ok(snapshot)
    }

    #[local]
    #[http]
    async fn play_local_turn(
        &mut self,
        params: (TurnPlan, TurnPlan),
    ) -> Result<GameSnapshot, String> {
        let (host, opponent) = params;
        let game = self.game.as_mut().ok_or("no active game")?;
        game.resolve_turn(host, opponent)?;
        self.next_instance = game.next_instance;
        let snapshot = self.compose_snapshot();
        self.broadcast_snapshot();
        Ok(snapshot)
    }

    #[local]
    #[remote]
    #[http]
    async fn handle_wire_message(&mut self, message: WireMessage) -> Result<WireReply, String> {
        match message {
            WireMessage::Commit(payload) => {
                let game = self.game.as_mut().ok_or("no active game")?;
                if game.turn != payload.turn {
                    return Err(format!(
                        "wire commit turn mismatch: game {}, got {}",
                        game.turn, payload.turn
                    ));
                }
                game.record_commit(payload.seat, payload.hash)?;
                let snapshot = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
            WireMessage::Reveal(payload) => {
                let game = self.game.as_mut().ok_or("no active game")?;
                if game.turn != payload.turn {
                    return Err(format!(
                        "wire reveal turn mismatch: game {}, got {}",
                        game.turn, payload.turn
                    ));
                }
                game.record_reveal(payload.seat, payload.plan, payload.salt)?;
                self.next_instance = game.next_instance;
                let snapshot = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
            WireMessage::RequestStateHash => {
                let game = self.game.as_ref().ok_or("no active game")?;
                Ok(WireReply::StateHash(game.state_hash()))
            }
            WireMessage::StateHash(remote) => {
                self.validate_state_hash(&remote)?;
                Ok(WireReply::Ack)
            }
            WireMessage::DebugState(remote_game) => {
                if let Some(local) = self.game.as_ref() {
                    let local_hash = local.state_hash();
                    let remote_hash = remote_game.state_hash();
                    if local_hash != remote_hash {
                        println!(
                            "⚠️ state mismatch: local turn {} hash {}, remote turn {} hash {}",
                            local_hash.turn, local_hash.hash, remote_hash.turn, remote_hash.hash
                        );
                    } else {
                        println!(
                            "✅ state match debug check turn {} hash {}",
                            remote_hash.turn, remote_hash.hash
                        );
                    }
                } else {
                    println!("⚠️ debug state received but no local game");
                }
                Ok(WireReply::Ack)
            }
            WireMessage::CallBased(payload) => {
                let game = self.game.as_mut().ok_or("no active game")?;
                game.call_based(payload.seat)?;
                let snapshot = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
            WireMessage::AcceptBased(payload) => {
                let game = self.game.as_mut().ok_or("no active game")?;
                game.accept_based(payload.seat)?;
                let snapshot = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
            WireMessage::FoldBased(payload) => {
                let game = self.game.as_mut().ok_or("no active game")?;
                game.fold_based(payload.seat)?;
                let snapshot = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
            WireMessage::JoinLobby(payload) => {
                let lobby = self
                    .lobbies
                    .iter_mut()
                    .find(|l| l.id == payload.lobby_id)
                    .ok_or("Lobby not found")?;
                if lobby.opponent.is_some() {
                    return Err("Lobby already has an opponent".into());
                }
                lobby.opponent = Some(payload.node_id);
                lobby.opponent_deck = payload.deck;
                let snapshot = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
            WireMessage::RequestSnapshot => {
                let snapshot = self.compose_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
            WireMessage::SyncGame(game) => {
                self.next_instance = game.next_instance;
                self.game = Some(game);
                let snapshot = self.compose_snapshot();
                self.broadcast_snapshot();
                Ok(WireReply::Snapshot(snapshot))
            }
        }
    }

    #[local]
    #[http]
    async fn get_state_hash(&self) -> Result<Option<StateHash>, String> {
        Ok(self.game.as_ref().map(|g| g.state_hash()))
    }

    #[local]
    #[http]
    async fn send_wire(&mut self, params: (String, WireMessage)) -> Result<WireReply, String> {
        let (node, message) = params;
        self.send_wire_message(&node, message).await
    }

    #[ws]
    async fn websocket(
        &mut self,
        channel_id: u32,
        message_type: WsMessageType,
        blob: LazyLoadBlob,
    ) {
        if !matches!(message_type, WsMessageType::Text | WsMessageType::Binary) {
            return;
        }
        println!("WS recv chan={} bytes={}", channel_id, blob.bytes.len());
        let payload = String::from_utf8_lossy(&blob.bytes).to_string();
        let parsed: Result<WsEnvelope<WsClientMessage>, _> = serde_json::from_str(&payload);
        match parsed {
            Ok(envelope) => {
                let request_id = envelope.id.clone();
                println!(
                    "WS parsed message={:?} id={:?}",
                    envelope.message, request_id
                );
                match self.process_ws_message(envelope.message).await {
                    Ok(response_msg) => {
                        let envelope = WsEnvelope {
                            id: request_id,
                            message: response_msg,
                        };
                        println!("WS responding ok id={:?}", envelope.id);
                        self.push_ws_message(WsTarget::Channel(channel_id), envelope);
                    }
                    Err(err) => {
                        println!("WS handler error id={:?} err={}", request_id, err);
                        let envelope = WsEnvelope {
                            id: request_id,
                            message: WsServerMessage::Error(err),
                        };
                        self.push_ws_message(WsTarget::Channel(channel_id), envelope);
                    }
                }
            }
            Err(e) => {
                println!("WS parse error: {}", e);
                let envelope = WsEnvelope {
                    id: None,
                    message: WsServerMessage::Error(format!("invalid ws payload: {}", e)),
                };
                self.push_ws_message(WsTarget::Channel(channel_id), envelope);
            }
        }
    }
}

impl MemeWarsState {
    fn compose_snapshot(&self) -> GameSnapshot {
        let mut lobbies = self.lobbies.clone();
        for lob in &self.discovered_lobbies {
            if !lobbies
                .iter()
                .any(|existing| existing.id == lob.id && existing.host == lob.host)
            {
                lobbies.push(lob.clone());
            }
        }
        // Filter out lobbies where the game is over
        let game_over = self
            .game
            .as_ref()
            .map(|g| g.phase == Phase::GameOver)
            .unwrap_or(false);
        if game_over {
            lobbies.retain(|l| !l.started);
        }
        GameSnapshot {
            catalog: self.catalog.clone(),
            game: self.game.clone(),
            lobbies,
        }
    }

    fn push_ws_message(&self, target: WsTarget, envelope: WsEnvelope<WsServerMessage>) {
        if let Some(server) = get_server() {
            if let Ok(bytes) = serde_json::to_vec(&envelope) {
                match target {
                    WsTarget::Channel(channel_id) => {
                        let blob = LazyLoadBlob {
                            mime: None,
                            bytes: bytes.clone(),
                        };
                        println!(
                            "WS push to channel {} message={:?}",
                            channel_id, envelope.message
                        );
                        server::send_ws_push(channel_id, WsMessageType::Text, blob)
                    }
                    WsTarget::Broadcast => {
                        println!(
                            "WS broadcast message={:?} paths={:?}",
                            envelope.message, self.ws_paths
                        );
                        let mut paths = self.ws_paths.clone();
                        if !paths.iter().any(|p| p == WS_PATH) {
                            paths.push(WS_PATH.to_string());
                        }
                        for path in paths {
                            let blob = LazyLoadBlob {
                                mime: None,
                                bytes: bytes.clone(),
                            };
                            let _ = server.ws_push_all_channels(&path, WsMessageType::Text, blob);
                        }
                    }
                }
            }
        }
    }

    fn broadcast_snapshot(&self) {
        let snapshot = self.compose_snapshot();
        let envelope = WsEnvelope {
            id: None,
            message: WsServerMessage::Snapshot(snapshot),
        };
        self.push_ws_message(WsTarget::Broadcast, envelope);
    }

    async fn process_ws_message(
        &mut self,
        msg: WsClientMessage,
    ) -> Result<WsServerMessage, String> {
        println!("processing ws message {:?}", msg);
        match msg {
            WsClientMessage::GetSnapshot => Ok(WsServerMessage::Snapshot(self.compose_snapshot())),
            WsClientMessage::NewGame { opponent } => {
                let snapshot = self.new_game(opponent).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::HostLobby(config) => {
                let snapshot = self.host_lobby(config).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::JoinLobby { lobby_id, deck } => {
                let snapshot = self.join_lobby((lobby_id, deck)).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::StartLobbyGame { lobby_id } => {
                let snapshot = self.start_lobby_game(lobby_id).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::FetchRemoteLobbies { host_node } => {
                let snapshot = self.fetch_remote_lobbies(host_node).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::JoinRemoteLobby {
                host_node,
                lobby_id,
                deck,
            } => {
                let snapshot = self.join_remote_lobby((host_node, lobby_id, deck)).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::SyncRemoteGame { host_node } => {
                let snapshot = self.sync_remote_game(host_node).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::CommitTurn {
                seat,
                plan,
                salt,
                turn,
            } => {
                let snapshot = commit_turn_with_plan(self, seat, plan, salt, turn).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::RevealTurn {
                seat,
                plan,
                salt,
                turn,
            } => {
                let snapshot = self.reveal_turn((seat, plan, salt, turn)).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::Reset => {
                self.reset().await?;
                Ok(WsServerMessage::Snapshot(self.compose_snapshot()))
            }
            WsClientMessage::PlayLocalTurn {
                host_plan,
                opponent_plan,
            } => {
                let opponent = opponent_plan.unwrap_or_default();
                let snapshot = self.play_local_turn((host_plan, opponent)).await?;
                Ok(WsServerMessage::Snapshot(snapshot))
            }
            WsClientMessage::CallBased { seat } => {
                let seat_clone = seat.clone();
                let opponent_node = self
                    .game
                    .as_ref()
                    .and_then(|g| g.player_node(&seat.other()));
                let reply = self
                    .handle_wire_message(WireMessage::CallBased(StakeNotice { seat: seat.clone() }))
                    .await?;
                if let Some(node) = opponent_node {
                    let _ = self
                        .send_wire_message(
                            &node,
                            WireMessage::CallBased(StakeNotice { seat: seat_clone }),
                        )
                        .await;
                }
                if let WireReply::Snapshot(snapshot) = reply {
                    Ok(WsServerMessage::Snapshot(snapshot))
                } else {
                    Ok(WsServerMessage::Ack)
                }
            }
            WsClientMessage::AcceptBased { seat } => {
                let seat_clone = seat.clone();
                let opponent_node = self
                    .game
                    .as_ref()
                    .and_then(|g| g.player_node(&seat.other()));
                let reply = self
                    .handle_wire_message(WireMessage::AcceptBased(StakeNotice {
                        seat: seat.clone(),
                    }))
                    .await?;
                if let Some(node) = opponent_node {
                    let _ = self
                        .send_wire_message(
                            &node,
                            WireMessage::AcceptBased(StakeNotice { seat: seat_clone }),
                        )
                        .await;
                }
                if let WireReply::Snapshot(snapshot) = reply {
                    Ok(WsServerMessage::Snapshot(snapshot))
                } else {
                    Ok(WsServerMessage::Ack)
                }
            }
            WsClientMessage::FoldBased { seat } => {
                let seat_clone = seat.clone();
                let opponent_node = self
                    .game
                    .as_ref()
                    .and_then(|g| g.player_node(&seat.other()));
                let reply = self
                    .handle_wire_message(WireMessage::FoldBased(StakeNotice { seat: seat.clone() }))
                    .await?;
                if let Some(node) = opponent_node {
                    let _ = self
                        .send_wire_message(
                            &node,
                            WireMessage::FoldBased(StakeNotice { seat: seat_clone }),
                        )
                        .await;
                }
                if let WireReply::Snapshot(snapshot) = reply {
                    Ok(WsServerMessage::Snapshot(snapshot))
                } else {
                    Ok(WsServerMessage::Ack)
                }
            }
        }
    }

    async fn send_wire_message(
        &self,
        node: &str,
        message: WireMessage,
    ) -> Result<WireReply, String> {
        let address = Address {
            node: node.to_string(),
            process: process_id(),
        };
        let envelope = serde_json::json!({ "HandleWireMessage": message });
        let body = serde_json::to_vec(&envelope).map_err(|e| e.to_string())?;
        let request = Request::to(address).expects_response(30).body(body);
        let response: Result<WireReply, String> = send(request).await.map_err(|e| e.to_string())?;
        response
    }

    fn validate_state_hash(&self, remote: &StateHash) -> Result<(), String> {
        let game = self.game.as_ref().ok_or("no active game")?;
        validate_state_hash(game, remote)
    }
}

async fn commit_turn_with_plan(
    app: &mut MemeWarsState,
    seat: Seat,
    plan: TurnPlan,
    salt: String,
    turn: u32,
) -> Result<GameSnapshot, String> {
    let hash = commitment_for(&plan, &salt);
    app.commit_turn((seat, hash, turn)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use catalog::find_definition;
    use game::split_players_mut;

    fn make_app() -> MemeWarsState {
        let mut app = MemeWarsState::default();
        app.catalog = build_catalog();
        app.next_instance = 1;
        app
    }

    #[test]
    fn commitment_changes_with_salt() {
        let plan = TurnPlan::default();
        let a = commitment_for(&plan, "a");
        let b = commitment_for(&plan, "b");
        assert_ne!(a, b);
    }

    #[test]
    fn reveal_rejects_wrong_commit() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 1, vec!["n01".into()], vec!["n01".into()], "opp.os".into())
                .unwrap();
        let plan = TurnPlan::default();
        let correct_hash = commitment_for(&plan, "good");
        game.record_commit(Seat::Host, correct_hash).unwrap();
        let err = game.record_reveal(Seat::Host, plan.clone(), "bad".into());
        assert!(err.is_err());
    }

    #[test]
    fn heavy_enters_bottom_when_feed_not_empty() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 2, vec!["d10".into()], vec!["n01".into()], "opp.os".into())
                .unwrap();
        let def_normal = find_definition("n01").unwrap();
        let existing =
            game.new_instance_from_def(def_normal, Seat::Host, Location::Feed(FeedSlot { slot: 0 }));
        game.feed.push(existing);

        let def_heavy = find_definition("d10").unwrap();
        let heavy = game.new_instance_from_def(def_heavy, Seat::Host, Location::Kitchen);
        let heavy_id = heavy.instance_id.clone();
        {
            let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
            host.kitchen.push(heavy);
        }
        game.resolve_posts(&[PostAction { card_id: heavy_id }], &[])
            .unwrap();

        assert_eq!(game.feed.first().unwrap().variant_id, "n01");
        assert_eq!(game.feed.last().unwrap().variant_id, "d10");
    }

    #[test]
    fn gatekeeper_blocks_low_cost_posts() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 3, vec!["m04".into()], vec!["n01".into()], "opp.os".into())
                .unwrap();

        let gate_def = find_definition("m04").unwrap();
        let gate =
            game.new_instance_from_def(gate_def, Seat::Host, Location::Feed(FeedSlot { slot: 0 }));
        game.feed.push(gate);
        game.reindex_feed();

        let post_def = find_definition("n01").unwrap();
        let post_card = game.new_instance_from_def(post_def, Seat::Opponent, Location::Kitchen);
        let post_id = post_card.instance_id.clone();
        {
            let (_, opp) = split_players_mut(&mut game.players, &Seat::Opponent);
            opp.kitchen.push(post_card);
        }

        game.resolve_posts(&[], &[PostAction { card_id: post_id }])
            .unwrap();
        assert_eq!(game.feed[0].variant_id, "m04");
        assert_eq!(game.feed[1].variant_id, "n01");
    }

    #[test]
    fn feed_yield_scales_with_stakes() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 4, vec!["n01".into()], vec!["n01".into()], "opp.os".into())
                .unwrap();

        let card_def = find_definition("n01").unwrap();
        let card =
            game.new_instance_from_def(card_def, Seat::Host, Location::Feed(FeedSlot { slot: 0 }));
        game.feed.push(card);
        game.stakes = 2;
        game.apply_feed_yield();
        let host = game.players.iter().find(|p| p.seat == Seat::Host).unwrap();
        assert_eq!(host.score, constants::BASE_FEED_YIELD * 2);
    }

    #[test]
    fn stakes_call_accept_and_fold() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 5, vec!["n01".into()], vec!["n01".into()], "opp.os".into())
                .unwrap();

        game.call_based(Seat::Host).unwrap();
        assert_eq!(game.phase, Phase::StakePending);
        assert!(game.pending_stakes.is_some());

        game.accept_based(Seat::Opponent).unwrap();
        assert_eq!(game.stakes, 2);
        assert!(game.pending_stakes.is_none());
        assert_eq!(game.phase, Phase::Commit);

        game.call_based(Seat::Opponent).unwrap();
        game.fold_based(Seat::Host).unwrap();
        assert_eq!(game.winner, Some(Seat::Opponent));
        assert_eq!(game.phase, Phase::GameOver);
    }

    #[test]
    fn initiative_controls_exploit_order() {
        let mut app = make_app();
        let mut game = build_game(&app.catalog, &mut app.next_instance, 6, vec![], vec![], "opp.os".into()).unwrap();
        for player in game.players.iter_mut() {
            player.hand.clear();
            player.kitchen.clear();
            player.mana = 10;
            player.max_mana = 10;
        }

        let target_def = find_definition("n04").unwrap();
        let mut target = game.new_instance_from_def(target_def, Seat::Host, Location::Kitchen);
        target.cook_rate = 0;
        let target_id = target.instance_id.clone();
        {
            let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
            host.kitchen.push(target);
        }

        let protect_def = find_definition("c06").unwrap();
        let protect = game.new_instance_from_def(protect_def, Seat::Host, Location::Hand);
        let protect_id = protect.instance_id.clone();
        {
            let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
            host.hand.push(protect);
        }

        let damage_def = find_definition("t02").unwrap();
        let damage = game.new_instance_from_def(damage_def, Seat::Opponent, Location::Hand);
        let damage_id = damage.instance_id.clone();
        {
            let (_, opp) = split_players_mut(&mut game.players, &Seat::Opponent);
            opp.hand.push(damage);
        }

        game.initiative = Seat::Opponent;
        let host_plan = TurnPlan {
            plays_to_kitchen: vec![],
            posts: vec![],
            exploits: vec![ExploitAction {
                card_id: protect_id,
                target: Some(Target::Card(target_id.clone())),
            }],
        };
        let opp_plan = TurnPlan {
            plays_to_kitchen: vec![],
            posts: vec![],
            exploits: vec![ExploitAction {
                card_id: damage_id,
                target: Some(Target::Card(target_id.clone())),
            }],
        };
        game.resolve_turn(host_plan, opp_plan).unwrap();

        let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
        let survivor = host
            .kitchen
            .iter()
            .find(|c| c.instance_id == target_id)
            .unwrap();
        assert_eq!(survivor.current_virality, 5);
    }

    #[test]
    fn cook_and_decay_apply() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 7, vec!["c01".into(), "d05".into()], vec![], "opp.os".into())
                .unwrap();
        for player in game.players.iter_mut() {
            player.kitchen.clear();
            player.hand.clear();
        }
        let fast_cook_def = find_definition("c01").unwrap();
        let mut fast_cook =
            game.new_instance_from_def(fast_cook_def, Seat::Host, Location::Kitchen);
        let fast_id = fast_cook.instance_id.clone();
        fast_cook.current_virality = 2;
        let volatile_def = find_definition("d05").unwrap();
        let mut volatile = game.new_instance_from_def(volatile_def, Seat::Host, Location::Kitchen);
        volatile.current_virality = 12;
        {
            let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
            host.kitchen.push(fast_cook);
            host.kitchen.push(volatile);
        }

        game.apply_cook_and_decay();

        let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
        let cook = host
            .kitchen
            .iter()
            .find(|c| c.instance_id == fast_id)
            .unwrap();
        assert_eq!(cook.current_virality, 5);
        game.cleanup_board();
        let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
        assert_eq!(host.kitchen.len(), 1);
    }

    #[test]
    fn pinned_and_anchor_block_movement() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 8, vec!["m07".into(), "n01".into()], vec![], "opp.os".into())
                .unwrap();
        for player in game.players.iter_mut() {
            player.feed_locked = false;
        }
        let anchor_def = find_definition("m07").unwrap();
        let anchor = game.new_instance_from_def(
            anchor_def,
            Seat::Host,
            Location::Feed(FeedSlot { slot: 0 }),
        );
        let other_def = find_definition("n01").unwrap();
        let other =
            game.new_instance_from_def(other_def, Seat::Host, Location::Feed(FeedSlot { slot: 1 }));
        game.feed = vec![anchor, other];
        game.reindex_feed();

        let (_, opp) = split_players_mut(&mut game.players, &Seat::Opponent);
        opp.pinned_slots.push(1);
        game.shift_feed_up(1).unwrap();
        assert_eq!(game.feed[0].variant_id, "m07");
        assert_eq!(game.feed[1].variant_id, "n01");

        let (_, opp) = split_players_mut(&mut game.players, &Seat::Opponent);
        opp.pinned_slots.clear();
        game.shift_feed_up(1).unwrap();
        assert_eq!(game.feed[0].variant_id, "m07");
    }

    #[test]
    fn can_play_to_kitchen_and_post_existing_in_same_turn() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 42, vec![], vec![], "opp.os".into()).unwrap();

        for player in game.players.iter_mut() {
            player.hand.clear();
            player.kitchen.clear();
            player.mana = 10;
            player.max_mana = 10;
        }

        let hand_def = find_definition("n02").unwrap();
        let kitchen_def = find_definition("n01").unwrap();
        let to_kitchen = game.new_instance_from_def(hand_def, Seat::Host, Location::Hand);
        let in_kitchen = game.new_instance_from_def(kitchen_def, Seat::Host, Location::Kitchen);
        let hand_id = to_kitchen.instance_id.clone();
        let kitchen_id = in_kitchen.instance_id.clone();

        {
            let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
            host.hand.push(to_kitchen);
            host.kitchen.push(in_kitchen);
        }

        let host_plan = TurnPlan {
            plays_to_kitchen: vec![hand_id.clone()],
            posts: vec![PostAction {
                card_id: kitchen_id.clone(),
            }],
            exploits: vec![],
        };
        let opponent_plan = TurnPlan::default();

        game.resolve_turn(host_plan, opponent_plan).unwrap();

        let hand_card_in_kitchen = {
            let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
            host.kitchen.iter().any(|c| c.instance_id == hand_id)
        };
        let feed_contains_kitchen_card = game
            .feed
            .iter()
            .any(|c| c.instance_id == kitchen_id && c.owner == Seat::Host);

        assert!(hand_card_in_kitchen, "newly played meme should remain in kitchen");
        assert!(feed_contains_kitchen_card, "existing kitchen meme should post to feed");
    }

    #[test]
    fn shuffle_feed_is_deterministic_per_seed_and_turn() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 9, vec!["n01".into(), "n02".into()], vec![], "opp.os".into())
                .unwrap();
        for player in game.players.iter_mut() {
            player.feed_locked = false;
        }
        let first = game.new_instance_from_def(
            find_definition("n01").unwrap(),
            Seat::Host,
            Location::Feed(FeedSlot { slot: 0 }),
        );
        let second = game.new_instance_from_def(
            find_definition("n02").unwrap(),
            Seat::Host,
            Location::Feed(FeedSlot { slot: 1 }),
        );
        game.feed = vec![first.clone(), second.clone()];
        game.reindex_feed();

        game.apply_exploit_effect(ExploitEffect::ShuffleFeed, &Seat::Host, None)
            .unwrap();
        let order1: Vec<String> = game.feed.iter().map(|c| c.variant_id.clone()).collect();

        let mut game2 =
            build_game(&app.catalog, &mut app.next_instance, 9, vec!["n01".into(), "n02".into()], vec![], "opp.os".into())
                .unwrap();
        game2.feed = vec![first, second];
        game2.reindex_feed();
        game2
            .apply_exploit_effect(ExploitEffect::ShuffleFeed, &Seat::Host, None)
            .unwrap();
        let order2: Vec<String> = game2.feed.iter().map(|c| c.variant_id.clone()).collect();
        assert_eq!(order1, order2);
    }

    #[test]
    fn execute_ignores_shield_and_protect() {
        let mut app = make_app();
        let mut game =
            build_game(&app.catalog, &mut app.next_instance, 10, vec!["c05".into()], vec![], "opp.os".into())
                .unwrap();
        for player in game.players.iter_mut() {
            player.hand.clear();
            player.kitchen.clear();
        }
        let mut shielded =
            game.new_instance_from_def(find_definition("c05").unwrap(), Seat::Host, Location::Kitchen);
        shielded.protected_until_end = true;
        let shielded_id = shielded.instance_id.clone();
        {
            let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
            host.kitchen.push(shielded);
        }
        let exploit = ExploitAction {
            card_id: "exec".into(),
            target: Some(Target::Card(shielded_id.clone())),
        };
        game.apply_exploit_effect(
            ExploitEffect::Execute,
            &Seat::Opponent,
            exploit.target.clone(),
        )
        .unwrap();
        game.cleanup_board();
        let (host, _) = split_players_mut(&mut game.players, &Seat::Host);
        assert!(host.kitchen.iter().all(|c| c.instance_id != shielded_id));
        assert!(host.abyss.iter().any(|c| c.instance_id == shielded_id));
    }
}
