export interface EmojiGroup {
  label: string;
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  { label: 'Story', emojis: ['⚔️', '🛡️', '💀', '👑', '🏰', '🗡️', '🔮', '📜', '🏴', '🎭'] },
  { label: 'Emotion', emojis: ['❤️', '💔', '😢', '😠', '😱', '🤝', '💤', '🔥', '✨', '💫'] },
  { label: 'Nature', emojis: ['🌙', '☀️', '⛈️', '🌊', '🏔️', '🌲', '🐉', '🐺', '🦅', '🕷️'] },
  { label: 'Objects', emojis: ['💎', '🗝️', '📖', '🏹', '⚓', '🔔', '🕯️', '💰', '🧪', '⏳'] },
  { label: 'Symbols', emojis: ['⭐', '🔴', '🟢', '🔵', '⚫', '⬛', '🔺', '💠', '🎯', '🚩'] },
];
