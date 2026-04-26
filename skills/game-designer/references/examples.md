# GDD examples

One full GDD per supported genre. These are the actual fixtures used to validate the framework.

## Top-down adventure — "Slime Slayer"

```json
{
  "title": "Slime Slayer",
  "genre": "top-down-adventure",
  "tagline": "A pixel knight collects gems while dodging slimes.",
  "loop": "Walk, swing sword to defeat slimes, collect gems, reach gem count to win.",
  "winCondition": "window.__gameState.gemsCollected >= 3",
  "loseCondition": "window.__gameState.playerHp <= 0",
  "controls": {
    "movement": "4-direction",
    "actions": [{ "key": "SPACE", "name": "attack", "description": "Swing sword" }]
  },
  "entities": [
    { "id": "KNIGHT", "kind": "player", "color": "blue",   "desc": "A small blue knight with a silver sword", "states": ["idle","walk","attack","hurt"], "speed": 80, "hp": 3 },
    { "id": "SLIME",  "kind": "enemy",  "color": "green",  "desc": "A round green slime with a wobble",       "states": ["idle","walk","hurt"], "speed": 30, "hp": 1 },
    { "id": "GEM",    "kind": "pickup", "color": "yellow", "desc": "A bright yellow gem with sparkles",       "states": ["idle"], "speed": 0, "hp": 0 }
  ],
  "tilesetPalette": [
    { "id": "GRASS", "color": "#3a8a3a", "passable": true  },
    { "id": "DIRT",  "color": "#7a5a30", "passable": true  },
    { "id": "STONE", "color": "#606060", "passable": false },
    { "id": "TREE",  "color": "#1a5a1a", "passable": false }
  ],
  "levelHints": { "size": [16, 12], "count": 1, "themes": ["forest"] }
}
```

## Platformer — "Pixel Pete"

```json
{
  "title": "Pixel Pete",
  "genre": "platformer",
  "tagline": "A jumpy hero collecting coins through floating platforms.",
  "loop": "Run right, jump over gaps, dodge bats, collect 5 coins to win.",
  "winCondition": "window.__gameState.coinsCollected >= 5",
  "loseCondition": "window.__gameState.playerHp <= 0 || window.__gameState.playerY > 400",
  "controls": {
    "movement": "platformer",
    "actions": [{ "key": "SPACE", "name": "jump", "description": "Jump" }]
  },
  "entities": [
    { "id": "PETE", "kind": "player", "color": "red",    "desc": "Red-hatted pixel runner", "states": ["idle","walk","jump","hurt"], "speed": 120, "hp": 3 },
    { "id": "BAT",  "kind": "enemy",  "color": "purple", "desc": "A flying purple bat",      "states": ["idle","walk","hurt"], "speed": 50, "hp": 1 },
    { "id": "COIN", "kind": "pickup", "color": "gold",   "desc": "A spinning gold coin",     "states": ["idle"], "speed": 0, "hp": 0 }
  ],
  "tilesetPalette": [
    { "id": "SKY",       "color": "#7090d0", "passable": true  },
    { "id": "GRASS_TOP", "color": "#3a8a3a", "passable": false },
    { "id": "DIRT",      "color": "#7a5a30", "passable": false },
    { "id": "STONE",     "color": "#606060", "passable": false }
  ],
  "levelHints": { "size": [22, 12], "count": 1, "themes": ["outdoor"] }
}
```

## Shoot-em-up — "Star Defender"

```json
{
  "title": "Star Defender",
  "genre": "shoot-em-up",
  "tagline": "Fend off falling asteroids from your tiny ship.",
  "loop": "Move left/right, fire bullets up, destroy 10 asteroids before any lands.",
  "winCondition": "window.__gameState.asteroidsDestroyed >= 10",
  "loseCondition": "window.__gameState.playerHp <= 0",
  "controls": {
    "movement": "4-direction",
    "actions": [{ "key": "SPACE", "name": "fire", "description": "Fire bullet upward" }]
  },
  "entities": [
    { "id": "SHIP",     "kind": "player",     "color": "cyan",   "desc": "A small cyan triangular ship", "states": ["idle","walk","hurt"], "speed": 140, "hp": 3 },
    { "id": "ASTEROID", "kind": "enemy",      "color": "gray",   "desc": "Chunky gray rock fragment",     "states": ["idle","hurt"],         "speed": 60, "hp": 1 },
    { "id": "BULLET",   "kind": "projectile", "color": "yellow", "desc": "A bright yellow plasma bolt",   "states": ["idle"],                "speed": 300, "hp": 0 }
  ],
  "tilesetPalette": [
    { "id": "SPACE",  "color": "#0a0820", "passable": true },
    { "id": "STAR",   "color": "#a0a0ff", "passable": true },
    { "id": "NEBULA", "color": "#3a1060", "passable": true }
  ],
  "levelHints": { "size": [16, 12], "count": 1, "themes": ["space"] }
}
```
