import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { DragEvent } from 'react';
import './index.css';
import './App.css';
import { useMcgStore } from './store/mcg';
import type {
  Ability,
  CardDefinition as BackendCardDefinition,
  CardInstance,
  GameState as BackendGameState,
  Lobby,
  PlayerState as BackendPlayerState,
  Seat,
  TurnPlan,
} from './types/mcg';

type Screen = 'lobby' | 'deck' | 'settings' | 'duel';
type SearchContext = 'none' | 'lobby' | 'deck' | 'settings';

type UICardDefinition = {
  id: string;
  name: string;
  cost: number;
  virality: number;
  kind: 'Meme' | 'Exploit';
  role: string;
  description: string;
  ability?: string;
  yieldBonus?: string;
  image?: string;
};

type LiveCard = {
  id: string;
  variantId: string;
  name: string;
  cost: number;
  baseVirality: number;
  currentVirality: number;
  kind: 'Meme' | 'Exploit';
  role: string;
  description: string;
  ability?: string;
  yieldRate?: number;
  location: 'hand' | 'kitchen' | 'feed';
  owner: Seat;
  image?: string;
};

type Deck = {
  id: string;
  name: string;
  cards: string[];
};

const iconPaths: Record<string, JSX.Element> = {
  home: <path d="M4 12l8-8 8 8v8a2 2 0 0 1-2 2h-4v-6H10v6H6a2 2 0 0 1-2-2z" />,
  library: <path d="M4 19V5a1 1 0 0 1 1-1h2v16H5a1 1 0 0 1-1-1zm5-14h2a1 1 0 0 1 1 1v14H9V5a1 1 0 0 1 1-1zm6-1h2a1 1 0 0 1 1 1v14h-4V4a1 1 0 0 1 1-1zm-6 9h2M9 9h2" />,
  search: <path d="M11 5a6 6 0 1 1-4.13 10.24L3 19l1.76-3.9A6 6 0 0 1 11 5z" />,
  settings: <path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm6.9 4a6.9 6.9 0 0 0-.14-1.34l2-1.56-1.9-3.3-2.36.95a7 7 0 0 0-2.32-1.34L13.5 2h-3l-.58 3.31a7 7 0 0 0-2.32 1.34l-2.36-.95-1.9 3.3 2 1.56A6.9 6.9 0 0 0 5.1 12c0 .46.05.9.14 1.34l-2 1.56 1.9 3.29 2.36-.94a7 7 0 0 0 2.32 1.33l.58 3.32h3l.58-3.32a7 7 0 0 0 2.32-1.33l2.36.94 1.9-3.3-2-1.55c.09-.44.14-.89.14-1.35z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrowLeft: <path d="M11 5 4 12l7 7M4 12h16" />,
  chevronUp: <path d="m6 14 6-6 6 6" />,
  chevronDown: <path d="m6 10 6 6 6-6" />,
  sword: <path d="M14.5 17.5 3 6V3h3l11.5 11.5-3 3zM13 19l-2 2" />,
  bolt: <path d="M13 2 3 14h6l-2 8 10-12h-6z" />,
};

const Icon = ({ name, size = 20 }: { name: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {iconPaths[name]}
  </svg>
);

const keywordLabel = (keyword: any) => {
  if (typeof keyword === 'string') return keyword;
  const key = Object.keys(keyword)[0];
  return key;
};

const abilityLabel = (ability: any) => {
  if (!ability) return '';
  if (typeof ability === 'string') return ability;
  const key = Object.keys(ability)[0];
  const value = (ability as any)[key];
  if (typeof value === 'number') return `${key} ${value}`;
  if (typeof value === 'object' && value !== null && 'min' in value && 'max' in value) {
    return `${key} ${value.min}-${value.max}`;
  }
  return key;
};

const mapBackendCard = (def: BackendCardDefinition): UICardDefinition => {
  if ('Meme' in def.class) {
    const meme = (def.class as any).Meme;
    const keywords: string[] = Array.isArray(meme.keywords) ? meme.keywords.map(keywordLabel) : [];
    const abilityText =
      Array.isArray(meme.abilities) && meme.abilities.length > 0
        ? abilityLabel((meme.abilities[0] as Ability).effect)
        : undefined;
    return {
      id: def.id,
      name: def.name,
      cost: def.cost,
      virality: meme.base_virality,
      kind: 'Meme',
      role: keywords[0] ?? 'Meme',
      description: def.description,
      ability: abilityText,
      yieldBonus: meme.yield_rate ? `+${meme.yield_rate} feed` : undefined,
      image: def.image,
    };
  }
  const effect = (def.class as any).Exploit;
  const role = typeof effect === 'string' ? effect : Object.keys(effect ?? {})[0];
  return {
    id: def.id,
    name: def.name,
    cost: def.cost,
    virality: 0,
    kind: 'Exploit',
    role: role ?? 'Exploit',
    description: def.description,
    ability: abilityLabel(effect),
    image: def.image,
  };
};

const locationToUi = (location: any): 'hand' | 'kitchen' | 'feed' => {
  if (typeof location === 'string') {
    if (location === 'Kitchen') return 'kitchen';
    if (location === 'Feed') return 'feed';
    if (location === 'Hand') return 'hand';
  }
  if (location && typeof location === 'object' && 'Feed' in location) return 'feed';
  return 'hand';
};

const mapInstanceToLiveCard = (instance: CardInstance, catalog?: Map<string, BackendCardDefinition>): LiveCard => {
  const kind: 'Meme' | 'Exploit' = 'Meme' in (instance.class as any) ? 'Meme' : 'Exploit';
  const def = catalog?.get(instance.variant_id);
  const card: LiveCard = {
    id: instance.instance_id,
    variantId: instance.variant_id,
    name: instance.name,
    cost: instance.cost,
    baseVirality: instance.base_virality,
    currentVirality: instance.current_virality,
    kind,
    role: kind,
    description: def?.description ?? '',
    ability: undefined,
    yieldRate: instance.yield_rate,
    location: locationToUi(instance.location),
    owner: instance.owner as Seat,
    image: def?.image,
  };
  if (kind === 'Meme') {
    const meme = (instance.class as any).Meme;
    card.role = (meme?.keywords && meme.keywords.length > 0 && keywordLabel(meme.keywords[0])) || 'Meme';
    card.ability =
      meme?.abilities && meme.abilities.length > 0
        ? abilityLabel((meme.abilities[0] as Ability).effect)
        : undefined;
  } else {
    const effect = (instance.class as any).Exploit;
    card.role = typeof effect === 'string' ? effect : Object.keys(effect ?? {})[0] ?? 'Exploit';
    card.ability = abilityLabel(effect);
  }
  return card;
};

// ═══════════════════════════════════════════════════════════════════════════════
// HOLOGRAPHIC CARD COMPONENT
// Adapted from pokemon-cards-css for 3D tilt + holographic shine effects
// ═══════════════════════════════════════════════════════════════════════════════

type HoloCardProps = {
  children: React.ReactNode;
  kind: 'Meme' | 'Exploit';
  cost: number;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  // Pass through event handlers
  onClick?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onPointerMove?: (e: ReactPointerEvent) => void;
  onPointerEnter?: (e: ReactPointerEvent) => void;
  onPointerLeave?: (e: ReactPointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  draggable?: boolean;
};

const HoloCard = ({
  children,
  kind,
  cost,
  className = '',
  style = {},
  disabled = false,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerEnter,
  onPointerLeave,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  draggable,
}: HoloCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tiltStyle, setTiltStyle] = useState<CSSProperties>({});
  const isInteracting = useRef(false);
  const rafId = useRef<number | null>(null);

  // Determine rarity tier based on cost
  const rarityClass = cost >= 5 ? 'epic' : cost >= 3 ? 'rare' : 'standard';
  const kindClass = kind.toLowerCase();

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !cardRef.current) return;

    // Cancel any pending animation frame
    if (rafId.current) cancelAnimationFrame(rafId.current);

    rafId.current = requestAnimationFrame(() => {
      if (!cardRef.current) return;

      const rect = cardRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Calculate position as percentage (0-100)
      const percentX = (x / rect.width) * 100;
      const percentY = (y / rect.height) * 100;

      // Calculate rotation (max ±12 degrees)
      const rotateY = ((percentX - 50) / 50) * 12;
      const rotateX = ((50 - percentY) / 50) * 12;

      setTiltStyle({
        '--holo-rotate-x': `${rotateX}deg`,
        '--holo-rotate-y': `${rotateY}deg`,
        '--holo-pointer-x': `${percentX}%`,
        '--holo-pointer-y': `${percentY}%`,
        '--holo-shine-opacity': '1',
        '--holo-scale': '1.02',
      } as CSSProperties);

      isInteracting.current = true;
    });

    // Forward the event
    onPointerMove?.(e);
  }, [disabled, onPointerMove]);

  const handlePointerEnter = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!disabled) {
      setTiltStyle(prev => ({
        ...prev,
        '--holo-shine-opacity': '1',
      } as CSSProperties));
    }
    onPointerEnter?.(e);
  }, [disabled, onPointerEnter]);

  const handlePointerLeave = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Reset tilt on leave
    if (rafId.current) cancelAnimationFrame(rafId.current);

    setTiltStyle({
      '--holo-rotate-x': '0deg',
      '--holo-rotate-y': '0deg',
      '--holo-pointer-x': '50%',
      '--holo-pointer-y': '50%',
      '--holo-shine-opacity': '0',
      '--holo-scale': '1',
    } as CSSProperties);

    isInteracting.current = false;
    onPointerLeave?.(e);
  }, [onPointerLeave]);

  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <div
      ref={cardRef}
      className={`holo-card ${kindClass} ${rarityClass} ${className}`}
      style={{ ...tiltStyle, ...style }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      draggable={draggable}
    >
      {children}
    </div>
  );
};

