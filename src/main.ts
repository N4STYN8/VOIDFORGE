import Phaser from 'phaser';
import { GameSettings } from './settings.ts';
import { moduleDrag } from './moduleDrag.ts';
import { flightHud } from './hud.ts';
import { outfitterMarkup } from './outfitter.ts';
import { EffectPool } from './effects.ts';
import { drawParticles, drawEnergyBeam, drawProjectile, drawEmp } from './effectsRender.ts';
import { GameModel } from './model.ts';
import { WORLD, SHIP, RESOURCES, ENEMIES, ENEMY_AI, EXPLORATION, MODULES, BUILD_GRID, equipment, upgradeCost, statsLabel, type EquipmentKind, type ModuleKind } from './data.ts';
import './style.css';
import { hashSeed } from './world.ts';
import { loadSavedGame, saveGame, backupSavedGame } from './persistence.ts';
import { GameAudio } from './audio.ts';
import { drawExplorationMap } from './map.ts';
import { ensureAsteroidGeometry } from './mining.ts';
import { drawModule } from './visuals.ts';
import { paintBackdrop, paintAsteroid, paintStation, paintEnemy, crispModule, mix, ASTEROID_SPRITE, ENEMY_SPRITE, STATION_SPRITE } from './sprites.ts';
class SpaceScene extends Phaser.Scene {
  private effects = new EffectPool();
  private saveElapsed = 0;
  private sessionControls = document.createElement('section');
  private hudContent='';
  private hudElapsed = 0;
  private mapElapsed = 0;
  private asteroidCache = new Map<number, { revision: number; key: string; used: number }>();
  private iconUrls = new Map<string, string>();
  private backdrop:{key:string;sprite:Phaser.GameObjects.TileSprite;factor:number;scale:number}[]=[];
  private stationSprites:Phaser.GameObjects.Image[]=[];
  private enemySprites:Phaser.GameObjects.Image[]=[];
  private shipSprites:Phaser.GameObjects.Image[]=[];
  private builderElapsed=0;
  private asteroidSprites: Phaser.GameObjects.Image[] = [];
  private mapView = { zoom: 1, centerX: 0.5, centerY: 0.5 };
  private audio = new GameAudio();
  private settings!:GameSettings;
  private mapOpen = false;
  private mapWindow = document.createElement('section');
  private mapCanvas!: HTMLCanvasElement;
  private moduleDragActive=false;
  private catalogQuery='';
  private catalogCategory='All';
  private detailMode:'install'|'module'='module';
  private gridRadius=3;
  private actionFailed=false;
  private buildCenter = { x:0, y:0 };
  private movingModule = false;
  private baseLabels: Phaser.GameObjects.Text[] = [];
  private lastBullet = -1;
  private model = loadSavedGame() ?? new GameModel();
  private targetLabel!: Phaser.GameObjects.Text;
  private mapLabel!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Graphics;
  private effectsGraphics!: Phaser.GameObjects.Graphics;
  private graphics!: Phaser.GameObjects.Graphics;
  private follow!: Phaser.GameObjects.Zone;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private paused = false;
  private building = false;
  private selectedCell = { x: 0, y: 0 };
  private selectedModule: ModuleKind = 'cannon';
  private builder = document.createElement('section');
  private builderContent = '';
  private hud = document.getElementById('hud')!;
  private bossBar = document.createElement('section');
  private hordeBanner = document.createElement('section');
  private hordeBannerContent = '';
  private bossBarContent = '';
  private status = document.getElementById('status')!;
  create() {
    // Local-development handle for browser checks; never set on the hosted site.
    if (['localhost','127.0.0.1'].includes(location.hostname)) (window as unknown as { voidforge?: SpaceScene }).voidforge = this;
    this.sessionControls.id = 'session-controls';
    this.sessionControls.innerHTML = '<div><small id="world-seed"></small></div><div class="session-actions"><button data-session="save">Save</button><button data-session="load">Load</button><button data-session="export">Export</button><label class="file-button">Import<input id="import-save" type="file" accept="application/json,.json"></label></div><div class="new-world"><input id="seed-input" aria-label="Optional new world seed" maxlength="80" placeholder="Optional new-world seed"><button data-session="new">New world</button></div><button data-settings="true">Settings · audio / VFX</button>';
    document.body.append(this.sessionControls); this.refreshSeedLabel();
    this.settings=new GameSettings(this.audio,this.effects,open=>{this.input.keyboard!.enabled=!open;if(open)this.input.keyboard!.disableGlobalCapture();else this.input.keyboard!.enableGlobalCapture();});
    this.sessionControls.querySelector('[data-settings]')!.addEventListener('click',()=>this.settings.show());
    this.sessionControls.addEventListener('focusin', event => { if ((event.target as HTMLElement).id === 'seed-input') { this.input.keyboard!.enabled = false; this.input.keyboard!.disableGlobalCapture(); this.paused = true; } });
    this.sessionControls.addEventListener('focusout', () => { this.input.keyboard!.enabled = true; this.input.keyboard!.enableGlobalCapture(); });
    this.sessionControls.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
      const action = button.dataset.session;
      if (action === 'save') this.model.message = saveGame(this.model) ?? 'World saved locally.';
      if (action === 'load') { const saved = loadSavedGame(); if (saved) this.switchModel(saved); else this.model.message = 'No valid local save found.'; }
      if (action === 'new') {
        const input = this.sessionControls.querySelector<HTMLInputElement>('#seed-input')!;
        try { const next = input.value.trim() ? new GameModel(input.value.trim()) : new GameModel(); backupSavedGame(); this.switchModel(next); saveGame(this.model); input.value = ''; }
        catch { this.model.message = 'Could not generate that seed. Choose another seed.'; }
      }
      if (action === 'export') {
        const blob = new Blob([JSON.stringify(this.model.toSave())], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `voidforge-${this.model.seed.replace(/[^a-z0-9-]/gi, '').slice(0, 40)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      button.blur();
    });
    this.sessionControls.querySelector<HTMLInputElement>('#import-save')!.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
      try { const model = GameModel.fromSave(JSON.parse(await file.text())); backupSavedGame(); this.switchModel(model); saveGame(model); }
      catch { this.model.message = 'That file is not a supported VOIDFORGE save.'; }
      input.value = '';
    });
    window.addEventListener('beforeunload', () => { saveGame(this.model); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(this.model); });
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
    this.mapWindow.id = 'map-window'; this.mapWindow.hidden = true;
    this.mapWindow.innerHTML = '<header><div><small>NAVIGATION / EXPLORED SPACE</small><h2>Sector map</h2></div><button id="close-map">Close · M / Esc</button></header><canvas width="640" height="640" aria-label="Explored space map"></canvas><p>Dark areas are unexplored · Green: active base · Amber: locked base<br>Explored space is tinted by threat: <span style="color:#7d9ab0">blue low</span> · <span style="color:#e8c45a">olive medium</span> · <span style="color:#f08a4b">rust high</span> · <span style="color:#f0527a">magenta extreme</span><br>Explore to discover outposts. G activates nearby locked bases · Wheel zooms · Drag pans.</p>';
    document.body.append(this.mapWindow); this.mapCanvas = this.mapWindow.querySelector('canvas')!;
    this.mapWindow.querySelector('button')!.addEventListener('click', () => { this.mapOpen = false; });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x >= this.scale.width - 152 && pointer.y >= this.scale.height - 152) this.mapOpen = !this.mapOpen;
    });
    this.bossBar.id = 'boss-bar'; this.bossBar.hidden = true; document.body.append(this.bossBar);
    this.hordeBanner.id = 'horde-banner'; this.hordeBanner.hidden = true; this.hordeBanner.setAttribute('role', 'alert'); document.body.append(this.hordeBanner);
    this.builder.id = 'builder'; this.builder.hidden = true;
    document.body.append(this.builder);
    this.builder.addEventListener('pointerdown', event => event.stopPropagation());
    const freezeKeyboard=()=>{this.input.keyboard!.enabled=false;this.input.keyboard!.disableGlobalCapture();};
    const restoreKeyboard=()=>{this.input.keyboard!.enabled=true;this.input.keyboard!.enableGlobalCapture();};
    this.builder.addEventListener('focusin',event=>{if((event.target as HTMLElement).matches('input,select'))freezeKeyboard();});
    this.builder.addEventListener('focusout',restoreKeyboard);
    this.builder.addEventListener('input',event=>{
      const input=event.target as HTMLInputElement;if(input.id!=='module-search')return;
      this.catalogQuery=input.value;const cursor=input.selectionStart;this.renderBuilder();const replacement=this.builder.querySelector<HTMLInputElement>('#module-search');replacement?.focus();if(cursor!==null)replacement?.setSelectionRange(cursor,cursor);
    });
    this.builder.addEventListener('change',event=>{const select=event.target as HTMLSelectElement;if(select.id==='module-category'){this.catalogCategory=select.value;this.renderBuilder();}});
    this.builder.addEventListener('keydown',event=>{if(event.key==='Escape'){this.building=false;this.builder.hidden=true;restoreKeyboard();}});
    const action=(success:boolean)=>{this.actionFailed=!success;this.audio.play(success?'build':'fail');return success;};
    moduleDrag(this.builder, {
      active: value=>{this.moduleDragActive=value;},
      error: (source,x,y)=>source.kind?this.model.buildError(source.kind,x,y):this.model.moveError(source.x!,source.y!,x,y),
      drop: (source,x,y)=>{
        const success=source.kind?this.model.installModule(source.kind,x,y):this.model.moveModule(source.x!,source.y!,x,y);
        if(action(success)){this.selectedCell={x,y};this.detailMode='module';this.movingModule=false;}
        this.renderBuilder();
      }
    });
    this.builder.addEventListener('click',event=>{
      const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button)return;
      if(button.dataset.pan){const direction=button.dataset.pan;if(direction==='home')this.buildCenter={x:0,y:0};else{this.buildCenter.x+=direction==='right'?2:direction==='left'?-2:0;this.buildCenter.y+=direction==='down'?2:direction==='up'?-2:0;}}
      else if(button.dataset.gridzoom)this.gridRadius=Math.max(1,Math.min(6,this.gridRadius+(button.dataset.gridzoom==='out'?1:-1)));
      else if(button.dataset.kind){this.selectedModule=button.dataset.kind as ModuleKind;this.detailMode='install';this.movingModule=false;this.actionFailed=false;}
      else if(button.dataset.place){this.movingModule=false;this.model.message=`Choose an empty connected cell to install ${MODULES[this.selectedModule].label}.`;}
      else if(button.dataset.move)this.movingModule=!this.movingModule;
      else if(button.dataset.remove){if(action(this.model.removeModule(this.selectedCell.x,this.selectedCell.y))){this.selectedCell={x:0,y:0};this.detailMode='module';}}
      else if(button.dataset.repair)action(this.model.repairShip());
      else if(button.dataset.upgrade)action(this.model.upgradeModule(this.selectedCell.x,this.selectedCell.y));
      else if(button.dataset.x){
        const x=Number(button.dataset.x),y=Number(button.dataset.y),occupied=(x===0&&y===0)||this.model.modules.some(m=>m.x===x&&m.y===y);
        if(this.movingModule){if(action(this.model.moveModule(this.selectedCell.x,this.selectedCell.y,x,y)))this.selectedCell={x,y};this.movingModule=false;}
        else if(occupied){this.selectedCell={x,y};this.detailMode='module';this.actionFailed=false;}
        else if(action(this.model.installModule(this.selectedModule,x,y))){this.selectedCell={x,y};this.detailMode='module';}
      }else if(button.dataset.close){this.building=false;restoreKeyboard();}
      button.blur();this.renderBuilder();
    });
    this.graphics = this.add.graphics();
    this.effectsGraphics=this.add.graphics().setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(20);
    // Three parallax layers (gas clouds, far stars, near stars) baked once per world seed.
    this.paintBackdropTextures();
    this.backdrop=[
      {key:'backdrop-nebula',sprite:this.add.tileSprite(0,0,64,64,'backdrop-nebula').setOrigin(0).setScale(4).setDepth(-5),factor:.1,scale:4},
      {key:'backdrop-far',sprite:this.add.tileSprite(0,0,64,64,'backdrop-far').setOrigin(0).setScale(2).setDepth(-4),factor:.28,scale:2},
      {key:'backdrop-near',sprite:this.add.tileSprite(0,0,64,64,'backdrop-near').setOrigin(0).setScale(2).setDepth(-3),factor:.55,scale:2},
    ];
    // Pixel art: every baked sprite is enlarged with nearest-neighbour filtering.
    for(const layer of this.backdrop)layer.sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.addCanvas('station-on',paintStation(true))!.setFilter(Phaser.Textures.FilterMode.NEAREST);this.textures.addCanvas('station-off',paintStation(false))!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.stationSprites=this.model.bases.map(base=>this.add.image(base.x,base.y,'station-off').setScale(1/STATION_SPRITE.scale).setDepth(-.5));
    for(const kind of Object.keys(ENEMIES))this.textures.addCanvas(`enemy-${kind}`,paintEnemy(kind as keyof typeof ENEMIES))!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const kind of ['core', ...Object.keys(MODULES)] as EquipmentKind[]) for (let level = 1; level <= equipment(kind).levels.length; level++) {
      const key = `icon-${kind}-${level}`, cache = this.add.graphics();
      drawModule(cache, 24, 24, -Math.PI / 2, kind, equipment(kind).color, level);
      cache.generateTexture(key, 48, 48); cache.destroy();
      // One texel per world unit, hard edges and stepped colours: a true 16x16 pixel module.
      const texture=this.textures.get(key) as Phaser.Textures.CanvasTexture,source=texture.getSourceImage() as HTMLCanvasElement;
      if(source instanceof HTMLCanvasElement){crispModule(source);texture.refresh?.();}
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      const cropped=document.createElement('canvas');cropped.width=cropped.height=24;cropped.getContext('2d')!.drawImage(source,12,12,24,24,0,0,24,24);this.iconUrls.set(`${kind}-${level}`,cropped.toDataURL());
    }
    this.baseLabels = this.model.bases.map(base => this.add.text(base.x, base.y - 172, '', { fontFamily: 'monospace', fontSize: '10px', color: '#a0d6cc', align: 'center', lineSpacing: 5 }).setOrigin(0.5));
    this.targetLabel = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '10px', color: '#b5ebdf', backgroundColor: '#0b1423', padding: { x: 6, y: 3 } }).setOrigin(0.5, 0).setDepth(5);
    this.mapLabel = this.add.text(0, 0, 'SECTOR MAP / M', { fontFamily: 'monospace', fontSize: '9px', color: '#91afc5', letterSpacing: 1 }).setScrollFactor(0).setDepth(21);
    this.follow = this.add.zone(this.model.player.x, this.model.player.y, 1, 1);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height).setZoom(1.35).startFollow(this.follow, true, 0.15, 0.15);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,E,R,ESC,B,Q,M,N,G,V,SHIFT,C') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (!this.mapOpen && !this.building) this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * Math.exp(-dy * 0.001), 0.55, 2.2));
    });
    this.mapCanvas.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = this.mapCanvas.getBoundingClientRect();
      const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
      const previous = this.mapView.zoom, next = Phaser.Math.Clamp(previous * Math.exp(-event.deltaY * 0.0015), 1, 24);
      this.mapView.centerX = Phaser.Math.Clamp(this.mapView.centerX + (u - 0.5) * (1 / previous - 1 / next), 0.5 / next, 1 - 0.5 / next);
      this.mapView.centerY = Phaser.Math.Clamp(this.mapView.centerY + (v - 0.5) * (1 / previous - 1 / next), 0.5 / next, 1 - 0.5 / next);
      this.mapView.zoom = next; this.mapElapsed = 200;
    }, { passive: false });
    let drag: { x: number; y: number } | undefined;
    this.mapCanvas.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY }; this.mapCanvas.setPointerCapture(event.pointerId); });
    this.mapCanvas.addEventListener('pointermove', event => {
      if (!drag) return;
      const rect = this.mapCanvas.getBoundingClientRect(), z = this.mapView.zoom;
      this.mapView.centerX = Phaser.Math.Clamp(this.mapView.centerX - (event.clientX - drag.x) / rect.width / z, 0.5 / z, 1 - 0.5 / z);
      this.mapView.centerY = Phaser.Math.Clamp(this.mapView.centerY - (event.clientY - drag.y) / rect.height / z, 0.5 / z, 1 - 0.5 / z);
      drag = { x: event.clientX, y: event.clientY }; this.mapElapsed = 200;
    });
    this.mapCanvas.addEventListener('pointerup', () => { drag = undefined; });
    this.mapCanvas.addEventListener('pointercancel', () => { drag = undefined; });
    this.input.mouse!.disableContextMenu();
    this.input.keyboard!.addCapture(['SPACE', 'W', 'A', 'S', 'D']);
    this.game.events.on('blur', () => { this.paused = true; });
  }
  update(_time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.M)) { this.mapOpen = !this.mapOpen; this.building = false; }
    if ((Phaser.Input.Keyboard.JustDown(this.keys.B) || Phaser.Input.Keyboard.JustDown(this.keys.Q)) && !this.mapOpen) {
      if (this.building) this.building = false;
      else if (this.model.atStation && !this.model.dead) this.building = true;
      else this.model.message = 'Return to the green station to open the shop (Q).';
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      if (this.mapOpen) this.mapOpen = false;
      else if (this.building) this.building = false;
      else this.paused = !this.paused;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.model.respawn();
    if (Phaser.Input.Keyboard.JustDown(this.keys.N)){this.audio.toggleMute();this.settings.sync();}
    if(Phaser.Input.Keyboard.JustDown(this.keys.V)){this.effects.enabled=!this.effects.enabled;this.settings.persist();}
    const beforeHull = this.model.player.health, beforeShield = this.model.shield, beforeKills = this.model.kills, beforeHits = this.model.enemyHits, beforeOreHits = this.model.oreHits;
    if (Phaser.Input.Keyboard.JustDown(this.keys.G) && !this.paused && !this.building && !this.mapOpen && !this.settings.open) { if (this.model.unlockBase()) this.audio.play('build'); }
    const boost=Phaser.Input.Keyboard.JustDown(this.keys.SHIFT);
    const dock = Phaser.Input.Keyboard.JustDown(this.keys.E);
    const pointer = this.input.activePointer;
    const aim = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const bounds = this.cameras.main.worldView;
    if (!this.paused && !this.building && !this.mapOpen && !this.settings.open) this.model.update(delta / 1000, {
      x: Number(this.keys.D.isDown) - Number(this.keys.A.isDown), y: Number(this.keys.S.isDown) - Number(this.keys.W.isDown),
      aim, fire: pointer.leftButtonDown(), overclock:Phaser.Input.Keyboard.JustDown(this.keys.C), boost, mine: pointer.rightButtonDown() || this.keys.SPACE.isDown, dock, view: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
    if (!this.paused && !this.building && !this.mapOpen && !this.settings.open) {
      for(const event of this.model.effects){if(event.type==='cue'&&event.cue)this.audio.play(event.cue,event.pitch,event.volume);else if(event.type==='muzzle'&&event.weapon&&!event.silent)this.audio.playWeapon(event.weapon);if(event.type==='arc')this.audio.play('pulse');if(event.type==='collection')this.audio.play('collect');if(event.type==='shield')this.audio.play('shield');}
      // Hull hits crunch, shield hits ring (the shield cue comes from its own event), and losing the ship has its own sound.
      if (this.model.dead && beforeHull > 0) this.audio.play('death'); else if (this.model.player.health < beforeHull) this.audio.play('hull');
      if (this.model.oreHits > beforeOreHits) this.audio.play('impact');
      if (this.model.enemyHits > beforeHits) this.audio.play('hit');
      if (this.model.kills > beforeKills) this.audio.play('explosion');
    }
    const audible=!this.paused&&!this.building&&!this.mapOpen&&!this.settings.open&&!this.model.dead;
    this.audio.setLoop('mine',audible?this.model.miningLinks.length:0);this.audio.setLoop('tractor',audible?this.model.tractorLinks.length:0);
    for (const b of this.model.bullets) this.lastBullet = Math.max(this.lastBullet, b.id);
    if (!this.paused && !this.building && !this.mapOpen && !this.settings.open) {
      this.effects.update(Math.min(delta/1000,.05),bounds);this.effects.consume(this.model.effects,bounds);this.effects.continuous(this.model.miningLinks,this.model.bullets,bounds);this.effects.ambient(this.model.asteroids,bounds);
    }
    const p = this.model.player;
    this.follow.setPosition(p.x, p.y);
    this.draw();
    this.mapElapsed += delta;
    const refreshMap = this.mapElapsed >= 200;
    if (refreshMap) this.drawMinimap();
    this.builderElapsed+=delta;if(this.builderElapsed>=100){this.renderBuilder();this.builderElapsed=0;}
    this.mapWindow.hidden = !this.mapOpen;
    if (this.mapOpen && refreshMap) drawExplorationMap(this.mapCanvas, this.model, this.mapView);
    if (refreshMap) this.mapElapsed = 0;
    this.saveElapsed += delta;
    if (this.saveElapsed >= 10000) { const error = saveGame(this.model); if (error) this.model.message = error; this.saveElapsed = 0; }
    this.hudElapsed += delta;
    if (this.hudElapsed >= 100) {
    this.hudElapsed = 0;
    const destination = this.model.bases.filter(base => this.model.isExplored(base) || base.unlocked).reduce((best, base) => Math.hypot(p.x - base.x, p.y - base.y) < Math.hypot(p.x - best.x, p.y - best.y) ? base : best);
    const html=flightHud(this.model,{base:destination,direction:this.directionToStation(),zoom:this.cameras.main.zoom,muted:this.audio.muted,effects:this.effects.enabled,detailsOpen:this.hud.querySelector<HTMLDetailsElement>('details')?.open??false});
    if(html!==this.hudContent){this.hud.innerHTML=html;this.hudContent=html;}
    // Boss bar: shown while a boss is close enough to matter.
    const boss=this.model.enemies.find(e=>ENEMIES[e.kind??'raider'].boss&&Math.hypot(e.x-p.x,e.y-p.y)<1800);
    let bossHtml='';
    if(boss){
      const def=ENEMIES[boss.kind!],parts=this.model.enemies.filter(e=>e.parent===boss.id&&e.mount),pct=(n:number,max:number)=>Math.max(0,Math.min(100,max?n/max*100:0)).toFixed(1);
      const turrets=parts.filter(e=>ENEMIES[e.kind!].weapons.length).length,generators=parts.filter(e=>ENEMIES[e.kind!].shieldSource).length;
      const vents=parts.filter(e=>ENEMIES[e.kind!].weakPoint).length,hasGenerators=def.boss!.parts.some(part=>ENEMIES[part.kind].shieldSource);
      const phase=boss.phase3?'FINAL PHASE':boss.phase2?'PHASE 2 · ENRAGED':'PHASE 1',marks=[def.boss!.phaseAt,def.boss!.finalAt].filter(Boolean).map(at=>`<b style="left:${at!*100}%"></b>`).join('');
      const status=(boss.surge??0)>0?'SHIELD SURGE · destroy the crystal nodes':(boss.empCharge??0)>0?'EMP CHARGING · leave the ring':vents?(boss.phase2?'Reactor vents EXPOSED · shoot them':'Reactor vents sealed'):hasGenerators?`Shield generators ${generators}${generators?'':' · shields will not recharge'}`:'';
      bossHtml=`<header><strong>${def.label.toUpperCase()}</strong><span>${phase}</span></header><div class="boss-hull"><i style="width:${pct(boss.health,def.health)}%"></i>${marks}</div><div class="boss-shield"><i style="width:${pct(boss.shield??0,def.shield)}%"></i></div><footer><span>Weapon mounts ${turrets}</span><span>${status}</span></footer>`;
    }
    if(bossHtml!==this.bossBarContent){this.bossBar.innerHTML=bossHtml;this.bossBarContent=bossHtml;}
    this.bossBar.hidden=!boss||this.building||this.mapOpen;
    // Horde alert: the whole HUD flashes red from the first warning until the last hostile is gone.
    const warning=this.model.horde.warning,hunting=this.model.hordeCount,alert=(warning>0||hunting>0)&&!this.model.dead;
    const banner=warning>0?`<strong>ALERT</strong><span>HORDE INBOUND · ${Math.ceil(warning)}</span><small>Fight, or dock at a station to lose them</small>`:hunting?`<strong>HORDE</strong><span>${hunting} of ${Math.max(hunting,this.model.horde.total)} hostiles left</span>`:'';
    if(banner!==this.hordeBannerContent){this.hordeBanner.innerHTML=banner;this.hordeBannerContent=banner;}
    this.hordeBanner.hidden=!alert||this.building||this.mapOpen;this.hordeBanner.classList.toggle('boss-below',Boolean(boss));
    document.body.classList.toggle('horde-alert',alert);document.body.classList.toggle('horde-warning',alert&&warning>0);
    }
    this.status.textContent = this.paused ? 'PAUSED — Press Esc to resume' : this.model.message;
    this.status.classList.toggle('urgent', this.model.dead || this.paused);
  }
  private refreshSeedLabel() {
    const label = this.sessionControls.querySelector<HTMLElement>('#world-seed');
    if (label) { label.textContent = `WORLD SEED: ${this.model.seed}`; label.title = this.model.seed; }
  }
  private paintBackdropTextures() {
    const layers=paintBackdrop(hashSeed(this.model.seed + ':stars') || 47);
    for(const [name,canvas] of Object.entries(layers)){
      const key=`backdrop-${name}`;
      if(!this.textures.exists(key)){this.textures.addCanvas(key,canvas);continue;}
      const texture=this.textures.get(key) as Phaser.Textures.CanvasTexture;
      texture.context.clearRect(0,0,canvas.width,canvas.height);texture.context.drawImage(canvas,0,0);texture.refresh();
    }
    // Re-read the repainted source; a tile sprite's own texture is its internal canvas, not the tile.
    for(const layer of this.backdrop){layer.sprite.setTexture(layer.key);layer.sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);}
  }
  private switchModel(model: GameModel) {
    for (const sprite of this.asteroidSprites) sprite.destroy(); this.asteroidSprites = [];
    for (const cache of this.asteroidCache.values()) this.textures.remove(cache.key); this.asteroidCache.clear();
    this.effects.clear();this.audio.setLoop('mine',0);this.audio.setLoop('tractor',0);
    this.model = model; this.building = false; this.mapOpen = false; this.paused = false; this.movingModule = false; this.selectedCell = { x: 0, y: 0 };this.detailMode='module';this.buildCenter={x:0,y:0};
    this.lastBullet = -1; this.builderContent = ''; this.hudElapsed = 100; this.mapElapsed = 200; this.saveElapsed = 0;
    this.baseLabels.forEach((label, i) => label.setPosition(model.bases[i].x, model.bases[i].y - 172));
    this.follow.setPosition(model.player.x, model.player.y); this.cameras.main.centerOn(model.player.x, model.player.y);
    this.paintBackdropTextures();
    this.refreshSeedLabel(); this.input.keyboard!.enabled = true;
  }
  private drawMinimap() {
    const g = this.minimap; g.clear();
    const zoom = this.cameras.main.zoom;
    g.setScale(1 / zoom); g.setPosition(this.scale.width / 2 * (1 - 1 / zoom), this.scale.height / 2 * (1 - 1 / zoom));
    this.mapLabel.setScale(1 / zoom);
    const size = 140, left = this.scale.width - size - 12, top = this.scale.height - size - 12;
    this.mapLabel.setPosition((left + 8 - this.scale.width / 2) / zoom + this.scale.width / 2, (top - 17 - this.scale.height / 2) / zoom + this.scale.height / 2);
    const map = (p: { x: number; y: number }) => ({ x: left + p.x / WORLD.width * size, y: top + p.y / WORLD.height * size });
    g.fillStyle(0x0b111d, 0.85); g.fillRect(left, top, size, size);
    g.lineStyle(1, 0x344252); g.strokeRect(left, top, size, size);
    for (const key of this.model.explored) {
      const [x, y] = key.split(',').map(Number); g.fillStyle(0x213c50, 0.6);
      g.fillRect(left + x * EXPLORATION.cell / WORLD.width * size, top + y * EXPLORATION.cell / WORLD.height * size, EXPLORATION.cell / WORLD.width * size + 0.5, EXPLORATION.cell / WORLD.height * size + 0.5);
    }
    for (const a of this.model.chartedAsteroids) { if (!this.model.isExplored(a)) continue; const p = map(a); g.fillStyle(RESOURCES[a.ore].color, 0.65); g.fillRect(p.x, p.y, 1, 1); }
    for (const base of this.model.bases) { if (!this.model.isExplored(base)) continue; const p = map(base); g.lineStyle(1, base.unlocked ? 0x75e2ac : 0xe7b477); g.strokeRect(p.x - 2, p.y - 2, 4, 4); }
    g.fillStyle(0xe15e68); for (const e of this.model.enemies) { if (!this.model.isExplored(e) || Math.hypot(e.x - this.model.player.x, e.y - this.model.player.y) > 1100) continue; const p = map(e); g.fillCircle(p.x, p.y, 1.5); }
    const p = map(this.model.player); g.fillStyle(0xffffff); g.fillCircle(p.x, p.y, 3);
    const view = this.cameras.main.worldView;
    g.lineStyle(1, 0x73c9ee, 0.5); g.strokeRect(left + view.x / WORLD.width * size, top + view.y / WORLD.height * size, view.width / WORLD.width * size, view.height / WORLD.height * size);
  }
  private renderBuilder() {
    this.builder.hidden = !this.building;
    if (!this.building || this.moduleDragActive) return;
    const content=outfitterMarkup(this.model,{selectedModule:this.selectedModule,selectedCell:this.selectedCell,mode:this.detailMode,query:this.catalogQuery,category:this.catalogCategory,center:this.buildCenter,radius:this.gridRadius,moving:this.movingModule,failed:this.actionFailed},this.iconUrls);
    if (content !== this.builderContent) {
      const scrolls=['.catalog-list','.detail-body','.grid-scroll'].map(selector=>{const element=this.builder.querySelector<HTMLElement>(selector);return {selector,top:element?.scrollTop??0,left:element?.scrollLeft??0};});
      const top=this.builder.scrollTop,left=this.builder.scrollLeft;
      this.builder.innerHTML=content;this.builderContent=content;
      for(const saved of scrolls){const element=this.builder.querySelector<HTMLElement>(saved.selector);if(element){element.scrollTop=saved.top;element.scrollLeft=saved.left;}}
      this.builder.scrollTop=top;this.builder.scrollLeft=left;
    }
  }
  private directionToStation() {
    const p = this.model.player;
    if (this.model.atStation) return '· E to unload & repair';
    const base = this.model.bases.filter(base => this.model.isExplored(base) || base.unlocked).reduce((best, base) => Math.hypot(p.x - base.x, p.y - base.y) < Math.hypot(p.x - best.x, p.y - best.y) ? base : best);
    const a = Math.atan2(base.y - p.y, base.x - p.x);
    return ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][(Math.round(a / (Math.PI / 4)) + 8) % 8];
  }
  private draw() {
    const g = this.graphics; g.clear();this.effectsGraphics.clear();
    const view = this.cameras.main.worldView;
    const now=this.time.now/1000;
    for(const {sprite,factor,scale} of this.backdrop){
      // Viewport-sized layers; slower factors sit further away. Anchored on the view centre so zoom stays stable.
      const width=Math.ceil((view.width+160)/scale),height=Math.ceil((view.height+160)/scale);
      if(sprite.width!==width||sprite.height!==height)sprite.setSize(width,height);
      sprite.setPosition(view.x-80,view.y-80).setTilePosition(Math.round((view.centerX*factor-view.width/2-80)/scale),Math.round((view.centerY*factor-view.height/2-80)/scale));
    }
    const visible = (p: { x: number; y: number }) => p.x >= view.x - 80 && p.y >= view.y - 80 && p.x <= view.right + 80 && p.y <= view.bottom + 80;
    g.lineStyle(2, 0x34526a); g.strokeRect(0, 0, WORLD.width, WORLD.height);
    this.model.bases.forEach((base, i) => {
      const inView = base.x > view.x - 300 && base.x < view.right + 300 && base.y > view.y - 300 && base.y < view.bottom + 300;
      this.baseLabels[i].setVisible(inView);
      this.stationSprites[i]?.setVisible(inView).setPosition(base.x,base.y).setTexture(base.unlocked?'station-on':'station-off');
      if (!inView) return;
      // Landing beacon: one expanding ring over the baked pad.
      const beat=(now*.45+i*.37)%1;
      g.lineStyle(1.5,base.unlocked?0x8df0bf:0xf0c98a,(1-beat)*.55);g.strokeCircle(base.x,base.y,20+beat*22);
      this.baseLabels[i].setText(`${base.name.toUpperCase()} / ${base.unlocked ? 'ACTIVE' : 'LOCKED'}\n${base.unlocked ? 'E  REPAIR + UNLOAD   Q  SHOP' : 'G  ACTIVATE: ' + Object.entries(base.cost).filter(([, n]) => n).map(([ore, n]) => `${n} ${ore}`).join(' + ')}`);
    });
    let rockIndex = 0;
    for (const a of this.model.asteroids) if (visible(a)) {
      const shape = ensureAsteroidGeometry(a), cache = this.asteroidCache.get(a.id);
      const key = `asteroid-${a.id}`;
      if (!cache || cache.revision !== shape.revision) {
        // Re-rasterize only when a visible polygon changes.
        const pixels=ASTEROID_SPRITE.size*ASTEROID_SPRITE.scale;
        const fresh=!this.textures.exists(key),texture=(fresh?this.textures.createCanvas(key,pixels,pixels):this.textures.get(key)) as Phaser.Textures.CanvasTexture;
        if(fresh)texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        paintAsteroid(texture.context,a);texture.refresh();
        this.asteroidCache.set(a.id, { revision: shape.revision, key, used: this.time.now });
      } else cache.used = this.time.now;
      const sprite = this.asteroidSprites[rockIndex] ?? this.add.image(0, 0, key).setDepth(-1);
      this.asteroidSprites[rockIndex++] = sprite;
      sprite.setVisible(true).setPosition(a.x, a.y).setTexture(key).setScale(1/ASTEROID_SPRITE.scale).setRotation(a.rotation??0);
    }
    for (; rockIndex < this.asteroidSprites.length; rockIndex++) this.asteroidSprites[rockIndex].setVisible(false);
    if (this.asteroidCache.size > 128) {
      const oldest = [...this.asteroidCache.entries()].filter(([, c]) => c.used < this.time.now).sort((a, b) => a[1].used - b[1].used);
      for (const [id, entry] of oldest.slice(0, this.asteroidCache.size - 128)) { this.textures.remove(entry.key); this.asteroidCache.delete(id); }
    }
    for (const block of this.model.detachedModules) {
      if (!visible(block)) continue;
      drawModule(g, block.x, block.y, block.angle, block.kind, MODULES[block.kind].color, block.level);
    }
    for (const link of this.model.tractorLinks) drawEnergyBeam(g,link,this.effects.time,'tractor',this.effects.enabled);
    this.model.drops.forEach((d,i)=>{
      if (!visible(d)) return;
      // Pixel gem: stepped diamond, lit upper-left half, shaded lower-right, gentle bob.
      const color=RESOURCES[d.ore].color,x=Math.round(d.x),y=Math.round(d.y+Math.sin(now*3+i)*1.5),lightTone=mix(color,0xffffff,.6),darkTone=mix(color,0x000000,.5);
      [1,3,5,3,1].forEach((width,row)=>{
        const top=y-5+row*2,left=x-width;
        g.fillStyle(0x05070c);g.fillRect(left-2,top,width*2+4,2);
        g.fillStyle(row<2?color:darkTone);g.fillRect(left,top,width*2,2);
        if(row<3){g.fillStyle(lightTone);g.fillRect(left,top,row===2?4:width+1,2);}
      });
      g.fillStyle(0x05070c);g.fillRect(x-1,y-7,2,2);g.fillRect(x-1,y+5,2,2);
    });
    for (const bullet of this.model.bullets) if(visible(bullet)) drawProjectile(g,bullet,this.effects.enabled,this.effects.time);
    for (const pulse of this.model.empPulses) if(visible(pulse)) drawEmp(g,pulse,this.effects.enabled,this.effects.time);
    let enemyIndex=0;
    for (const e of this.model.enemies) {
      if (!visible(e)) continue;
      const kind=e.kind ?? 'raider';
      const hull=this.enemySprites[enemyIndex]??this.add.image(e.x,e.y,`enemy-${kind}`).setDepth(1);
      this.enemySprites[enemyIndex++]=hull;
      hull.setVisible(true).setPosition(e.x,e.y).setTexture(`enemy-${kind}`).setRotation(e.angle).setScale(1/ENEMY_SPRITE.scale);
      const def=ENEMIES[kind],half=Math.max(16,def.radius+4),top=e.y-def.radius-14;
      if (e.squad !== undefined) { g.fillStyle(0xa6c6dd, 0.7); g.fillRect(e.x - 5, top - 9, 2, 2); g.fillRect(e.x - 1, top - 9, 2, 2); g.fillRect(e.x + 3, top - 9, 2, 2); }
      if (!def.weakPoint) {
        g.fillStyle(0x05070c); g.fillRect(e.x - half - 1, top - 1, half * 2 + 2, 6);
        g.fillStyle(0x481d26); g.fillRect(e.x - half, top, half * 2, 4); g.fillStyle(0xee7f89); g.fillRect(e.x - half, top, half * 2 * Math.min(1, Math.max(0, e.health) / def.health), 4);
      }
      // Awareness pip: amber while searching, red while fighting, white while breaking off.
      const mood=e.state==='investigate'?0xffd166:e.state==='retreat'?0xe8f1f8:e.state&&e.state!=='patrol'&&e.state!=='return'?0xff4d6d:0;
      if(mood){g.fillStyle(0x05070c);g.fillRect(e.x+half+2,top-1,6,6);g.fillStyle(mood);g.fillRect(e.x+half+3,top,4,4);}
      if (def.shield > 0) {
        // Shield strength: a blue bar over the hull bar and a ring that brightens with charge.
        const charge=Math.max(0,e.shield??def.shield)/def.shield;
        g.fillStyle(0x05070c); g.fillRect(e.x - half - 1, top - 5, half * 2 + 2, 4); g.fillStyle(0x7fd0ff); g.fillRect(e.x - half, top - 4, half * 2 * Math.min(1, charge), 2);
        if (charge > 0) { g.lineStyle(1.5, 0x8fd4ff, 0.2 + charge * 0.45); g.strokeCircle(e.x, e.y, def.radius + 7); }
      }
      if ((e.surge ?? 0) > 0) {
        // Shield surge: pulsing rings show the boss is recharging rather than firing.
        const pulse = (now * 2) % 1;
        g.lineStyle(2, 0xbdf3ff, 0.75 - pulse * 0.6); g.strokeCircle(e.x, e.y, def.radius + 10 + pulse * 26);
        g.lineStyle(1.5, 0x7fd0ff, 0.7); g.strokeCircle(e.x, e.y, def.radius + 10);
      }
      if ((e.empCharge ?? 0) > 0 && def.boss?.emp) {
        // EMP warning: the blast ring fills in as the charge completes. Get outside it.
        const emp = def.boss.emp, progress = 1 - e.empCharge! / emp.charge;
        g.fillStyle(0x9db8ff, 0.03 + progress * 0.08); g.fillCircle(e.x, e.y, emp.radius);
        g.lineStyle(progress > 0.8 ? 3 : 1.5, progress > 0.8 ? 0xf2f6ff : 0x9db8ff, 0.35 + progress * 0.6); g.strokeCircle(e.x, e.y, emp.radius);
        g.lineStyle(1.5, 0x9db8ff, 0.5); g.strokeCircle(e.x, e.y, emp.radius * progress);
      }
      if (def.weakPoint && this.model.enemies.some(other => other.id === e.parent && other.phase2)) {
        // Exposed reactor vent: a flashing target marker.
        const flash = 0.45 + Math.sin(now * 9) * 0.35;
        g.lineStyle(2, 0xffe07a, flash); g.strokeCircle(e.x, e.y, def.radius + 5);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.lineBetween(e.x + dx * (def.radius + 3), e.y + dy * (def.radius + 3), e.x + dx * (def.radius + 10), e.y + dy * (def.radius + 10));
      }
      if (e.charge) {
        // Aiming warning: the line brightens while charging and turns solid once the shot is locked.
        const weapon=def.weapons[e.charge.weapon],progress=1-e.charge.t/(weapon.charge??1),locked=e.charge.t<=ENEMY_AI.chargeLock;
        g.lineStyle(locked?2:1, locked?0xffe0e6:0xff4d6d, locked?.9:.2+progress*.5);
        g.lineBetween(e.x+Math.cos(e.charge.angle)*def.radius,e.y+Math.sin(e.charge.angle)*def.radius,e.x+Math.cos(e.charge.angle)*def.range,e.y+Math.sin(e.charge.angle)*def.range);
        g.fillStyle(0xff4d6d,.35+progress*.5);g.fillCircle(e.x+Math.cos(e.charge.angle)*(def.radius+3),e.y+Math.sin(e.charge.angle)*(def.radius+3),2+progress*3);
      }
    }
    for(;enemyIndex<this.enemySprites.length;enemyIndex++)this.enemySprites[enemyIndex].setVisible(false);
    const p = this.model.player;
    this.targetLabel.setVisible(Boolean(this.model.minedTarget));
    if (this.model.minedTarget) {
      const a = this.model.minedTarget;
      this.targetLabel.setText(`${RESOURCES[a.ore].label.toUpperCase()} / ${a.amount} ORE`).setPosition(a.x, a.y + a.radius + 12);
    }
    if (!this.model.dead) {
      if (this.model.horde.warning > 0) {
        // Chevrons point at where the horde will arrive from.
        const a=this.model.horde.angle,blink=Math.floor(now*4)%2?0.95:0.4;
        g.fillStyle(0xff3355,blink);
        for(let i=0;i<3;i++){const d=150+i*16,x=p.x+Math.cos(a)*d,y=p.y+Math.sin(a)*d;g.fillTriangle(x+Math.cos(a)*10,y+Math.sin(a)*10,x+Math.cos(a+2.4)*9,y+Math.sin(a+2.4)*9,x+Math.cos(a-2.4)*9,y+Math.sin(a-2.4)*9);}
      }
      if (this.model.shield > 0) {
        const radius = Math.max(24, ...this.model.modules.map(m => Math.hypot(m.x, m.y) * BUILD_GRID.cellSize + 12));
        // Shield bubble: soft body, bright shell and a specular arc on the lit side.
        const charge=this.model.shield / this.model.maxShield;
        g.fillStyle(0x71e1ff, 0.035); g.fillCircle(p.x, p.y, radius);
        g.lineStyle(4, 0x71e1ff, 0.06 + charge * 0.08); g.strokeCircle(p.x, p.y, radius + 1.5);
        g.lineStyle(1.3, 0xa9ecff, 0.25 + charge * 0.4); g.strokeCircle(p.x, p.y, radius);
        g.lineStyle(2, 0xffffff, 0.15 + charge * 0.3); g.beginPath(); g.arc(p.x, p.y, radius - 2.5, -2.75, -1.75); g.strokePath();
      }
      const heading=this.building?-Math.PI/2:p.angle;
      const blocks=[{x:0,y:0,kind:'core' as EquipmentKind,level:this.model.coreLevel},...this.model.modules];
      const occupied=new Set(blocks.map(m=>`${m.x},${m.y}`));let index=0;
      // World-fixed cast shadow: the ship reads as flying above stations and debris.
      g.fillStyle(0x000000,.3);
      for(const m of blocks){const point=this.model.modulePoint(m,heading);if(!visible(point))continue;g.save();g.translateCanvas(point.x+5,point.y+8);g.rotateCanvas(heading);g.fillRect(-8,-8,16,16);g.restore();}
      g.lineStyle(6,0x172b3c);
      for(const m of blocks){
        const point=this.model.modulePoint(m,heading);
        for(const [dx,dy]of [[1,0],[0,1]])if(occupied.has(`${m.x+dx},${m.y+dy}`)){const other=this.model.modulePoint({x:m.x+dx,y:m.y+dy},heading);if(visible(point)||visible(other))g.lineBetween(point.x,point.y,other.x,other.y);}
        if(!visible(point))continue;
        const sprite=this.shipSprites[index]??this.add.image(point.x,point.y,`icon-${m.kind}-${m.level}`).setDepth(1);
        this.shipSprites[index++]=sprite;sprite.setVisible(true).setPosition(point.x,point.y).setTexture(`icon-${m.kind}-${m.level}`).setRotation(heading+Math.PI/2);
      }
      for(;index<this.shipSprites.length;index++)this.shipSprites[index].setVisible(false);
    }else for(const sprite of this.shipSprites)sprite.setVisible(false);
    for(const field of this.model.novaFields)if(visible(field)){
      g.fillStyle(0x99ff80,this.effects.enabled?.09:.025);g.fillCircle(field.x,field.y,field.radius);
      g.lineStyle(1,0xb1ff91,this.effects.enabled?.5:.2);g.strokeCircle(field.x,field.y,field.radius);
    }
    if(this.effects.enabled&&this.model.modules.some(m=>m.kind==='engine'&&(m.ability?.phase??0)>0)){
      g.lineStyle(1,0x94ddff,.6);g.strokeCircle(p.x-p.vx*.07,p.y-p.vy*.07,18);g.strokeCircle(p.x-p.vx*.14,p.y-p.vy*.14,14);
    }
    for (const link of this.model.miningLinks) drawEnergyBeam(g,link,this.effects.time,'mining',this.effects.enabled);
    drawParticles(this.effectsGraphics,this.effects);
    if (!this.building && !this.paused) {
      const pointer = this.input.activePointer;
      const aim = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      g.lineStyle(1, 0xc2dbe7, 0.7); g.strokeCircle(aim.x, aim.y, 7);
      g.lineBetween(aim.x - 12, aim.y, aim.x - 5, aim.y); g.lineBetween(aim.x + 5, aim.y, aim.x + 12, aim.y);
      g.lineBetween(aim.x, aim.y - 12, aim.x, aim.y - 5); g.lineBetween(aim.x, aim.y + 5, aim.x, aim.y + 12);
    }
  }
}
new Phaser.Game({ type: new URLSearchParams(location.search).get('renderer')==='webgl'?Phaser.WEBGL:Phaser.CANVAS, parent: 'game', backgroundColor: '#080e1a', scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, scene: SpaceScene, render: { antialias: true } });
