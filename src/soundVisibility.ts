export type SoundView={x:number;y:number;width:number;height:number};
/** World sounds follow the visible camera rectangle, without the render/culling margin. */
export function soundIsVisible(event:{x:number;y:number;localSound?:boolean},view:SoundView){return Boolean(event.localSound)||(event.x>=view.x&&event.y>=view.y&&event.x<=view.x+view.width&&event.y<=view.y+view.height);}
