import { GameModel } from './model.ts';
export const SAVE_KEY = 'voidforge.save.v1';
export function loadSavedGame(): GameModel | null {
  try { const text = localStorage.getItem(SAVE_KEY); return text ? GameModel.fromSave(JSON.parse(text)) : null; }
  catch { return null; }
}
export function saveGame(model: GameModel): string | undefined {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(model.toSave())); }
  catch { return 'Save failed: browser storage is unavailable or full. Export a save file instead.'; }
}
export function backupSavedGame() {
  try { const text = localStorage.getItem(SAVE_KEY); if (text) localStorage.setItem('voidforge.save.backup', text); } catch { /* Export remains available. */ }
}
