export type Author = 'self' | 'peer';

export interface User {
  id: string;
  name: string;
}

export interface Message {
  id: string;
  author: Author;
  text: string;
  /** Unix epoch in milliseconds */
  timestamp: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** Result of asking the backend whether an invite link still works. */
export type SessionCheck = 'valid' | 'expired' | 'invalid' | 'full';
