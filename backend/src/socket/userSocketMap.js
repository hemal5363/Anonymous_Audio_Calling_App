/**
 * In-memory map of userId <-> socketId for active online sockets.
 * Provides bidirectional mapping and clean disconnect handling.
 */
class UserSocketMap {
  constructor() {
    // userId -> socketId
    this.userToSocket = new Map();
    // socketId -> userId
    this.socketToUser = new Map();
  }

  /**
   * Set or update user-to-socket mapping.
   * If the user already had another socket connected, cleans up the stale reverse mapping.
   */
  set(userId, socketId) {
    const existingSocketId = this.userToSocket.get(userId);
    if (existingSocketId && existingSocketId !== socketId) {
      this.socketToUser.delete(existingSocketId);
    }
    this.userToSocket.set(userId, socketId);
    this.socketToUser.set(socketId, userId);
  }

  /**
   * Remove mapping cleanly by socketId on disconnect.
   * Ensures that if the user already reconnected on a newer socket,
   * the newer socket is not deleted accidentally.
   */
  removeBySocketId(socketId) {
    const userId = this.socketToUser.get(socketId);
    if (userId) {
      this.socketToUser.delete(socketId);
      if (this.userToSocket.get(userId) === socketId) {
        this.userToSocket.delete(userId);
      }
      return userId;
    }
    return null;
  }

  /**
   * Remove mapping explicitly by userId.
   */
  removeByUserId(userId) {
    const socketId = this.userToSocket.get(userId);
    if (socketId) {
      this.userToSocket.delete(userId);
      this.socketToUser.delete(socketId);
      return socketId;
    }
    return null;
  }

  /**
   * Retrieve socket ID for a given user ID
   */
  getSocketId(userId) {
    return this.userToSocket.get(userId) || null;
  }

  /**
   * Retrieve user ID for a given socket ID
   */
  getUserId(socketId) {
    return this.socketToUser.get(socketId) || null;
  }

  /**
   * Check if user is currently connected via socket
   */
  hasUser(userId) {
    return this.userToSocket.has(userId);
  }

  /**
   * Check if socket is registered
   */
  hasSocket(socketId) {
    return this.socketToUser.has(socketId);
  }

  /**
   * Return an array of all currently connected user IDs (for fast matching priority)
   */
  getOnlineUserIds() {
    return Array.from(this.userToSocket.keys());
  }

  /**
   * Return total count of online connected users
   */
  getOnlineCount() {
    return this.userToSocket.size;
  }

  /**
   * Clear all mappings (useful for testing)
   */
  clear() {
    this.userToSocket.clear();
    this.socketToUser.clear();
  }
}

export const userSocketMap = new UserSocketMap();
