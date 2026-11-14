import Phaser from 'phaser';
import { VFX, WEAPON_TYPES } from './data.ts';
import type { EffectPool } from './effects.ts';
import type { Bullet, GameModel } from './model.ts';
export function drawParticles(g:Phaser.GameObjects.Graphics,pool:EffectPool){
  if(!pool.enabled)return;
  for(const p of pool.particles){if(!p.active)continue;
    const alpha=p.opacity*Math.pow(Math.max(0,p.life/p.duration),p.fade),s=Math.max(.1,p.size);
    if(p.kind==='arc'){g.lineStyle(1.5,p.color,alpha);const mx=p.x+p.vx*.5-p.vy*.06,my=p.y+p.vy*.5+p.vx*.06;g.lineBetween(p.x,p.y,mx,my);g.lineBetween(mx,my,p.x+p.vx,p.y+p.vy);continue;}
    if(p.kind==='ring'){g.lineStyle(1.5,p.color,alpha);g.strokeCircle(p.x,p.y,s);}
    else if(p.kind==='spark'){g.lineStyle(1.4,p.color,alpha);g.lineBetween(p.x,p.y,p.x-Math.cos(p.rotation)*s*2,p.y-Math.sin(p.rotation)*s*2);}
    else if(p.kind==='debris'){
      const c=Math.cos(p.rotation),d=Math.sin(p.rotation);g.fillStyle(p.color,alpha);
      g.fillTriangle(p.x-c*s-d*s*.4,p.y-d*s+c*s*.4,p.x+d*s,p.y-c*s,p.x+c*s-d*s,p.y+d*s+c*s);
    }else{
      if(p.kind==='flash'){g.fillStyle(p.color,alpha*.13);g.fillRect(p.x-s*2,p.y-s*2,s*4,s*4);}
      g.fillStyle(p.color,alpha);g.fillRect(p.x-s/2,p.y-s/2,s,s);
    }
  }
}
export function drawEnergyBeam(g:Phaser.GameObjects.Graphics,link:GameModel['miningLinks'][number]|GameModel['tractorLinks'][number],time:number,kind:'mining'|'tractor',enabled:boolean){
  const colors=VFX.beamColors[kind],color=colors[Math.min(colors.length-1,link.level-1)],dx=link.to.x-link.from.x,dy=link.to.y-link.from.y;
  const pulse=.75+Math.sin(time*(kind==='mining'?34:9)+link.targetId)*.15;
  if(enabled){g.lineStyle(kind==='mining'?6+link.level:5,color,.1*pulse);g.lineBetween(link.from.x,link.from.y,link.to.x,link.to.y);g.lineStyle(3,color,.35*pulse);g.lineBetween(link.from.x,link.from.y,link.to.x,link.to.y);}
  g.lineStyle(enabled?(link.level>=5?2.3:1.3):1,enabled?0xf3ffff:color,enabled?.9*pulse:.55);g.lineBetween(link.from.x,link.from.y,link.to.x,link.to.y);
  if(enabled)for(let i=0;i<2;i++){
    const phase=(time*(kind==='mining'?1.9:1.2)+i*.5)%1,t=kind==='tractor'?1-phase:phase;
    const x=link.from.x+dx*t,y=link.from.y+dy*t;
    g.fillStyle(color,.2);g.fillRect(x-3,y-3,6,6);g.fillStyle(0xf6ffff,.9);g.fillRect(x-1,y-1,2,2);
  }
}
// Hostile fire stays in a warm red family so it is never mistaken for the player's shots.
const ENEMY_SHOT:Partial<Record<string,number>>={cannon:0xff8a5c,pulse:0xff5d7a,rail:0xffd0dc,plasma:0xff6ad5,rocket:0xffb070};
export function drawProjectile(g:Phaser.GameObjects.Graphics,b:Bullet,enabled:boolean,time:number){
  const kind=b.weapon??(b.rocket?'rocket':'cannon'),type=WEAPON_TYPES[kind],color=b.enemy?ENEMY_SHOT[kind]??0xff7770:type.color;
  const speed=Math.hypot(b.vx,b.vy)||1,ux=b.vx/speed,uy=b.vy/speed,trail=enabled?type.trail:5;
  if(b.enhanced&&enabled){g.lineStyle(b.weapon==='pulse'?5:4,b.weapon==='pulse'?0xa3f6ff:0xffffff,.7);g.lineBetween(b.x,b.y,b.x-ux*190,b.y-uy*190);}
  if(kind==='rail'&&enabled)for(let i=3;i>=0;i--){g.lineStyle(i===0?2:1,color,.12+(3-i)*.13);g.lineBetween(b.x-ux*trail*i/4,b.y-uy*trail*i/4,b.x-ux*trail*(i+1)/4,b.y-uy*trail*(i+1)/4);}
  else if(enabled&&trail>5){g.lineStyle(kind==='pulse'?5:4,color,.12);g.lineBetween(b.x,b.y,b.x-ux*trail,b.y-uy*trail);}
  if(kind==='rocket'){
    g.lineStyle(2,0xffbe75,.7);g.lineBetween(b.x-ux*7,b.y-uy*7,b.x-ux*trail,b.y-uy*trail);
    g.save();g.translateCanvas(b.x,b.y);g.rotateCanvas(Math.atan2(b.vy,b.vx));if(b.guided)g.scaleCanvas(.6,.6);g.fillStyle(0xe6dbca);g.fillRect(-7,-3,11,6);g.fillStyle(0xff7853);g.fillTriangle(4,-3,9,0,4,3);g.fillStyle(0xffd39c);g.fillTriangle(-7,-2,-13,0,-7,2);g.restore();
  }else if(kind==='plasma'){
    const r=(b.ultimate?9:5)+(enabled?Math.sin(time*20+b.id)*.7:0);
    if(enabled)for(const [scale,alpha]of [[2,.04],[1.5,.12]])for(let i=0;i<8;i++){const a=i*Math.PI/4,c=(i+1)*Math.PI/4;g.fillStyle(color,alpha);g.fillTriangle(b.x,b.y,b.x+Math.cos(a)*r*scale,b.y+Math.sin(a)*r*scale,b.x+Math.cos(c)*r*scale,b.y+Math.sin(c)*r*scale);}
    for(let i=0;i<8;i++){const a=i*Math.PI/4,c=(i+1)*Math.PI/4;g.fillStyle(color,.9);g.fillTriangle(b.x,b.y,b.x+Math.cos(a)*r,b.y+Math.sin(a)*r,b.x+Math.cos(c)*r,b.y+Math.sin(c)*r);}
    g.fillStyle(0xf3ffe2);g.fillRect(b.x-1.5,b.y-1.5,3,3);
  }else{
    g.lineStyle(kind==='rail'?2:kind==='flak'?2:3,color);g.lineBetween(b.x,b.y,b.x-ux*(kind==='rail'?18:trail),b.y-uy*(kind==='rail'?18:trail));
    if(enabled&&kind==='pulse'){g.lineStyle(1,0xf4ffff);g.lineBetween(b.x,b.y,b.x-ux*8,b.y-uy*8);}
  }
}
export function drawEmp(g:Phaser.GameObjects.Graphics,pulse:{x:number;y:number;radius:number;maxRadius:number},enabled:boolean,time:number){
  const alpha=1-pulse.radius/pulse.maxRadius;
  if(enabled){g.fillStyle(WEAPON_TYPES.emp.color,.03+alpha*.045);g.fillCircle(pulse.x,pulse.y,pulse.radius);}
  g.lineStyle(enabled?3:1,WEAPON_TYPES.emp.color,.3+alpha*.6);g.strokeCircle(pulse.x,pulse.y,pulse.radius);
  if(!enabled)return;
  g.lineStyle(1,0xd3e7ff,alpha*.7);g.strokeCircle(pulse.x,pulse.y,Math.max(0,pulse.radius-5));
  for(let i=0;i<8;i++){const a=i*Math.PI/4+Math.sin(time*12+i)*.04,r=pulse.radius;g.lineStyle(1,0xa5caff,alpha);g.lineBetween(pulse.x+Math.cos(a)*r*.85,pulse.y+Math.sin(a)*r*.85,pulse.x+Math.cos(a+.1)*r,pulse.y+Math.sin(a+.1)*r);}
}
