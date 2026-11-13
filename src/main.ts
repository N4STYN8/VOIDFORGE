import {FACTIONS} from './fleetConfig.ts';
import Phaser from 'phaser';
import { GameSettings } from './settings.ts';
import { moduleDrag } from './moduleDrag.ts';
import { flightHud } from './hud.ts';
import { Cockpit, type CockpitAction } from './cockpit.ts';
import { outfitterMarkup } from './outfitter.ts';
import { EffectPool } from './effects.ts';
import { drawParticles, drawEnergyBeam, drawProjectile, drawEmp } from './effectsRender.ts';
import { GameModel } from './model.ts';
import { cellOf, cellCenter, bounds as outpostBounds, outpostStats, storedTotal, structureAt, maxHealth, turretOf, dronesOf, outputOf, type Outpost, type Structure } from './outposts.ts';
import { WORLD, SHIP, RESOURCES, ENEMIES, ENEMY_AI, WAYPOINTS, OUTPOST, STRUCTURES, STRUCTURE_ABILITIES, type StructureKind, type Resource, EXPLORATION, MODULES, BUILD_GRID, equipment, upgradeCost, statsLabel, type EquipmentKind, type ModuleKind, FLEET } from './data.ts';
import './style.css';
import './cockpit.css';
import './outfitter.css';
import './map.css';
import { hashSeed } from './world.ts';
import { loadSavedGame, saveGame, saveText, backupSavedGame } from './persistence.ts';
/** The save found at start-up; storage is read before the game is created because the large store is asynchronous. */
let startModel: GameModel | null = null;
import { GameAudio } from './audio.ts';
import { drawExplorationMap, mapToWorld } from './map.ts';
import { drawRadar, drawCompass } from './nav.ts';
import { ensureAsteroidGeometry } from './mining.ts';
import { drawModule } from './visuals.ts';
import { paintBackdrop, paintAsteroid, paintStation, paintEnemy, paintOutpost, paintStructureIcon, paintTurretHead, paintDrone, crispModule, paintHull, mix, ASTEROID_SPRITE, ENEMY_SPRITE, STATION_SPRITE } from './sprites.ts';
class SpaceScene extends Phaser.Scene {
  private cockpit!:Cockpit;
  private commandInput=new Set<CockpitAction>();
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
  private mapFollow = true;
  private mapPointer = false;
  private mapView = { zoom: 8, centerX: 0.5, centerY: 0.5 };
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
  private model = startModel ?? new GameModel();
  /** Shows a storage failure that only became known after an asynchronous write. */
  private saveFailed = (message: string) => { this.model.message = message; };
  private targetLabel!: Phaser.GameObjects.Text;
  private radar = document.createElement('section'); private radarCanvas = document.createElement('canvas'); private radarRange = 1; private compass = document.createElement('canvas');
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
  // Build Mode (outpost construction).
  private buildMode = false; private buildKind: StructureKind = 'outpostCore'; private buildRot = 0; private buildHeld = ''; private buildWasDown = false; private buildHover = '';
  private buildSelected?: { outpost: number; block: number };
  private buildPanel = document.createElement('section'); private buildPanelContent = ''; private buildToggle = document.createElement('button');
  private structureIcons = new Map<StructureKind, string>();
  private gridGraphics!: Phaser.GameObjects.Graphics; private buildGhost!: Phaser.GameObjects.Image;
  private outpostSprites = new Map<number, { image: Phaser.GameObjects.Image; revision: number }>();
  private turretSprites: Phaser.GameObjects.Image[] = []; private turretIndex = 0;
  private droneSprites: Phaser.GameObjects.Image[] = []; private droneIndex = 0;
  private outpostPanel = document.createElement('section'); private outpostPanelContent = ''; private panelOutpost?: Outpost;
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
    this.cockpit=new Cockpit(this.sessionControls,action=>this.cockpitCommand(action));
    this.sessionControls.querySelector('[data-settings]')!.addEventListener('click',()=>this.settings.show());
    this.sessionControls.addEventListener('focusin', event => { if ((event.target as HTMLElement).id === 'seed-input') { this.input.keyboard!.enabled = false; this.input.keyboard!.disableGlobalCapture(); this.paused = true; } });
    this.sessionControls.addEventListener('focusout', () => { this.input.keyboard!.enabled = true; this.input.keyboard!.enableGlobalCapture(); });
    this.sessionControls.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
      const action = button.dataset.session;
      if (action === 'save') this.model.message = saveGame(this.model, this.saveFailed) ?? 'World saved locally.';
      if (action === 'load') void loadSavedGame().then(saved => { if (saved) this.switchModel(saved); else this.model.message = 'No valid local save found.'; });
      if (action === 'new') {
        const input = this.sessionControls.querySelector<HTMLInputElement>('#seed-input')!;
        try { const next = input.value.trim() ? new GameModel(input.value.trim()) : new GameModel(); const backup = backupSavedGame(); this.switchModel(next); void backup.finally(() => saveGame(this.model, this.saveFailed)); input.value = ''; }
        catch { this.model.message = 'Could not generate that seed. Choose another seed.'; }
      }
      if (action === 'export') {
        const blob = new Blob([saveText(this.model)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `voidforge-${this.model.seed.replace(/[^a-z0-9-]/gi, '').slice(0, 40)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      button.blur();
    });
    this.sessionControls.querySelector<HTMLInputElement>('#import-save')!.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
      try { const model = GameModel.fromSave(JSON.parse(await file.text())); const backup = backupSavedGame(); this.switchModel(model); void backup.finally(() => saveGame(model, this.saveFailed)); }
      catch { this.model.message = 'That file is not a supported VOIDFORGE save.'; }
      input.value = '';
    });
    window.addEventListener('beforeunload', () => { saveGame(this.model); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(this.model); });
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
    this.mapWindow.id = 'map-window'; this.mapWindow.hidden = true;
    this.mapWindow.innerHTML = '<header><div><small>NAVIGATION / LIVE TELEMETRY</small><h2>Sector chart</h2></div><button id="close-map">Close · M / Esc</button></header><div class="map-toolbar"><button data-chart="follow" aria-pressed="true">Follow ship</button><button data-chart="world">World</button><button data-chart="out" aria-label="Zoom map out">−</button><button data-chart="in" aria-label="Zoom map in">+</button></div><div class="chart-surface"><canvas width="720" height="720" aria-label="Explored space map"></canvas><span class="chart-north">N ↑</span></div><div class="map-telemetry" aria-live="off"></div><div class="map-legend"><span>● Ship</span><span>■ Active base</span><span>◇ Locked / marker</span><span>● Contact</span></div><p>WASD flies · Shift bursts · Flight stays live<br>Wheel zooms · Drag pans · Click adds/removes a marker<br>Only explored space is charted. Threat tint: blue → amber → red.</p>';

    document.body.append(this.mapWindow); this.mapCanvas = this.mapWindow.querySelector('canvas')!;
    this.mapWindow.querySelector('#close-map')!.addEventListener('click', () => { this.setMapOpen(false); });
    this.mapWindow.addEventListener('pointerenter',()=>{this.mapPointer=true;});
    this.mapWindow.addEventListener('pointerleave',()=>{this.mapPointer=false;});
    this.mapWindow.querySelectorAll<HTMLButtonElement>('[data-chart]').forEach(button=>button.addEventListener('click',()=>{
      const action=button.dataset.chart;
      if(action==='follow'){this.mapFollow=true;this.mapView.zoom=8;}
      else if(action==='world'){this.mapFollow=false;this.mapView={zoom:1,centerX:.5,centerY:.5};}
      else {this.mapView.zoom=Phaser.Math.Clamp(this.mapView.zoom*(action==='in'?1.4:1/1.4),1,24);this.clampMap();}
      this.mapElapsed=200;button.blur();
    }));
    // Radar minimap (bottom right) and compass strip (top centre): DOM canvases so they stay crisp and scale with the HUD.
    this.radar.id = 'nav-radar'; this.radarCanvas.width = this.radarCanvas.height = 220;
    this.radar.innerHTML = '<header><small data-radar-label>RADAR</small><span><button data-radar="in" title="Zoom radar in">+</button><button data-radar="out" title="Zoom radar out">−</button><button data-radar="map" title="Open the sector map (M)">Map · M</button></span></header>';
    this.radar.append(this.radarCanvas); document.body.append(this.radar);
    this.radar.addEventListener('pointerdown', event => event.stopPropagation());
    this.radarCanvas.addEventListener('click', () => { this.setMapOpen(true); });
    this.radar.addEventListener('wheel', event => { event.preventDefault(); this.radarRange = Phaser.Math.Clamp(this.radarRange + (event.deltaY > 0 ? 1 : -1), 0, SpaceScene.RADAR_RANGES.length - 1); this.mapElapsed = 200; }, { passive: false });
    this.radar.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
      if (button.dataset.radar === 'map') this.setMapOpen(!this.mapOpen);
      else if (button.dataset.radar) this.radarRange = Phaser.Math.Clamp(this.radarRange + (button.dataset.radar === 'out' ? 1 : -1), 0, SpaceScene.RADAR_RANGES.length - 1);
      this.mapElapsed = 200; button.blur();
    });
    this.cockpit.mountRadar(this.radar);
    this.compass.id = 'compass'; this.compass.width = 1040; this.compass.height = 120; document.body.append(this.compass);
    const help = document.getElementById('help') as HTMLDetailsElement | null;
    if (help) { try { const saved=localStorage.getItem('voidforge.help');if(saved)help.open=saved==='open'; } catch { /* Defaults to compact help. */ } help.addEventListener('toggle', () => { try { localStorage.setItem('voidforge.help', help.open ? 'open' : 'closed'); } catch { /* Not persisted. */ } }); }
    this.bossBar.id = 'boss-bar'; this.bossBar.hidden = true; document.body.append(this.bossBar);
    this.buildPanel.id = 'build-panel'; this.buildPanel.hidden = true; document.body.append(this.buildPanel);
    this.buildPanel.addEventListener('pointerdown', event => event.stopPropagation());
    this.buildPanel.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
      if (button.dataset.structure) { this.buildKind = button.dataset.structure as StructureKind; this.buildSelected = undefined; }
      const chosen = this.selectedBlock();
      if (button.dataset.block && chosen) { const done = button.dataset.block === 'upgrade' ? this.model.upgradeStructure(chosen.outpost, chosen.structure) : this.model.repairStructure(chosen.outpost, chosen.structure); if (!done) this.audio.play('fail'); }
      if (button.dataset.block === 'deselect') this.buildSelected = undefined;
      if (button.dataset.buildClose) this.buildMode = false;
      button.blur(); this.renderBuildPanel();
    });
    this.outpostPanel.id = 'outpost-panel'; this.outpostPanel.hidden = true; document.body.append(this.outpostPanel);
    this.outpostPanel.addEventListener('pointerdown', event => event.stopPropagation());
    this.outpostPanel.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'), outpost = this.panelOutpost; if (!button || !outpost) return;
      const moved = button.dataset.outpost === 'deposit' ? this.model.depositToOutpost(outpost) : this.model.withdrawFromOutpost(outpost);
      this.audio.play(moved ? 'collect' : 'fail'); button.blur(); this.renderOutpostPanel();
    });
    this.buildToggle.id = 'build-toggle'; this.buildToggle.hidden = true; this.buildToggle.textContent = `Build mode · ${OUTPOST.key}`;
    this.buildToggle.addEventListener('pointerdown', event => event.stopPropagation());
    this.buildToggle.addEventListener('click', () => { this.toggleBuildMode(); this.buildToggle.blur(); });
    this.radar.append(this.buildToggle);
    this.textures.addCanvas('mining-drone', paintDrone())!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const kind of Object.keys(STRUCTURES) as StructureKind[]) if (STRUCTURES[kind].turret) this.textures.addCanvas(`turret-${kind}`, paintTurretHead(kind))!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const kind of Object.keys(STRUCTURES) as StructureKind[]) { const icon = paintStructureIcon(kind); this.structureIcons.set(kind, icon.toDataURL()); this.textures.addCanvas(`structure-${kind}`, icon)!.setFilter(Phaser.Textures.FilterMode.NEAREST); }
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
    this.builder.addEventListener('change',event=>{const select=event.target as HTMLSelectElement;if(select.id==='module-category'){this.catalogCategory=select.value;this.renderBuilder();}if(select.id==='ship-name'){this.model.renameShip(select.value);this.renderBuilder();}});
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
      if(button.dataset.ship){if(action(this.model.switchShip(Number(button.dataset.ship)))){this.selectedCell={x:0,y:0};this.detailMode='module';this.movingModule=false;this.buildCenter={x:0,y:0};}}
      else if(button.dataset.buyShip)action(this.model.buyShip());
      else if(button.dataset.paint){this.model.setShipPaint(Number(button.dataset.paint));this.audio.play('build');}
      else if(button.dataset.pan){const direction=button.dataset.pan;if(direction==='home')this.buildCenter={x:0,y:0};else{this.buildCenter.x+=direction==='right'?2:direction==='left'?-2:0;this.buildCenter.y+=direction==='down'?2:direction==='up'?-2:0;}}
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
    this.gridGraphics = this.add.graphics().setDepth(-2.5);
    this.buildGhost = this.add.image(0, 0, 'structure-wall').setDepth(2).setAlpha(0.6).setVisible(false);
    this.graphics = this.add.graphics();
    this.effectsGraphics=this.add.graphics().setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
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
    this.cockpit.setStationIcon((this.textures.get('station-on').getSourceImage() as HTMLCanvasElement).toDataURL());
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
    this.follow = this.add.zone(this.model.player.x, this.model.player.y, 1, 1);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height).setZoom(1.35).startFollow(this.follow, true, 0.15, 0.15);
    this.keys = this.input.keyboard!.addKeys(`W,A,S,D,SPACE,E,R,ESC,B,Q,M,N,G,V,SHIFT,C,${OUTPOST.key}`) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (!this.mapOpen && !this.building) this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * Math.exp(-dy * 0.001), 0.55, 2.2));
    });
    this.mapCanvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.mapFollow=false;
      const rect = this.mapCanvas.getBoundingClientRect();
      const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
      const previous = this.mapView.zoom, next = Phaser.Math.Clamp(previous * Math.exp(-event.deltaY * 0.0015), 1, 24);
      this.mapView.centerX = Phaser.Math.Clamp(this.mapView.centerX + (u - 0.5) * (1 / previous - 1 / next), 0.5 / next, 1 - 0.5 / next);
      this.mapView.centerY = Phaser.Math.Clamp(this.mapView.centerY + (v - 0.5) * (1 / previous - 1 / next), 0.5 / next, 1 - 0.5 / next);
      this.mapView.zoom = next; this.mapElapsed = 200;
    }, { passive: false });
    let drag: { x: number; y: number } | undefined;
    let travelled = 0;
    this.mapCanvas.addEventListener('pointerdown', event => { if(event.button!==0)return; drag = { x: event.clientX, y: event.clientY }; travelled = 0; this.mapCanvas.setPointerCapture(event.pointerId); });
    this.mapCanvas.addEventListener('pointermove', event => {
      if (!drag) return;
      this.mapFollow=false;
      const rect = this.mapCanvas.getBoundingClientRect(), z = this.mapView.zoom;
      this.mapView.centerX = Phaser.Math.Clamp(this.mapView.centerX - (event.clientX - drag.x) / rect.width / z, 0.5 / z, 1 - 0.5 / z);
      this.mapView.centerY = Phaser.Math.Clamp(this.mapView.centerY - (event.clientY - drag.y) / rect.height / z, 0.5 / z, 1 - 0.5 / z);
      travelled += Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
      drag = { x: event.clientX, y: event.clientY }; this.mapElapsed = 200;
    });
    this.mapCanvas.addEventListener('pointerup', event => {
      // A click (not a drag) drops a marker there, or removes the marker under the cursor.
      if (drag && travelled < 5) {
        const rect = this.mapCanvas.getBoundingClientRect(), point = mapToWorld(this.mapCanvas.width, this.mapView, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        const pick = WAYPOINTS.pickRadius * (this.mapCanvas.width / rect.width) / (this.mapCanvas.width / WORLD.width * this.mapView.zoom);
        if (point.x >= 0 && point.y >= 0 && point.x <= WORLD.width && point.y <= WORLD.height) this.audio.play(this.model.toggleWaypoint(point, pick) === 'full' ? 'fail' : 'collect');
        this.mapElapsed = 200;
      }
      drag = undefined;
    });
    this.mapCanvas.addEventListener('pointercancel', () => { drag = undefined; });
    this.input.mouse!.disableContextMenu();
    this.input.keyboard!.addCapture(['SPACE', 'W', 'A', 'S', 'D']);
    this.game.events.on('blur', () => { this.paused = true; });
  }
  update(_time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.M)) { this.setMapOpen(!this.mapOpen); this.building = false; }
    if ((Phaser.Input.Keyboard.JustDown(this.keys.B) || Phaser.Input.Keyboard.JustDown(this.keys.Q)) && !this.mapOpen) {
      if (this.building) this.building = false;
      else if (this.model.atStation && !this.model.dead) this.building = true;
      else this.model.message = 'Return to the green station to open the shop (Q).';
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      if (this.mapOpen) this.mapOpen = false;
      else if (this.buildMode) this.buildMode = false;
      else if (this.building) this.building = false;
      else this.paused = !this.paused;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) { if (this.buildMode) this.buildRot = (this.buildRot + 1) % 4; else this.model.respawn(); }
    if (Phaser.Input.Keyboard.JustDown(this.keys[OUTPOST.key]) && !this.building && !this.mapOpen && !this.settings.open) this.toggleBuildMode();
    if (this.buildMode && (this.model.buildModeError && !this.model.builder || this.building || this.mapOpen)) this.buildMode = false;
    if (Phaser.Input.Keyboard.JustDown(this.keys.N)){this.audio.toggleMute();this.settings.sync();}
    if(Phaser.Input.Keyboard.JustDown(this.keys.V)){this.effects.enabled=!this.effects.enabled;this.settings.persist();}
    const beforeHull = this.model.player.health, beforeShield = this.model.shield, beforeKills = this.model.kills, beforeHits = this.model.enemyHits, beforeOreHits = this.model.oreHits;
    if (Phaser.Input.Keyboard.JustDown(this.keys.G) && !this.paused && !this.building && !this.settings.open) { if (this.model.unlockBase()) this.audio.play('build'); }
    const boost=Phaser.Input.Keyboard.JustDown(this.keys.SHIFT)||this.commandInput.has('boost');
    const dock = Phaser.Input.Keyboard.JustDown(this.keys.E)||this.commandInput.has('dock');
    const pointer = this.input.activePointer;
    const aim = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const bounds = this.cameras.main.worldView;
    if (this.buildMode && !this.paused && !this.settings.open) this.updateBuildMode(aim, pointer);
    if (!this.paused && !this.building && !this.settings.open) this.model.update(delta / 1000, {
      x: Number(this.keys.D.isDown) - Number(this.keys.A.isDown), y: Number(this.keys.S.isDown) - Number(this.keys.W.isDown),
      aim, fire: !this.buildMode && !(this.mapOpen&&this.mapPointer) && pointer.leftButtonDown(), overclock:Phaser.Input.Keyboard.JustDown(this.keys.C)||this.commandInput.has('overclock'), boost, mine: !this.buildMode && ((!(this.mapOpen&&this.mapPointer)&&pointer.rightButtonDown()) || this.keys.SPACE.isDown), dock, view: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
    if (!this.paused && !this.building && !this.settings.open) {
      for(const event of this.model.effects){if(event.type==='cue'&&event.cue)this.audio.play(event.cue,event.pitch,event.volume);else if(event.type==='muzzle'&&event.weapon&&!event.silent)this.audio.playWeapon(event.weapon,event.level===5?.8:1);if(event.type==='arc')this.audio.play('pulse');if(event.type==='collection')this.audio.play('collect');if(event.type==='shield')this.audio.play('shield');}
      // Hull hits crunch, shield hits ring (the shield cue comes from its own event), and losing the ship has its own sound.
      if (this.model.dead && beforeHull > 0) this.audio.play('death'); else if (this.model.player.health < beforeHull) this.audio.play('hull');
      if (this.model.oreHits > beforeOreHits) this.audio.play('impact');
      if (this.model.enemyHits > beforeHits) this.audio.play('hit');
      if (this.model.kills > beforeKills) this.audio.play('explosion');
    }
    this.commandInput.clear();
    const audible=!this.paused&&!this.building&&!this.settings.open&&!this.model.dead;
    this.audio.setLoop('mine',audible?this.model.miningLinks.length:0);this.audio.setLoop('tractor',audible?this.model.tractorLinks.length:0);
    for (const b of this.model.bullets) this.lastBullet = Math.max(this.lastBullet, b.id);
    if (!this.paused && !this.building && !this.settings.open) {
      this.effects.update(Math.min(delta/1000,.05),bounds);this.effects.consume(this.model.effects,bounds);this.effects.continuous(this.model.miningLinks,this.model.bullets,bounds);this.effects.ambient(this.model.asteroids,bounds);
    }
    const p = this.model.player;
    this.follow.setPosition(p.x, p.y);
    this.draw();
    this.mapElapsed += delta;
    const refreshMap = this.mapElapsed >= 200;
    if (refreshMap) this.drawMinimap();
    if (!this.compass.hidden) drawCompass(this.compass, this.model);
    this.builderElapsed+=delta;if(this.builderElapsed>=100){this.renderBuilder();this.builderElapsed=0;}
    this.mapWindow.hidden = !this.mapOpen;
    document.body.classList.toggle('chart-open',this.mapOpen);
    if(this.mapOpen){
      if(this.mapFollow){this.mapView.centerX=p.x/WORLD.width;this.mapView.centerY=p.y/WORLD.height;this.clampMap();}
      if(refreshMap){drawExplorationMap(this.mapCanvas,this.model,this.mapView);this.mapWindow.querySelector('.map-telemetry')!.textContent=`${this.mapFollow?'TRACKING SHIP':'FREE CHART'} · ${(WORLD.width/this.mapView.zoom/1000).toFixed(1)} km span · X ${Math.round(p.x).toLocaleString()} / Y ${Math.round(p.y).toLocaleString()}${this.paused?' · PAUSED':''}`;this.mapWindow.querySelector('[data-chart="follow"]')!.setAttribute('aria-pressed',String(this.mapFollow));}
    }
    if (refreshMap) this.mapElapsed = 0;
    this.saveElapsed += delta;
    if (this.saveElapsed >= 10000) { const error = saveGame(this.model, this.saveFailed); if (error) this.model.message = error; this.saveElapsed = 0; }
    this.hudElapsed += delta;
    if (this.hudElapsed >= 100) {
    this.hudElapsed = 0;
    const destination = this.model.bases.filter(base => this.model.isExplored(base) || base.unlocked).reduce((best, base) => Math.hypot(p.x - base.x, p.y - base.y) < Math.hypot(p.x - best.x, p.y - best.y) ? base : best);
    this.cockpit.update(this.model,aim,this.paused||this.building||this.settings.open,this.buildMode);
    document.body.classList.toggle('cockpit-modal',this.building||this.settings.open);
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
    const raided=this.model.outposts.find(o=>(o.raidWarning??0)>0.05&&Math.hypot((o.cx+.5)*OUTPOST.cell-p.x,(o.cy+.5)*OUTPOST.cell-p.y)<OUTPOST.activeRange),raiders=this.model.enemies.filter(e=>e.raidParty&&e.health>0).length;
    const banner=warning>0?`<strong>ALERT</strong><span>HORDE INBOUND · ${Math.ceil(warning)}</span><small>Fight, or dock at a station to lose them</small>`:hunting?`<strong>HORDE</strong><span>${hunting} of ${Math.max(hunting,this.model.horde.total)} hostiles left</span>`:raided?`<strong>RAID</strong><span>${raided.name.toUpperCase()} · ${Math.ceil(raided.raidWarning!)}s</span><small>Radar has picked up a raiding party</small>`:raiders?`<strong>RAID</strong><span>${raiders} raider${raiders===1?'':'s'} attacking your outpost</span>`:'';
    if(banner!==this.hordeBannerContent){this.hordeBanner.innerHTML=banner;this.hordeBannerContent=banner;}
    this.hordeBanner.hidden=!banner||this.model.dead||this.building||this.mapOpen;this.hordeBanner.classList.toggle('boss-below',Boolean(boss));
    this.renderBuildPanel(); this.renderOutpostPanel();
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
  private toggleBuildMode() {
    if (this.buildMode) { this.buildMode = false; return; }
    const error = this.model.buildModeError;
    if (error) { this.model.message = error; this.audio.play('fail'); return; }
    this.buildMode = true; this.buildHeld = ''; this.buildWasDown = true; this.buildSelected = undefined;
    if (!this.model.outposts.length) this.buildKind = 'outpostCore';
    this.model.message = 'Build Mode: pick a block, left click a green cell to build.';
  }
  /** Places blocks under the cursor while the left button is held (one per cell), and leaves Build Mode on right click. */
  private updateBuildMode(aim: { x: number; y: number }, pointer: Phaser.Input.Pointer) {
    const cx = cellOf(aim.x), cy = cellOf(aim.y), down = pointer.leftButtonDown();
    const existing = structureAt(this.model.outposts, cx, cy);
    this.buildHover = existing ? '' : this.model.placeError(this.buildKind, cx, cy) ?? '';
    if (pointer.rightButtonDown()) { this.buildMode = false; return; }
    // Clicking a built block selects it for upgrade or repair instead of placing.
    if (existing) { if (down && !this.buildWasDown) { this.buildSelected = { outpost: existing.outpost.id, block: existing.structure.id }; this.audio.play('collect'); } this.buildWasDown = down; if (!down) this.buildHeld = ''; return; }
    if (down && this.buildHeld !== `${cx},${cy}` && !(this.buildWasDown && this.buildHeld === '')) {
      this.buildHeld = `${cx},${cy}`;
      const placed = this.model.placeStructure(this.buildKind, cx, cy, this.buildRot);
      if (!placed && !this.buildWasDown) this.audio.play('fail');
      if (placed && this.buildKind === 'outpostCore') this.buildKind = 'wall';
    }
    if (!down) this.buildHeld = '';
    this.buildWasDown = down;
  }
  private selectedBlock() {
    const outpost = this.model.outposts.find(o => o.id === this.buildSelected?.outpost), structure = outpost?.structures.find(s => s.id === this.buildSelected?.block);
    return outpost && structure ? { outpost, structure } : undefined;
  }
  /** Details and actions for the block selected in Build Mode. */
  private blockDetails(outpost: Outpost, s: Structure) {
    const def = STRUCTURES[s.kind], ability = STRUCTURE_ABILITIES[s.kind], ores = Object.keys(this.model.cargo) as Resource[], turret = turretOf(s), next = { ...s, level: s.level + 1 }, nextTurret = s.level < OUTPOST.maxLevel ? turretOf(next) : undefined;
    const price = (cost: Record<Resource, number>) => ores.filter(ore => cost[ore] > 0).map(ore => `${cost[ore]} ${ore}`).join(' + ') || 'free';
    const arrow = (label: string, now: number, later: number | undefined) => now || later ? `<tr><th>${label}</th><td>${Math.round(now)}</td>${later !== undefined && later !== now ? `<td class="next-value">→ ${Math.round(later)}</td>` : '<td></td>'}</tr>` : '';
    const can = s.level < OUTPOST.maxLevel;
    const rows = [arrow('Hull', maxHealth(s), can ? maxHealth(next) : undefined), turret ? arrow('Damage', turret.damage, nextTurret?.damage) : '', turret ? arrow('Range', turret.range, nextTurret?.range) : '',
      arrow('Power /s', outputOf(s, def.generation), can ? outputOf(next, def.generation) : undefined), arrow('Battery', outputOf(s, def.energyCapacity), can ? outputOf(next, def.energyCapacity) : undefined), arrow('Storage', outputOf(s, def.storage), can ? outputOf(next, def.storage) : undefined),
      arrow('Shield', outputOf(s, def.shield), can ? outputOf(next, def.shield) : undefined), arrow('Cooling /s', outputOf(s, def.cooling), can ? outputOf(next, def.cooling) : undefined), arrow('Repair /s', outputOf(s, def.repair), can ? outputOf(next, def.repair) : undefined),
      arrow('Drones', dronesOf(s), can ? dronesOf(next) : undefined)].join('');
    const upgradeError = this.model.upgradeStructureError(outpost, s), repairError = this.model.repairStructureError(outpost, s);
    return `<section class="block-details"><header><div><small>SELECTED · ${outpost.name.toUpperCase()}</small><h3>${def.label}</h3></div><button data-block="deselect">Back</button></header>
<p>Level ${s.level} / ${OUTPOST.maxLevel} · Hull ${Math.ceil(s.health)} / ${maxHealth(s)}${s.progress < 1 ? ` · building ${Math.round(s.progress * 100)}%` : ''}</p><table>${rows}</table>
<p class="block-ability ${s.level >= OUTPOST.maxLevel ? 'unlocked' : ''}"><b>Level 5 · ${ability.name}</b> ${s.level >= OUTPOST.maxLevel ? '(active)' : '(locked)'}<br>${ability.description}</p>
<div class="block-actions"><button data-block="upgrade" ${upgradeError ? 'disabled' : ''}>${can ? `Upgrade to level ${s.level + 1} · ${price(this.model.structureUpgradeCost(outpost, s))}` : 'Maximum level'}</button>${upgradeError && can ? `<small class="blocked">${upgradeError}</small>` : ''}
<button data-block="repair" ${repairError ? 'disabled' : ''}>Repair · ${price(this.model.structureRepairCost(s))}</button>${repairError && s.health < maxHealth(s) ? `<small class="blocked">${repairError}</small>` : ''}</div></section>`;
  }
  private renderBuildPanel() {
    const builder = this.model.builder;
    this.buildToggle.hidden = !builder || this.building || this.mapOpen; this.buildToggle.setAttribute('aria-pressed', String(this.buildMode));
    this.buildPanel.hidden = !this.buildMode; document.body.classList.toggle('build-mode', this.buildMode);
    if (!this.buildMode || !builder) return;
    const ores = Object.keys(this.model.cargo) as Resource[];
    const items = (Object.keys(STRUCTURES) as StructureKind[]).map(kind => {
      const def = STRUCTURES[kind], price = this.model.structureCost(kind), can = ores.every(ore => this.model.cargo[ore] >= price[ore]);
      const cost = ores.filter(ore => price[ore] > 0).map(ore => `<i class="${this.model.cargo[ore] >= price[ore] ? 'have' : 'lack'}">${price[ore]} ${ore}</i>`).join(' + ');
      return `<button data-structure="${kind}" aria-pressed="${kind === this.buildKind}" class="${can ? 'affordable' : 'unaffordable'}" title="${def.description}"><img alt="" src="${this.structureIcons.get(kind)}"><span><b>${def.label}</b><small>${cost}</small></span></button>`;
    }).join('');
    const carried = ores.filter(ore => this.model.cargo[ore] > 0).map(ore => `${this.model.cargo[ore]} ${ore}`).join(' · ') || 'empty';
    const chosen = STRUCTURES[this.buildKind], turret = chosen.turret;
    const facts = [`${chosen.health} hull`, `${chosen.buildTime}s build`, chosen.generation ? `+${chosen.generation} power/s` : '', chosen.energyCapacity ? `+${chosen.energyCapacity} battery` : '', chosen.storage ? `+${chosen.storage} storage` : '', chosen.drones ? `${chosen.drones} mining drones` : '', chosen.dock ? `dock range ${chosen.dock}` : '', turret ? `${turret.damage} dmg every ${turret.cooldown}s · range ${turret.range} · ${turret.energy} energy/shot` : ''].filter(Boolean).join(' · ');
    const status = `<p class="build-facts"><b>${chosen.label}</b> — ${chosen.description}<br>${facts}</p>` + (this.buildHover ? `<p class="build-status blocked">${this.buildHover}</p>` : `<p class="build-status ready">Left click to build ${chosen.label}.</p>`);
    const picked = this.selectedBlock(); if (!picked) this.buildSelected = undefined;
    const body = picked ? this.blockDetails(picked.outpost, picked.structure) : `<div class="build-catalog">${items}</div>${status}`;
    const html = `<header><div><small>BUILD MODULE · LEVEL ${builder.level}</small><h2>Build Mode</h2></div><button data-build-close="true">Close · ${OUTPOST.key}</button></header><p class="build-cargo">Carried cargo: ${carried}</p>${body}<p class="build-stats">Range ${builder.range} · Speed x${builder.speed}${builder.discount ? ` · Cost -${builder.discount}%` : ''} · ${this.model.outposts.length} outpost${this.model.outposts.length === 1 ? '' : 's'}</p><p class="build-hints"><kbd>Left click</kbd> build (hold to drag walls), or click a built block to upgrade/repair · <kbd>${OUTPOST.rotateKey}</kbd> rotate · <kbd>Right click</kbd> / <kbd>Esc</kbd> exit</p>`;
    if (html !== this.buildPanelContent) { this.buildPanel.innerHTML = html; this.buildPanelContent = html; }
  }
  /** Readout for the nearest outpost: power, battery, storage and cargo transfer. */
  private renderOutpostPanel() {
    const outpost = this.building || this.mapOpen || this.model.dead ? undefined : this.model.outpostNear();
    this.panelOutpost = outpost; this.outpostPanel.hidden = !outpost;
    if (!outpost) return;
    const stats = outpostStats(outpost), energy = Math.floor(outpost.energy ?? 0), used = storedTotal(outpost), blocked = this.model.transferError(outpost);
    const pct = (n: number, max: number) => (max ? Math.max(0, Math.min(100, n / max * 100)) : 0).toFixed(1);
    const ores = (Object.keys(this.model.cargo) as Resource[]).filter(ore => (outpost.stored?.[ore] ?? 0) > 0).map(ore => `${outpost.stored![ore]} ${ore}`).join(' · ') || 'empty';
    const drones = outpost.drones ?? [], busy = (state: string) => drones.filter(d => d.state === state).length, docked = this.model.dockAt() === outpost;
    const droneLine = drones.length ? `<small>Drones ${drones.length}: ${busy('mining')} mining · ${busy('outbound') + busy('returning')} flying · ${busy('idle')} parked${used >= stats.storageCapacity ? ' · <em>storage full</em>' : ''}</small>` : '';
    const dockLine = docked ? `<small class="dock-hint"><kbd>E</kbd> dock: unload cargo and repair from outpost stores</small>` : '';
    const html = `<header><strong>${outpost.name.toUpperCase()}</strong><span>${outpost.structures.length} blocks · ${stats.turrets} turret${stats.turrets === 1 ? '' : 's'}</span></header>
<div class="outpost-row"><span>Power</span><b>+${stats.generation}/s</b><span>Peak turret draw</span><b class="${stats.peakDemand > stats.generation ? 'warn' : ''}">${stats.peakDemand.toFixed(1)}/s</b></div>
<div class="outpost-meter energy"><i style="width:${pct(energy, stats.energyCapacity)}%"></i></div><small>Battery ${energy} / ${stats.energyCapacity}${outpost.shortage ? ' · <em>ENERGY SHORTAGE: turrets waiting</em>' : ''}</small>
<div class="outpost-meter storage"><i style="width:${pct(used, stats.storageCapacity)}%"></i></div><small>Storage ${used} / ${stats.storageCapacity} · ${ores}</small>${stats.shieldCapacity ? `<small>Shield ${Math.floor(outpost.shield ?? 0)} / ${Math.round(stats.shieldCapacity)}</small>` : ''}${stats.turrets ? `<small>Heat ${Math.floor(outpost.heat ?? 0)} / ${Math.round(stats.heatCapacity)}${outpost.overheated ? ' · <em>OVERHEATED: turrets cooling</em>' : ''}${(outpost.command ?? 0) > 0 ? ' · Command Network active' : ''}</small>` : ''}${(outpost.raidWarning ?? 0) > 0.05 ? `<small><em>RAID INBOUND in ${Math.ceil(outpost.raidWarning!)}s</em></small>` : ''}${outpost.report ? `<small class="away-report">${outpost.report}</small>` : ''}${droneLine}${dockLine}
<footer><button data-outpost="deposit" ${blocked ? 'disabled' : ''}>Store cargo</button><button data-outpost="withdraw" ${blocked ? 'disabled' : ''}>Load cargo</button><small>${blocked ?? 'Moves as much as fits.'}</small></footer>`;
    if (html !== this.outpostPanelContent) { this.outpostPanel.innerHTML = html; this.outpostPanelContent = html; }
  }
  /** World-aligned grids: a faint large grid always, and the fine construction grid when zoomed in or building. */
  private drawGrids(view: Phaser.Geom.Rectangle, zoom: number) {
    const g = this.gridGraphics; g.clear();
    const lines = (step: number, color: number, alpha: number) => {
      g.lineStyle(1 / zoom, color, alpha);
      for (let x = Math.floor(view.x / step) * step; x <= view.right; x += step) g.lineBetween(x, view.y, x, view.bottom);
      for (let y = Math.floor(view.y / step) * step; y <= view.bottom; y += step) g.lineBetween(view.x, y, view.right, y);
    };
    lines(OUTPOST.largeGrid, 0x3a5a78, 0.22);
    const [from, to] = OUTPOST.gridZoom, fade = Math.max(0, Math.min(1, (zoom - from) / (to - from))), alpha = this.buildMode ? 0.34 : fade * fade * (3 - 2 * fade) * 0.2;
    if (alpha <= 0.005) return;
    // Zoomed far out in Build Mode, draw every 2nd/4th line so the grid stays aligned but bounded.
    const step = OUTPOST.cell * Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, view.width / OUTPOST.cell / 180))));
    lines(step, this.buildMode ? 0xd9a441 : 0x5f86a8, alpha);
  }
  private drawOutposts(view: Phaser.Geom.Rectangle, now: number) {
    const g = this.graphics, seen = new Set<number>(), size = OUTPOST.cell; this.turretIndex = 0; this.droneIndex = 0;
    for (const outpost of this.model.outposts) {
      seen.add(outpost.id);
      const b = outpostBounds(outpost), inView = (b.maxX + 1) * size > view.x - 40 && b.minX * size < view.right + 40 && (b.maxY + 1) * size > view.y - 40 && b.minY * size < view.bottom + 40;
      let entry = this.outpostSprites.get(outpost.id);
      if (!inView) { entry?.image.setVisible(false); continue; }
      if (!entry || entry.revision !== outpost.revision) {
        // Static blocks are baked once per change, never redrawn per frame.
        const baked = paintOutpost(outpost), key = `outpost-${outpost.id}`;
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, baked.canvas)!.setFilter(Phaser.Textures.FilterMode.NEAREST);
        const image = entry?.image ?? this.add.image(0, 0, key).setOrigin(0).setDepth(-0.6);
        image.setTexture(key).setPosition(baked.x, baked.y); entry = { image, revision: outpost.revision }; this.outpostSprites.set(outpost.id, entry);
      }
      entry.image.setVisible(true);
      for (const s of outpost.structures) {
        const x = s.cx * size, y = s.cy * size;
        if (s.progress < 1) { g.fillStyle(0x05070c); g.fillRect(x + 1, y + size - 4, size - 2, 3); g.fillStyle(0xf2d489); g.fillRect(x + 2, y + size - 3, (size - 4) * s.progress, 1); }
        else if (s.kind === 'outpostCore' || s.kind === 'reactor') {
          g.fillStyle(0xffd27a, 0.25 + Math.sin(now * 3 + s.id) * 0.15); g.fillCircle(x + size / 2, y + size / 2, 4.5);
          // Turning gear teeth on the core.
          if (s.kind === 'outpostCore') { g.fillStyle(0xf2d489, 0.9); for (let i = 0; i < 4; i++) { const a = now * 0.8 + i * Math.PI / 2; g.fillRect(x + size / 2 + Math.cos(a) * 6 - 0.5, y + size / 2 + Math.sin(a) * 6 - 0.5, 1.5, 1.5); } }
        }
        else if (s.kind === 'coolingUnit') { g.lineStyle(1, 0xbfeaff, 0.85); for (let i = 0; i < 2; i++) { const a = now * 6 + i * Math.PI / 2; g.lineBetween(x + size / 2 - Math.cos(a) * 3, y + size / 2 - Math.sin(a) * 3, x + size / 2 + Math.cos(a) * 3, y + size / 2 + Math.sin(a) * 3); } }
        else if (s.kind === 'radarTower') { const a = now * 2.2 + s.id; g.lineStyle(1, 0x9fe6ff, 0.9); g.lineBetween(x + size / 2, y + size / 2, x + size / 2 + Math.cos(a) * 5, y + size / 2 + Math.sin(a) * 5); }
        else if (s.kind === 'shieldGenerator' && (outpost.shield ?? 0) > 0) { const reach = (STRUCTURES[s.kind].shieldRadius! + 0.5) * size; g.lineStyle(1.2, 0x79dfff, 0.12 + 0.3 * (outpost.shield! / Math.max(1, outpostStats(outpost).shieldCapacity))); g.strokeRect(x + size / 2 - reach, y + size / 2 - reach, reach * 2, reach * 2); }
        else if (STRUCTURES[s.kind].turret) {
          // Rotating turret heads are pooled sprites over the baked mount.
          const head = this.turretSprites[this.turretIndex] ?? this.add.image(0, 0, `turret-${s.kind}`).setDepth(-0.5);
          this.turretSprites[this.turretIndex++] = head;
          head.setVisible(true).setTexture(`turret-${s.kind}`).setPosition(x + size / 2, y + size / 2).setRotation(s.angle ?? s.rot * Math.PI / 2);
        }
      }
    }
    for (const outpost of this.model.outposts) for (const d of outpost.drones ?? []) {
      // Mining drones: pooled sprites, hidden while parked in the hangar, with a thin beam while cutting.
      if (d.state === 'idle' || d.x < view.x - 30 || d.x > view.right + 30 || d.y < view.y - 30 || d.y > view.bottom + 30) continue;
      const sprite = this.droneSprites[this.droneIndex] ?? this.add.image(0, 0, 'mining-drone').setDepth(0.5);
      this.droneSprites[this.droneIndex++] = sprite; sprite.setVisible(true).setPosition(d.x, d.y).setRotation(d.angle);
      if (d.beam) { g.lineStyle(2.5, 0x75ebc3, 0.25); g.lineBetween(d.x, d.y, d.beam.x, d.beam.y); g.lineStyle(1, 0xdfffe9, 0.6 + Math.sin(now * 30 + d.id) * 0.3); g.lineBetween(d.x, d.y, d.beam.x, d.beam.y); g.fillStyle(0xdfffe9, 0.9); g.fillRect(d.beam.x - 1, d.beam.y - 1, 2, 2); }
      if (d.load > 0 && d.ore) { g.fillStyle(RESOURCES[d.ore].color); g.fillRect(d.x - 1, d.y - 8, 2, 2); }
    }
    for (let i = this.droneIndex; i < this.droneSprites.length; i++) this.droneSprites[i].setVisible(false);
    for (let i = this.turretIndex; i < this.turretSprites.length; i++) this.turretSprites[i].setVisible(false);
    for (const [id, entry] of this.outpostSprites) if (!seen.has(id)) { entry.image.destroy(); if (this.textures.exists(`outpost-${id}`)) this.textures.remove(`outpost-${id}`); this.outpostSprites.delete(id); }
  }
  private drawBuildPreview(now: number) {
    const g = this.graphics, builder = this.model.builder, p = this.model.player;
    const picked = this.buildMode ? this.selectedBlock() : undefined;
    if (picked) { const s = picked.structure, c = OUTPOST.cell; g.lineStyle(2, 0xffe9a8, 0.6 + Math.sin(now * 6) * 0.3); g.strokeRect(s.cx * c - 1, s.cy * c - 1, c + 2, c + 2); }
    this.buildGhost.setVisible(this.buildMode && Boolean(builder) && !this.paused);
    if (!this.buildMode || !builder || this.paused) return;
    const aim = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y), cx = cellOf(aim.x), cy = cellOf(aim.y), size = OUTPOST.cell, ok = !this.buildHover, color = ok ? 0x5dff9a : 0xff4d6d;
    g.lineStyle(1, 0xd9a441, 0.35 + Math.sin(now * 4) * 0.1); g.strokeCircle(p.x, p.y, builder.range);
    this.buildGhost.setTexture(`structure-${this.buildKind}`).setPosition(cellCenter(cx), cellCenter(cy)).setRotation(this.buildRot * Math.PI / 2);
    const over = Boolean(structureAt(this.model.outposts, cx, cy));
    this.buildGhost.setVisible(!over);
    if (over) { g.lineStyle(1.5, 0xffe9a8, 0.9); g.strokeRect(cx * size, cy * size, size, size); return; }
    g.fillStyle(color, 0.28); g.fillRect(cx * size, cy * size, size, size); g.lineStyle(1.5, color, 0.95); g.strokeRect(cx * size, cy * size, size, size);
  }
  private switchModel(model: GameModel) {
    for (const sprite of this.asteroidSprites) sprite.destroy(); this.asteroidSprites = [];
    for (const cache of this.asteroidCache.values()) this.textures.remove(cache.key); this.asteroidCache.clear();
    this.effects.clear();this.audio.setLoop('mine',0);this.audio.setLoop('tractor',0);
    this.buildMode = false; for (const [id, entry] of this.outpostSprites) { entry.image.destroy(); if (this.textures.exists(`outpost-${id}`)) this.textures.remove(`outpost-${id}`); } this.outpostSprites.clear();
    this.model = model; this.building = false; this.mapOpen = false; this.paused = false; this.movingModule = false; this.selectedCell = { x: 0, y: 0 };this.detailMode='module';this.buildCenter={x:0,y:0};
    this.lastBullet = -1; this.builderContent = ''; this.hudElapsed = 100; this.mapElapsed = 200; this.saveElapsed = 0;
    this.baseLabels.forEach((label, i) => label.setPosition(model.bases[i].x, model.bases[i].y - 172));
    this.follow.setPosition(model.player.x, model.player.y); this.cameras.main.centerOn(model.player.x, model.player.y);
    this.paintBackdropTextures();
    this.refreshSeedLabel(); this.input.keyboard!.enabled = true;
  }
  private static readonly RADAR_RANGES = [1200, 2400, 4800];
  private drawMinimap() {
    const hide = this.building || this.mapOpen;
    this.radar.hidden = hide; this.compass.hidden = hide || this.model.dead;
    if (hide) return;
    const range = SpaceScene.RADAR_RANGES[this.radarRange];
    drawRadar(this.radarCanvas, this.model, range, true);
    const label = this.radar.querySelector<HTMLElement>('[data-radar-label]');
    if (label) label.textContent = `RADAR ${(range / 1000).toFixed(1)} km`;
  }
  private clampMap(){const margin=.5/this.mapView.zoom;this.mapView.centerX=Phaser.Math.Clamp(this.mapView.centerX,margin,1-margin);this.mapView.centerY=Phaser.Math.Clamp(this.mapView.centerY,margin,1-margin);}
  private setMapOpen(open:boolean){this.mapOpen=open;this.mapPointer=false;if(open){this.building=false;this.buildMode=false;this.mapFollow=true;this.mapView.zoom=8;this.mapElapsed=200;}}
  private cockpitCommand(action:CockpitAction){
    this.audio.unlock();
    if(this.settings.open)return;
    // Navigation/settings remain usable while paused, just like their keyboard equivalents.
    if(action==='settings'){this.settings.show();return;}
    if(action==='map'){this.setMapOpen(!this.mapOpen);this.building=false;this.buildMode=false;return;}
    if(action==='shop'){if(!this.mapOpen&&this.model.atStation&&!this.model.dead)this.building=!this.building;return;}
    if(this.paused||this.building||this.mapOpen||this.model.dead)return;
    if(action==='build')this.toggleBuildMode();else this.commandInput.add(action);
  }
  /** Texture for one block of the flown ship in its paint. Painted variants are baked once, on first use. */
  private shipTexture(kind: EquipmentKind, level: number) {
    const base = `icon-${kind}-${level}`, paint = this.model.shipPaint; if (!paint) return base;
    const key = `${base}-p${paint}`;
    if (!this.textures.exists(key)) {
      const source = this.textures.get(base).getSourceImage(); if (!(source instanceof HTMLCanvasElement)) return base;
      this.textures.addCanvas(key, paintHull(source, FLEET.paints[paint].color, FLEET.paintStrength))!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    return key;
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
    this.drawGrids(view, this.cameras.main.zoom); this.drawOutposts(view, now);
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
    for(const hazard of this.model.enemyHazards){g.lineStyle(2,hazard.active?0xff7755:0xc99bff,hazard.active?.9:.25+hazard.progress*.5);g.strokeCircle(hazard.x,hazard.y,hazard.radius);if(hazard.active){g.fillStyle(0xae76ee,.18);g.fillCircle(hazard.x,hazard.y,hazard.radius);}}
    for(const beam of this.model.enemyBeams){g.lineStyle(4,0xffa54a,beam.life/.22);g.lineBetween(beam.start.x,beam.start.y,beam.end.x,beam.end.y);}
    let enemyIndex=0;
    for (const e of this.model.enemies) {
      if (!visible(e)) continue;
      const kind=e.kind ?? 'raider';
      const hull=this.enemySprites[enemyIndex]??this.add.image(e.x,e.y,`enemy-${kind}`).setDepth(1);
      this.enemySprites[enemyIndex++]=hull;
      hull.setVisible(true).setPosition(e.x,e.y).setTexture(`enemy-${kind}`).setRotation(e.angle).setScale(1/ENEMY_SPRITE.scale);
      const def=ENEMIES[kind],half=Math.max(16,def.radius+4),top=e.y-def.radius-14;
      const faction=e.faction??def.faction;if(faction){g.fillStyle(FACTIONS[faction].color,.9);g.fillRect(e.x-4,top-5,8,2);}
      if(def.aura){g.lineStyle(1,0x7fd0ff,.18);g.strokeCircle(e.x,e.y,def.aura.range);}
      if (e.squad !== undefined) { g.fillStyle(0xa6c6dd, 0.7); g.fillRect(e.x - 5, top - 9, 2, 2); g.fillRect(e.x - 1, top - 9, 2, 2); g.fillRect(e.x + 3, top - 9, 2, 2); }
      if (!def.weakPoint) {
        g.fillStyle(0x05070c); g.fillRect(e.x - half - 1, top - 1, half * 2 + 2, 6);
        g.fillStyle(0x481d26); g.fillRect(e.x - half, top, half * 2, 4); g.fillStyle(0xee7f89); g.fillRect(e.x - half, top, half * 2 * Math.min(1, Math.max(0, e.health) / (e.maxHealth??def.health)), 4);
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
      if ((e.empCharge ?? 0) > 0 && (def.boss?.emp||def.emp||def.boss?.meltdown)) {
        // EMP warning: the blast ring fills in as the charge completes. Get outside it.
        const emp = def.boss?.emp??def.emp??{...def.boss!.meltdown!,charge:def.boss!.meltdown!.duration}, progress = 1 - e.empCharge! / emp.charge;
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
        const key=this.shipTexture(m.kind,m.level),sprite=this.shipSprites[index]??this.add.image(point.x,point.y,key).setDepth(1);
        this.shipSprites[index++]=sprite;sprite.setVisible(true).setPosition(point.x,point.y).setTexture(key).setRotation(heading+Math.PI/2);
      }
      for(;index<this.shipSprites.length;index++)this.shipSprites[index].setVisible(false);
      // Engine exhaust: stepped pixel flames behind every booster while thrusting, longer during a burst.
      const thrusting=!this.building&&!this.paused&&(this.keys.W.isDown||this.keys.A.isDown||this.keys.S.isDown||this.keys.D.isDown),burst=this.model.boostActive;
      if(thrusting||burst)for(const m of this.model.modules){
        if(m.kind!=='engine'||m.integrity<=0)continue;
        const point=this.model.modulePoint(m,heading);if(!visible(point))continue;
        const length=(5+m.level*1.5)*(burst?2.1:1)+Math.sin(now*40+m.x*3+m.y)*1.5;
        g.save();g.translateCanvas(point.x,point.y);g.rotateCanvas(heading+Math.PI);
        g.fillStyle(0xff7a3c,.85);g.fillRect(8,-3,length,6);g.fillStyle(0xffc46b,.95);g.fillRect(8,-2,length*.65,4);g.fillStyle(0xfff3d0);g.fillRect(8,-1,length*.35,2);
        g.restore();
      }
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
    this.drawBuildPreview(now);
    if (!this.building && !this.paused) {
      const pointer = this.input.activePointer;
      const aim = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      g.lineStyle(1, 0xc2dbe7, 0.7); g.strokeCircle(aim.x, aim.y, 7);
      g.lineBetween(aim.x - 12, aim.y, aim.x - 5, aim.y); g.lineBetween(aim.x + 5, aim.y, aim.x + 12, aim.y);
      g.lineBetween(aim.x, aim.y - 12, aim.x, aim.y - 5); g.lineBetween(aim.x, aim.y + 5, aim.x, aim.y + 12);
    }
  }
}
void loadSavedGame().catch(() => null).then(saved => { startModel = saved; new Phaser.Game({ type: new URLSearchParams(location.search).get('renderer')==='webgl'?Phaser.WEBGL:Phaser.CANVAS, parent: 'game', backgroundColor: '#080e1a', scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, scene: SpaceScene, render: { antialias: true } }); });
