# RING of RED — 交戰層 (Engagement Layer)

A mobile-first **Three.js** web game inspired by Konami's PS2 tactical-mecha title
*Ring of Red*. This build focuses on the most distinctive part of the original —
the **~90-second real-time artillery duel** — and its "four pressures":

> **命中率 (Accuracy) × 過熱 (Heat) × 時間 (Timer) × 攻守迴避 (Duel / Dodge)**

You don't drag a crosshair. You watch the **accuracy %** climb while you aim, and
decide *how high a %* you dare fire at — knowing the gun **overheats**, the clock is
**counting down**, and the enemy AFW is **charging a shot at you** the whole time.

## How to play (mobile, touch)

| Control | Button | What it does |
|---|---|---|
| Fire | **✕ 開火** | Fires the main gun at the *current* accuracy %. Then reloads + adds heat. |
| Dodge | **L 迴避** | When the enemy's **裝填** gauge fills, the dodge button **arms** — tap it in time to evade their shot (but it resets your own aim). |
| Move | **L1 移動** | Advance / retreat to change **range** (SHORT/MEDIUM/LONG): closer = higher accuracy & damage but the enemy hits harder. |
| Shell | **□ 彈種** | Switch ammo: **對甲 (AT)** wrecks the enemy AFW; **對人 (AP)** shreds its infantry/squads (and knocks out their bonuses) but barely dents armour. |
| Maximum Attack | **△ 必殺** | The pilot's signature: arm a near-certain, heavy hit on the next shot (limited charges). |

Desktop testing: **Space/J/X** = fire, **L/Shift** = dodge, **M** = move, **K** = Maximum Attack, **C** = switch shell.

**Accuracy** is modified by **range**, **day/night**, **land effect**, and your **pilot skill ★**
(higher skill draws an accurate aim faster). Night + long range stays stubbornly low.

**Infantry & squads (faithful to the original):** each AFW carries 3 support squads from the
six classes — anti-soldier **Infantry / Recon / Medic** and anti-mech **Shooter / Supply /
Mechanic** — which fight automatically and grant passives: **Shooter** +AFW damage, **Supply**
faster reload, **Mechanic** slow self-repair, **Medic** heals infantry, **Recon** faster aim,
**Infantry** stronger anti-personnel fire. Lose your infantry and you lose their edge.

## Tech

- **Three.js** (r160) via CDN import map — **no build step**, pure static files.
- Procedural **low-poly** battlefield, walking-tank AFWs, muzzle flashes, tracers and
  explosions, plus a CRT scanline / vignette overlay for the grim, gritty tone.
- Mobile-tuned: `viewport-fit=cover`, safe-area insets, zoom/scroll locked, landscape hint.

## Project layout

```
index.html        # entry, HUD markup, import map
styles.css        # gunner-dashboard HUD + overlays
src/
  main.js         # bootstrap, game loop, screen flow
  combat.js       # state machine & math (the four pressures)
  world.js        # Three.js scene, AFW models, effects
  hud.js          # DOM HUD, driven by state
  input.js        # touch + keyboard bindings
.github/workflows/deploy.yml   # auto-deploy to GitHub Pages
```

## Deployment

Pushing to the development branch (or `main`) triggers
`.github/workflows/deploy.yml`, which publishes the static site to **GitHub Pages**
using the official Pages actions — no build required.

> One-time setup: in the repo, **Settings → Pages → Build and deployment → Source**,
> select **GitHub Actions**.

## Roadmap

This is the **engagement layer**. The original's other two layers (isometric
strategy map + mech/soldier formation) are designed to layer on top of this core later.
