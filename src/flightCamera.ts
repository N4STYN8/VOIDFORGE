/** Unrotated flight-camera projection from current values, never a cached render matrix. */
export function flightWorldPoint(camera:{x:number;y:number;width:number;height:number;scrollX:number;scrollY:number;zoom:number},x:number,y:number){
 return {x:camera.scrollX+camera.width/2+(x-camera.x-camera.width/2)/camera.zoom,y:camera.scrollY+camera.height/2+(y-camera.y-camera.height/2)/camera.zoom};
}
export type ZoomAimLock={x:number;y:number;angle:number};
/** Scrolling changes magnification, not heading; mouse movement resumes ordinary aiming. */
export function zoomAimPoint(point:{x:number;y:number},player:{x:number;y:number},lock:ZoomAimLock|undefined,x:number,y:number){
 if(!lock||Math.hypot(x-lock.x,y-lock.y)>.5)return point;
 const reach=Math.max(100,Math.hypot(point.x-player.x,point.y-player.y));
 return {x:player.x+Math.cos(lock.angle)*reach,y:player.y+Math.sin(lock.angle)*reach};
}
