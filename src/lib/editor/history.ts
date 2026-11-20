export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export const MAX_HISTORY_ENTRIES = 50;

export function createHistory<T>(initial: T): HistoryState<T> {
  return {
    past: [],
    present: initial,
    future: [],
  };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}

export function pushHistory<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  if (Object.is(history.present, next)) {
    return history;
  }
  const nextPast = [...history.past, history.present];
  if (nextPast.length > MAX_HISTORY_ENTRIES) {
    nextPast.shift();
  }
  return {
    past: nextPast,
    present: next,
    future: [],
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  return {
    past: nextPast,
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  const nextFuture = history.future.slice(1);
  return {
    past: [...history.past, history.present],
    present: next,
    future: nextFuture,
  };
}
