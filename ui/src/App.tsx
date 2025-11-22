import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
  ability?: string;
  yieldBonus?: string;
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
  ability?: string;
  yieldRate?: number;
  location: 'hand' | 'kitchen' | 'feed';
  owner: Seat;
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
      ability: abilityText,
      yieldBonus: meme.yield_rate ? `+${meme.yield_rate} feed` : undefined,
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
    ability: abilityLabel(effect),
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

const mapInstanceToLiveCard = (instance: CardInstance): LiveCard => {
  const kind: 'Meme' | 'Exploit' = 'Meme' in (instance.class as any) ? 'Meme' : 'Exploit';
  const card: LiveCard = {
    id: instance.instance_id,
    variantId: instance.variant_id,
    name: instance.name,
    cost: instance.cost,
    baseVirality: instance.base_virality,
    currentVirality: instance.current_virality,
    kind,
    role: kind,
    ability: undefined,
    yieldRate: instance.yield_rate,
    location: locationToUi(instance.location),
    owner: instance.owner as Seat,
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
    callBased,
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
  const [basedModalSeenTurn, setBasedModalSeenTurn] = useState<number | null>(null);
  const [isEndingTurn, setIsEndingTurn] = useState(false);
  const [hoverZone, setHoverZone] = useState<'feed' | 'kitchen' | null>(null);
  const [holdTargets, setHoldTargets] = useState<{ feed: boolean; kitchen: boolean; enemy: boolean }>({
    feed: false,
    kitchen: false,
    enemy: false,
  });
  const [noPlayCardId, setNoPlayCardId] = useState<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [heldCard, setHeldCard] = useState<string | null>(null);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  const feedZoneRef = useRef<HTMLDivElement | null>(null);
  const kitchenZoneRef = useRef<HTMLDivElement | null>(null);
  const isRevealingRef = useRef<boolean>(false);

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
  const myPlayer: BackendPlayerState | undefined = useMemo(
    () => game?.players.find((p) => p.seat === mySeat),
    [game, mySeat],
  );
  const opponentPlayer: BackendPlayerState | undefined = useMemo(
    () => game?.players.find((p) => p.seat !== mySeat),
    [game, mySeat],
  );

  const feedCards: LiveCard[] = useMemo(
    () => (game ? game.feed.map((card) => mapInstanceToLiveCard(card)) : []),
    [game],
  );
  const playerKitchen = useMemo(
    () => (myPlayer ? myPlayer.kitchen.map((card) => mapInstanceToLiveCard(card)) : []),
    [myPlayer],
  );
  const enemyKitchen = useMemo(
    () => (opponentPlayer ? opponentPlayer.kitchen.map((card) => mapInstanceToLiveCard(card)) : []),
    [opponentPlayer],
  );
  const playerHand = useMemo(
    () => (myPlayer ? myPlayer.hand.map((card) => mapInstanceToLiveCard(card)) : []),
    [myPlayer],
  );
  const draggingCard = useMemo(
    () =>
      draggingId
        ? playerHand.find((c) => c.id === draggingId) ||
          playerKitchen.find((c) => c.id === draggingId) ||
          null
        : null,
    [draggingId, playerHand, playerKitchen],
  );
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
    !!game && !!nodeId && !!game.pending_stakes && game.pending_stakes !== nodeId;
  const showBasedModal =
    opponentCalledBased && game && (basedModalSeenTurn === null || basedModalSeenTurn < game.turn);

  const getExploitEffect = (card: LiveCard) => {
    if (card.kind !== 'Exploit') return null;
    const def = catalogById.get(card.variantId);
    if (!def) return null;
    const effect = (def.class as any).Exploit;
    return effect ?? null;
  };

  const getExploitKind = (effect: any): string => {
    if (!effect) return '';
    if (typeof effect === 'string') return effect;
    const key = Object.keys(effect)[0];
    return key ?? '';
  };

  const getExploitTargetProfile = (effect: any) => {
    const kind = getExploitKind(effect);
    const profile = {
      enemyKitchenCard: false,
      enemyFeedCard: false,
      allyKitchenCard: false,
      allyFeedCard: false,
      feedSlot: false,
      enemyKitchenZone: false,
      feedZone: false,
      requiresTarget: true,
    };
    switch (kind) {
      case 'Damage':
        profile.enemyKitchenCard = true;
        profile.enemyFeedCard = true;
        profile.feedSlot = true;
        break;
      case 'AreaDamageKitchen':
        profile.enemyKitchenZone = true;
        profile.requiresTarget = false;
        break;
      case 'Boost':
      case 'Protect':
      case 'Double':
        profile.allyKitchenCard = true;
        profile.allyFeedCard = true;
        break;
      case 'Debuff':
      case 'Execute':
      case 'Silence':
        profile.enemyKitchenCard = true;
        profile.enemyFeedCard = true;
        break;
      case 'PinSlot':
      case 'MoveUp':
      case 'NukeBelow':
        profile.feedSlot = true;
        break;
      case 'LockFeed':
        profile.feedZone = true;
        profile.requiresTarget = false;
        break;
      case 'Tax':
      case 'ManaBurn':
        profile.enemyKitchenZone = true;
        profile.requiresTarget = false;
        break;
      case 'ShuffleFeed':
      case 'WipeBottom':
        profile.feedZone = true;
        profile.requiresTarget = false;
        break;
      case 'ResurrectLast':
      case 'SpawnShitposts':
      case 'DiscountNext':
        profile.requiresTarget = false;
        break;
      default:
        break;
    }
    return profile;
  };

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
    if (basedModalSeenTurn !== null && game.turn > basedModalSeenTurn) {
      setBasedModalSeenTurn(null);
    }
  }, [game?.turn, game, basedTurnCalled, basedModalSeenTurn]);

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
    if (!showBasedModal || !game) return;
    setBasedModalSeenTurn(game.turn);
    const key = Date.now();
    setBasedModalPulse(key);
    const timer = window.setTimeout(() => {
      setBasedModalPulse((curr) => (curr === key ? null : curr));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [showBasedModal, game]);

  const filteredLobbies = useMemo(() => {
    if (!lobbyQuery.trim()) return lobbies;
    return lobbies.filter(
      (lobby) =>
        lobby.host.toLowerCase().includes(lobbyQuery.toLowerCase()) ||
        lobby.description.toLowerCase().includes(lobbyQuery.toLowerCase()),
    );
  }, [lobbies, lobbyQuery]);

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
      flashNoPlay(cardId);
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
      flashNoPlay(cardId);
      return;
    }
    setDraftPlan((prev) => {
      if (prev.posts.find((p) => p.card_id === cardId)) return prev;
      return { ...prev, posts: [...prev.posts, { card_id: cardId }] };
    });
  };

  const canUseExploitOnCard = (exploit: LiveCard, targetCard: LiveCard) => {
    const profile = getExploitTargetProfile(getExploitEffect(exploit));
    const isEnemy = targetCard.owner !== mySeat;
    const inFeed = targetCard.location === 'feed';
    const inKitchen = targetCard.location === 'kitchen';
    if (isEnemy) {
      if (inKitchen && profile.enemyKitchenCard) return true;
      if (inFeed && profile.enemyFeedCard) return true;
    } else {
      if (inKitchen && profile.allyKitchenCard) return true;
      if (inFeed && profile.allyFeedCard) return true;
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
    if (!draggingId) return;
    const exploit = playerHand.find((c) => c.id === draggingId && c.kind === 'Exploit');
    if (!exploit) return;
    if (planLocked) {
      flashNoPlay(exploit.id);
      return;
    }
    const meta = getPlayableMeta(exploit);
    if (!meta.canPlay) {
      flashNoPlay(exploit.id);
      return;
    }
    if (!canUseExploitOnCard(exploit, targetCard)) {
      flashNoPlay(exploit.id);
      return;
    }
    queueExploit(exploit.id, { Card: targetCard.id });
  };

  const planExploitOnFeedSlot = (slot: number) => {
    if (!draggingId) return;
    const exploit = playerHand.find((c) => c.id === draggingId && c.kind === 'Exploit');
    if (!exploit) return;
    if (planLocked) {
      flashNoPlay(exploit.id);
      return;
    }
    const meta = getPlayableMeta(exploit);
    const profile = getExploitTargetProfile(getExploitEffect(exploit));
    if (!meta.canPlay || !profile.feedSlot || !canUseExploitOnSlot(exploit)) {
      flashNoPlay(exploit.id);
      return;
    }
    queueExploit(exploit.id, { FeedSlot: slot });
  };

  const planExploitZoneEnemyKitchen = () => {
    if (!draggingId) return;
    const exploit = playerHand.find((c) => c.id === draggingId && c.kind === 'Exploit');
    if (!exploit) return;
    if (planLocked) {
      flashNoPlay(exploit.id);
      return;
    }
    const meta = getPlayableMeta(exploit);
    if (!meta.canPlay) {
      flashNoPlay(exploit.id);
      return;
    }
    const profile = getExploitTargetProfile(getExploitEffect(exploit));
    if (!profile.enemyKitchenZone) {
      flashNoPlay(exploit.id);
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

  const flashNoPlay = (cardId?: string) => {
    const targetId = cardId ?? heldCard;
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
      const feedTargeting = profile.feedSlot || profile.feedZone || profile.enemyFeedCard || profile.allyFeedCard;
      const enemyTargeting = profile.enemyKitchenCard || profile.enemyFeedCard || profile.enemyKitchenZone;
      const kitchenTargeting = profile.allyKitchenCard;
      return {
        canPlay: mana >= costWithDiscount(card) && hasTarget,
        targets: { kitchen: kitchenTargeting, feed: feedTargeting, enemy: enemyTargeting },
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
      flashNoPlay(card.id);
    }, 220);
  };

  const onDragStart = (cardId: string, source: 'hand' | 'kitchen') => (event: DragEvent) => {
    setDraggingId(cardId);
    setIsPointerDragging(false);
    event.dataTransfer.setData('text/plain', cardId);
  };

  const onDragEnd = () => {
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
        flashNoPlay(draggingId);
      }
      setHoverZone(null);
      setDraggingId(null);
      setIsPointerDragging(false);
      endHoldPreview();
    };
    const handlePointerMove = () => {
      clearHoldTimer();
      setIsPointerDragging(true);
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [isPointerDragging, draggingId, hoverZone]);

  const performDrop = (zone: 'feed' | 'kitchen', cardId: string) => {
    if (planLocked) {
      flashNoPlay(cardId);
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
      flashNoPlay(cardId);
      return;
    }
    scrubFromPlan(cardId);
    if (zone === 'kitchen') {
      dropToKitchen(cardId);
    } else {
      if (card.kind === 'Exploit') {
        flashNoPlay(cardId);
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
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain') || draggingId;
    if (!cardId) return;
    if (planLocked) {
      flashNoPlay(cardId);
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
      flashNoPlay(cardId);
      return;
    }
    const card =
      playerHand.find((c) => c.id === cardId) || playerKitchen.find((c) => c.id === cardId) || null;
    if (card && card.kind === 'Exploit') {
      const profile = getExploitTargetProfile(getExploitEffect(card));
      const meta = getPlayableMeta(card);
      if (meta.canPlay && profile.feedZone) {
        queueExploit(card.id, null);
      } else {
        flashNoPlay(card.id);
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
    event.preventDefault();
    if (planLocked) return;
    if (!draggingCard || draggingCard.kind !== 'Exploit') {
      flashNoPlay();
      return;
    }
    const profile = getExploitTargetProfile(getExploitEffect(draggingCard));
    const meta = getPlayableMeta(draggingCard);
    if (!meta.canPlay) {
      flashNoPlay(draggingCard.id);
      return;
    }
    if (profile.enemyKitchenZone) {
      planExploitZoneEnemyKitchen();
    } else {
      flashNoPlay(draggingCard.id);
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

    // Set the flag immediately to prevent double-clicks
    console.log('🔒 Setting isEndingTurn to true');
    setIsEndingTurn(true);

    try {
      const salt = crypto.randomUUID();
      const plan = { ...draftPlan };
      console.log('📤 Committing turn', {
        turn: game.turn,
        planActions: {
          kitchen: plan.plays_to_kitchen.length,
          posts: plan.posts.length,
          exploits: plan.exploits.length
        }
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

  const handleCallBased = async () => {
    if (!game || !mySeat) return;
    if (basedButtonDisabled) return;
    setBasedTurnCalled(game.turn);
    triggerRipple(setBasedPulseKey);
    await callBased(mySeat);
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
          <div
            key={`full-${card.id}`}
            className={`hand-card surface ${queuedToKitchen.has(card.id) || queuedExploits.has(card.id) ? 'queued' : ''} ${
              draggingId === card.id ? 'dragging' : ''
            } ${noPlayCardId === card.id ? 'no-play' : ''}`}
            draggable
            onDragStart={(e) => {
              if (planLocked) {
                e.preventDefault();
                flashNoPlay(card.id);
                return;
              }
              endHoldPreview();
              onDragStart(card.id, 'hand')(e);
            }}
            onDragEnd={onDragEnd}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault();
              if (planLocked) {
                flashNoPlay(card.id);
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
          </div>
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
  ) => (
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
        {cards.map((card) => (
          <div
            key={card.id}
            className={`kitchen-card surface ${queuedPosts.has(card.id) ? 'queued' : ''} ${
              draggingId === card.id ? 'dragging' : ''
            } ${noPlayCardId === card.id ? 'no-play' : ''}`}
            draggable={tone === 'green'}
            onDragOver={(e) => {
              const draggingExploit =
                draggingCard && draggingCard.kind === 'Exploit' && draggingCard.location === 'hand';
              if (draggingExploit && draggingId && draggingCard && canUseExploitOnCard(draggingCard, card)) {
                e.preventDefault();
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const draggingExploit =
                draggingCard && draggingCard.kind === 'Exploit' && draggingCard.location === 'hand';
              if (draggingExploit && draggingCard) {
                planExploitOnCard(card);
                setHoverZone(null);
                endHoldPreview();
                return;
              }
            }}
            onDragStart={
              tone === 'green'
                ? (e) => {
                    if (planLocked) {
                      e.preventDefault();
                      flashNoPlay(card.id);
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
                    if (planLocked) {
                      flashNoPlay(card.id);
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
            onPointerLeave={tone === 'green' ? endHoldPreview : undefined}
            onClick={() => {
              if (isPointerDragging) return;
              handleInspectCard(card);
            }}
          >
            <div className="card-top">
              <span className="pill quiet">{card.cost}</span>
              <span className="pill quiet">{card.currentVirality}</span>
            </div>
            <p className="card-name">{card.name}</p>
          </div>
        ))}
        {planned.map((card) => (
          <div key={`plan-${card.id}`} className={`kitchen-card surface pending ${planLocked ? 'locked' : ''}`}>
            <div className="card-top">
              <span className="pill quiet">{card.cost}</span>
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
          </div>
        ))}
        {cards.length === 0 && planned.length === 0 && <p className="muted small">Empty</p>}
      </div>
    </div>
  );

  const playerScore = myPlayer?.score ?? 0;
  const opponentScore = opponentPlayer?.score ?? 0;
  const scoreTarget = Math.max(playerScore, opponentScore, 100);
  const playerPct = scoreTarget === 0 ? 0 : Math.min(100, Math.round((playerScore / scoreTarget) * 100));
  const opponentPct = scoreTarget === 0 ? 0 : Math.min(100, Math.round((opponentScore / scoreTarget) * 100));
  const planHasActions =
    draftPlan.plays_to_kitchen.length + draftPlan.posts.length + draftPlan.exploits.length > 0;
  const basedCalledThisTurn = game && basedTurnCalled !== null ? basedTurnCalled === game.turn : false;
  const basedButtonDisabled =
    planLocked || waitingForOpponent || isResolving || !planHasActions || basedCalledThisTurn || !!game?.pending_stakes;
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
            <button
              className={`based-btn compact ${basedButtonDisabled ? 'disabled' : ''}`}
              onClick={handleCallBased}
              disabled={basedButtonDisabled}
            >
              BASED
            </button>
            <button className="icon-btn tiny" aria-label="Settings" onClick={() => setShowSettingsModal(true)}>
              <Icon name="settings" size={16} />
            </button>
          </div>
        </div>
      </header>
      {game?.winner && (
        <div className="winner-banner surface">
          <p className="card-name">
            {game.winner === mySeat ? 'You win!' : 'Opponent wins.'} Stakes x{stakesMultiplier}
          </p>
        </div>
      )}

      <div className="duel-stage">
        <section className="playfield surface">
          <div
            className={`lane enemy-lane ${holdTargets.enemy ? 'hold-hot' : ''} ${
              hoverZone === 'feed' ? 'drop-hot' : ''
            }`}
            onDragOver={(e) => {
              const allowZone =
                draggingCard &&
                draggingCard.kind === 'Exploit' &&
                draggingCard.location === 'hand' &&
                getExploitTargetProfile(getExploitEffect(draggingCard)).enemyKitchenZone &&
                getPlayableMeta(draggingCard).canPlay;
              if (allowZone || canHoverZone('feed')) {
                e.preventDefault();
                setHoverZone('feed');
              }
            }}
            onDragLeave={() => setHoverZone(null)}
            onPointerEnter={() => canHoverZone('feed') && onPointerEnterZone('feed')()}
            onPointerLeave={onPointerLeaveZone}
            onDrop={handleEnemyKitchenDrop}
          >
            {renderKitchenRow(
              enemyKitchen,
              'red',
              'Enemy Kitchen',
              undefined,
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
            <div className="feed-prompt">What’s happening?</div>
            <div className="feed-stack">
              {feedCards.map((card, idx) => (
                <div
                  key={card.id}
                  className={`feed-pill surface ${card.owner === mySeat ? 'mine' : 'enemy'}`}
                  onClick={() => handleInspectCard(card)}
                  onContextMenu={(e) => e.preventDefault()}
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
                        flashNoPlay(draggingCard.id);
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
                </div>
              ))}
              {plannedFeedPosts.map((card, idx) => (
                <div
                  key={`plan-feed-${card.id}-${idx}`}
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
                </div>
              ))}
              {plannedExploits.map((card, idx) => (
                <div
                  key={`plan-ex-${card.id}-${idx}`}
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
                </div>
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
              e.preventDefault();
              if (canHoverZone('kitchen')) setHoverZone('kitchen');
            }}
            onDragLeave={() => setHoverZone(null)}
            onDrop={handleKitchenDrop}
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
      <div className="modal-overlay" onClick={closeAllModals}>
        <div className="modal-card surface" onClick={(e) => e.stopPropagation()}>
          <p className="muted small center">Tap anywhere to close</p>
          <div className="big-card">
            {'variantId' in modalCard ? (
              <>
                <span className="cost-badge">{(modalCard as LiveCard).cost}</span>
                <h3>{modalCard.name}</h3>
                <p className="muted small">
                  {(modalCard as LiveCard).kind.toUpperCase()} • {(modalCard as LiveCard).role}
                </p>
                <div className="stats-box">
                  <p>Base Virality: {(modalCard as LiveCard).baseVirality}</p>
                  <p>Current: {(modalCard as LiveCard).currentVirality}</p>
                  {(modalCard as LiveCard).ability && <p className="ability">{(modalCard as LiveCard).ability}</p>}
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
                <div className="stats-box">
                  <p>Virality: {(modalCard as UICardDefinition).virality}</p>
                  {(modalCard as UICardDefinition).yieldBonus && <p>{(modalCard as UICardDefinition).yieldBonus}</p>}
                  {(modalCard as UICardDefinition).ability && (
                    <p className="ability">{(modalCard as UICardDefinition).ability}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );

  const renderSearchModal = () => {
    if (searchContext === 'none') return null;
    if (searchContext === 'lobby') {
      return (
        <div className="modal-overlay" onClick={closeAllModals}>
          <div className="search-modal surface" onClick={(e) => e.stopPropagation()}>
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
        <div className="modal-overlay" onClick={closeAllModals}>
          <div className="search-modal surface" onClick={(e) => e.stopPropagation()}>
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
        <div className="modal-overlay" onClick={closeAllModals}>
          <div className="search-modal surface" onClick={(e) => e.stopPropagation()}>
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
      <div className="modal-overlay" onClick={() => setShowHostModal(false)}>
        <div className="search-modal surface" onClick={(e) => e.stopPropagation()}>
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
      <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
        <div className="search-modal surface" onClick={(e) => e.stopPropagation()}>
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
      <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal surface based-modal">
          <h3>Opponent called BASED: double-or-nothing.</h3>
          <div className="stack">
            <button
              className="save-btn"
              onClick={async () => {
                triggerRipple(setBasedPulseKey);
                await acceptBased(mySeat ?? 'Host');
              }}
            >
              BASED (Double)
            </button>
            <button
              className="ghost-btn compact danger"
              onClick={async () => {
                triggerRipple(setBasedPulseKey);
                await foldBased(mySeat ?? 'Host');
              }}
            >
              Withdraw
            </button>
          </div>
          <p className="muted small">Stakes: x{stakesMultiplier * 2}</p>
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
      {renderModalCard()}
      {basedPulseKey && <div key={basedPulseKey} className="based-ripple" />}
      {basedModalPulse && <div key={`modal-${basedModalPulse}`} className="based-ripple modal-ripple" />}
    </div>
  );
}

export default App;
