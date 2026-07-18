function getJoinedRoomsStorageKey(userId: string): string {
  const normalizedUserId = userId.trim() || 'anonymous';
  return `agent-studio:ws:joined-rooms:v1:${normalizedUserId}`;
}

function isThreadRoom(room: unknown): room is string {
  return typeof room === 'string' && room.startsWith('thread:');
}

export function loadJoinedRoomsFromSession(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const raw = window.sessionStorage.getItem(getJoinedRoomsStorageKey(userId));
  if (!raw) return new Set();

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isThreadRoom));
  } catch (error) {
    console.warn('[ws] Failed to parse persisted rooms, resetting cache', { error });
    window.sessionStorage.removeItem(getJoinedRoomsStorageKey(userId));
    return new Set();
  }
}

export function saveJoinedRoomsToSession(userId: string, rooms: Set<string>): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(getJoinedRoomsStorageKey(userId), JSON.stringify([...rooms]));
}
