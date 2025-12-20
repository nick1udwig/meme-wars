use crate::snapshot::GameSnapshot;
use crate::types::{Seat, TurnPlan};
use serde::{Deserialize, Serialize};

// Wire-level message shapes for P2P sync and the websocket bridge. These stay simple to keep
// compatibility with WIT/serde boundaries.

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct WireCommit {
    pub seat: Seat,
    pub hash: String,
    pub turn: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct WireReveal {
    pub seat: Seat,
    pub plan: TurnPlan,
    pub salt: String,
    pub turn: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct StakeNotice {
    pub seat: Seat,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct JoinLobbyPayload {
    pub lobby_id: String,
    pub node_id: String,
    pub deck: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum WireMessage {
    Commit(WireCommit),
    Reveal(WireReveal),
    RequestStateHash,
    StateHash(crate::types::StateHash),
    DebugState(crate::game::GameState),
    CallBased(StakeNotice),
    AcceptBased(StakeNotice),
    FoldBased(StakeNotice),
    JoinLobby(JoinLobbyPayload),
    RequestSnapshot,
    SyncGame(crate::game::GameState),
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum WireReply {
    Ack,
    Snapshot(GameSnapshot),
    StateHash(crate::types::StateHash),
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum WsClientMessage {
    GetSnapshot,
    NewGame {
        opponent: Option<String>,
    },
    HostLobby(crate::types::LobbyConfig),
    JoinLobby {
        lobby_id: String,
        deck: Vec<String>,
    },
    StartLobbyGame {
        lobby_id: String,
    },
    FetchRemoteLobbies {
        host_node: String,
    },
    JoinRemoteLobby {
        host_node: String,
        lobby_id: String,
        deck: Vec<String>,
    },
    SyncRemoteGame {
        host_node: String,
    },
    CommitTurn {
        seat: Seat,
        plan: TurnPlan,
        salt: String,
        turn: u32,
    },
    RevealTurn {
        seat: Seat,
        plan: TurnPlan,
        salt: String,
        turn: u32,
    },
    Reset,
    PlayLocalTurn {
        host_plan: TurnPlan,
        opponent_plan: Option<TurnPlan>,
    },
    CallBased {
        seat: Seat,
    },
    AcceptBased {
        seat: Seat,
    },
    FoldBased {
        seat: Seat,
    },
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum WsServerMessage {
    Snapshot(GameSnapshot),
    Error(String),
    Ack,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct WsEnvelope<T> {
    pub id: Option<String>,
    #[serde(flatten)]
    pub message: T,
}

pub enum WsTarget {
    Channel(u32),
    Broadcast,
}
