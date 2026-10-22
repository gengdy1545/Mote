export type Card = {
  vocId: string;
  spelling: string;
  order: number;
};

export type PracticeState = {
  accountKey: string;
  studyDay: string;
  cards: Card[];
  index: number;
  revealed: boolean;
};

export type StoredSession = {
  accountKey: string;
  studyDay: string;
  queue: string[];
  index: number;
};

function sortCards(cards: Card[]): Card[] {
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
}): { state: PracticeState; queueReset: boolean } {
  const cards = sortCards(input.cards);
  const queue = queueOf(cards);
  const base: PracticeState = {
    accountKey: input.accountKey,
    studyDay: input.studyDay,
    cards,
    index: 0,
    revealed: false,
  };
  if (cards.length === 0) return { state: base, queueReset: false };

  const previous = input.previous;
  const sameContext =
    previous !== null && previous.accountKey === input.accountKey && previous.studyDay === input.studyDay;
  if (!sameContext || previous === null) return { state: base, queueReset: false };

  if (!sameQueue(previous.queue, queue)) {
    return { state: base, queueReset: true };
  }

  const index = Math.min(cards.length - 1, Math.max(0, previous.index));
  return {
    state: { ...base, index },
    queueReset: false,
  };
}

export function hide(state: PracticeState): PracticeState {
  if (!state.revealed) return state;
  return { ...state, revealed: false };
}

export function reveal(state: PracticeState): PracticeState {
  const card = state.cards[state.index];
  if (!card || state.revealed) return state;
  return { ...state, revealed: true };
}

export function jump(state: PracticeState, position: number): PracticeState {
  if (!Number.isInteger(position) || position < 1 || position > state.cards.length) return state;
  const nextIndex = position - 1;
  if (nextIndex === state.index) return state;
  return { ...state, index: nextIndex, revealed: false };
}

export function move(state: PracticeState, delta: -1 | 1): PracticeState {
  const nextIndex = state.index + delta;
  if (nextIndex < 0 || nextIndex >= state.cards.length) return state;
  return { ...state, index: nextIndex, revealed: false };
}

export function currentCard(state: PracticeState): Card | null {
  return state.cards[state.index] ?? null;
}

