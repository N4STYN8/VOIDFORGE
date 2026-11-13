import { VFX, WEAPON_TYPES } from './data.ts';
import type { EffectEvent } from './effectEvents.ts';
import type { Bullet, GameModel } from './model.ts';
export type EffectView = {x:number;y:number;width:number;height:number};
export type Particle = {active:boolean;kind:'arc'|'spark'|'debris'|'flash'|'ring'|'energy';x:number;y:number;vx:number;vy:number;life:number;duration:number;size:number;growth:number;color:number;opacity:number;fade:number;rotation:number;spin:number;priority:number};
export type ParticleConfig = Partial<Omit<Particle,'active'|'duration'>> & {x:number;y:number;life:number};
export class EffectPool {
  readonly particles: Particle[];
  private free:number[]=[];
  private on=true;
  private randomState=9217;
  private emissionClock=0;
  private dustClock=0;
  time=0;
  density=1;
  constructor(budget=VFX.particleBudget){
    this.particles=Array.from({length:Math.max(0,Math.floor(budget))},(_,i)=>{this.free.push(i);return {active:false,kind:'spark',x:0,y:0,vx:0,vy:0,life:0,duration:0,size:0,growth:0,color:0xffffff,opacity:1,fade:1,rotation:0,spin:0,priority:0};});
  }
  get enabled(){return this.on;}
  set enabled(value:boolean){this.on=value;if(!value)this.clear();}
  get activeCount(){return this.particles.length-this.free.length;}
  clear(){this.free.length=0;for(let i=0;i<this.particles.length;i++){this.particles[i].active=false;this.free.push(i);}this.emissionClock=0;}
  private random(){this.randomState=(Math.imul(this.randomState,1664525)+1013904223)>>>0;return this.randomState/4294967296;}
  visible(x:number,y:number,view:EffectView,margin=VFX.visibleMargin){return x>=view.x-margin&&y>=view.y-margin&&x<=view.x+view.width+margin&&y<=view.y+view.height+margin;}
  spawn(config:ParticleConfig,view?:EffectView):boolean {
    if(!this.on||config.life<=0||(view&&!this.visible(config.x,config.y,view)))return false;
    if(this.density<1&&this.random()>this.density)return false;
    let index=this.free.pop();
    if(index===undefined&&view){
      const cx=view.x+view.width/2,cy=view.y+view.height/2;
      const rank=(x:number,y:number,priority:number)=>priority*1e7-((x-cx)**2+(y-cy)**2);
      const incoming=rank(config.x,config.y,config.priority??1);let worst=incoming;
      for(let i=0;i<this.particles.length;i++){const p=this.particles[i],value=rank(p.x,p.y,p.priority);if(value<worst){worst=value;index=i;}}
    }
    if(index===undefined)return false;
    const p=this.particles[index];p.active=true;p.kind=config.kind??'spark';p.x=config.x;p.y=config.y;p.vx=config.vx??0;p.vy=config.vy??0;
    p.life=p.duration=config.life;p.size=config.size??2;p.growth=config.growth??0;p.color=config.color??0xffffff;p.opacity=config.opacity??1;p.fade=config.fade??1;
    p.rotation=config.rotation??0;p.spin=config.spin??0;p.priority=config.priority??1;return true;
  }
  update(dt:number,view?:EffectView){
    if(!this.on)return;this.time+=dt;this.emissionClock+=dt;this.dustClock+=dt;
    for(let i=0;i<this.particles.length;i++){
      const p=this.particles[i];if(!p.active)continue;
      p.life-=dt;if(p.kind!=='arc'){p.x+=p.vx*dt;p.y+=p.vy*dt;}p.size+=p.growth*dt;p.rotation+=p.spin*dt;
      if(p.life<=0||(view&&!this.visible(p.x,p.y,view,180))){p.active=false;this.free.push(i);}
    }
  }
  consume(events:EffectEvent[],view:EffectView){
    if(!this.on)return;
    for(const e of events){
      if(e.type==='cue'||!this.visible(e.x,e.y,view))continue;
      if(e.type==='arc'){this.spawn({kind:'arc',x:e.x,y:e.y,vx:(e.toX??e.x)-e.x,vy:(e.toY??e.y)-e.y,life:.2,color:e.color??0x9eefff,priority:2},view);continue;}
      const color=e.color??(e.weapon?WEAPON_TYPES[e.weapon].color:0xffbf80),angle=e.angle??0;
      if(e.type==='debris'){
        for(let i=0;i<(e.count??3);i++){const a=angle+(this.random()-.5)*1.5,speed=20+this.random()*45;this.spawn({kind:'debris',x:e.x,y:e.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.45+this.random()*.25,size:1.5+this.random()*2,color,rotation:a,spin:2-this.random()*4},view);}continue;
      }
      const explosion=e.type==='explosion',collection=e.type==='collection',muzzle=e.type==='muzzle';
      this.spawn({kind:'flash',x:e.x,y:e.y,life:muzzle?.055:.12,size:muzzle?4:explosion?10:5,color,priority:3,rotation:angle},view);
      const count=muzzle?2:collection?5:explosion?12:e.weapon==='rail'?9:4;
      for(let i=0;i<count;i++){
        const a=muzzle?angle+(this.random()-.5)*.9:this.random()*Math.PI*2,speed=(explosion?45:20)+this.random()*(explosion?110:55);
        this.spawn({kind:collection?'energy':'spark',x:e.x,y:e.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.12+this.random()*(explosion?.4:.18),size:muzzle?1.5:2,color,rotation:a,priority:explosion?2:1},view);
      }
      if(explosion||collection||e.type==='shield'||e.weapon==='rail'||e.weapon==='emp')this.spawn({kind:'ring',x:e.x,y:e.y,life:explosion?.38:.23,size:2,growth:(e.radius??(collection?15:30))/(explosion?.38:.23),color,opacity:.8,priority:2},view);
    }
  }
  ambient(asteroids:GameModel['asteroids'],view:EffectView){
    if(!this.on||this.dustClock<.8)return;this.dustClock%=.8;let emitted=0;
    for(const a of asteroids)if(a.motion&&this.visible(a.x,a.y,view,0)){this.spawn({kind:'debris',x:a.x-a.vx*3,y:a.y-a.vy*3,vx:a.vx*.15,vy:a.vy*.15,life:.7,size:.8,color:0x8a9ca5,opacity:.25,priority:0},view);if(++emitted>=3)break;}
  }
  continuous(mining:GameModel['miningLinks'],bullets:Bullet[],view:EffectView){
    if(!this.on||this.emissionClock<.05)return;this.emissionClock%=.05;
    for(const link of mining){
      const angle=Math.atan2(link.from.y-link.to.y,link.from.x-link.to.x);
      for(let i=0;i<2;i++){const a=angle+(this.random()-.5)*2.4,speed=20+this.random()*40;this.spawn({kind:'spark',x:link.to.x,y:link.to.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.1+this.random()*.12,size:1.4,color:VFX.beamColors.mining[link.level-1],rotation:a,priority:1},view);}
      this.spawn({kind:'flash',x:link.to.x,y:link.to.y,life:.07,size:2.5+link.level,color:0xe9fff2,opacity:.7},view);
    }
    for(const b of bullets)if((b.weapon==='plasma'||b.rocket)&&this.visible(b.x,b.y,view))this.spawn({kind:'energy',x:b.x-b.vx*.015,y:b.y-b.vy*.015,vx:-b.vx*.05,vy:-b.vy*.05,life:.18,size:b.rocket?2:3,color:b.rocket?0xffae65:WEAPON_TYPES.plasma.color,opacity:.55,priority:0},view);
  }
}
