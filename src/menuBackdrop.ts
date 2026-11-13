/** Illustrated reference plate + independently animated, bounded presentation layers. */
const illustrationUrl=new URL('./assets/menu-forge-v2.webp',import.meta.url).href;
import { paintAsteroid } from './sprites.ts';
export class MenuBackdrop {
 private frame=0;private clock=0;private last=0;private running=false;
 private reduced=matchMedia('(prefers-reduced-motion: reduce)');
 private illustration=new Image();
 private rocks=Array.from({length:6},(_,i)=>{const c=document.createElement('canvas');c.width=c.height=112;paintAsteroid(c.getContext('2d')!,{id:i+1,x:0,y:0,radius:28+i%3*5,ore:i%3===0?'copper':'iron',amount:60,health:60,vx:0,vy:0,shapeSeed:700+i});return c;});
 private visibility=()=>{this.last=0;if(!document.hidden&&this.running&&!this.frame)this.frame=requestAnimationFrame(this.animate);};
 constructor(private canvas:HTMLCanvasElement){this.illustration.onload=this.visibility;this.illustration.src=illustrationUrl;document.addEventListener('visibilitychange',this.visibility);window.addEventListener('resize',this.visibility);this.reduced.addEventListener('change',this.visibility);}
 start(){if(this.running)return;this.running=true;this.last=0;this.frame=requestAnimationFrame(this.animate);}
 stop(){this.running=false;cancelAnimationFrame(this.frame);this.frame=0;this.last=0;}
 destroy(){this.stop();this.illustration.onload=null;document.removeEventListener('visibilitychange',this.visibility);window.removeEventListener('resize',this.visibility);this.reduced.removeEventListener('change',this.visibility);}
 private animate=(now:number)=>{this.frame=0;if(!this.running||document.hidden)return;
  if(!this.last||now-this.last>=33){const dt=this.last?Math.min((now-this.last)/1000,.1):0;this.last=now;if(!this.reduced.matches)this.clock+=dt;this.draw();}
  if(!this.reduced.matches)this.frame=requestAnimationFrame(this.animate);
 };
 private draw(){
  const quality=Math.min(1,1920/innerWidth,1080/innerHeight),c=this.canvas,w=Math.max(1,Math.floor(innerWidth*quality)),h=Math.max(1,Math.floor(innerHeight*quality));if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
  const g=c.getContext('2d')!,t=this.clock;g.fillStyle='#03091a';g.fillRect(0,0,w,h);
  if(!this.illustration.complete||!this.illustration.naturalWidth)return;
  // Preserve the illustration proportions: fit the full composition on desktop, crop on phones.
  const mobile=w<700,scale=mobile?h/941:Math.min(w/1672,h/941),iw=1672*scale,ih=941*scale,ox=mobile?w*.5-iw*.37:(w-iw)/2,oy=mobile?0:(h-ih)*.4;
  g.imageSmoothingEnabled=true;g.drawImage(this.illustration,ox,oy,iw,ih);
  const sx=ox+1470*scale,sy=oy+267*scale;
  // Rotate the actual illustrated energy aperture; the surrounding dock architecture stays fixed.
  g.save();g.translate(sx,sy);g.rotate(t*.045);g.beginPath();g.arc(0,0,52*scale,0,Math.PI*2);g.clip();g.drawImage(this.illustration,1418,215,104,104,-52*scale,-52*scale,104*scale,104*scale);g.restore();
  g.globalAlpha=.10+.05*Math.sin(t*1.7);g.fillStyle='#77fff4';g.beginPath();g.ellipse(sx,sy,36*scale,45*scale,0,0,Math.PI*2);g.fill();g.globalAlpha=1;
  for(let i=0;i<80;i++){const x=(i*191.37+t*(1+i%3))%w,y=(i*97.73)%h;if(x<w*.48&&y>h*.23)continue;g.fillStyle=i%4?'#6584ad':'#9cdfeb';g.fillRect(x|0,y|0,1,1);}
  g.imageSmoothingEnabled=false;
  for(let i=0;i<(mobile?3:7);i++){const x=ox+((i*257+t*(2+i%3))%(1672+100)-50)*scale,y=oy+(160+i*101%540)*scale,s=(.2+i%3*.09)*scale;if(x<w*.48&&y>h*.25)continue;g.save();g.translate(x,y);g.rotate(t*.025*(i%2?1:-1)+i);g.drawImage(this.rocks[i%6],-56*s,-56*s,112*s,112*s);g.restore();}

 }
}
