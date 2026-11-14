/// <reference types="vite/client" />
import type {MusicState} from './musicState.ts';
// Exact local filenames, discovered before integration. Missing categories remain empty.
const files=import.meta.glob('./Background Music/*.mp3',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
export const MUSIC_TRACKS:Record<MusicState,string[]>={
menu:[files['./Background Music/The Last Forge — Main Menu Theme.mp3']].filter(Boolean),
mining:[files['./Background Music/Deep Space Mining — Main Gameplay Music 1.mp3'],files['./Background Music/Deep Space Mining — Main Gameplay Music 2.mp3']].filter(Boolean),
exploration:[files['./Background Music/The Shattered Expanse — Exploration Theme 1.mp3'],files['./Background Music/The Shattered Expanse — Exploration Theme 2.mp3']].filter(Boolean),
station:[files['./Background Music/Forge-01 — Station and Shipbuilding Theme 1.mp3'],files['./Background Music/Forge-01 — Station and Shipbuilding Theme 2.mp3']].filter(Boolean),
pve:[files['./Background Music/Hostile Sector — Combat Music 1.mp3']].filter(Boolean),
pvp:[files['./Background Music/No Mercy in the Void — PvP Combat Theme 1.mp3'],files['./Background Music/No Mercy in the Void — PvP Combat Theme 2.mp3']].filter(Boolean),
boss:[files['./Background Music/The Shattering — Boss Battle Theme 1.mp3'],files['./Background Music/The Shattering — Boss Battle Theme 2.mp3']].filter(Boolean),
};
export const MUSIC_FALLBACK=new URL('./Deep Space Patrol.mp3',import.meta.url).href;