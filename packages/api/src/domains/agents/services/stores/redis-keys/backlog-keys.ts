export const BacklogKeys = {
  detail: (id: string) => `backlog:item:${id}`,
  userList: (userId: string) => `backlog:items:user:${userId}`,
  dispatchLock: (itemId: string) => `backlog:dispatch-lock:${itemId}`,
} as const;
