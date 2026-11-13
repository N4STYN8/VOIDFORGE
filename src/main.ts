import Phaser from 'phaser';
import { GameSettings } from './settings.ts';
import { moduleDrag } from './moduleDrag.ts';
import { flightHud } from './hud.ts';
import { outfitterMarkup } from './outfitter.ts';
import { EffectPool } from './effects.ts';
import { drawParticles, drawEnergyBeam, drawProjectile, drawEmp } from './effectsRender.ts';
import { GameModel } from './model.ts';
import { WORLD, SHIP, RESOURCES, ENEMIES, EXPLORATION, MODULES, BUILD_GRID, equipment, upgradeCost, statsLabel, type EquipmentKind, type ModuleKind } from './data.ts';
import './style.css';
import { hashSeed } from './world.ts';
import { loadSavedGame, saveGame, backupSavedGame } from './persistence.ts';
import { GameAudio } from './audio.ts';
import { drawExplorationMap } from './map.ts';
import { ensureAsteroidGeometry } from './mining.ts';
import { drawModule, drawAsteroid, drawStation } from './visuals.ts';
class SpaceScene extends Phaser.Scene {
  private effects = new EffectPool();
  private saveElapsed = 0;
  private sessionControls = document.createElement('section');
  private hudContent='';
  private hudElapsed = 0;
  private mapElapsed = 0;
  private asteroidCache = new Map<number, { revision: number; key: string; used: number }>();
  private asteroidBaker!: Phaser.GameObjects.Graphics;
  private iconUrls = new Map<string, string>();
  private background!:Phaser.GameObjects.TileSprite;
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
  private status = document.getElementById('status')!;
  create() {
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
    this.mapWindow.innerHTML = '<header><div><small>NAVIGATION / EXPLORED SPACE</small><h2>Sector map</h2></div><button id="close-map">Close · M / Esc</button></header><canvas width="640" height="640" aria-label="Explored space map"></canvas><p>Dark areas are unexplored · Green: active base · Amber: locked base<br>Explore to discover outposts. G activates nearby locked bases · Wheel zooms · Drag pans.</p>';
    document.body.append(this.mapWindow); this.mapCanvas = this.mapWindow.querySelector('canvas')!;
    this.mapWindow.querySelector('button')!.addEventListener('click', () => { this.mapOpen = false; });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x >= this.scale.width - 152 && pointer.y >= this.scale.height - 152) this.mapOpen = !this.mapOpen;
    });
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
    this.effectsGraphics=this.add.graphics().setDepth(4);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(20);
    // Bake the background once; one repeated texture replaces thousands of paths/frame.
    const tile = document.createElement('canvas'); tile.width = tile.height = 640;
    const context = tile.getContext('2d')!;
    context.fillStyle = '#080e1a'; context.fillRect(0, 0, 640, 640);
    let seed = hashSeed(this.model.seed + ':stars') || 47;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 45; i++) { context.fillStyle = i % 7 === 0 ? '#a9cfe5' : '#43576e'; context.fillRect(random() * 640, random() * 640, i % 7 === 0 ? 1.5 : 1, 1); }
    context.strokeStyle = '#101e2c'; context.lineWidth = 1;
    for (let i = 0; i < 640; i += 160) { context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 640); context.moveTo(0, i); context.lineTo(640, i); context.stroke(); }
    this.textures.addCanvas('starfield', tile);
    this.background=this.add.tileSprite(0,0,this.scale.width+160,this.scale.height+160,'starfield').setOrigin(0).setDepth(-2);
    this.asteroidBaker = this.add.graphics().setVisible(false);
    for (const kind of ['core', ...Object.keys(MODULES)] as EquipmentKind[]) for (let level = 1; level <= 3; level++) {
      const key = `icon-${kind}-${level}`, cache = this.add.graphics();
      drawModule(cache, 24, 24, -Math.PI / 2, kind, equipment(kind).color, level);
      cache.generateTexture(key, 48, 48); cache.destroy();
      const cropped=document.createElement('canvas');cropped.width=cropped.height=24;cropped.getContext('2d')!.drawImage(this.textures.get(key).getSourceImage() as HTMLCanvasElement,12,12,24,24,0,0,24,24);this.iconUrls.set(`${kind}-${level}`,cropped.toDataURL());
    }
    this.baseLabels = this.model.bases.map(base => this.add.text(base.x, base.y - 77, '', { fontFamily: 'monospace', fontSize: '10px', color: '#a0d6cc', align: 'center', lineSpacing: 5 }).setOrigin(0.5));
    this.targetLabel = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '10px', color: '#b5ebdf', backgroundColor: '#0b1423', padding: { x: 6, y: 3 } }).setOrigin(0.5, 0).setDepth(5);
    this.mapLabel = this.add.text(0, 0, 'SECTOR MAP / M', { fontFamily: 'monospace', fontSize: '9px', color: '#91afc5', letterSpacing: 1 }).setScrollFactor(0).setDepth(21);
    this.follow = this.add.zone(this.model.player.x, this.model.player.y, 1, 1);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height).setZoom(1.35).startFollow(this.follow, true, 0.15, 0.15);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,E,R,ESC,B,Q,M,N,G,V,SHIFT') as Record<string, Phaser.Input.Keyboard.Key>;
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
      aim, fire: pointer.leftButtonDown(), boost, mine: pointer.rightButtonDown() || this.keys.SPACE.isDown, dock, view: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
    if (!this.paused && !this.building && !this.mapOpen && !this.settings.open) {
      for(const event of this.model.effects){if(event.type==='muzzle'&&event.weapon)this.audio.playWeapon(event.weapon);if(event.type==='collection')this.audio.play('collect');if(event.type==='shield')this.audio.play('shield');}
      if (this.model.player.health < beforeHull || this.model.shield < beforeShield) this.audio.play('impact');
      if (this.model.oreHits > beforeOreHits) this.audio.play('impact');
      if (this.model.enemyHits > beforeHits) this.audio.play('hit');
      if (this.model.kills > beforeKills) this.audio.play('explosion');
    }
    const audible=!this.paused&&!this.building&&!this.mapOpen&&!this.settings.open&&!this.model.dead;
    this.audio.setLoop('mine',audible?this.model.miningLinks.length:0);this.audio.setLoop('tractor',audible?this.model.tractorLinks.length:0);
    for (const b of this.model.bullets) this.lastBullet = Math.max(this.lastBullet, b.id);
    if (!this.paused && !this.building && !this.mapOpen && !this.settings.open) {
      this.effects.update(Math.min(delta/1000,.05),bounds);this.effects.consume(this.model.effects,bounds);this.effects.continuous(this.model.miningLinks,this.model.bullets,bounds);
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
    }
    this.status.textContent = this.paused ? 'PAUSED — Press Esc to resume' : this.model.message;
    this.status.classList.toggle('urgent', this.model.dead || this.paused);
  }
  private refreshSeedLabel() {
    const label = this.sessionControls.querySelector<HTMLElement>('#world-seed');
    if (label) { label.textContent = `WORLD SEED: ${this.model.seed}`; label.title = this.model.seed; }
  }
  private switchModel(model: GameModel) {
    for (const sprite of this.asteroidSprites) sprite.destroy(); this.asteroidSprites = [];
    for (const cache of this.asteroidCache.values()) this.textures.remove(cache.key); this.asteroidCache.clear();
    this.effects.clear();this.audio.setLoop('mine',0);this.audio.setLoop('tractor',0);
    this.model = model; this.building = false; this.mapOpen = false; this.paused = false; this.movingModule = false; this.selectedCell = { x: 0, y: 0 };this.detailMode='module';this.buildCenter={x:0,y:0};
    this.lastBullet = -1; this.builderContent = ''; this.hudElapsed = 100; this.mapElapsed = 200; this.saveElapsed = 0;
    this.baseLabels.forEach((label, i) => label.setPosition(model.bases[i].x, model.bases[i].y - 77));
    this.follow.setPosition(model.player.x, model.player.y); this.cameras.main.centerOn(model.player.x, model.player.y);
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
    if (content !== this.builderContent) { this.builder.innerHTML = content; this.builderContent = content; }
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
    this.background.setPosition(view.x-80,view.y-80).setTilePosition(view.x-80,view.y-80);if(this.background.width!==Math.ceil(view.width)+160||this.background.height!==Math.ceil(view.height)+160)this.background.setSize(Math.ceil(view.width)+160,Math.ceil(view.height)+160);
    const visible = (p: { x: number; y: number }) => p.x >= view.x - 80 && p.y >= view.y - 80 && p.x <= view.right + 80 && p.y <= view.bottom + 80;
    g.lineStyle(2, 0x34526a); g.strokeRect(0, 0, WORLD.width, WORLD.height);
    this.model.bases.forEach((base, i) => {
      const inView = base.x > view.x - 300 && base.x < view.right + 300 && base.y > view.y - 300 && base.y < view.bottom + 300;
      this.baseLabels[i].setVisible(inView);
      if (!inView) return;
      drawStation(g, base);
      this.baseLabels[i].setText(`${base.name.toUpperCase()} / ${base.unlocked ? 'ACTIVE' : 'LOCKED'}\n${base.unlocked ? 'E  REPAIR + UNLOAD   Q  SHOP' : 'G  ACTIVATE: ' + Object.entries(base.cost).filter(([, n]) => n).map(([ore, n]) => `${n} ${ore}`).join(' + ')}`);
    });
    let rockIndex = 0;
    for (const a of this.model.asteroids) if (visible(a)) {
      const shape = ensureAsteroidGeometry(a), cache = this.asteroidCache.get(a.id);
      const key = `asteroid-${a.id}`;
      if (!cache || cache.revision !== shape.revision) {
        // Reuse one baker; re-rasterize only when a visible polygon changes.
        this.asteroidBaker.clear(); drawAsteroid(this.asteroidBaker, a, { x: 48, y: 48 });
        if(this.textures.exists(key)){const canvas=this.textures.get(key).getSourceImage() as HTMLCanvasElement;canvas.getContext('2d')!.clearRect(0,0,96,96);}
        this.asteroidBaker.generateTexture(key, 96, 96);
        this.asteroidCache.set(a.id, { revision: shape.revision, key, used: this.time.now });
      } else cache.used = this.time.now;
      const sprite = this.asteroidSprites[rockIndex] ?? this.add.image(0, 0, key).setDepth(-1);
      this.asteroidSprites[rockIndex++] = sprite;
      sprite.setVisible(true).setPosition(a.x, a.y).setTexture(key).setScale(1);
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
    for (const d of this.model.drops) { if (!visible(d)) continue; g.lineStyle(1, RESOURCES[d.ore].color, 0.4); g.strokeCircle(d.x, d.y, 10); g.fillStyle(RESOURCES[d.ore].color); g.fillTriangle(d.x, d.y - 5, d.x - 5, d.y + 4, d.x + 5, d.y + 4); }
    for (const bullet of this.model.bullets) if(visible(bullet)) drawProjectile(g,bullet,this.effects.enabled,this.effects.time);
    for (const pulse of this.model.empPulses) if(visible(pulse)) drawEmp(g,pulse,this.effects.enabled,this.effects.time);
    for (const e of this.model.enemies) {
      if (!visible(e)) continue;
      const def = ENEMIES[e.kind ?? 'raider'];
      g.save(); g.translateCanvas(e.x, e.y); g.scaleCanvas(def.radius / 17, def.radius / 17); this.ship(0, 0, e.angle, def.color); g.restore();
      if (e.squad !== undefined) { g.fillStyle(0xa6c6dd, 0.7); g.fillCircle(e.x - 4, e.y - 35, 1.5); g.fillCircle(e.x, e.y - 35, 1.5); g.fillCircle(e.x + 4, e.y - 35, 1.5); }
      g.fillStyle(0x481d26); g.fillRect(e.x - 20, e.y - 29, 40, 4); g.fillStyle(0xee7f89); g.fillRect(e.x - 20, e.y - 29, 40 * e.health / ENEMIES[e.kind ?? 'raider'].health, 4);
    }
    const p = this.model.player;
    this.targetLabel.setVisible(Boolean(this.model.minedTarget));
    if (this.model.minedTarget) {
      const a = this.model.minedTarget;
      this.targetLabel.setText(`${RESOURCES[a.ore].label.toUpperCase()} / ${a.amount} ORE`).setPosition(a.x, a.y + a.radius + 12);
    }
    if (!this.model.dead) {
      if (this.model.shield > 0) {
        const radius = Math.max(24, ...this.model.modules.map(m => Math.hypot(m.x, m.y) * BUILD_GRID.cellSize + 12));
        g.fillStyle(0x71e1ff, 0.035); g.fillCircle(p.x, p.y, radius); g.lineStyle(1.5, 0x71e1ff, 0.25 + this.model.shield / this.model.maxShield * 0.4); g.strokeCircle(p.x, p.y, radius);
      }
      const heading=this.building?-Math.PI/2:p.angle;
      const blocks=[{x:0,y:0,kind:'core' as EquipmentKind,level:this.model.coreLevel},...this.model.modules];
      const occupied=new Set(blocks.map(m=>`${m.x},${m.y}`));let index=0;
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
  private ship(x: number, y: number, angle: number, color: number) {
    const g = this.graphics;
    g.save(); g.translateCanvas(x, y); g.rotateCanvas(angle);
    g.fillStyle(0x151a29); g.fillTriangle(23, 0, -16, -15, -16, 15);
    g.fillStyle(color); g.fillTriangle(20, 0, -12, -11, -5, 0); g.fillTriangle(20, 0, -12, 11, -5, 0);
    g.fillStyle(0x733e52); g.fillRect(-13, -12, 8, 5); g.fillRect(-13, 7, 8, 5);
    g.fillStyle(0xffa48e); g.fillRect(-17, -11, 4, 3); g.fillRect(-17, 8, 4, 3);
    g.fillStyle(0xffd3c0); g.fillTriangle(9, 0, 0, -3, 0, 3);
    g.lineStyle(1, color); g.strokeTriangle(23, 0, -16, -15, -16, 15);
    g.restore();
  }
}
new Phaser.Game({ type: new URLSearchParams(location.search).get('renderer')==='webgl'?Phaser.WEBGL:Phaser.CANVAS, parent: 'game', backgroundColor: '#080e1a', scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, scene: SpaceScene, render: { antialias: true } });
