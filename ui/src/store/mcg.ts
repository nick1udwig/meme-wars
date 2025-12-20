// Zustand store for Hyperapp Skeleton state management
import { create } from 'zustand';
import type { McgState, GameSnapshot, Seat, TurnPlan } from '../types/mcg';
import { getNodeId } from '../types/global';

type WsClientMessage =
  | { type: 'GetSnapshot' }
  | { type: 'NewGame'; data?: { opponent?: string | null } }
  | { type: 'HostLobby'; data: { mode: string; stakes: number; description: string; deck: string[] } }
  | { type: 'JoinLobby'; data: { lobby_id: string; deck: string[] } }
  | { type: 'StartLobbyGame'; data: { lobby_id: string } }
  | { type: 'FetchRemoteLobbies'; data: { host_node: string } }
  | { type: 'JoinRemoteLobby'; data: { host_node: string; lobby_id: string; deck: string[] } }
  | { type: 'SyncRemoteGame'; data: { host_node: string } }
  | { type: 'CommitTurn'; data: { seat: Seat; plan: TurnPlan; salt: string; turn: number } }
  | { type: 'RevealTurn'; data: { seat: Seat; plan: TurnPlan; salt: string; turn: number } }
  | { type: 'Reset' }
  | { type: 'PlayLocalTurn'; data: { host_plan: TurnPlan; opponent_plan?: TurnPlan } }
  | { type: 'CallBased'; data: { seat: Seat } }
  | { type: 'AcceptBased'; data: { seat: Seat } }
  | { type: 'FoldBased'; data: { seat: Seat } };

type WsServerEnvelope =
  | { id?: string | null; type: 'Snapshot'; data: GameSnapshot }
  | { id?: string | null; type: 'Error'; data: string }
  | { id?: string | null; type: 'Ack'; data?: null };

