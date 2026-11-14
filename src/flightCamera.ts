/** Unrotated flight-camera projection from current values, never a cached render matrix. */
export function flightWorldPoint(camera:{x:number;y:number;width:number;height:number;scrollX:number;scrollY:number;zoom:number},x:number,y:number){
 return {x:camera.scrollX+camera.width/2+(x-camera.x-camera.width/2)/camera.zoom,y:camera.scrollY+camera.height/2+(y-camera.y-camera.height/2)/camera.zoom};
}
