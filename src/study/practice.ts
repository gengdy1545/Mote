export type Card = {
  vocId: string;
  spelling: string;
  order: number;
  isNew: boolean;
  isFinished: boolean;
  firstResponse?: string;
};

export type PracticeStatus = "empty" | "practicing" | "paused" | "completed";

export type PracticeState = {
  accountKey: string;
  studyDay: string;
  cards: Card[];
  index: number;
  revealed: boolean;
  revealedIds: string[];
  status: PracticeStatus;
  limit: number | null;
  origin: number;
};

export type StoredSession = {
  accountKey: string;
  studyDay: string;
  queue: string[];
  index: number;
  status: "active" | "completed";
  revealed: string[];
};

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) => a.order - b.order || a.spelling.localeCompare(b.spelling) || a.vocId.localeCompare(b.vocId),
  );
}

export function queueOf(cards: Card[]): string[] {
  return cards.map((card) => card.vocId);
}

function sameQueue(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function startPractice(input: {
  accountKey: string;
  studyDay: string;
  cards: Card[];
  previous: StoredSession | null;
  revealedIds: string[];
  limit: number | null;
}): { state: PracticeState; queueReset: boolean } {
  const cards = sortCards(input.cards);
  const queue = queueOf(cards);
  const base: PracticeState = {
    accountKey: input.accountKey,
    studyDay: input.studyDay,
    cards,
    index: 0,
    revealed: false,
    revealedIds: [...new Set(input.revealedIds)],
    status: cards.length === 0 ? "empty" : "practicing",
    limit: input.limit,
    origin: 0,
  };
  if (base.status === "empty") return { state: base, queueReset: false };

  const previous = input.previous;
  const sameContext =
    previous !== null && previous.accountKey === input.accountKey && previous.studyDay === input.studyDay;
  if (!sameContext || previous === null) return { state: base, queueReset: false };

  if (!sameQueue(previous.queue, queue)) {
    return { state: base, queueReset: true };
  }

  const index = Math.min(cards.length - 1, Math.max(0, previous.index));
  return {
    state: { ...base, index, origin: index },
    queueReset: false,
  };
}

export function hide(state: PracticeState): PracticeState {
  if (state.status !== "practicing" || !state.revealed) return state;
  return { ...state, revealed: false };
}

export function reveal(state: PracticeState): PracticeState {
  if (state.status !== "practicing") return state;
  const card = state.cards[state.index];
  if (!card || state.revealed) return state;
  const seen = state.revealedIds.includes(card.vocId);
  return {
    ...state,
    revealed: true,
    revealedIds: seen ? state.revealedIds : [...state.revealedIds, card.vocId],
  };
}

export function jump(state: PracticeState, position: number): PracticeState {
  if (state.status !== "practicing") return state;
  if (!Number.isInteger(position) || position < 1 || position > state.cards.length) return state;
  const nextIndex = position - 1;
  if (nextIndex === state.index) return state;
  // The next run resumes on the card this run did not open.
  if (state.limit !== null && nextIndex >= state.origin + state.limit) {
    return { ...state, index: nextIndex, revealed: false, status: "paused" };
  }
  return { ...state, index: nextIndex, revealed: false };
}

export function move(state: PracticeState, delta: -1 | 1): PracticeState {
  if (state.status !== "practicing") return state;
  const nextIndex = state.index + delta;
  if (nextIndex < 0 || nextIndex >= state.cards.length) return state;
  // The next run resumes on the card this run did not open.
  if (delta > 0 && state.limit !== null && nextIndex >= state.origin + state.limit) {
    return { ...state, index: nextIndex, revealed: false, status: "paused" };
  }
  return { ...state, index: nextIndex, revealed: false };
}

export function quit(state: PracticeState): PracticeState {
  if (state.status !== "practicing") return state;
  return { ...state, status: "paused" };
}

export function currentCard(state: PracticeState): Card | null {
  if (state.status === "empty" || state.status === "completed") return null;
  return state.cards[state.index] ?? null;
}