type PendingRequest = {
  resolve: (message: WsServerEnvelope) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const WS_TIMEOUT_MS = 12000;
const BASE_PATH = import.meta.env.BASE_URL || '/';
const trimmedBase = BASE_PATH.endsWith('/') ? BASE_PATH.slice(0, -1) : BASE_PATH;
const buildWsUrl = () => {
  const targetRoot = import.meta.env.DEV
    ? (import.meta.env.VITE_NODE_URL || 'http://127.0.0.1:8080').replace('localhost', '127.0.0.1')
    : window.location.origin;
  const wsRoot = targetRoot.replace(/^http/, 'ws');
  const base = trimmedBase || '';
  const needsSlash = base === '' || base.startsWith('/') ? '' : '/';
  return `${wsRoot}${needsSlash}${base}/ws`;
};

interface McgStore extends McgState {
  // Actions
  initialize: () => void;
  fetchSnapshot: () => Promise<void>;
  startGame: (opponent?: string | null) => Promise<void>;
  hostLobby: (config: { mode: string; stakes: number; description: string; deck: string[] }) => Promise<void>;
  joinLobby: (lobbyId: string, deck: string[]) => Promise<void>;
  joinRemoteLobby: (hostNode: string, lobbyId: string, deck: string[]) => Promise<void>;
  fetchRemoteLobbies: (hostNode: string) => Promise<void>;
  syncRemoteGame: (hostNode: string) => Promise<void>;
  startLobbyGame: (lobbyId: string) => Promise<void>;
  leaveGame: () => Promise<void>;
  commitTurn: (seat: Seat, plan: TurnPlan, salt: string, turn: number) => Promise<void>;
  revealTurn: (seat: Seat, plan: TurnPlan, salt: string, turn: number) => Promise<void>;
  playTurn: (plan: import('../types/mcg').TurnPlan, opponentPlan?: import('../types/mcg').TurnPlan) => Promise<void>;
  playEmptyTurn: () => Promise<void>;
  callBased: (seat?: Seat) => Promise<void>;
  acceptBased: (seat?: Seat) => Promise<void>;
  foldBased: (seat?: Seat) => Promise<void>;
  setError: (error: string | null) => void;
  clearError: () => void;
}

// Create the Zustand store with a websocket transport to the backend
export const useMcgStore = create<McgStore>((set, get) => {
  let socket: WebSocket | null = null;
  const pending = new Map<string, PendingRequest>();

  const settlePending = (id: string, message: WsServerEnvelope) => {
    const entry = pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      entry.resolve(message);
      pending.delete(id);
    }
  };

  const rejectAllPending = (reason: unknown) => {
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(reason);
    });
    pending.clear();
  };

  const handleServerMessage = (message: WsServerEnvelope) => {
    if (message.id) {
      settlePending(message.id, message);
    }
    if (message.type === 'Snapshot') {
      set({ snapshot: message.data, isLoading: false });
    } else if (message.type === 'Error') {
      set({ error: message.data, isLoading: false });
    }
  };

  const sendWs = (message: WsClientMessage): Promise<WsServerEnvelope> => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }
    const id = crypto.randomUUID();
    const payload: Record<string, unknown> = { id, type: message.type };
    if ('data' in message && (message as any).data !== undefined) {
      payload.data = (message as any).data;
    }
    console.log('[mcg/ws] send', payload);
    const timer = setTimeout(() => {
      const entry = pending.get(id);
      if (entry) {
        entry.reject(new Error('WebSocket request timed out'));
        pending.delete(id);
      }
    }, WS_TIMEOUT_MS);
    const promise = new Promise<WsServerEnvelope>((resolve, reject) => {
      pending.set(id, { resolve, reject, timer });
    });
    socket.send(JSON.stringify(payload));
    return promise;
  };

  const connectWebSocket = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const url = buildWsUrl();
    try {
      socket = new WebSocket(url);
    } catch (error) {
      set({ error: getErrorMessage(error), isConnected: false });
      return;
    }
    socket.onopen = () => {
      console.log('[mcg/ws] open', url);
      set({ isConnected: true });
      void sendWs({ type: 'GetSnapshot' }).catch(() => {
        // handled by periodic snapshot requests in actions
      });
    };
    socket.onmessage = (event) => {
      console.log('[mcg/ws] message raw', event.data);
      try {
        const message = JSON.parse(event.data) as WsServerEnvelope;
        console.log('[mcg/ws] parsed', message);
        handleServerMessage(message);
      } catch (error) {
        set({ error: 'Failed to parse websocket payload' });
      }
    };
    socket.onclose = (ev) => {
      console.log('[mcg/ws] close', ev.code, ev.reason);
      rejectAllPending(new Error('WebSocket closed'));
      socket = null;
      set({ isConnected: false });
      setTimeout(connectWebSocket, 1500);
    };
    socket.onerror = (e) => {
      console.log('[mcg/ws] error', e);
      set({ error: 'WebSocket error', isConnected: false });
    };
  };

  const ensureSocketReady = async () => {
    connectWebSocket();
    const start = Date.now();
    while (!socket || socket.readyState !== WebSocket.OPEN) {
      if (Date.now() - start > WS_TIMEOUT_MS) {
        throw new Error('WebSocket not connected');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  const run = async (message: WsClientMessage) => {
    set({ isLoading: true, error: null });
    await ensureSocketReady();
    try {
      const response = await sendWs(message);
      if (response.type === 'Error') {
        set({ error: response.data });
      }
    } catch (error) {
      set({ error: getErrorMessage(error) });
    } finally {
      set({ isLoading: false });
    }
  };

  return {
    nodeId: null,
    isConnected: false,
    snapshot: null,
    isLoading: false,
    error: null,

    initialize: () => {
      const nodeId = getNodeId();
      set({
        nodeId,
        isConnected: false,
      });
      if (nodeId) {
        connectWebSocket();
      }
    },

    fetchSnapshot: async () => {
      await run({ type: 'GetSnapshot' });
    },

    startGame: async (opponent = null) => {
      await run({ type: 'NewGame', data: { opponent: opponent ?? undefined } });
    },

    hostLobby: async (config) => {
      await run({ type: 'HostLobby', data: config });
    },

    joinLobby: async (lobbyId, deck) => {
      await run({ type: 'JoinLobby', data: { lobby_id: lobbyId, deck } });
    },

    joinRemoteLobby: async (hostNode, lobbyId, deck) => {
      await run({ type: 'JoinRemoteLobby', data: { host_node: hostNode, lobby_id: lobbyId, deck } });
    },

    fetchRemoteLobbies: async (hostNode) => {
      await run({ type: 'FetchRemoteLobbies', data: { host_node: hostNode } });
    },

    syncRemoteGame: async (hostNode) => {
      await run({ type: 'SyncRemoteGame', data: { host_node: hostNode } });
    },

    startLobbyGame: async (lobbyId) => {
      await run({ type: 'StartLobbyGame', data: { lobby_id: lobbyId } });
    },

    leaveGame: async () => {
      await run({ type: 'Reset' });
    },

    commitTurn: async (seat: Seat, plan: TurnPlan, salt: string, turn: number) => {
      await run({ type: 'CommitTurn', data: { seat, plan, salt, turn } });
    },

    revealTurn: async (seat: Seat, plan: TurnPlan, salt: string, turn: number) => {
      await run({ type: 'RevealTurn', data: { seat, plan, salt, turn } });
    },

    playTurn: async (plan, opponentPlan) => {
      const hostPlan = plan ?? { plays_to_kitchen: [], posts: [], exploits: [] };
      const oppPlan = opponentPlan ?? { plays_to_kitchen: [], posts: [], exploits: [] };
      await run({ type: 'PlayLocalTurn', data: { host_plan: hostPlan, opponent_plan: oppPlan } });
    },

    playEmptyTurn: async () => {
      const emptyPlan = { plays_to_kitchen: [], posts: [], exploits: [] };
      await run({ type: 'PlayLocalTurn', data: { host_plan: emptyPlan, opponent_plan: emptyPlan } });
    },

    callBased: async (seat: Seat = 'Host') => {
      await run({ type: 'CallBased', data: { seat } });
    },

    acceptBased: async (seat: Seat = 'Host') => {
      await run({ type: 'AcceptBased', data: { seat } });
    },

    foldBased: async (seat: Seat = 'Host') => {
      await run({ type: 'FoldBased', data: { seat } });
    },

    // Error management
    setError: (error) => set({ error }),
    clearError: () => set({ error: null }),
  };
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown error occurred';
}

// Selector hooks for common use cases
export const useNodeId = () => useMcgStore((state) => state.nodeId);
export const useIsConnected = () => useMcgStore((state) => state.isConnected);
export const useSnapshot = () => useMcgStore((state) => state.snapshot);
export const useIsLoading = () => useMcgStore((state) => state.isLoading);
export const useError = () => useMcgStore((state) => state.error);
