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
export function avoidMovingOre(start:Vertex,angle:number,asteroids:Asteroid[],radius:number){
 const ux=Math.cos(angle),uy=Math.sin(angle),look=110+radius;let nearest=Infinity,turn=0;
 for(const rock of asteroids){if(!rock.motion&&Math.hypot(rock.vx,rock.vy)<.2)continue;const dx=rock.x+rock.vx*.4-start.x,dy=rock.y+rock.vy*.4-start.y,along=dx*ux+dy*uy;
  if(along<=0||along>look||along>=nearest)continue;const side=dx*uy-dy*ux;if(Math.abs(side)>rock.radius+radius+18)continue;nearest=along;turn=side>=0?.8:-.8;
 }
 return angle+turn;
}
