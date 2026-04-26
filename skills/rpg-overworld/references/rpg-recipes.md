# RPG Overworld Recipes

Copy-paste patterns for the RPG overworld skill.

## DialogBox with typewriter effect

```js
class DialogBox {
  constructor(scene) {
    const W = scene.scale.width, H = scene.scale.height;
    const BH = 82, BY = H - BH - 4;
    this.scene = scene;

    this.bg = scene.add.graphics().setScrollFactor(0).setDepth(200).setVisible(false);
    this.bg.fillStyle(0x000000, 0.84);
    this.bg.fillRoundedRect(6, BY, W-12, BH, 6);
    this.bg.lineStyle(1, 0x6666cc, 0.85);
    this.bg.strokeRoundedRect(6, BY, W-12, BH, 6);

    this.nameLabel = scene.add.text(14, BY+7, '', {
      fontSize:'8px', color:'#ffd84a', fontFamily:'monospace', stroke:'#000', strokeThickness:2,
    }).setScrollFactor(0).setDepth(201).setVisible(false);

    this.bodyText = scene.add.text(14, BY+22, '', {
      fontSize:'7px', color:'#eeeeee', fontFamily:'monospace', wordWrap:{width:W-28}, lineSpacing:2,
    }).setScrollFactor(0).setDepth(201).setVisible(false);

    this.cursor = scene.add.text(W-12, H-8, '▼', {
      fontSize:'6px', color:'#aaaaff', fontFamily:'monospace',
    }).setScrollFactor(0).setDepth(201).setOrigin(1,1).setVisible(false);
    scene.tweens.add({ targets:this.cursor, alpha:0, duration:420, yoyo:true, repeat:-1 });

    this.active=false; this.typing=false; this.allLines=[]; this.lineIdx=0;
    this.curLine=''; this.charIdx=0; this.typeEvent=null;
  }

  show(name, lines) {
    this.allLines = Array.isArray(lines) ? [...lines] : [lines];
    this.lineIdx = 0;
    this.active  = true;
    this.bg.setVisible(true);
    this.nameLabel.setVisible(true).setText(name);
    this.bodyText.setVisible(true);
    this.cursor.setVisible(true);
    this._type(this.allLines[0]);
  }

  _type(line) {
    this.curLine = line; this.charIdx = 0; this.typing = true;
    this.bodyText.setText('');
    if (this.typeEvent) { this.typeEvent.remove(); this.typeEvent = null; }
    this.typeEvent = this.scene.time.addEvent({
      delay:26, loop:true,
      callback:()=>{
        if (this.charIdx < this.curLine.length) {
          this.bodyText.setText(this.curLine.substring(0, ++this.charIdx));
        } else {
          this.typing = false;
          this.typeEvent.remove(); this.typeEvent = null;
        }
      },
    });
  }

  advance() {
    if (!this.active) return;
    if (this.typing) {
      this.typeEvent?.remove(); this.typeEvent=null; this.typing=false;
      this.bodyText.setText(this.curLine);
      return;
    }
    if (++this.lineIdx >= this.allLines.length) this.hide();
    else this._type(this.allLines[this.lineIdx]);
  }

  hide() {
    this.active=false; this.typing=false;
    this.typeEvent?.remove(); this.typeEvent=null;
    this.bg.setVisible(false); this.nameLabel.setVisible(false);
    this.bodyText.setVisible(false); this.cursor.setVisible(false);
  }
}
```

## NPC spawn with proximity indicator

```js
// In create() — for each NPC spawn:
const npc = this.add.sprite(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
npc.entityId     = sp.entity;
npc.dialogueData = { name: 'NPC Name', lines: ['Hello!', 'I have news for you.'] };
npc.setDisplaySize(tileSize * 1.1, tileSize * 1.1);
npc.play(sp.entity + '-idle');

npc.indicator = this.add.text(px, py - tileSize*0.85, '!', {
  fontSize:'11px', color:'#ffe000', stroke:'#000000', strokeThickness:3,
}).setOrigin(0.5,1).setDepth(500).setVisible(false);
this.tweens.add({ targets:npc.indicator, y:'-=4', duration:520, yoyo:true, repeat:-1 });
this.npcs.push(npc);
```

## Crystal pickup with glow + bob

```js
// In create():
const c = this.crystals.create(px, py, sheet.tex, sheet.rowIdx * sheet.cols);
c.collected = false;
c.setDisplaySize(tileSize * 0.9, tileSize * 0.9);
c.body.setSize(tileSize * 0.7, tileSize * 0.7);
c.play('CRYSTAL-idle');
this.tweens.add({ targets:c, y:c.y-5, duration:950, yoyo:true, repeat:-1, ease:'Sine.easeInOut' });
if (c.postFX) c.postFX.addGlow(0x44ddff, 5, 0, false, 0.1, 14);

// Overlap handler:
this.physics.add.overlap(this.player, this.crystals, (_p, crystal) => {
  if (crystal.collected) return;
  crystal.collected = true;
  crystal.body.enable = false;
  this.tweens.killTweensOf(crystal);
  // Burst particles
  for (let i = 0; i < 8; i++) {
    const p = this.add.rectangle(crystal.x, crystal.y, 2, 2, 0x44ddff).setDepth(80);
    const a = (i/8)*Math.PI*2;
    this.tweens.add({ targets:p, x:p.x+Math.cos(a)*18, y:p.y+Math.sin(a)*18, alpha:0, duration:320, onComplete:()=>p.destroy() });
  }
  this.tweens.add({ targets:crystal, scale:crystal.scale*1.8, alpha:0, duration:220, onComplete:()=>crystal.destroy() });
  this.cameras.main.shake(60, 0.003);
  this.crystalsCollected++;
  this.updateState();
  if (this.crystalsCollected >= TARGET) this.time.delayedCall(350, ()=>this.win());
});
```

## Y-depth sort (call every frame in update)

```js
this.player.setDepth(this.player.y + 2);
for (const npc of this.npcs) npc.setDepth(npc.y + 2);
for (const c of this.crystals.getChildren()) c.setDepth(c.y + 1);
```

## Camera follow with world bounds

```js
// In create():
this.cameras.main.setBounds(0, 0, worldW, worldH);
this.physics.world.setBounds(0, 0, worldW, worldH);
this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
this.cameras.main.roundPixels = true;
```

## Smooth win panel

```js
win() {
  if (this.gameOver) return;
  this.gameOver = true; this.won = true;
  this.updateState();
  this.events.emit('game-won');
  this.cameras.main.flash(320, 100, 190, 255);

  const { width:W, height:H } = this.scale;
  const panel = this.add.graphics().setScrollFactor(0).setDepth(300);
  panel.fillStyle(0x000000, 0.75);
  panel.fillRoundedRect(W*0.1, H*0.28, W*0.8, H*0.44, 10);
  panel.lineStyle(2, 0xffd700, 1);
  panel.strokeRoundedRect(W*0.1, H*0.28, W*0.8, H*0.44, 10);

  const title = this.add.text(W/2, H*0.40, 'QUEST COMPLETE!', {
    fontSize:'20px', color:'#ffd700', fontFamily:'monospace', stroke:'#000', strokeThickness:4,
  }).setOrigin(0.5).setScrollFactor(0).setDepth(301).setScale(0);
  this.tweens.add({ targets:title, scale:1, duration:420, ease:'Back.easeOut' });
}
```
