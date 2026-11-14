import { ensureAsteroidGeometry,asteroidLocal, type Asteroid } from './mining.ts';
import { containsPoint,segmentPolygonHit, type Vertex } from './asteroidGeometry.ts';
export function clearLineOfSight(start: Vertex, end: Vertex, asteroids: Asteroid[]) {
  const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-8) return true;
  for (const asteroid of asteroids) {
    const t = Math.max(0, Math.min(1, ((asteroid.x - start.x) * dx + (asteroid.y - start.y) * dy) / lengthSquared));
    if ((start.x + dx * t - asteroid.x) ** 2 + (start.y + dy * t - asteroid.y) ** 2 > asteroid.radius ** 2) continue;
    const vertices = ensureAsteroidGeometry(asteroid).vertices;
    const local=asteroidLocal(asteroid,start);
    if(containsPoint(local,vertices)||segmentPolygonHit(ensureAsteroidGeometry(asteroid),local,asteroidLocal(asteroid,end)))return false;
  }
  return true;
}

/** Existing flight behavior receives a local steering angle around moving rocks. */
export function avoidMovingOre(start:Vertex,angle:number,asteroids:Asteroid[],radius:number,includeStatic=false){
 const ux=Math.cos(angle),uy=Math.sin(angle),look=110+radius;let nearest=Infinity,turn=0;
 for(const rock of asteroids){if(!includeStatic&&!rock.motion&&Math.hypot(rock.vx,rock.vy)<.2)continue;const dx=rock.x+rock.vx*.4-start.x,dy=rock.y+rock.vy*.4-start.y,along=dx*ux+dy*uy;
  if(along<=0||along>look||along>=nearest)continue;const side=dx*uy-dy*ux;if(Math.abs(side)>rock.radius+radius+18)continue;nearest=along;turn=side>=0?.8:-.8;
 }
 return angle+turn;
}

export type EnemyState = 'mine'|'collect'|'escort'|'patrol' | 'investigate' | 'chase' | 'attack' | 'strafe' | 'retreat' | 'reposition' | 'defend' | 'return';
export type EnemySituation = {
  /** Player is inside detection range with a clear line of sight. */
  visible: boolean;
  /** Recently damaged by this target; pursue beyond normal detection. */
  provoked?: boolean;
  /** A last-known player position is still remembered. */
  remembers: boolean;
  inRange: boolean;
  /** Territory guard whose target has left its territory. */
  leashed: boolean;
  /** Away from its squad slot or guard post. */
  awayFromPost: boolean;
  guard: boolean;
  /** Class strafes hard enough to count as a strafing run rather than a standing attack. */
  strafes: boolean;
  /** Backing off while a slow weapon reloads. */
  reloading: boolean;
  retreating: boolean;
  /** Sidestepping after being blocked. */
  repositioning: boolean;
};
/** Pure state selection, highest priority first. Movement and fire for each state live in the model. */
export function nextEnemyState(s: EnemySituation): EnemyState {
  if (s.leashed) return s.awayFromPost ? 'return' : 'patrol';
  if (s.retreating) return 'retreat';
  if (s.repositioning && (s.visible || s.remembers)) return 'reposition';
  if (s.visible) {
    if (!s.inRange) return 'chase';
    if (s.reloading) return 'reposition';
    if (s.guard) return 'defend';
    return s.strafes ? 'strafe' : 'attack';
  }
  if (s.provoked) return 'chase';
  if (s.remembers) return 'investigate';
  return s.awayFromPost ? 'return' : 'patrol';
}
