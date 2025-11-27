use crate::types::TurnPlan;
use sha2::{Digest, Sha256};

// Simple hashing helpers for commit/reveal. Kept separate so both engine and transport reuse.
pub fn commitment_for(plan: &TurnPlan, salt: &str) -> String {
    let mut hasher = Sha256::new();
    let payload = serde_json::to_vec(plan).unwrap_or_default();
    hasher.update(payload);
    hasher.update(salt.as_bytes());
    format!("{:x}", hasher.finalize())
}