// Simpler holo pill for feed cards (no tilt, just shimmer)
type HoloPillProps = {
  children: React.ReactNode;
  kind: 'Meme' | 'Exploit';
  className?: string;
  style?: CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  onPointerEnter?: (e: ReactPointerEvent) => void;
  onPointerLeave?: (e: ReactPointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
};

const HoloPill = ({
  children,
  kind,
  className = '',
  style = {},
  onClick,
  onPointerEnter,
  onPointerLeave,
  onContextMenu,
  onDragOver,
  onDrop,
}: HoloPillProps) => {
  const kindClass = kind.toLowerCase();

  return (
    <div
      className={`holo-pill ${kindClass} ${className}`}
      style={style}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
};

function App() {
  const {
    nodeId,
    isConnected,
    initialize,
    snapshot,
    isLoading,
    error,
    fetchSnapshot,
    startGame,
    hostLobby,
    joinLobby,
    joinRemoteLobby,
    fetchRemoteLobbies,
    syncRemoteGame,
    startLobbyGame,
    leaveGame,
    commitTurn,
    revealTurn,
    acceptBased,
    foldBased,
  } = useMcgStore();

  const [activeScreen, setActiveScreen] = useState<Screen>('lobby');
  const [searchContext, setSearchContext] = useState<SearchContext>('none');
  const [lobbyQuery, setLobbyQuery] = useState('');
  const [cardQuery, setCardQuery] = useState('');
  const [decks, setDecks] = useState<Deck[]>([{ id: 'deck-1', name: 'New Deck', cards: [] }]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>('deck-1');
  const [deckMessage, setDeckMessage] = useState<string | null>(null);
  const [modalCard, setModalCard] = useState<UICardDefinition | LiveCard | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHostModal, setShowHostModal] = useState(false);
  const [hostForm, setHostForm] = useState({ mode: 'Standard', stakes: 1, description: 'Public lobby' });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [lastSyncedHost, setLastSyncedHost] = useState<string | null>(null);
  const [draftPlan, setDraftPlan] = useState<TurnPlan>({
    plays_to_kitchen: [],
    posts: [],
    exploits: [],
  });
  const [pendingReveal, setPendingReveal] = useState<{ plan: TurnPlan; salt: string; turn: number } | null>(
    null,
  );
  const [basedPulseKey, setBasedPulseKey] = useState<number | null>(null);
  const [basedModalPulse, setBasedModalPulse] = useState<number | null>(null);
  const [basedTurnCalled, setBasedTurnCalled] = useState<number | null>(null);
  const [showBasedResponseModal, setShowBasedResponseModal] = useState(false);
  const [isEndingTurn, setIsEndingTurn] = useState(false);
  const [hoverZone, setHoverZone] = useState<'feed' | 'kitchen' | null>(null);
  const [hoverTargetCard, setHoverTargetCard] = useState<LiveCard | null>(null); // Track target card for pointer exploit drops
  const [holdTargets, setHoldTargets] = useState<{ feed: boolean; kitchen: boolean; enemy: boolean }>({
    feed: false,
    kitchen: false,
    enemy: false,
  });
  const [noPlayCardId, setNoPlayCardId] = useState<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const nativeDragActive = useRef(false); // Track if native HTML5 drag is in progress
  const [heldCard, setHeldCard] = useState<string | null>(null);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const feedZoneRef = useRef<HTMLDivElement | null>(null);
  const kitchenZoneRef = useRef<HTMLDivElement | null>(null);
  const isRevealingRef = useRef<boolean>(false);
  const [opponentExploits, setOpponentExploits] = useState<Array<{ card_id: string; target: any }>>([]);
  const opponentExploitTimer = useRef<number | null>(null);
  const pendingExploitNotification = useRef<Array<{ card_id: string; target: any }> | null>(null);
  const lastExploitTurn = useRef<number | null>(null);

  const activePlan = useMemo(() => pendingReveal?.plan ?? draftPlan, [pendingReveal, draftPlan]);
  const queuedToKitchen = useMemo(() => new Set(activePlan.plays_to_kitchen), [activePlan]);
  const queuedPosts = useMemo(() => new Set(activePlan.posts.map((p) => p.card_id)), [activePlan]);
  const queuedExploits = useMemo(() => new Set(activePlan.exploits.map((p) => p.card_id)), [activePlan]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Disable the long-press context menu so holding a card doesn't trigger right-click.
  useEffect(() => {
    const handler = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  useEffect(() => {
    if (isConnected && !snapshot) {
      fetchSnapshot();
    }
  }, [isConnected, snapshot, fetchSnapshot]);

  const catalog = useMemo<UICardDefinition[]>(() => {
    if (snapshot?.catalog) return snapshot.catalog.map(mapBackendCard);
    return [];
  }, [snapshot]);
  const catalogById = useMemo(() => {
    const map = new Map<string, BackendCardDefinition>();
    snapshot?.catalog?.forEach((card) => map.set(card.id, card));
    return map;
  }, [snapshot]);

  // Prime a starter deck with real catalog cards once catalog exists
  useEffect(() => {
    if (catalog.length > 0 && decks[0].cards.length === 0) {
      const memes = catalog.filter((c) => c.kind === 'Meme').slice(0, 4).map((c) => c.id);
      const exploits = catalog.filter((c) => c.kind === 'Exploit').slice(0, 8).map((c) => c.id);
      setDecks((prev) => {
        const updated = [...prev];
        updated[0] = { ...updated[0], cards: [...memes, ...exploits] };
        return updated;
      });
    }
  }, [catalog, decks]);

  const game: BackendGameState | null = snapshot?.game ?? null;
  const mySeat: Seat | null = useMemo(() => {
    if (!game || !nodeId) return game?.players?.[0]?.seat ?? null;
    const mine = game.players.find((p) => p.node_id === nodeId);
    return mine?.seat ?? game.players?.[0]?.seat ?? null;
  }, [game, nodeId]);
  const myPlayer: BackendPlayerState | undefined = useMemo(() => {
    const player = game?.players.find((p) => p.seat === mySeat);
    console.log('myPlayer:', { mySeat, player: player?.seat, nodeId: player?.node_id });
    return player;
  }, [game, mySeat]);

  const opponentPlayer: BackendPlayerState | undefined = useMemo(() => {
    const player = game?.players.find((p) => p.seat !== mySeat);
    console.log('opponentPlayer:', { mySeat, player: player?.seat, nodeId: player?.node_id });
    return player;
  }, [game, mySeat]);
  const myNodeId = useMemo(() => nodeId ?? myPlayer?.node_id ?? null, [nodeId, myPlayer]);

  const feedCards: LiveCard[] = useMemo(
    () => (game ? game.feed.map((card) => mapInstanceToLiveCard(card, catalogById)) : []),
    [game, catalogById],
  );
  const playerKitchen = useMemo(() => {
    const cards = myPlayer ? myPlayer.kitchen.map((card) => mapInstanceToLiveCard(card, catalogById)) : [];
    console.log('playerKitchen cards:', cards.map(c => ({ name: c.name, owner: c.owner })));
    return cards;
  }, [myPlayer, catalogById]);

  const enemyKitchen = useMemo(() => {
    const cards = opponentPlayer ? opponentPlayer.kitchen.map((card) => mapInstanceToLiveCard(card, catalogById)) : [];
    console.log('🏠 enemyKitchen cards:', cards.map(c => ({
      name: c.name,
      id: c.id,
      owner: c.owner,
      location: c.location,
      kind: c.kind
    })));
    return cards;
  }, [opponentPlayer, catalogById]);
  const playerHand = useMemo(
    () => (myPlayer ? myPlayer.hand.map((card) => mapInstanceToLiveCard(card, catalogById)) : []),
    [myPlayer, catalogById],
  );
  const draggingCard = useMemo(() => {
    if (!draggingId) return null;
    const fromHand = playerHand.find((c) => c.id === draggingId);
    const fromKitchen = playerKitchen.find((c) => c.id === draggingId);
    const card = fromHand || fromKitchen || null;
    console.log('🎴 draggingCard computed:', {
      draggingId,
      foundInHand: !!fromHand,
      foundInKitchen: !!fromKitchen,
      card: card ? { name: card.name, kind: card.kind, location: card.location } : null,
    });
    return card;
  }, [draggingId, playerHand, playerKitchen]);
  const plannedKitchenAdds = useMemo(
    () =>
      activePlan.plays_to_kitchen
        .map((id) => playerHand.find((c) => c.id === id))
        .filter(Boolean) as LiveCard[],
    [activePlan, playerHand],
  );
  const plannedFeedPosts = useMemo(
    () =>
      activePlan.posts
        .map((p) => playerKitchen.find((c) => c.id === p.card_id))
        .filter(Boolean) as LiveCard[],
    [activePlan, playerKitchen],
  );
  const plannedExploits = useMemo(
    () =>
      activePlan.exploits
        .map((e) => playerHand.find((c) => c.id === e.card_id))
        .filter(Boolean) as LiveCard[],
    [activePlan, playerHand],
  );

  const lobbies = snapshot?.lobbies ?? [];

  const myCommit = myPlayer?.commit;
  const opponentCommit = opponentPlayer?.commit;
  const myHasCommitted = !!myCommit && myCommit.turn === game?.turn;
  const opponentHasCommitted = !!opponentCommit && opponentCommit.turn === game?.turn;
  const waitingForOpponent = myHasCommitted && !opponentHasCommitted;
  const opponentWaitingOnMe = opponentHasCommitted && !myHasCommitted;
  const isResolving = myHasCommitted && opponentHasCommitted && !myCommit?.revealed;
  const planLocked = !!pendingReveal || myHasCommitted;
  const planHasActions =
    draftPlan.plays_to_kitchen.length + draftPlan.posts.length + draftPlan.exploits.length > 0;
  const basedCalledThisTurn = game && basedTurnCalled !== null ? basedTurnCalled === game.turn : false;
  const basedButtonDisabled =
    planLocked ||
    waitingForOpponent ||
    isResolving ||
    isEndingTurn ||
    !planHasActions ||
    basedCalledThisTurn ||
    !!game?.pending_stakes;

  const costWithDiscount = (card: LiveCard) => {
    const discount = myPlayer?.cost_discount ?? 0;
    return Math.max(0, card.cost - discount);
  };

  const plannedManaSpent = useMemo(() => {
    if (!myPlayer) return 0;
    let spent = 0;
    activePlan.plays_to_kitchen.forEach((id) => {
      const card = playerHand.find((c) => c.id === id);
      if (card) {
        spent += costWithDiscount(card);
      }
    });
    activePlan.exploits.forEach((action) => {
      const card = playerHand.find((c) => c.id === action.card_id);
      if (card) {
        spent += costWithDiscount(card);
      }
    });
    return spent;
  }, [activePlan, myPlayer, playerHand, playerKitchen]);
  const availableMana = Math.max(0, (myPlayer?.mana ?? 0) - plannedManaSpent);
  const opponentCalledBased =
    !!game && !!game.pending_stakes && game.pending_stakes !== myNodeId;
  // Show modal when:
  // 1. Phase is StakePending and opponent called BASED (immediate response needed)
  // 2. User clicked End Turn while opponent has pending BASED
  const showBasedModal =
    (opponentCalledBased && game?.phase === 'StakePending') ||
    (showBasedResponseModal && opponentCalledBased && !!game);

  const getExploitEffect = (card: LiveCard) => {
    if (card.kind !== 'Exploit') {
      console.log('⚠️ getExploitEffect: card is not an Exploit', { cardName: card.name, kind: card.kind });
      return null;
    }

    // First try to find the card instance directly to get the effect
    const allInstances = [
      ...(myPlayer?.hand || []),
      ...(myPlayer?.kitchen || []),
      ...(opponentPlayer?.hand || []),
      ...(opponentPlayer?.kitchen || []),
      ...(game?.feed || [])
    ];

    console.log('🔍 getExploitEffect searching for:', {
      cardId: card.id,
      cardName: card.name,
      totalInstances: allInstances.length,
      instanceIds: allInstances.slice(0, 5).map(i => i.instance_id),
    });

    const instance = allInstances.find(inst => inst.instance_id === card.id);
    if (instance && 'Exploit' in (instance.class as any)) {
      const effect = (instance.class as any).Exploit;
      console.log('✅ Found effect from instance:', effect);
      return effect;
    }

    // Fall back to catalog lookup
    console.log('🔍 Falling back to catalog lookup for variantId:', card.variantId);
    const def = catalogById.get(card.variantId);
    if (!def) {
      console.log('❌ Card definition not found for:', card.variantId);
      return null;
    }
    const effect = (def.class as any).Exploit;
    console.log('✅ Found effect from catalog:', effect);
    return effect ?? null;
  };

  const getExploitKind = (effect: any): string => {
    if (!effect) return '';
    if (typeof effect === 'string') return effect;
    if (typeof effect === 'object' && effect !== null) {
      const key = Object.keys(effect)[0];
      return key ?? '';
    }
    return '';
  };

  const getExploitTargetProfile = (effect: any) => {
    const kind = getExploitKind(effect);
    const profile = {
      // Can target specific cards
      enemyKitchenCard: false,
      enemyFeedCard: false,
      allyKitchenCard: false,
      allyFeedCard: false,
      // Can target slots or zones
      feedSlot: false,
      enemyKitchenZone: false,
      feedZone: false,
      // Targeting behavior
      requiresTarget: true,
      targetType: 'none' as 'card' | 'slot' | 'zone' | 'none',
    };

    console.log('getExploitTargetProfile - kind:', kind, 'effect:', effect);

    switch (kind) {
      case 'Damage':
        // Single-target damage can target enemy cards or feed slots
        profile.enemyKitchenCard = true;
        profile.enemyFeedCard = true;
        profile.feedSlot = true;
        profile.targetType = 'card';
        break;
      case 'AreaDamageKitchen':
        // Area damage targets the entire enemy kitchen zone
        profile.enemyKitchenZone = true;
        profile.requiresTarget = false;
        profile.targetType = 'zone';
        break;
      case 'Boost':
      case 'Protect':
      case 'Double':
        // Buff exploits target ally cards
        profile.allyKitchenCard = true;
        profile.allyFeedCard = true;
        profile.targetType = 'card';
        break;
      case 'Debuff':
      case 'Execute':
      case 'Silence':
        // Debuff/removal exploits target enemy cards
        profile.enemyKitchenCard = true;
        profile.enemyFeedCard = true;
        profile.targetType = 'card';
        break;
      case 'PinSlot':
      case 'MoveUp':
      case 'NukeBelow':
        // Feed manipulation targets specific feed slots
        profile.feedSlot = true;
        profile.targetType = 'slot';
        break;
      case 'LockFeed':
        // Lock feed targets the feed zone
        profile.feedZone = true;
        profile.requiresTarget = false;
        profile.targetType = 'zone';
        break;
      case 'Tax':
      case 'ManaBurn':
        // These target the opponent directly (via their kitchen zone)
        profile.enemyKitchenZone = true;
        profile.requiresTarget = false;
        profile.targetType = 'zone';
        break;
      case 'ShuffleFeed':
      case 'WipeBottom':
        // These target the feed zone
        profile.feedZone = true;
        profile.requiresTarget = false;
        profile.targetType = 'zone';
        break;
      case 'ResurrectLast':
      case 'SpawnShitposts':
      case 'DiscountNext':
        // Self-targeting, no target needed
        profile.requiresTarget = false;
        profile.targetType = 'none';
        break;
      default:
        break;
    }
    return profile;
  };

  // Track opponent exploits when turn resolves
  useEffect(() => {
    if (!game || !mySeat || !opponentPlayer) return;

    // Check if opponent has revealed exploits
    const opponentCommit = opponentPlayer.commit;
    if (opponentCommit?.revealed && opponentCommit.revealed.exploits.length > 0) {
      // Only show if we haven't shown for this turn yet
      if (lastExploitTurn.current === game.turn) return;
      lastExploitTurn.current = game.turn;

      const exploits = opponentCommit.revealed.exploits;

      // If BASED modal is showing, store for later
      if (showBasedModal) {
        pendingExploitNotification.current = exploits;
        return;
      }

      // Show opponent exploits
      setOpponentExploits(exploits);

      // Clear previous timer
      if (opponentExploitTimer.current) {
        clearTimeout(opponentExploitTimer.current);
      }

      // Set timer to hide exploits after 5 seconds
      opponentExploitTimer.current = window.setTimeout(() => {
        setOpponentExploits([]);
        opponentExploitTimer.current = null;
      }, 5000);
    }

    return () => {
      if (opponentExploitTimer.current) {
        clearTimeout(opponentExploitTimer.current);
      }
    };
  }, [game?.turn, opponentPlayer?.commit?.revealed?.exploits?.length ?? 0, showBasedModal]);

  // Show pending exploits when BASED modal closes
  useEffect(() => {
    if (!showBasedModal && pendingExploitNotification.current) {
      const exploits = pendingExploitNotification.current;
      pendingExploitNotification.current = null;

      setOpponentExploits(exploits);

      if (opponentExploitTimer.current) {
        clearTimeout(opponentExploitTimer.current);
      }

      opponentExploitTimer.current = window.setTimeout(() => {
        setOpponentExploits([]);
        opponentExploitTimer.current = null;
      }, 5000);
    }
  }, [showBasedModal]);

  useEffect(() => {
    if (!pendingReveal || !game || !mySeat) return;
    const myCommit = myPlayer?.commit?.turn === game.turn ? myPlayer.commit : null;
    const allCommitted = game.players.every((p) => p.commit && p.commit.turn === game.turn);
    console.log('🎯 Reveal effect triggered', {
      pendingRevealTurn: pendingReveal.turn,
      currentTurn: game.turn,
      myCommit: !!myCommit,
      myRevealed: myCommit?.revealed,
      allCommitted,
      waitingForOpponent,
      isRevealing: isRevealingRef.current
    });
    if (game.turn > pendingReveal.turn) {
      console.log('⏩ Turn has advanced, clearing pending reveal');
      setPendingReveal(null);
      isRevealingRef.current = false;
      return;
    }
    if (myCommit && myCommit.revealed) {
      console.log('✨ Already revealed');
      isRevealingRef.current = false;
      return;
    }
    if (allCommitted && !isRevealingRef.current) {
      console.log('🚀 All committed, revealing turn');
      isRevealingRef.current = true;
      revealTurn(mySeat, pendingReveal.plan, pendingReveal.salt, pendingReveal.turn).then(() => {
        console.log('✅ Reveal completed');
        isRevealingRef.current = false;
      }).catch((error) => {
        console.error('❌ Reveal failed:', error);
        isRevealingRef.current = false;
      });
    } else if (allCommitted && isRevealingRef.current) {
      console.log('⏳ Already revealing, skipping duplicate reveal');
    }
  }, [pendingReveal, game, mySeat, myPlayer, revealTurn, waitingForOpponent]);

  useEffect(() => {
    if (!game) {
      if (pendingReveal) {
        setPendingReveal(null);
      }
      // Clear reveal flag if game ends
      isRevealingRef.current = false;
    }
  }, [game, pendingReveal]);

  useEffect(() => {
    if (!game) return;
    console.log('🔄 Turn changed effect triggered', {
      turn: game.turn,
      wasEndingTurn: isEndingTurn,
      wasRevealing: isRevealingRef.current
    });
    // Reset the ending and revealing flags when the turn changes
    setIsEndingTurn(false);
    isRevealingRef.current = false;
    if (basedTurnCalled !== null && game.turn > basedTurnCalled) {
      setBasedTurnCalled(null);
    }
    // Reset BASED response modal on turn change
    setShowBasedResponseModal(false);
  }, [game?.turn, game, basedTurnCalled]);

  // Also reset the ending turn flag when the commit is successful
  useEffect(() => {
    console.log('📝 Commit status changed', {
      myHasCommitted,
      turn: game?.turn,
      isEndingTurn
    });
    if (myHasCommitted) {
      console.log('🔓 Resetting isEndingTurn due to successful commit');
      setIsEndingTurn(false);
    }
  }, [myHasCommitted]);

  useEffect(() => {
    if (!game) return;
    // If the player cleared their plan before ending the turn, drop the BASED intent.
    if (!planHasActions && !planLocked && basedTurnCalled === game.turn) {
      setBasedTurnCalled(null);
    }
  }, [planHasActions, planLocked, basedTurnCalled, game]);

  useEffect(() => {
    if (!showBasedModal || !game) return;
    const key = Date.now();
    setBasedModalPulse(key);
    const timer = window.setTimeout(() => {
      setBasedModalPulse((curr) => (curr === key ? null : curr));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [showBasedModal, game]);

  const filteredLobbies = useMemo(() => {
    let filtered = lobbies;
    // Filter out started lobbies if game is over
    if (game?.phase === 'GameOver') {
      filtered = filtered.filter((l) => !l.started);
    }
    if (!lobbyQuery.trim()) return filtered;
    return filtered.filter(
      (lobby) =>
        lobby.host.toLowerCase().includes(lobbyQuery.toLowerCase()) ||
        lobby.description.toLowerCase().includes(lobbyQuery.toLowerCase()),
    );
  }, [lobbies, lobbyQuery, game?.phase]);

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) ?? decks[0];
  const MAX_DECK_SIZE = 12;
  const MEME_LIMIT = 4;
  const EXPLOIT_LIMIT = 8;

  const handleCreateDeck = () => {
    const nextName = `Deck ${decks.length + 1}`;
    const newDeck: Deck = { id: `deck-${Date.now()}`, name: nextName, cards: [] };
    setDecks((prev) => [...prev, newDeck]);
    setSelectedDeckId(newDeck.id);
  };

  const handleAddToDeck = (cardId: string) => {
    if (!selectedDeck) return;
    const card = catalog.find((c) => c.id === cardId);
    if (!card) return;
    if (selectedDeck.cards.length >= MAX_DECK_SIZE) {
      setDeckMessage('Deck is full (12 cards). Remove one to add another.');
      return;
    }
    const currentMemes = selectedDeck.cards.filter((id) => {
      const def = catalog.find((c) => c.id === id);
      return def?.kind === 'Meme';
    }).length;
    const currentExploits = selectedDeck.cards.filter((id) => {
      const def = catalog.find((c) => c.id === id);
      return def?.kind === 'Exploit';
    }).length;
    if (card.kind === 'Meme' && currentMemes >= MEME_LIMIT) {
      setDeckMessage('Deck already has 4 memes. Remove one to add another.');
      return;
    }
    if (card.kind === 'Exploit' && currentExploits >= EXPLOIT_LIMIT) {
      setDeckMessage('Deck already has 8 exploits. Remove one to add another.');
      return;
    }
    setDecks((prev) =>
      prev.map((deck) => (deck.id === selectedDeck.id ? { ...deck, cards: [...deck.cards, cardId] } : deck)),
    );
    setDeckMessage(null);
  };

  const handleRemoveFromDeck = (cardIndex: number) => {
    if (!selectedDeck) return;
    setDecks((prev) =>
      prev.map((deck) =>
        deck.id === selectedDeck.id
          ? { ...deck, cards: deck.cards.filter((_, idx) => idx !== cardIndex) }
          : deck,
      ),
    );
    setDeckMessage(null);
  };

  const handleSearchNav = () => {
    if (activeScreen === 'lobby') {
      setSearchContext('lobby');
    } else if (activeScreen === 'deck') {
      setSearchContext('deck');
    } else if (activeScreen === 'settings') {
      setSearchContext('settings');
    }
  };

  const closeAllModals = () => {
    setSearchContext('none');
    setModalCard(null);
  };

  const handleJoinLobbyClick = async (lobby: Lobby) => {
    if (nodeId && lobby.host !== nodeId) {
      await joinRemoteLobby(lobby.host, lobby.id);
    } else {
      await joinLobby(lobby.id);
    }
  };

  const handleEnterGame = async (lobby: Lobby) => {
    if (nodeId && lobby.host !== nodeId) {
      await syncRemoteGame(lobby.host);
    }
    setActiveScreen('duel');
  };

  const handleInspectCard = (card: UICardDefinition | LiveCard) => setModalCard(card);

  const handleLeaveGame = async () => {
    await leaveGame();
    setActiveScreen('lobby');
    setShowSettingsModal(false);
  };

  const resetPlan = useCallback(() => {
    console.log('🔧 Resetting plan');
    setDraftPlan({ plays_to_kitchen: [], posts: [], exploits: [] });
  }, []);

  useEffect(() => {
    console.log('🎲 Turn reset effect - clearing plan and pending reveal', {
      turn: game?.turn
    });
    resetPlan();
    setPendingReveal(null);
  }, [game?.turn, resetPlan]);

  // Auto-enter duel when a game snapshot arrives (e.g., host started).
  useEffect(() => {
    if (snapshot?.game && activeScreen !== 'duel') {
      setActiveScreen('duel');
    }
    if (!snapshot?.game && activeScreen === 'duel') {
      setActiveScreen('lobby');
    }
  }, [snapshot?.game, activeScreen]);

  // Joiner fallback: if a lobby we're in has started but we don't yet have the game,
  // pull the remote game from the host.
  useEffect(() => {
    if (snapshot?.game || !nodeId) return;
    const startedLobby = lobbies.find((l) => l.started && l.opponent === nodeId);
    if (!startedLobby) return;
    if (startedLobby.host === lastSyncedHost) return;
    setLastSyncedHost(startedLobby.host);
    void syncRemoteGame(startedLobby.host);
  }, [snapshot?.game, lobbies, nodeId, syncRemoteGame, lastSyncedHost]);

  const scrubFromPlan = (cardId: string) => {
    if (planLocked) return;
    setDraftPlan((prev) => ({
      plays_to_kitchen: prev.plays_to_kitchen.filter((id) => id !== cardId),
      posts: prev.posts.filter((p) => p.card_id !== cardId),
      exploits: prev.exploits.filter((e) => e.card_id !== cardId),
    }));
  };

  const dropToKitchen = (cardId: string) => {
    if (planLocked) return;
    const card = playerHand.find((c) => c.id === cardId && c.kind === 'Meme');
    if (!card) return;
    const meta = getPlayableMeta(card);
    if (!meta.canPlay || !meta.targets.kitchen) {
      flashNoPlay(cardId, 'dropToKitchen:memeConditions');
      return;
    }
    setDraftPlan((prev) => {
      if (prev.plays_to_kitchen.includes(cardId)) return prev;
      return { ...prev, plays_to_kitchen: [...prev.plays_to_kitchen, cardId] };
    });
  };

  const dropToFeedFromKitchen = (cardId: string) => {
    if (planLocked) return;
    const card = playerKitchen.find((c) => c.id === cardId);
    if (!card) return;
    const meta = getPlayableMeta(card);
    if (!meta.canPlay || !meta.targets.feed) {
      flashNoPlay(cardId, 'dropToFeed:memeConditions');
      return;
    }
    setDraftPlan((prev) => {
      if (prev.posts.find((p) => p.card_id === cardId)) return prev;
      return { ...prev, posts: [...prev.posts, { card_id: cardId }] };
    });
  };

  const canUseExploitOnCard = (exploit: LiveCard, targetCard: LiveCard) => {
    const debugInfo: any = {
      exploitName: exploit?.name,
      exploitId: exploit?.id,
      targetCardName: targetCard?.name,
      targetCardId: targetCard?.id,
      targetOwner: targetCard?.owner,
      targetLocation: targetCard?.location,
      mySeat,
    };

    if (!mySeat) {
      console.log('❌ canUseExploitOnCard FAIL: mySeat is null', debugInfo);
      return false;
    }

    const effect = getExploitEffect(exploit);
    debugInfo.effect = effect;
    debugInfo.effectType = effect ? (typeof effect === 'string' ? effect : Object.keys(effect)[0]) : 'NULL';

    if (!effect) {
      console.log('❌ canUseExploitOnCard FAIL: effect is null', debugInfo);
      return false;
    }

    const profile = getExploitTargetProfile(effect);
    debugInfo.profile = profile;

    const isEnemy = targetCard.owner !== mySeat;
    const inFeed = targetCard.location === 'feed';
    const inKitchen = targetCard.location === 'kitchen';

    debugInfo.isEnemy = isEnemy;
    debugInfo.inFeed = inFeed;
    debugInfo.inKitchen = inKitchen;

    if (isEnemy) {
      if (inKitchen && profile.enemyKitchenCard) {
        console.log('✅ canUseExploitOnCard SUCCESS: enemy kitchen card', debugInfo);
        return true;
      }
      if (inFeed && profile.enemyFeedCard) {
        console.log('✅ canUseExploitOnCard SUCCESS: enemy feed card', debugInfo);
        return true;
      }
      console.log('❌ canUseExploitOnCard FAIL: isEnemy but no match', debugInfo);
    } else {
      if (inKitchen && profile.allyKitchenCard) {
        console.log('✅ canUseExploitOnCard SUCCESS: ally kitchen card', debugInfo);
        return true;
      }
      if (inFeed && profile.allyFeedCard) {
        console.log('✅ canUseExploitOnCard SUCCESS: ally feed card', debugInfo);
        return true;
      }
      console.log('❌ canUseExploitOnCard FAIL: isAlly but no match', debugInfo);
    }
    return false;
  };

  const canUseExploitOnSlot = (exploit: LiveCard) => {
    const profile = getExploitTargetProfile(getExploitEffect(exploit));
    return profile.feedSlot;
  };

  const queueExploit = (exploitId: string, target: any | null) => {
    if (planLocked) return;
    setDraftPlan((prev) => {
      const without = prev.exploits.filter((e) => e.card_id !== exploitId);
      return { ...prev, exploits: [...without, { card_id: exploitId, target }] };
    });
  };

  const planExploitOnCard = (targetCard: LiveCard) => {
    console.log('planExploitOnCard called:', {
      draggingId,
      targetCard: targetCard.name,
      planLocked
    });

    if (!draggingId) {
      console.log('No draggingId!');
      return;
    }

    const exploit = playerHand.find((c) => c.id === draggingId && c.kind === 'Exploit');
    console.log('Found exploit:', exploit?.name);

    if (!exploit) {
      console.log('Exploit not found in hand!');
      return;
    }

    if (planLocked) {
      console.log('Plan is locked!');
      flashNoPlay(exploit.id, 'planExploitOnCard:planLocked');
      return;
    }

    const meta = getPlayableMeta(exploit);
    console.log('Playable meta:', meta);

    if (!meta.canPlay) {
      console.log('Meta says cannot play!');
      flashNoPlay(exploit.id, 'planExploitOnCard:!canPlay');
      return;
    }

    const canUse = canUseExploitOnCard(exploit, targetCard);
    console.log('canUseExploitOnCard result:', canUse);

    if (!canUse) {
      console.log('Cannot use exploit on this card!');
      flashNoPlay(exploit.id, 'planExploitOnCard:!canUse');
      return;
    }

    console.log('Queueing exploit!');
    queueExploit(exploit.id, { Card: targetCard.id });
  };

  const planExploitOnFeedSlot = (slot: number) => {
    if (!draggingId) return;
    const exploit = playerHand.find((c) => c.id === draggingId && c.kind === 'Exploit');
    if (!exploit) return;
    if (planLocked) {
      flashNoPlay(exploit.id, 'planExploitOnFeedSlot:planLocked');
      return;
    }
    const meta = getPlayableMeta(exploit);
    const profile = getExploitTargetProfile(getExploitEffect(exploit));
    if (!meta.canPlay || !profile.feedSlot || !canUseExploitOnSlot(exploit)) {
      flashNoPlay(exploit.id, 'planExploitOnFeedSlot:conditions');
      return;
    }
    queueExploit(exploit.id, { FeedSlot: slot });
  };

  const planExploitZoneEnemyKitchen = () => {
    if (!draggingId) return;
    const exploit = playerHand.find((c) => c.id === draggingId && c.kind === 'Exploit');
    if (!exploit) return;
    if (planLocked) {
      flashNoPlay(exploit.id, 'planExploitZoneEnemyKitchen:planLocked');
      return;
    }
    const meta = getPlayableMeta(exploit);
    if (!meta.canPlay) {
      flashNoPlay(exploit.id, 'planExploitZoneEnemyKitchen:!canPlay');
      return;
    }
    const profile = getExploitTargetProfile(getExploitEffect(exploit));
    if (!profile.enemyKitchenZone) {
      flashNoPlay(exploit.id, 'planExploitZoneEnemyKitchen:!zoneTargeting');
      return;
    }
    queueExploit(exploit.id, 'EnemyKitchen' as any);
  };

  const clearHoldTimer = () => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const endHoldPreview = () => {
    clearHoldTimer();
    setHeldCard(null);
    setHoldTargets({ feed: false, kitchen: false, enemy: false });
    setHoverZone(null);
  };

  const flashNoPlay = (cardId?: string, source?: string) => {
    const targetId = cardId ?? heldCard;
    console.log('🚫 flashNoPlay called:', { cardId, heldCard, targetId, source });
    console.trace('flashNoPlay trace');
    if (!targetId) return;
    setNoPlayCardId(targetId);
    window.setTimeout(() => setNoPlayCardId((current) => (current === targetId ? null : current)), 420);
  };

  const getPlayableMeta = (card: LiveCard) => {
    if (planLocked) {
      return { canPlay: false, targets: { kitchen: false, feed: false, enemy: false } };
    }
    const kitchenPlayAvailable = draftPlan.plays_to_kitchen.length < 1;
    const mana = availableMana;
    const inHand = card.location === 'hand';
    const inKitchen = card.location === 'kitchen';
    if (card.kind === 'Meme') {
      if (inHand) {
        const playCost = costWithDiscount(card);
        return {
          canPlay: mana >= playCost && kitchenPlayAvailable,
          targets: { kitchen: kitchenPlayAvailable, feed: false, enemy: false }
        };
      }
      if (inKitchen) {
        // Posting from kitchen to feed is free; only mana gating happens on initial play to kitchen.
        return { canPlay: true, targets: { kitchen: false, feed: true, enemy: false } };
      }
    } else {
      const effect = getExploitEffect(card);
      const profile = getExploitTargetProfile(effect);
      const hasEnemyKitchenCard = enemyKitchen.length > 0;
      const hasAllyKitchenCard = playerKitchen.length > 0;
      const hasEnemyFeedCard = feedCards.some((c) => c.owner !== mySeat);
      const hasAllyFeedCard = feedCards.some((c) => c.owner === mySeat);
      const hasFeed = feedCards.length > 0;
      const hasTarget =
        (profile.enemyKitchenCard && hasEnemyKitchenCard) ||
        (profile.enemyFeedCard && hasEnemyFeedCard) ||
        (profile.allyKitchenCard && hasAllyKitchenCard) ||
        (profile.allyFeedCard && hasAllyFeedCard) ||
        (profile.feedSlot && hasFeed) ||
        (profile.enemyKitchenZone && hasEnemyKitchenCard) ||
        (profile.feedZone && (hasFeed || !profile.requiresTarget)) ||
        !profile.requiresTarget;
      // Feed zone targeting: zone/slot-targeting exploits AND no-target exploits
      // Card-targeting exploits for feed should target individual cards
      const feedZoneTargeting = profile.feedSlot || profile.feedZone || !profile.requiresTarget;
      // Only show enemy zone highlight for zone-targeting exploits (not card-targeting)
      // Card-targeting exploits should show individual cards as targets
      const enemyZoneTargeting = profile.enemyKitchenZone;
      // Kitchen zone is only for playing memes, not for buff exploits targeting kitchen cards
      // Buff exploits should target individual cards in kitchen
      const kitchenTargeting = false; // Exploits never target kitchen zone
      return {
        canPlay: mana >= costWithDiscount(card) && hasTarget,
        targets: { kitchen: kitchenTargeting, feed: feedZoneTargeting, enemy: enemyZoneTargeting },
      };
    }
    return { canPlay: false, targets: { kitchen: false, feed: false, enemy: false } };
  };

  const startHoldPreview = (card: LiveCard) => () => {
    clearHoldTimer();
    setHoldTargets({ feed: false, kitchen: false, enemy: false });
    setHeldCard(card.id);
    holdTimer.current = window.setTimeout(() => {
      const meta = getPlayableMeta(card);
      if (meta.canPlay) {
        setHoldTargets(meta.targets);
        setHoverZone(null);
        return;
      }
      setHoldTargets({ feed: false, kitchen: false, enemy: false });
      setHoverZone(null);
      flashNoPlay(card.id, 'holdTimer:!canPlay');
    }, 220);
  };

  const onDragStart = (cardId: string, source: 'hand' | 'kitchen') => (event: DragEvent) => {
    console.log('🚀 onDragStart:', { cardId, source });
    clearHoldTimer(); // Clear the hold preview timer to prevent flashNoPlay during drag
    setHeldCard(null);
    setDraggingId(cardId);
    setIsPointerDragging(false);
    nativeDragActive.current = true; // Mark native drag as active
    event.dataTransfer.setData('text/plain', cardId);
  };

  const onDragEnd = () => {
    console.log('onDragEnd called - clearing dragging state');
    // Note: Don't reset nativeDragActive here - pointerup may fire after dragend
    // It will be reset in the next onPointerDown
    setDraggingId(null);
    setIsPointerDragging(false);
    endHoldPreview();
  };

  const onPointerEnterZone = (zone: 'feed' | 'kitchen') => () => {
    if (!draggingId) return;
    setHoverZone(zone);
  };

  const onPointerLeaveZone = () => {
    if (!draggingId) return;
    setHoverZone(null);
  };

  useEffect(() => {
    if (!isPointerDragging || !draggingId) return;
    const isPointInRect = (el: HTMLElement | null, x: number, y: number) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    const handlePointerUp = (evt: PointerEvent) => {
      console.log('👆 handlePointerUp called:', {
        nativeDragActive: nativeDragActive.current,
        draggingId,
        hoverZone,
        hoverTargetCard: hoverTargetCard?.name,
      });
      // Skip if native HTML5 drag is handling this
      if (nativeDragActive.current) {
        console.log('🔄 Skipping pointerUp - native drag is active');
        return;
      }

      // Check if we're dropping an exploit on a specific card target
      if (draggingId && hoverTargetCard) {
        const exploit = playerHand.find((c) => c.id === draggingId && c.kind === 'Exploit');
        if (exploit) {
          console.log('🎯 Pointer exploit drop on card:', {
            exploitName: exploit.name,
            targetCard: hoverTargetCard.name,
          });
          planExploitOnCard(hoverTargetCard);
          setHoverZone(null);
          setHoverTargetCard(null);
          setDraggingId(null);
          setIsPointerDragging(false);
          endHoldPreview();
          return;
        }
      }

      let zone: 'feed' | 'kitchen' | null = hoverZone;
      if (!zone) {
        if (isPointInRect(feedZoneRef.current, evt.clientX, evt.clientY)) {
          zone = 'feed';
        } else if (isPointInRect(kitchenZoneRef.current, evt.clientX, evt.clientY)) {
          zone = 'kitchen';
        }
      }
      if (zone && draggingId) {
        performDrop(zone, draggingId);
      } else if (draggingId) {
        flashNoPlay(draggingId, 'pointerUp:noZone');
      }
      setHoverZone(null);
      setHoverTargetCard(null);
      setDraggingId(null);
      setIsPointerDragging(false);
      setDragPosition(null);
      endHoldPreview();
    };
    const handlePointerMove = (evt: PointerEvent) => {
      clearHoldTimer();
      setIsPointerDragging(true);
      setDragPosition({ x: evt.clientX, y: evt.clientY });
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [isPointerDragging, draggingId, hoverZone, hoverTargetCard, playerHand]);

  const performDrop = (zone: 'feed' | 'kitchen', cardId: string) => {
    console.log('📦 performDrop called:', { zone, cardId, draggingCard: draggingCard?.name });
    if (planLocked) {
      flashNoPlay(cardId, 'performDrop:planLocked');
      return;
    }
    const card =
      playerHand.find((c) => c.id === cardId) || playerKitchen.find((c) => c.id === cardId) || null;
    if (!card) return;
    const meta = getPlayableMeta(card);
    // Guard that target zone matches allowed targets and mana
    const allowed =
      meta.canPlay &&
      ((zone === 'kitchen' && meta.targets.kitchen) || (zone === 'feed' && (meta.targets.feed || meta.targets.enemy)));
    if (!allowed) {
      flashNoPlay(cardId, 'performDrop:notAllowed');
      return;
    }
    scrubFromPlan(cardId);
    if (zone === 'kitchen') {
      dropToKitchen(cardId);
    } else {
      if (card.kind === 'Exploit') {
        flashNoPlay(cardId, 'performDrop:exploitOnFeed');
        return;
      }
      dropToFeedFromKitchen(cardId);
    }
  };

  const canHoverZone = (zone: 'feed' | 'kitchen') => {
    if (!draggingId) return false;
    const card =
      playerHand.find((c) => c.id === draggingId) || playerKitchen.find((c) => c.id === draggingId) || null;
    if (!card) return false;
    const meta = getPlayableMeta(card);
    if (!meta.canPlay) return false;
    return zone === 'kitchen' ? meta.targets.kitchen : meta.targets.feed || meta.targets.enemy;
  };

  const handleKitchenDrop = (event: DragEvent) => {
    console.log('🍳 handleKitchenDrop called:', {
      cardId: event.dataTransfer.getData('text/plain') || draggingId,
      draggingCard: draggingCard?.name,
    });
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain') || draggingId;
    if (!cardId) return;
    if (planLocked) {
      flashNoPlay(cardId, 'handleKitchenDrop:planLocked');
      return;
    }
    performDrop('kitchen', cardId);
    setHoverZone(null);
    endHoldPreview();
  };

  const handleFeedDrop = (event: DragEvent) => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain') || draggingId;
    if (!cardId) return;
    if (planLocked) {
      flashNoPlay(cardId, 'handleFeedDrop:planLocked');
      return;
    }
    const card =
      playerHand.find((c) => c.id === cardId) || playerKitchen.find((c) => c.id === cardId) || null;
    if (card && card.kind === 'Exploit') {
      const profile = getExploitTargetProfile(getExploitEffect(card));
      const meta = getPlayableMeta(card);
      // Allow dropping if exploit targets feed zone OR doesn't require a target
      if (meta.canPlay && (profile.feedZone || !profile.requiresTarget)) {
        queueExploit(card.id, null);
      } else {
        flashNoPlay(card.id, 'handleFeedDrop:exploitNoZone');
      }
      setHoverZone(null);
      endHoldPreview();
      return;
    }
    performDrop('feed', cardId);
    setHoverZone(null);
    endHoldPreview();
  };

  const handleEnemyKitchenDrop = (event: DragEvent) => {
    console.log('🏠 handleEnemyKitchenDrop called:', {
      draggingCard: draggingCard?.name,
      draggingCardKind: draggingCard?.kind,
    });
    event.preventDefault();
    if (planLocked) return;
    if (!draggingCard || draggingCard.kind !== 'Exploit') {
      flashNoPlay(undefined, 'handleEnemyKitchenDrop:notExploit');
      return;
    }
    const profile = getExploitTargetProfile(getExploitEffect(draggingCard));
    const meta = getPlayableMeta(draggingCard);
    if (!meta.canPlay) {
      flashNoPlay(draggingCard.id, 'handleEnemyKitchenDrop:!canPlay');
      return;
    }
    if (profile.enemyKitchenZone) {
      planExploitZoneEnemyKitchen();
    } else {
      console.log('🏠 handleEnemyKitchenDrop: not zone-targeting exploit, flashing');
      flashNoPlay(draggingCard.id, 'handleEnemyKitchenDrop:!zoneTargeting');
    }
    setHoverZone(null);
    endHoldPreview();
  };

  const handleEndTurn = async () => {
    console.log('🎮 handleEndTurn called', {
      planLocked,
      isEndingTurn,
      currentTurn: game?.turn,
      mySeat,
      myHasCommitted,
      opponentHasCommitted,
      pendingReveal: !!pendingReveal
    });

    if (planLocked || isEndingTurn) {
      console.log('❌ Early return: planLocked or isEndingTurn', { planLocked, isEndingTurn });
      return;
    }
    if (!game) {
      console.log('🆕 No game, starting new game');
      await startGame();
      return;
    }
    if (!mySeat) {
      console.log('❌ No seat identified');
      setDeckMessage('Cannot identify seat');
      return;
    }

    // If opponent called BASED, show modal instead of ending turn
    if (opponentCalledBased) {
      console.log('⚡ Opponent called BASED - showing response modal');
      setShowBasedResponseModal(true);
      return;
    }

    // Set the flag immediately to prevent double-clicks
    console.log('🔒 Setting isEndingTurn to true');
    setIsEndingTurn(true);

    try {
      const salt = crypto.randomUUID();
      // Include BASED flag in the plan - it will be processed after both players reveal
      const plan = { ...draftPlan, based: basedTurnCalled === game.turn && planHasActions };
      console.log('📤 Committing turn', {
        turn: game.turn,
        planActions: {
          kitchen: plan.plays_to_kitchen.length,
          posts: plan.posts.length,
          exploits: plan.exploits.length
        },
        based: plan.based
      });
      setPendingReveal({ plan, salt, turn: game.turn });
      await commitTurn(mySeat, plan, salt, game.turn);
      console.log('✅ Turn committed successfully');
      resetPlan();
    } catch (error) {
      // If something goes wrong, reset the flag
      console.log('❌ Failed to commit turn, resetting isEndingTurn');
      setIsEndingTurn(false);
      console.error('Failed to end turn:', error);
    }
  };

  const triggerRipple = (setter: Dispatch<SetStateAction<number | null>>) => {
    const key = Date.now();
    setter(key);
    window.setTimeout(() => {
      setter((current) => (current === key ? null : current));
    }, 900);
  };

  const handleCallBased = () => {
    if (!game || !mySeat) return;
    if (basedButtonDisabled) return;
    setBasedTurnCalled(game.turn);
    triggerRipple(setBasedPulseKey);
  };

  const renderLobby = () => (
    <div className="screen-panel lobby-screen">
      <div className="panel-actions lobby-actions">
        <button className="ghost-btn compact" onClick={() => fetchSnapshot()}>
          Refresh
        </button>
        <button className="ghost-btn compact" onClick={() => setShowHostModal(true)}>
          <Icon name="plus" size={16} /> Host
        </button>
        <button className="ghost-btn compact" onClick={() => startGame().then(() => setActiveScreen('duel'))}>
          Local Duel
        </button>
        <button className="icon-btn" onClick={() => setSearchContext('lobby')} aria-label="Search lobbies">
          <Icon name="search" />
        </button>
      </div>
      {isLoading && <p className="muted small">Syncing with backend…</p>}
      {error && !(searchContext === 'lobby' && error === 'cannot fetch remote lobbies from self') && (
        <p className="warning">{error}</p>
      )}
      {filteredLobbies.length === 0 && (
        <div className="empty-state surface">
          <p className="card-name">No lobbies yet</p>
          <p className="muted small">Host a match from the plus button.</p>
        </div>
      )}
      <div className="lobby-list scroll-y">
        {filteredLobbies.map((lobby) => {
          const isHost = nodeId === lobby.host;
          const canStart = isHost && lobby.opponent && !lobby.started;
          return (
            <div key={lobby.id} className="lobby-card surface">
              <div>
                <div className="card-title-row">
                  <span className="card-title">{lobby.host}</span>
                  <span className="pill">{lobby.mode}</span>
                  {lobby.started && <span className="pill success">Live</span>}
                </div>
                <p className="muted">{lobby.description}</p>
                <p className="muted">Stakes: {lobby.stakes} • Players: {lobby.opponent ? '2/2' : '1/2'}</p>
              </div>
              <div className="lobby-actions-inline">
                {!lobby.started && !isHost && !lobby.opponent && (
                  <button className="ghost-btn compact" onClick={() => handleJoinLobbyClick(lobby)}>
                    Join
                  </button>
                )}
                {canStart && (
                  <button
                    className="ghost-btn compact"
                    onClick={() => startLobbyGame(lobby.id).then(() => setActiveScreen('duel'))}
                  >
                    Start
                  </button>
                )}
                {lobby.started && (
                  <button className="ghost-btn compact" onClick={() => handleEnterGame(lobby)}>
                    Enter
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderDeckSelection = () => (
    <div className="deck-sidebar surface">
      <div className="sidebar-header">
        <span className="eyebrow">Decks</span>
        <button className="icon-btn" onClick={handleCreateDeck} aria-label="New deck">
          <Icon name="plus" />
        </button>
      </div>
      <div className="sidebar-list scroll-y">
        {decks.map((deck) => (
          <button
            key={deck.id}
            className={`deck-button ${deck.id === selectedDeckId ? 'active' : ''}`}
            onClick={() => setSelectedDeckId(deck.id)}
          >
            <span className="deck-name">{deck.name}</span>
            <span className="muted small">{deck.cards.length}/12</span>
          </button>
        ))}
      </div>
    </div>
  );


  const renderDeckContents = () => (
    <div
      className={`deck-contents surface ${draggingId ? 'deck-drop-active' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const cardId = e.dataTransfer.getData('text/plain') || draggingId;
        if (cardId) handleAddToDeck(cardId);
      }}
    >
      <div className="panel-header deck-edit-header">
        <div>
          <p className="eyebrow">Editing</p>
          <h3>{selectedDeck?.name ?? 'Select a deck'}</h3>
        </div>
        <button className="ghost-btn compact" onClick={() => setSelectedDeckId(decks[0]?.id ?? 'deck-1')}>
          <Icon name="arrowLeft" size={18} /> Back
        </button>
      </div>
      <div className="deck-edit-body">
        <div className="deck-list-half scroll-y">
          {selectedDeck && (
            <p className="muted small">
              Memes: {selectedDeck.cards.filter((id) => catalog.find((c) => c.id === id && c.kind === 'Meme')).length}
              /{MEME_LIMIT} • Exploits:{' '}
              {selectedDeck.cards.filter((id) => catalog.find((c) => c.id === id && c.kind === 'Exploit')).length}
              /{EXPLOIT_LIMIT}
            </p>
          )}
          {selectedDeck && selectedDeck.cards.length === 0 && (
            <p className="muted">Drag a card from the catalog to add it. Limit {MAX_DECK_SIZE}.</p>
          )}
          {selectedDeck && selectedDeck.cards.length !== MAX_DECK_SIZE && (
            <p className="warning">Deck must contain exactly {MAX_DECK_SIZE} cards.</p>
          )}
          {selectedDeck &&
            (selectedDeck.cards.filter((id) => catalog.find((c) => c.id === id && c.kind === 'Meme')).length !==
              MEME_LIMIT ||
              selectedDeck.cards.filter((id) => catalog.find((c) => c.id === id && c.kind === 'Exploit')).length !==
                EXPLOIT_LIMIT) && <p className="warning">Use 4 memes and 8 exploits.</p>}
          {selectedDeck?.cards.map((cardId, idx) => {
            const card = catalog.find((c) => c.id === cardId);
            if (!card) return null;
            return (
              <div key={`${card.id}-${idx}`} className="deck-row compact-row" onClick={() => handleInspectCard(card)}>
                <span className="card-name">{card.name}</span>
                <button className="ghost-btn compact" onClick={() => handleRemoveFromDeck(idx)}>
                  Remove
                </button>
              </div>
            );
          })}
          {deckMessage && <p className="warning">{deckMessage}</p>}
        </div>
        <div className="deck-catalog-half scroll-y">
          {catalog.length === 0 && <p className="muted small">Catalog not loaded from backend yet.</p>}
          <div className="card-grid two-wide">
            {catalog.map((card) => (
              <div
                key={card.id}
                className={`card-tile draggable ${draggingId === card.id ? 'dragging' : ''}`}
                draggable
                onDragStart={onDragStart(card.id, 'hand')}
                onDragEnd={onDragEnd}
                onClick={() => handleInspectCard(card)}
              >
                <span className="cost-badge">{card.cost}</span>
                <div className="card-body">
                  <p className="card-name">{card.name}</p>
                  <p className="muted small">
                    {card.kind.toUpperCase()} • {card.role}
                  </p>
                  <p className="muted small">Virality: {card.virality}</p>
                  {card.ability && <p className="ability">{card.ability}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDeckBuilder = () => (
    <div className="deck-screen">
      {renderDeckSelection()}
      <div className="deck-main">
        {renderDeckContents()}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="screen-panel settings-screen">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Dial in your vibe</h2>
        </div>
        <button className="ghost-btn compact" onClick={() => setSearchContext('settings')}>
          <Icon name="search" size={18} /> Search
        </button>
      </div>

      <div className="settings-grid">
        <div className="surface settings-card">
          <div className="setting-row">
            <div>
              <p className="card-name">Animations</p>
              <p className="muted small">Feed slam + Kitchen simmer</p>
            </div>
            <label className="toggle">
              <input type="checkbox" defaultChecked />
              <span />
            </label>
          </div>
          <div className="setting-row">
            <div>
              <p className="card-name">Sound FX</p>
              <p className="muted small">Clicks, swooshes, cringe alarms</p>
            </div>
            <label className="toggle">
              <input type="checkbox" defaultChecked />
              <span />
            </label>
          </div>
          <div className="setting-row">
            <div>
              <p className="card-name">Hardcore Mode</p>
              <p className="muted small">Enable NFT ante + BASED bets</p>
            </div>
            <label className="toggle">
              <input type="checkbox" />
              <span />
            </label>
          </div>
        </div>

        <div className="surface settings-card">
          <p className="eyebrow">Profile</p>
          <div className="stack">
            <label className="muted small">Display Name</label>
            <input placeholder="chef.os" defaultValue={nodeId ?? ''} />
          </div>
          <div className="stack">
            <label className="muted small">Bio</label>
            <textarea placeholder="Cooking meta, trolling feed..." rows={3} />
          </div>
          <div className="stack">
            <label className="muted small">Avatar URL</label>
            <input placeholder="https://..." />
          </div>
          <button className="save-btn">Save</button>
        </div>
      </div>
    </div>
  );

  const renderHandStrip = () => (
    <div className="hand-strip up hand-always">
      <div className="hand-expanded">
        {playerHand.map((card) => (
          <HoloCard
            key={`full-${card.id}`}
            kind={card.kind}
            cost={card.cost}
            className={`hand-card surface ${queuedToKitchen.has(card.id) || queuedExploits.has(card.id) ? 'queued' : ''} ${
              draggingId === card.id ? 'dragging' : ''
            } ${noPlayCardId === card.id ? 'no-play' : ''}`}
            disabled={planLocked}
            draggable
            onDragStart={(e) => {
              if (planLocked) {
                e.preventDefault();
                flashNoPlay(card.id, 'handCard:onDragStart:planLocked');
                return;
              }
              endHoldPreview();
              onDragStart(card.id, 'hand')(e);
            }}
            onDragEnd={onDragEnd}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault();
              nativeDragActive.current = false; // Reset for new drag operation
              if (planLocked) {
                flashNoPlay(card.id, 'handCard:onPointerDown:planLocked');
                return;
              }
              setDraggingId(card.id);
              setIsPointerDragging(true);
              startHoldPreview(card)();
            }}
            onPointerMove={() => {
              if (draggingId === card.id) {
                clearHoldTimer();
                setIsPointerDragging(true);
              }
            }}
            onPointerLeave={endHoldPreview}
            onClick={() => {
              if (isPointerDragging) return;
              handleInspectCard(card);
            }}
          >
            <div className="hand-card-top">
              <span className="pill quiet">{card.cost}</span>
              <span className="pill quiet">{card.currentVirality}</span>
            </div>
            <p className="card-name ellipsis">{card.name}</p>
          </HoloCard>
        ))}
        {playerHand.length === 0 && <p className="muted small">Empty hand</p>}
      </div>
    </div>
  );

  const renderKitchenRow = (
    cards: LiveCard[],
    tone: 'red' | 'green',
    label: string,
    dropHandler?: any,
    planned: LiveCard[] = [],
    statusText?: string,
  ) => {
    // Get exploit targets for this kitchen
    const exploitTargets = new Map<string, string[]>();
    draftPlan.exploits.forEach((exploit) => {
      if (exploit.target && typeof exploit.target === 'object' && 'Card' in exploit.target) {
        const targetId = exploit.target.Card;
        if (!exploitTargets.has(targetId)) {
          exploitTargets.set(targetId, []);
        }
        exploitTargets.get(targetId)?.push(exploit.card_id);
      }
    });

    return (
      <div
        className={`kitchen-row ${tone}`}
        onDragOver={(e) => dropHandler && e.preventDefault()}
        onDrop={dropHandler}
      >
        <div className="kitchen-label-row">
          <div className="kitchen-label">{label}</div>
          {statusText && <span className="status-flag flash">{statusText}</span>}
        </div>
        <div className="kitchen-cards row">
          {cards.map((card) => {
            const targetedByExploits = exploitTargets.get(card.id) || [];
            const isDragTarget = draggingCard && draggingCard.kind === 'Exploit' &&
                               draggingCard.location === 'hand' && canUseExploitOnCard(draggingCard, card);

            // Debug: log when rendering with a dragging card
            if (draggingCard && tone === 'red') {
              console.log(`🎯 Rendering ${tone} kitchen card:`, {
                cardName: card.name,
                cardLocation: card.location,
                cardOwner: card.owner,
                draggingCardName: draggingCard.name,
                draggingCardKind: draggingCard.kind,
                draggingCardLocation: draggingCard.location,
                isDragTarget,
              });
            }

            return (
              <HoloCard
                key={card.id}
                kind={card.kind}
                cost={card.cost}
                className={`kitchen-card surface ${queuedPosts.has(card.id) ? 'queued' : ''} ${
                  draggingId === card.id ? 'dragging' : ''
                } ${noPlayCardId === card.id ? 'no-play' : ''} ${
                  targetedByExploits.length > 0 ? 'exploit-target' : ''
                } ${isDragTarget ? 'valid-target' : ''}`}
                disabled={planLocked}
                draggable={tone === 'green'}
                onDragOver={(e) => {
                  // Always log for debugging
                  console.log(`🔄 CARD onDragOver (${tone}):`, {
                    cardName: card.name,
                    cardOwner: card.owner,
                    tone,
                    draggingId,
                    hasDraggingCard: !!draggingCard,
                    draggingCardName: draggingCard?.name,
                  });

                  const draggingExploit =
                    draggingCard && draggingCard.kind === 'Exploit' && draggingCard.location === 'hand';
                  const canUse = draggingExploit && draggingId && draggingCard && canUseExploitOnCard(draggingCard, card);

                  console.log(`🔄 CARD onDragOver result (${tone}):`, {
                    cardName: card.name,
                    draggingExploit,
                    canUse,
                    willPreventDefault: canUse,
                  });

                  if (canUse) {
                    e.preventDefault();
                    e.stopPropagation(); // Stop event from bubbling to lane
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation(); // Prevent bubbling to zone handler
                  console.log('onDrop triggered for card:', card.name, {
                    draggingCard: draggingCard?.name,
                    draggingCardKind: draggingCard?.kind,
                    draggingCardLocation: draggingCard?.location,
                    tone
                  });

                  const draggingExploit =
                    draggingCard && draggingCard.kind === 'Exploit' && draggingCard.location === 'hand';

                  console.log('draggingExploit check:', {
                    draggingCard: !!draggingCard,
                    isExploit: draggingCard?.kind === 'Exploit',
                    isInHand: draggingCard?.location === 'hand',
                    result: draggingExploit
                  });

                  if (draggingExploit && draggingCard) {
                    console.log('Calling planExploitOnCard for:', card.name);
                    planExploitOnCard(card);
                    setHoverZone(null);
                    endHoldPreview();
                    return;
                  } else {
                    console.log('Not calling planExploitOnCard - conditions not met');
                  }
                }}
                onDragStart={
                  tone === 'green'
                    ? (e) => {
                        if (planLocked) {
                          e.preventDefault();
                          flashNoPlay(card.id, 'kitchenCard:onDragStart:planLocked');
                          return;
                        }
                        onDragStart(card.id, 'kitchen')(e);
                      }
                    : undefined
                }
                onDragEnd={tone === 'green' ? onDragEnd : undefined}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={
                  tone === 'green'
                    ? (e) => {
                        e.preventDefault();
                        nativeDragActive.current = false; // Reset for new drag operation
                        if (planLocked) {
                          flashNoPlay(card.id, 'kitchenCard:onPointerDown:planLocked');
                          return;
                        }
                        setDraggingId(card.id);
                        setIsPointerDragging(true);
                        startHoldPreview(card)();
                      }
                    : undefined
                }
                onPointerMove={
                  tone === 'green'
                    ? () => {
                        if (draggingId === card.id) {
                          clearHoldTimer();
                          setIsPointerDragging(true);
                        }
                      }
                    : undefined
                }
                onPointerEnter={() => {
                  // When dragging an exploit over a card, track it as the target
                  if (draggingId && draggingCard?.kind === 'Exploit' && canUseExploitOnCard(draggingCard, card)) {
                    console.log('🎯 onPointerEnter - setting target card:', card.name);
                    setHoverTargetCard(card);
                  }
                }}
                onPointerLeave={() => {
                  // Clear target card when leaving
                  if (hoverTargetCard?.id === card.id) {
                    console.log('🎯 onPointerLeave - clearing target card:', card.name);
                    setHoverTargetCard(null);
                  }
                  // Also handle hold preview for green cards
                  if (tone === 'green') {
                    endHoldPreview();
                  }
                }}
                onClick={() => {
                  if (isPointerDragging) return;
                  handleInspectCard(card);
                }}
              >
                <div className="card-top">
                  <span className="pill quiet">{card.currentVirality}</span>
                </div>
                <p className="card-name">{card.name}</p>
                {targetedByExploits.length > 0 && (
                  <div className="exploit-indicators">
                    {targetedByExploits.map((exploitId, idx) => {
                      const exploit = playerHand.find(h => h.id === exploitId);
                      return exploit ? (
                        <span key={`ex-${idx}`} className="exploit-indicator" title={exploit.name}>
                          ⚡
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </HoloCard>
            );
          })}
        {planned.map((card) => (
          <HoloCard
            key={`plan-${card.id}`}
            kind={card.kind}
            cost={card.cost}
            className={`kitchen-card surface pending ${planLocked ? 'locked' : ''}`}
            disabled
          >
            <div className="card-top">
              <span className="pill quiet">{card.currentVirality}</span>
            </div>
            <p className="card-name">{card.name}</p>
            {!planLocked && (
              <button
                className="cancel-chip"
                onClick={(e) => {
                  e.stopPropagation();
                  scrubFromPlan(card.id);
                }}
              >
                ×
              </button>
            )}
          </HoloCard>
        ))}
        {cards.length === 0 && planned.length === 0 && <p className="muted small">Empty</p>}
      </div>
    </div>
    );
  };

  const playerScore = myPlayer?.score ?? 0;
  const opponentScore = opponentPlayer?.score ?? 0;
  const scoreTarget = Math.max(playerScore, opponentScore, 30);
  const playerPct = scoreTarget === 0 ? 0 : Math.min(100, Math.round((playerScore / scoreTarget) * 100));
  const opponentPct = scoreTarget === 0 ? 0 : Math.min(100, Math.round((opponentScore / scoreTarget) * 100));
  const endTurnLabel = waitingForOpponent ? 'Waiting for opponent…' : isResolving ? 'Resolving…' : isEndingTurn ? 'Processing…' : 'End Turn';
  const endTurnDisabled = waitingForOpponent || isResolving || planLocked || isEndingTurn;

  // Debug log button state
  useEffect(() => {
    console.log('🔘 Button state', {
      label: endTurnLabel,
      disabled: endTurnDisabled,
      planLocked,
      isEndingTurn,
      waitingForOpponent,
      isResolving,
      turn: game?.turn
    });
  }, [endTurnLabel, endTurnDisabled, planLocked, isEndingTurn, waitingForOpponent, isResolving, game?.turn]);
  const stakesMultiplier = game?.stakes ?? 1;

  const renderDuel = () => (
    <div className="duel-shell">
      <header className="duel-header surface">
        <div className="enemy-hand-line">
          <div className="enemy-hand-bubbles" aria-label="Opponent hand">
            {Array.from({ length: opponentPlayer?.hand.length ?? 0 }).map((_, idx) => (
              <span key={idx} className="card-bubble" />
            ))}
          </div>
          <div className="duel-top-actions">
            <button className="ghost-btn compact" onClick={handleEndTurn} disabled={endTurnDisabled}>
              {endTurnLabel}
            </button>
            <div className="based-container">
              <button
                className={`based-btn compact ${basedButtonDisabled ? 'disabled' : ''}`}
                onClick={handleCallBased}
                disabled={basedButtonDisabled}
              >
                BASED
              </button>
              <span className="stakes-display">x{stakesMultiplier}</span>
            </div>
            <button className="icon-btn tiny" aria-label="Settings" onClick={() => setShowSettingsModal(true)}>
              <Icon name="settings" size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="duel-stage">
        <section className="playfield surface">
          <div
            className={`lane enemy-lane ${holdTargets.enemy ? 'hold-hot' : ''} ${
              hoverZone === 'feed' ? 'drop-hot' : ''
            }`}
            onDragOver={(e) => {
              console.log('🏠 LANE onDragOver (enemy-lane):', {
                target: (e.target as HTMLElement).className,
                currentTarget: (e.currentTarget as HTMLElement).className,
                draggingCard: draggingCard?.name,
              });
              // Only allow zone-targeting exploits on the enemy lane zone
              // Card-targeting exploits should be dropped on individual cards
              const allowZone =
                draggingCard &&
                draggingCard.kind === 'Exploit' &&
                draggingCard.location === 'hand' &&
                getExploitTargetProfile(getExploitEffect(draggingCard)).enemyKitchenZone &&
                getPlayableMeta(draggingCard).canPlay;
              if (allowZone) {
                e.preventDefault();
                setHoverZone('feed');
              }
            }}
            onDragLeave={() => setHoverZone(null)}
            onPointerEnter={() => {
              // Only show hold preview for zone-targeting exploits on enemy lane
              if (!draggingId) return;
              const card = playerHand.find((c) => c.id === draggingId);
              if (card && card.kind === 'Exploit') {
                const profile = getExploitTargetProfile(getExploitEffect(card));
                if (profile.enemyKitchenZone && getPlayableMeta(card).canPlay) {
                  onPointerEnterZone('feed')();
                }
              }
            }}
            onPointerLeave={onPointerLeaveZone}
            onDrop={handleEnemyKitchenDrop}
          >
            {renderKitchenRow(
              enemyKitchen,
              'red',
              'Enemy Kitchen',
              undefined,  // Zone drop handler stays undefined since we handle per-card
              [],
              opponentWaitingOnMe ? 'Opponent waiting for you…' : undefined,
            )}
          </div>

          <div
            className={`lane feed-lane ${hoverZone === 'feed' ? 'drop-hot' : ''} ${
              holdTargets.feed ? 'hold-hot' : ''
            }`}
            ref={feedZoneRef}
            onDragOver={(e) => {
              e.preventDefault();
              if (canHoverZone('feed')) setHoverZone('feed');
            }}
            onDragLeave={() => setHoverZone(null)}
            onDrop={handleFeedDrop}
            onPointerEnter={() => canHoverZone('feed') && onPointerEnterZone('feed')()}
            onPointerLeave={onPointerLeaveZone}
          >
            <div className="feed-prompt">What's happening?</div>
            <div className="feed-stack">
              {feedCards.map((card, idx) => {
                const isTargetedByExploit = draftPlan.exploits.some(
                  e => e.target && typeof e.target === 'object' && 'Card' in e.target && e.target.Card === card.id
                );
                const isDragTarget = draggingCard && draggingCard.kind === 'Exploit' &&
                                   draggingCard.location === 'hand' && canUseExploitOnCard(draggingCard, card);

                return (
                  <HoloPill
                    key={card.id}
                    kind={card.kind}
                    className={`feed-pill surface ${card.owner === mySeat ? 'mine' : 'enemy'} ${
                      isTargetedByExploit ? 'exploit-target' : ''
                    } ${isDragTarget ? 'valid-target' : ''}`}
                    onClick={() => handleInspectCard(card)}
                    onContextMenu={(e) => e.preventDefault()}
                    onPointerEnter={() => {
                      // When dragging an exploit over a feed card, track it as the target
                      if (draggingId && draggingCard?.kind === 'Exploit' && canUseExploitOnCard(draggingCard, card)) {
                        console.log('🎯 feed card onPointerEnter - setting target card:', card.name);
                        setHoverTargetCard(card);
                      }
                    }}
                    onPointerLeave={() => {
                      // Clear target card when leaving
                      if (hoverTargetCard?.id === card.id) {
                        console.log('🎯 feed card onPointerLeave - clearing target card:', card.name);
                        setHoverTargetCard(null);
                      }
                    }}
                    onDragOver={(e) => {
                      const draggingExploit =
                        draggingCard && draggingCard.kind === 'Exploit' && draggingCard.location === 'hand';
                      const draggingMeme =
                        draggingCard && draggingCard.kind === 'Meme' && draggingCard.location === 'kitchen';
                      if (
                        (draggingExploit &&
                          draggingCard &&
                          (canUseExploitOnSlot(draggingCard) || canUseExploitOnCard(draggingCard, card))) ||
                        (draggingMeme && getPlayableMeta(draggingCard).targets.feed)
                      ) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation(); // Prevent bubbling to feed zone handler
                      const draggingExploit =
                        draggingCard && draggingCard.kind === 'Exploit' && draggingCard.location === 'hand';
                      const draggingMeme =
                        draggingCard && draggingCard.kind === 'Meme' && draggingCard.location === 'kitchen';
                      if (draggingExploit && draggingCard) {
                        const profile = getExploitTargetProfile(getExploitEffect(draggingCard));
                        if (canUseExploitOnCard(draggingCard, card)) {
                          planExploitOnCard(card);
                        } else if (profile.feedSlot && canUseExploitOnSlot(draggingCard)) {
                          planExploitOnFeedSlot(idx);
                        } else {
                          flashNoPlay(draggingCard.id, 'feedCard:onDrop:noMatch');
                        }
                        setHoverZone(null);
                        endHoldPreview();
                        return;
                      }
                      if (draggingMeme && draggingCard) {
                        performDrop('feed', draggingCard.id);
                      }
                    }}
                  >
                    <span className="feed-prefix">#{idx + 1}</span>
                    <span className="feed-name ellipsis">{card.name}</span>
                    <span className="feed-virality">{card.currentVirality}</span>
                    {isTargetedByExploit && (
                      <span className="exploit-indicator-small" title="Targeted by exploit">⚡</span>
                    )}
                  </HoloPill>
                );
              })}
              {plannedFeedPosts.map((card, idx) => (
                <HoloPill
                  key={`plan-feed-${card.id}-${idx}`}
                  kind={card.kind}
                  className={`feed-pill surface pending ${mySeat ? 'mine' : ''}`}
                >
                  <span className="feed-prefix">#?</span>
                  <span className="feed-name ellipsis">{card.name}</span>
                  <span className="feed-virality">{card.currentVirality}</span>
                  {!planLocked && (
                    <button
                      className="cancel-chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        scrubFromPlan(card.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </HoloPill>
              ))}
              {plannedExploits.map((card, idx) => (
                <HoloPill
                  key={`plan-ex-${card.id}-${idx}`}
                  kind={card.kind}
                  className={`feed-pill surface pending exploit-preview ${mySeat ? 'mine' : ''}`}
                >
                  <span className="feed-prefix">⚡</span>
                  <span className="feed-name ellipsis">{card.name}</span>
                  <span className="feed-virality">{card.cost}</span>
                  {!planLocked && (
                    <button
                      className="cancel-chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        scrubFromPlan(card.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </HoloPill>
              ))}
              {feedCards.length === 0 && plannedFeedPosts.length === 0 && plannedExploits.length === 0 && (
                <p className="muted small">Feed is empty.</p>
              )}
            </div>
          </div>

          <div
            className={`lane player-lane ${hoverZone === 'kitchen' ? 'drop-hot' : ''} ${
              holdTargets.kitchen ? 'hold-hot' : ''
            }`}
            ref={kitchenZoneRef}
            onDragOver={(e) => {
              console.log('🏠 LANE onDragOver (player-lane):', {
                target: (e.target as HTMLElement).className,
                draggingCard: draggingCard?.name,
              });
              e.preventDefault();
              if (canHoverZone('kitchen')) setHoverZone('kitchen');
            }}
            onDragLeave={() => setHoverZone(null)}
            onDrop={(e) => {
              console.log('🏠 LANE onDrop (player-lane):', {
                target: (e.target as HTMLElement).className,
                draggingCard: draggingCard?.name,
              });
              handleKitchenDrop(e);
            }}
            onPointerEnter={() => canHoverZone('kitchen') && onPointerEnterZone('kitchen')()}
            onPointerLeave={onPointerLeaveZone}
          >
            {renderKitchenRow(playerKitchen, 'green', 'Your Kitchen', handleKitchenDrop, plannedKitchenAdds)}
          </div>

          {renderHandStrip()}
        </section>

        <aside className="score-rail surface">
          <div className="score-bar">
            <div className="score-lane enemy">
              <div className="score-fill enemy" style={{ height: `${opponentPct}%` }} />
            </div>
            <div className="score-lane player">
              <div className="score-fill player" style={{ height: `${playerPct}%` }} />
            </div>
          </div>
          <div className="mana-column">
            {Array.from({ length: 6 }).map((_, idx) => {
              const filled = (myPlayer?.mana ?? 0) > idx;
              return <div key={idx} className={`mana-dot ${filled ? 'filled' : 'empty'}`} />;
            })}
          </div>
        </aside>
      </div>
    </div>
  );

  const renderModalCard = () =>
    modalCard && (
      <div className="modal-overlay modal-entering" onClick={closeAllModals}>
        <div className="modal-card surface modal-quick" onClick={(e) => e.stopPropagation()}>
          <p className="muted small center">Tap anywhere to close</p>
          <HoloCard
            kind={modalCard.kind}
            cost={modalCard.cost}
            className="big-card"
          >
            {'variantId' in modalCard ? (
              <>
                <span className="cost-badge">{(modalCard as LiveCard).cost}</span>
                <h3>{modalCard.name}</h3>
                <p className="muted small">
                  {(modalCard as LiveCard).kind.toUpperCase()} • {(modalCard as LiveCard).role}
                </p>
                <p className="card-description">{(modalCard as LiveCard).description}</p>
                <div className="stats-box">
                  <p>Base Virality: {(modalCard as LiveCard).baseVirality}</p>
                  <p>Current: {(modalCard as LiveCard).currentVirality}</p>
                  {(modalCard as LiveCard).yieldRate !== undefined && (
                    <p className="muted small">Yield: +{(modalCard as LiveCard).yieldRate} / turn</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="cost-badge">{(modalCard as UICardDefinition).cost}</span>
                <h3>{modalCard.name}</h3>
                <p className="muted small">
                  {(modalCard as UICardDefinition).kind.toUpperCase()} • {(modalCard as UICardDefinition).role}
                </p>
                <p className="card-description">{(modalCard as UICardDefinition).description}</p>
                <div className="stats-box">
                  <p>Virality: {(modalCard as UICardDefinition).virality}</p>
                  {(modalCard as UICardDefinition).yieldBonus && <p>{(modalCard as UICardDefinition).yieldBonus}</p>}
                </div>
              </>
            )}
          </HoloCard>
        </div>
      </div>
    );

  const renderSearchModal = () => {
    if (searchContext === 'none') return null;
    if (searchContext === 'lobby') {
      return (
        <div className="modal-overlay modal-entering" onClick={closeAllModals}>
          <div className="search-modal surface modal-quick" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Search for someone else</h3>
              <button className="ghost-btn compact" onClick={closeAllModals}>
                Close
              </button>
            </div>
            <input
              placeholder="Search host or description..."
              value={lobbyQuery}
              onChange={(e) => setLobbyQuery(e.target.value)}
              autoFocus
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!lobbyQuery.trim()) return;
                  await fetchRemoteLobbies(lobbyQuery.trim());
                }
              }}
            />
            <div className="panel-actions" style={{ marginTop: 8 }}>
              <button
                className="ghost-btn compact"
                onClick={async () => {
                  if (!lobbyQuery.trim()) return;
                  await fetchRemoteLobbies(lobbyQuery.trim());
                }}
              >
                Fetch from host
              </button>
            </div>
            <div className="modal-results scroll-y">
              {error === 'cannot fetch remote lobbies from self' ? (
                <p className="warning small">cannot fetch remote lobbies from self</p>
              ) : (
                <>
                  {filteredLobbies.map((lobby) => (
                    <div key={lobby.id} className="modal-row">
                      <div>
                        <p className="card-name">{lobby.host}</p>
                        <p className="muted small">
                          {lobby.mode} • Stakes {lobby.stakes}
                        </p>
                      </div>
                      {!lobby.started && !lobby.opponent && (
                        <button
                          className="ghost-btn compact"
                          onClick={() => {
                            handleJoinLobbyClick(lobby);
                            closeAllModals();
                          }}
                        >
                          Join
                        </button>
                      )}
                    </div>
                  ))}
                  {filteredLobbies.length === 0 && <p className="muted small">No matches.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (searchContext === 'deck') {
      return (
        <div className="modal-overlay modal-entering" onClick={closeAllModals}>
          <div className="search-modal surface modal-quick" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h3>Filter Cards</h3>
              <button className="ghost-btn compact" onClick={closeAllModals}>
                Close
              </button>
            </div>
            <input
              placeholder="Search by name, role..."
              value={cardQuery}
              onChange={(e) => setCardQuery(e.target.value)}
              autoFocus
            />
            <p className="muted small">Results update on the deck view.</p>
          </div>
        </div>
      );
    }

    if (searchContext === 'settings') {
      return (
        <div className="modal-overlay modal-entering" onClick={closeAllModals}>
          <div className="search-modal surface modal-quick" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
            <h3>Search Settings</h3>
            <button className="ghost-btn compact" onClick={closeAllModals}>
              Close
            </button>
          </div>
          <input placeholder="e.g. sound, hardcore" autoFocus />
        </div>
      </div>
    );
    }
    return null;
  };

  const renderHostModal = () =>
    showHostModal && (
      <div className="modal-overlay modal-entering" onClick={() => setShowHostModal(false)}>
        <div className="search-modal surface modal-quick" onClick={(e) => e.stopPropagation()}>
          <div className="panel-header">
            <h3>Host Lobby</h3>
            <button className="ghost-btn compact" onClick={() => setShowHostModal(false)}>
              Close
            </button>
          </div>
          <div className="stack">
            <label className="muted small">Mode</label>
            <input
              value={hostForm.mode}
              onChange={(e) => setHostForm((prev) => ({ ...prev, mode: e.target.value }))}
              placeholder="Standard"
            />
          </div>
          <div className="stack">
            <label className="muted small">Stakes</label>
            <input
              type="number"
              min={1}
              max={8}
              value={hostForm.stakes}
              onChange={(e) => setHostForm((prev) => ({ ...prev, stakes: parseInt(e.target.value || '1', 10) }))}
            />
          </div>
          <div className="stack">
            <label className="muted small">Description</label>
            <textarea
              rows={3}
              value={hostForm.description}
              onChange={(e) => setHostForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>
          <button
            className="save-btn"
            onClick={async () => {
              await hostLobby(hostForm);
              setShowHostModal(false);
            }}
          >
            Create Lobby
          </button>
        </div>
      </div>
    );

  const renderSettingsModal = () =>
    showSettingsModal && (
      <div className="modal-overlay modal-entering" onClick={() => setShowSettingsModal(false)}>
        <div className="search-modal surface modal-quick" onClick={(e) => e.stopPropagation()}>
          <div className="panel-header">
            <h3>Game Menu</h3>
            <button className="ghost-btn compact" onClick={() => setShowSettingsModal(false)}>
              Close
            </button>
          </div>
          <button className="ghost-btn compact" onClick={handleLeaveGame}>
            Leave game
          </button>
          <p className="muted small">You will return to the lobby.</p>
        </div>
      </div>
    );

  const renderBasedModal = () => {
    if (!showBasedModal || !game) return null;
    return (
      <div className="modal-overlay modal-entering" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal surface based-modal modal-dramatic">
          <h3>Opponent called BASED. Call BASED to double stakes or retreat.</h3>
          <div className="stack">
            <button
              className="save-btn"
              onClick={async () => {
                triggerRipple(setBasedPulseKey);
                setShowBasedResponseModal(false);
                await acceptBased(mySeat ?? 'Host');
              }}
            >
              BASED
            </button>
            <button
              className="ghost-btn compact danger"
              onClick={async () => {
                triggerRipple(setBasedPulseKey);
                setShowBasedResponseModal(false);
                await foldBased(mySeat ?? 'Host');
              }}
            >
              Retreat
            </button>
          </div>
          <p className="muted small">Stakes: x{stakesMultiplier * 2}</p>
        </div>
      </div>
    );
  };

  const renderWinLoseModal = () => {
    if (!game?.winner) return null;
    const isWinner = game.winner === mySeat;
    return (
      <div className="modal-overlay modal-entering" onClick={(e) => e.stopPropagation()}>
        <div className={`search-modal surface win-lose-modal ${isWinner ? 'win' : 'lose'}`}>
          <h2 className={`win-lose-title ${isWinner ? 'win' : 'lose'}`}>
            {isWinner ? 'You Win!' : 'You Lose'}
          </h2>
          <p className="muted">Stakes: x{stakesMultiplier}</p>
          <button className="save-btn" onClick={handleLeaveGame}>
            Leave Game
          </button>
        </div>
      </div>
    );
  };

  const renderBottomNav = () => (
    <nav className="bottom-nav surface">
      {[
        { key: 'lobby', label: 'Lobby', icon: 'home' },
        { key: 'deck', label: 'Decks', icon: 'library' },
        { key: 'search', label: 'Search', icon: 'search' },
        { key: 'settings', label: 'Settings', icon: 'settings' },
      ].map((item) => {
        const isSearch = item.key === 'search';
        const isActive = activeScreen === item.key || (isSearch && searchContext !== 'none');
        return (
          <button
            key={item.key}
            className={`nav-button ${isActive ? 'active' : ''}`}
            onClick={() => {
              if (isSearch) {
                handleSearchNav();
              } else {
                setActiveScreen(item.key as Screen);
              }
            }}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );

  const renderDesktopNav = () => (
    <aside className="desktop-nav surface">
      <div className="app-logo">
        <Icon name="bolt" />
        <span>MEME WARS</span>
      </div>
      {[
        { key: 'lobby', label: 'Lobby', icon: 'home' },
        { key: 'deck', label: 'Decks', icon: 'library' },
        { key: 'settings', label: 'Settings', icon: 'settings' },
        { key: 'duel', label: 'Duel', icon: 'sword' },
      ].map((item) => (
        <button
          key={item.key}
          className={`desktop-nav-btn ${activeScreen === item.key ? 'active' : ''}`}
          onClick={() => setActiveScreen(item.key as Screen)}
        >
          <Icon name={item.icon} size={18} />
          <span>{item.label}</span>
        </button>
      ))}
    </aside>
  );

  const renderContent = () => {
    if (activeScreen === 'deck') return renderDeckBuilder();
    if (activeScreen === 'settings') return renderSettings();
    if (activeScreen === 'duel') return renderDuel();
    return renderLobby();
  };

  return (
    <div className={`app-shell ${activeScreen === 'duel' ? 'duel-mode' : ''}`}>
      <div className="desktop-layout">
        {renderDesktopNav()}
        <main className="main">{renderContent()}</main>
      </div>
      {activeScreen !== 'duel' && renderBottomNav()}
      {renderSearchModal()}
      {renderHostModal()}
      {renderSettingsModal()}
      {renderBasedModal()}
      {renderWinLoseModal()}
      {renderModalCard()}
      {basedPulseKey && <div key={basedPulseKey} className="based-ripple" />}
      {basedModalPulse && <div key={`modal-${basedModalPulse}`} className="based-ripple modal-ripple" />}
      {opponentExploits.length > 0 && (
        <div
          className="opponent-exploit-notification"
          onClick={() => {
            setOpponentExploits([]);
            if (opponentExploitTimer.current) {
              clearTimeout(opponentExploitTimer.current);
              opponentExploitTimer.current = null;
            }
          }}
        >
          <div className="notification-header">Opponent played exploits!</div>
          <div className="exploit-list">
            {opponentExploits.map((exploit, idx) => {
              // Look up card name from catalog using variant_id (card_id is instance_id like "e01-5")
              const variantId = exploit.card_id.split('-')[0];
              const cardDef = catalog.find((c) => c.id === variantId);
              const cardName = cardDef?.name || exploit.card_id;

              // Look up target card name if targeting a card
              let targetDesc = '';
              if (exploit.target) {
                if (typeof exploit.target === 'object' && 'Card' in exploit.target) {
                  const targetInstanceId = exploit.target.Card;
                  // Find target in all zones
                  const allCards = [
                    ...(myPlayer?.kitchen || []),
                    ...(myPlayer?.hand || []),
                    ...(opponentPlayer?.kitchen || []),
                    ...(opponentPlayer?.hand || []),
                    ...(game?.feed || []),
                  ];
                  const targetCard = allCards.find((c) => c.instance_id === targetInstanceId);
                  const targetName = targetCard?.name || 'card';
                  targetDesc = `→ ${targetName}`;
                } else if (typeof exploit.target === 'object' && 'FeedSlot' in exploit.target) {
                  targetDesc = `→ Feed #${exploit.target.FeedSlot + 1}`;
                } else if (exploit.target === 'EnemyKitchen') {
                  targetDesc = '→ Kitchen';
                }
              }

              return (
                <div key={idx} className="exploit-notification-item">
                  <span className="exploit-icon">⚡</span>
                  <span>{cardName} {targetDesc}</span>
                </div>
              );
            })}
          </div>
          <div className="notification-hint">tap to dismiss</div>
        </div>
      )}
      {/* Floating drag preview for exploits */}
      {isPointerDragging && draggingCard && draggingCard.kind === 'Exploit' && dragPosition && (
        <div
          className="floating-exploit-preview"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
          }}
        >
          <div className="exploit-preview-card">
            <span className="exploit-preview-icon">⚡</span>
            <span className="exploit-preview-name">{draggingCard.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
