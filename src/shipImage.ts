import type { EquipmentKind } from './data.ts';
export type ShipArtBlock={x:number;y:number;kind:EquipmentKind;level:number};
/** One shared pixel grid, anchored to the core, independent of camera zoom/ship rotation. */
export function shipImageLayout(blocks:readonly ShipArtBlock[],cell=16){
 if(!blocks.length||blocks.some(b=>!Number.isSafeInteger(b.x)||!Number.isSafeInteger(b.y)))return null;
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const b of blocks){minX=Math.min(minX,b.x*cell);maxX=Math.max(maxX,b.x*cell);minY=Math.min(minY,b.y*cell);maxY=Math.max(maxY,b.y*cell);}
 const offsetX=24-minX,offsetY=24-minY,width=maxX-minX+48,height=maxY-minY+48;
 // Large ships retain the existing per-block renderer; this is a texture budget, never a construction cap.
 if(width>2048||height>2048||width*height>2048*2048)return null;
 return {width,height,offsetX,offsetY,originX:offsetX/width,originY:offsetY/height};
}
export function bakeShipImage(blocks:readonly ShipArtBlock[],source:(block:ShipArtBlock)=>CanvasImageSource|undefined,cell=16){
 const layout=shipImageLayout(blocks,cell);if(!layout)return null;
 const images=blocks.map(source);if(images.some(image=>!image))return null;
 const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;const g=canvas.getContext('2d')!;g.imageSmoothingEnabled=false;
 const occupied=new Set(blocks.map(b=>`${b.x},${b.y}`));g.strokeStyle='#172b3c';g.lineWidth=6;
 for(const b of blocks)for(const [dx,dy]of [[1,0],[0,1]])if(occupied.has(`${b.x+dx},${b.y+dy}`)){g.beginPath();g.moveTo(layout.offsetX+b.x*cell,layout.offsetY+b.y*cell);g.lineTo(layout.offsetX+(b.x+dx)*cell,layout.offsetY+(b.y+dy)*cell);g.stroke();}
 for(let i=0;i<blocks.length;i++){const b=blocks[i];g.save();g.translate(layout.offsetX+b.x*cell,layout.offsetY+b.y*cell);g.rotate(Math.PI/2);g.drawImage(images[i]!,-24,-24);g.restore();}
 return {...layout,canvas};
}
