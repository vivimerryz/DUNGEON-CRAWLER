(() => {
  'use strict';

  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const titleScreen = document.querySelector('#titleScreen');
  const resultScreen = document.querySelector('#resultScreen');
  const breakScreen = document.querySelector('#breakScreen');
  const hud = document.querySelector('#hud');
  const controls = document.querySelector('#controls');
  const objective = document.querySelector('#objective');
  const objectiveText = document.querySelector('#objectiveText');
  const toast = document.querySelector('#toast');
  const playButton = document.querySelector('#playButton');
  const restartButton = document.querySelector('#restartButton');
  const gameRestartButton = document.querySelector('#gameRestartButton');
  const breakYesButton = document.querySelector('#breakYesButton');
  const breakNoButton = document.querySelector('#breakNoButton');
  const attackButton = document.querySelector('#attackButton');
  const sprintButton = document.querySelector('#sprintButton');
  const joystick = document.querySelector('#joystick');
  const joystickStick = document.querySelector('#joystickStick');

  const TAU = Math.PI * 2;
  const WOLF_COUNT = 17;
  const WOLF_DAMAGE = 13;
  const FLOOR_KILL_TARGET = 20;
  const WARDEN_INTERVAL = 5;
  const WEAPON_COUNT = 2;
  const SAVE_KEY = 'dungeon-crawler-save-v4';
  let view = { w: 0, h: 0, dpr: 1 };
  let camera = { x: 0, y: 0, shake: 0 };
  let state = 'title';
  let floor = 1;
  let score = 0;
  let kills = 0;
  let floorKills = 0;
  let breakPromptPending = false;
  let elapsed = 0;
  let floorTime = 0;
  let nextToastTimeout;
  let toastTimer = 0;
  let lastTime = 0;
  let saveTimer = 0;
  let seed = 18;
  let world;
  let player;
  let monsters = [];
  let wolves = [];
  let potions = [];
  let weapons = [];
  let particles = [];
  let exitGate;
  let boss = null;

  const input = { moveX: 0, moveY: 0, targetMoveX: 0, targetMoveY: 0, sprint: false };
  const keyboardState = { left: false, right: false, up: false, down: false };
  let joystickPointer = null;
  let lastMoveAngle = 0;

  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const formatNumber = (value, length = 6) => String(Math.max(0, Math.floor(value))).padStart(length, '0');
  const formatFloor = (value) => String(Math.max(1, Math.floor(value))).padStart(2, '0');
  const isWardenFloor = () => floor % WARDEN_INTERVAL === 0;

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.floor(view.w * view.dpr);
    canvas.height = Math.floor(view.h * view.dpr);
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  function resetInput() {
    input.moveX = 0;
    input.moveY = 0;
    input.targetMoveX = 0;
    input.targetMoveY = 0;
    input.sprint = false;
    Object.keys(keyboardState).forEach((key) => { keyboardState[key] = false; });
    joystickPointer = null;
    joystickStick.style.transform = 'translate(0, 0)';
    sprintButton.classList.remove('is-held');
  }

  function startGame() {
    state = 'playing';
    clearSavedGame();
    saveTimer = 0;
    floor = 1;
    score = 0;
    kills = 0;
    floorKills = 0;
    breakPromptPending = false;
    elapsed = 0;
    seed = 12;
    player = makePlayer();
    wolves = makeWolves();
    hud.hidden = false;
    controls.hidden = false;
    objective.hidden = false;
    titleScreen.hidden = true;
    resultScreen.hidden = true;
    breakScreen.hidden = true;
    resetInput();
    loadFloor(true);
    showToast(`DESCEND · FLOOR ${formatFloor(floor)}`);
  }

  function makePlayer() {
    return { x: 160, y: 750, r: 17, hp: 1000, maxHp: 1000, speed: 192, damage: 34, weapon: 'claws', angle: 0, attackTimer: 0, attackCooldown: 0, giantTimer: 0, speedTimer: 0, immortalTimer: 0, sprintFuel: 100, hurtTimer: 0 };
  }

  function makeWolves() {
    return Array.from({ length: WOLF_COUNT }, (_, index) => ({
      x: player.x,
      y: player.y,
      r: 11,
      hp: 50,
      maxHp: 50,
      dead: false,
      angle: 0,
      formationAngle: (index / WOLF_COUNT) * TAU,
      homeRadius: 48 + (index % 2) * 18,
      attackCooldown: index * .12,
      hitTimer: 0,
      hurtTimer: 0,
      giantTimer: 0,
      speedTimer: 0,
      immortalTimer: 0,
      index,
    }));
  }

  function encodeTimer(value) {
    return value === Infinity ? 'forever' : value;
  }

  function decodeTimer(value) {
    return value === 'forever' ? Infinity : Number.isFinite(value) ? value : 0;
  }

  function saveGame() {
    if (state !== 'playing' || !world || !player) return;
    const save = {
      version: 1,
      floor,
      score,
      kills,
      floorKills,
      breakPromptPending,
      elapsed,
      floorTime,
      seed,
      player: { ...player, immortalTimer: encodeTimer(player.immortalTimer) },
      wolves: wolves.map((wolf) => ({ ...wolf, immortalTimer: encodeTimer(wolf.immortalTimer) })),
      monsters,
      potions,
      weapons,
      boss,
      exitGate,
      world,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (error) { /* storage can be unavailable */ }
  }

  function clearSavedGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (error) { /* storage can be unavailable */ }
  }

  function restoreGame() {
    let save;
    try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (error) { return false; }
    if (!save || save.version !== 1 || !save.player || !save.world || !Array.isArray(save.wolves)) return false;
    state = 'playing';
    floor = Math.max(1, Math.floor(Number(save.floor) || 1));
    score = Number(save.score) || 0;
    kills = Number(save.kills) || 0;
    floorKills = Number(save.floorKills) || 0;
    breakPromptPending = Boolean(save.breakPromptPending);
    elapsed = Number(save.elapsed) || 0;
    floorTime = Number(save.floorTime) || 0;
    seed = Number(save.seed) || 12;
    player = { ...save.player, immortalTimer: decodeTimer(save.player.immortalTimer) };
    wolves = save.wolves.map((wolf) => ({
      ...wolf,
      hp: clamp(Number.isFinite(wolf.hp) ? wolf.hp : 50, 0, 50),
      maxHp: 50,
      dead: Boolean(wolf.dead) || (Number.isFinite(wolf.hp) && wolf.hp <= 0),
      hurtTimer: Number(wolf.hurtTimer) || 0,
      immortalTimer: decodeTimer(wolf.immortalTimer),
    }));
    monsters = Array.isArray(save.monsters) ? save.monsters : [];
    potions = Array.isArray(save.potions) ? save.potions.filter((potion) => potion.kind !== 'immortal' || floor % 2 === 0) : [];
    weapons = Array.isArray(save.weapons) ? save.weapons : [];
    particles = [];
    world = save.world;
    boss = save.boss || null;
    exitGate = save.exitGate || { x: world.w - 175, y: world.h / 2, open: false, triggered: false };
    titleScreen.hidden = true;
    resultScreen.hidden = true;
    breakScreen.hidden = true;
    hud.hidden = false;
    controls.hidden = false;
    objective.hidden = false;
    resetInput();
    updateObjective();
    updateCamera();
    updateHud();
    showToast(`RUN RESTORED · FLOOR ${formatFloor(floor)}`);
    if (breakPromptPending && floor >= 15) showBreakPrompt();
    return true;
  }

  function loadFloor(first = false) {
    floorTime = 0;
    floorKills = 0;
    world = { w: 2440, h: 1500 };
    player.x = 156;
    player.y = world.h / 2;
    if (!first) {
      player.hp = Math.min(player.maxHp, player.hp + 35);
      player.sprintFuel = 100;
    }
    player.attackTimer = 0;
    player.attackCooldown = 0;
    player.giantTimer = 0;
    player.speedTimer = 0;
    player.r = 17;
    resetWolves();
    monsters = [];
    potions = [];
    weapons = [];
    particles = [];
    boss = null;
    exitGate = { x: world.w - 175, y: world.h / 2, open: false, triggered: false };
    createFloorGeometry();
    spawnMonsters(4 + Math.min(floor, 10) * 3);
    spawnPotions(3);
    spawnWeapons(WEAPON_COUNT);
    updateObjective();
  }

  function resetWolves() {
    wolves.forEach((wolf) => {
      wolf.x = player.x + Math.cos(wolf.formationAngle) * 42;
      wolf.y = player.y + Math.sin(wolf.formationAngle) * 42;
      wolf.attackCooldown = wolf.index * .12;
      wolf.hitTimer = 0;
      wolf.hurtTimer = 0;
      wolf.giantTimer = 0;
      wolf.speedTimer = 0;
    });
  }

  function createFloorGeometry() {
    world.walls = [
      { x: 390, y: 0, w: 32, h: 390 }, { x: 390, y: 510, w: 32, h: 600 },
      { x: 790, y: 0, w: 32, h: 260 }, { x: 790, y: 385, w: 32, h: 560 }, { x: 790, y: 1070, w: 32, h: 430 },
      { x: 1190, y: 0, w: 32, h: 520 }, { x: 1190, y: 650, w: 32, h: 850 },
      { x: 1585, y: 0, w: 32, h: 310 }, { x: 1585, y: 440, w: 32, h: 690 }, { x: 1585, y: 1260, w: 32, h: 240 },
      { x: 1980, y: 0, w: 32, h: 590 }, { x: 1980, y: 730, w: 32, h: 770 },
      { x: 430, y: 250, w: 185, h: 28 }, { x: 980, y: 1130, w: 170, h: 28 },
      { x: 1350, y: 310, w: 145, h: 28 }, { x: 1690, y: 1050, w: 180, h: 28 },
      { x: 470, y: 640, w: 220, h: 26 }, { x: 470, y: 840, w: 220, h: 26 },
      { x: 850, y: 520, w: 230, h: 26 }, { x: 850, y: 820, w: 220, h: 26 },
      { x: 1250, y: 200, w: 220, h: 26 }, { x: 1250, y: 970, w: 230, h: 26 },
      { x: 1650, y: 600, w: 240, h: 26 }, { x: 1650, y: 870, w: 240, h: 26 },
      { x: 2050, y: 300, w: 230, h: 26 }, { x: 2050, y: 1060, w: 230, h: 26 },
    ];
    for (let i = 0; i < 15 + Math.min(floor, 12) * 4; i += 1) {
      const x = 420 + Math.floor(rand() * 1840 / 80) * 80;
      const y = 110 + Math.floor(rand() * 1280 / 80) * 80;
      world.walls.push({ x, y, w: 38, h: 38, pillar: true });
    }
  }

  function inWall(x, y, r = 0) {
    if (x - r < 35 || x + r > world.w - 35 || y - r < 35 || y + r > world.h - 35) return true;
    return world.walls.some((wall) => circleRectCollision(x, y, r, wall));
  }

  function circleRectCollision(x, y, r, rect) {
    const nearestX = clamp(x, rect.x, rect.x + rect.w);
    const nearestY = clamp(y, rect.y, rect.y + rect.h);
    return Math.hypot(x - nearestX, y - nearestY) < r;
  }

  function freeSpot(minX = 0, minY = 0, minDistance = 0) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = { x: minX + 80 + rand() * (world.w - minX - 230), y: minY + 80 + rand() * (world.h - minY - 160) };
      if (inWall(candidate.x, candidate.y, 30)) continue;
      if (distance(candidate, player) < minDistance) continue;
      if (monsters.some((other) => distance(candidate, other) < 90)) continue;
      return candidate;
    }
    return { x: 560, y: 750 };
  }

  function spawnMonsters(count) {
    for (let i = 0; i < count; i += 1) {
      const pos = freeSpot(520, 0, 430);
      const type = (i + floor) % 3 === 0 ? 'runner' : 'brawler';
      monsters.push({ x: pos.x, y: pos.y, r: type === 'runner' ? 18 : 20, hp: 136, maxHp: 136, type, angle: rand() * TAU, attackCooldown: rand(), hitTimer: 0, dead: false, wander: rand() * TAU });
    }
  }

  function spawnPotions(count) {
    for (let i = 0; i < count; i += 1) {
      const kind = ['giant', 'speed', 'immortal'][i];
      if (kind === 'immortal' && floor % 2 !== 0) continue;
      const pos = freeSpot(320, 0, 240);
      potions.push({ x: pos.x, y: pos.y, r: 15, active: true, bob: rand() * TAU, kind });
    }
  }

  function spawnWeapons(count) {
    const kinds = ['sword', 'spear'];
    for (let i = 0; i < count; i += 1) {
      const pos = freeSpot(420, 0, 300);
      weapons.push({ x: pos.x, y: pos.y, r: 17, active: true, bob: rand() * TAU, kind: kinds[i % kinds.length] });
    }
  }

  function spawnBoss() {
    const difficulty = Math.min(floor, 25);
    const bossHealth = 860 + difficulty * 70;
    boss = { x: world.w - 480, y: world.h / 2, r: 64, hp: bossHealth, maxHp: bossHealth, angle: Math.PI, attackCooldown: 0.5, hitTimer: 0, dead: false, phase: 0 };
    showToast('THE ABYSS AWAKENS');
    camera.shake = 16;
    updateObjective();
  }

  function livingMonsters() { return monsters.filter((monster) => !monster.dead); }

  function livingWolves() { return wolves.filter((wolf) => !wolf.dead && wolf.hp > 0); }

  function nearestLivingWolf(entity) {
    let nearestWolf = null;
    let nearestDistance = Infinity;
    for (const wolf of livingWolves()) {
      const currentDistance = distance(entity, wolf);
      if (currentDistance < nearestDistance) {
        nearestDistance = currentDistance;
        nearestWolf = wolf;
      }
    }
    return nearestWolf;
  }

  function updateObjective() {
    if (floorKills < FLOOR_KILL_TARGET) {
      objectiveText.textContent = `Defeat 20 attackers · ${floorKills}/20`;
    } else if (isWardenFloor() && !boss) {
      objectiveText.textContent = '20 defeated · reach the Warden';
    } else if (boss && !boss.dead) {
      objectiveText.textContent = `The Warden · ${Math.ceil((boss.hp / boss.maxHp) * 100)}% remaining`;
    } else {
      objectiveText.textContent = '20 defeated · reach the far end';
    }
  }

  function showToast(message, duration = 2.2) {
    clearTimeout(nextToastTimeout);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = duration;
    nextToastTimeout = setTimeout(() => toast.classList.remove('show'), duration * 1000);
  }

  function update(dt) {
    if (state !== 'playing') return;
    elapsed += dt;
    floorTime += dt;
    toastTimer = Math.max(0, toastTimer - dt);
    camera.shake = Math.max(0, camera.shake - dt * 22);
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.attackTimer = Math.max(0, player.attackTimer - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.giantTimer = Math.max(0, player.giantTimer - dt);
    player.speedTimer = Math.max(0, player.speedTimer - dt);
    player.immortalTimer = Math.max(0, player.immortalTimer - dt);
    player.r = 17;

    const movementBlend = 1 - Math.exp(-dt * 14);
    input.moveX = lerp(input.moveX, input.targetMoveX, movementBlend);
    input.moveY = lerp(input.moveY, input.targetMoveY, movementBlend);
    const moveMagnitude = Math.hypot(input.moveX, input.moveY);
    const moving = moveMagnitude > .08;
    const sprinting = input.sprint && moving && player.sprintFuel > 1;
    const currentSpeed = player.speed * (player.speedTimer > 0 ? 2.25 : 1) * (sprinting ? 1.62 : 1);
    if (sprinting) player.sprintFuel = clamp(player.sprintFuel - dt * 29, 0, 100);
    else player.sprintFuel = clamp(player.sprintFuel + dt * 18, 0, 100);
    if (moving) {
      const x = input.moveX / moveMagnitude;
      const y = input.moveY / moveMagnitude;
      lastMoveAngle = Math.atan2(y, x);
      player.angle = lastMoveAngle;
      moveCircle(player, x * currentSpeed * dt, y * currentSpeed * dt);
    }
    updateWolves(dt, moving);
    updateMonsters(dt);
    updateBoss(dt);
    updatePotions(dt);
    updateWeapons(dt);
    updateParticles(dt);

    if (floorKills >= FLOOR_KILL_TARGET && !exitGate.open && (!isWardenFloor() || (boss && boss.dead))) {
      exitGate.open = true;
      score += 250 * floor;
      showToast('20 DEFEATED · THE GATE IS OPEN');
      updateObjective();
    }
    if (isWardenFloor() && floorKills >= FLOOR_KILL_TARGET && !boss && player.x > world.w - 620) spawnBoss();
    if (exitGate.open && player.x > exitGate.x - 80 && Math.abs(player.y - exitGate.y) < 130) {
      score += Math.max(0, 500 - Math.floor(floorTime * 3));
      floor += 1;
      loadFloor();
      showToast(`FLOOR ${formatFloor(floor)} · DEEPER STILL`);
      if (floor === 15) {
        breakPromptPending = true;
        saveGame();
        showBreakPrompt();
      }
    }
    updateCamera();
    updateHud();
    saveTimer += dt;
    if (saveTimer >= 1) { saveGame(); saveTimer = 0; }
  }

  function moveCircle(entity, dx, dy) {
    const nextX = entity.x + dx;
    if (!inWall(nextX, entity.y, entity.r)) entity.x = nextX;
    const nextY = entity.y + dy;
    if (!inWall(entity.x, nextY, entity.r)) entity.y = nextY;
  }

  function findWolfTarget(wolf) {
    let target = null;
    let nearest = Infinity;
    for (const monster of monsters) {
      if (monster.dead || distance(player, monster) > 680) continue;
      const d = distance(wolf, monster);
      if (d < nearest) { nearest = d; target = monster; }
    }
    if (!target && boss && !boss.dead && distance(player, boss) < 760) target = boss;
    return target;
  }

  function updateWolves(dt, moving) {
    for (const wolf of wolves) {
      if (wolf.dead) continue;
      wolf.attackCooldown = Math.max(0, wolf.attackCooldown - dt);
      wolf.hitTimer = Math.max(0, wolf.hitTimer - dt);
      wolf.hurtTimer = Math.max(0, wolf.hurtTimer - dt);
      wolf.giantTimer = Math.max(0, wolf.giantTimer - dt);
      wolf.speedTimer = Math.max(0, wolf.speedTimer - dt);
      wolf.immortalTimer = Math.max(0, wolf.immortalTimer - dt);
      const homeX = player.x + Math.cos(wolf.formationAngle) * wolf.homeRadius;
      const homeY = player.y + Math.sin(wolf.formationAngle) * wolf.homeRadius;
      const playerDistance = distance(wolf, player);
      if (moving || playerDistance > 100) {
        if (inWall(homeX, homeY, wolf.r)) {
          wolf.x = player.x;
          wolf.y = player.y;
        } else {
          wolf.x = homeX;
          wolf.y = homeY;
        }
        wolf.angle = player.angle;
      }
      const target = findWolfTarget(wolf);
      const targetDistance = target ? distance(wolf, target) : Infinity;
      const contactRange = target ? wolf.r + target.r + (wolf.giantTimer > 0 ? 14 : 8) : 0;
      if (target && targetDistance <= contactRange) {
        wolf.angle = Math.atan2(target.y - wolf.y, target.x - wolf.x);
        if (wolf.attackCooldown <= 0 && !target.dead) {
          target.hp -= WOLF_DAMAGE;
          target.hitTimer = .2;
          wolf.hitTimer = .2;
          for (let i = 0; i < 4; i += 1) emitParticle(target.x, target.y, '#8fc9c5', 22 + rand() * 35);
          wolf.attackCooldown = .82;
          if (target.hp <= 0) defeat(target);
        }
      }
    }
  }

  function updateMonsters(dt) {
    for (const monster of monsters) {
      if (monster.dead) continue;
      monster.attackCooldown = Math.max(0, monster.attackCooldown - dt);
      monster.hitTimer = Math.max(0, monster.hitTimer - dt);
      const wolfTarget = nearestLivingWolf(monster);
      const playerDistance = distance(monster, player);
      const wolfDistance = wolfTarget ? distance(monster, wolfTarget) : Infinity;
      const target = wolfTarget && wolfDistance < playerDistance ? wolfTarget : player;
      const d = distance(monster, target);
      if (d < 560) {
        const chaseAngle = Math.atan2(target.y - monster.y, target.x - monster.x);
        monster.angle = chaseAngle;
        const targetRadius = target === player ? player.r : target.r;
        if (d > monster.r + targetRadius + 12) {
          const difficulty = Math.min(floor, 20);
          const speed = monster.type === 'runner' ? 92 + difficulty * 9 : 66 + difficulty * 8;
          moveCircle(monster, Math.cos(chaseAngle) * speed * dt, Math.sin(chaseAngle) * speed * dt);
        } else if (monster.attackCooldown <= 0) {
          if (target === player) hurtPlayer(1);
          else hurtWolf(target, 1);
          monster.attackCooldown = monster.type === 'runner' ? 1.05 : 1.3;
        }
      } else {
        monster.wander += (rand() - .5) * dt * .3;
        moveCircle(monster, Math.cos(monster.wander) * 12 * dt, Math.sin(monster.wander) * 12 * dt);
      }
    }
  }

  function updateBoss(dt) {
    if (!boss || boss.dead) return;
    boss.attackCooldown = Math.max(0, boss.attackCooldown - dt);
    boss.hitTimer = Math.max(0, boss.hitTimer - dt);
    const wolfTarget = nearestLivingWolf(boss);
    const playerDistance = distance(boss, player);
    const wolfDistance = wolfTarget ? distance(boss, wolfTarget) : Infinity;
    const target = wolfTarget && wolfDistance < playerDistance ? wolfTarget : player;
    const d = distance(boss, target);
    const angle = Math.atan2(target.y - boss.y, target.x - boss.x);
    boss.angle = angle;
    boss.phase += dt;
    const targetRadius = target === player ? player.r : target.r;
    if (d > targetRadius + 88) moveCircle(boss, Math.cos(angle) * 40 * dt, Math.sin(angle) * 40 * dt);
    else if (boss.attackCooldown <= 0) {
      if (target === player) hurtPlayer(20);
      else hurtWolf(target, 1);
      boss.attackCooldown = 1.05;
      for (let i = 0; i < 10; i += 1) emitParticle(target.x, target.y, '#bd4b40', 55 + rand() * 50);
    }
  }

  function updatePotions(dt) {
    for (const potion of potions) {
      if (!potion.active) continue;
      potion.bob += dt * 2.4;
      if (distance(potion, player) < potion.r + player.r + 8) {
        potion.active = false;
        if (potion.kind === 'giant') {
          player.giantTimer = 14;
          wolves.forEach((wolf) => { wolf.giantTimer = 14; });
          showToast('GIANT FORM · THE PACK GROWS BIG');
        } else if (potion.kind === 'speed') {
          player.speedTimer = 14;
          wolves.forEach((wolf) => { wolf.speedTimer = 14; });
          showToast('VELOCITY SURGE · THE PACK IS SUPER FAST');
        } else {
          player.immortalTimer = Infinity;
          wolves.forEach((wolf) => {
            wolf.dead = false;
            wolf.hp = wolf.maxHp;
            wolf.hurtTimer = 0;
            wolf.immortalTimer = Infinity;
            wolf.x = player.x + Math.cos(wolf.formationAngle) * 42;
            wolf.y = player.y + Math.sin(wolf.formationAngle) * 42;
          });
          showToast('IMMORTAL FOREVER · THE PACK RETURNS');
        }
        score += 150;
        const potionColor = potion.kind === 'giant' ? '#a9df8d' : potion.kind === 'speed' ? '#5ed8c9' : '#9ab9ff';
        for (let i = 0; i < 14; i += 1) emitParticle(potion.x, potion.y, potionColor, 30 + rand() * 50);
      }
    }
  }

  function updateWeapons(dt) {
    for (const weapon of weapons) {
      if (!weapon.active) continue;
      weapon.bob += dt * 2.2;
      if (distance(weapon, player) < weapon.r + player.r + 10) {
        weapon.active = false;
        player.weapon = weapon.kind;
        showToast(`${weapon.kind.toUpperCase()} FOUND · ATTACK REACH UP`);
        score += 250;
        for (let i = 0; i < 12; i += 1) emitParticle(weapon.x, weapon.y, '#f0c36a', 28 + rand() * 45);
      }
    }
  }

  function hurtPlayer(amount) {
    if (player.hurtTimer > 0 || player.immortalTimer > 0 || state !== 'playing') return;
    player.hp = clamp(player.hp - amount, 0, player.maxHp);
    player.hurtTimer = .35;
    camera.shake = Math.max(camera.shake, 8);
    for (let i = 0; i < 5; i += 1) emitParticle(player.x, player.y, '#df594b', 22 + rand() * 35);
    if (player.hp <= 0) finishGame(false);
  }

  function hurtWolf(wolf, amount) {
    if (!wolf || wolf.dead || wolf.hurtTimer > 0 || wolf.immortalTimer > 0 || state !== 'playing') return;
    wolf.hp = clamp(wolf.hp - amount, 0, wolf.maxHp);
    wolf.hurtTimer = .35;
    camera.shake = Math.max(camera.shake, 4);
    for (let i = 0; i < 4; i += 1) emitParticle(wolf.x, wolf.y, '#df594b', 20 + rand() * 30);
    if (wolf.hp <= 0) {
      wolf.dead = true;
      if (livingWolves().length === 0) showToast('THE PACK HAS FALLEN');
    }
  }

  function attack() {
    if (state !== 'playing' || player.attackCooldown > 0) return;
    player.attackCooldown = .42;
    player.attackTimer = .24;
    const damage = player.damage;
    const hit = (target) => {
      const d = distance(player, target);
      const contactRange = player.r + target.r + (player.giantTimer > 0 ? 14 : 8);
      if (d <= contactRange) {
        target.hp -= damage;
        target.hitTimer = .22;
        camera.shake = Math.max(camera.shake, 4);
        for (let i = 0; i < 8; i += 1) emitParticle(target.x, target.y, '#eda268', 35 + rand() * 60);
        if (target.hp <= 0) defeat(target);
      }
    };
    monsters.filter((monster) => !monster.dead).forEach(hit);
    if (boss && !boss.dead) hit(boss);
  }

  function defeat(target) {
    target.dead = true;
    kills += 1;
    if (target !== boss) floorKills += 1;
    score += target === boss ? 2500 : target.type === 'runner' ? 220 : 180;
    if (target !== boss && floorKills < FLOOR_KILL_TARGET) spawnMonsters(1);
    for (let i = 0; i < (target === boss ? 36 : 15); i += 1) emitParticle(target.x, target.y, target === boss ? '#c93e3a' : '#a44c46', 30 + rand() * 100);
    if (target === boss) {
      showToast('THE WARDEN FALLS');
      exitGate.open = true;
      score += 1000;
      updateObjective();
    } else updateObjective();
  }

  function emitParticle(x, y, color, speed) {
    const angle = rand() * TAU;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .35 + rand() * .7, maxLife: .8, size: 1.5 + rand() * 3.5, color });
  }

  function updateParticles(dt) {
    particles = particles.filter((particle) => {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= .93;
      particle.vy *= .93;
      return particle.life > 0;
    });
  }

  function updateCamera() {
    const targetX = clamp(player.x - view.w * .5, 0, Math.max(0, world.w - view.w));
    const targetY = clamp(player.y - view.h * .5, 0, Math.max(0, world.h - view.h));
    camera.x = lerp(camera.x, targetX, .12);
    camera.y = lerp(camera.y, targetY, .12);
  }

  function updateHud() {
    document.querySelector('#floorLabel').textContent = `${formatFloor(floor)} / ∞`;
    document.querySelector('#scoreText').textContent = formatNumber(score);
    document.querySelector('#killsText').textContent = String(kills).padStart(2, '0');
    document.querySelector('#healthText').textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    document.querySelector('#healthMeter').style.width = `${(player.hp / player.maxHp) * 100}%`;
    document.querySelector('#fuelText').textContent = String(Math.ceil(player.sprintFuel));
    document.querySelector('#fuelText').style.color = player.sprintFuel < 25 ? '#d85c4e' : '#86a75e';
    if (boss && !boss.dead) updateObjective();
  }

  function showBreakPrompt() {
    if (state !== 'playing') return;
    state = 'break-prompt';
    resetInput();
    controls.hidden = true;
    objective.hidden = true;
    breakScreen.hidden = false;
  }

  function continueAfterBreakPrompt() {
    if (state !== 'break-prompt') return;
    breakPromptPending = false;
    state = 'playing';
    breakScreen.hidden = true;
    controls.hidden = false;
    objective.hidden = false;
    updateObjective();
    saveGame();
    showToast('KEEP GOING · FLOOR 15');
  }

  function finishGame(won, reason = '') {
    if (state !== 'playing' && state !== 'break-prompt') return;
    state = won ? 'won' : 'lost';
    breakPromptPending = false;
    clearSavedGame();
    resetInput();
    controls.hidden = true;
    objective.hidden = true;
    breakScreen.hidden = true;
    hud.hidden = true;
    resultScreen.hidden = false;
    const takingBreak = reason === 'break';
    document.querySelector('#resultEyebrow').textContent = takingBreak ? 'A REST AT FLOOR 15' : won ? 'THE DUNGEON REMEMBERS' : 'THE DARK CLAIMS YOU';
    document.querySelector('#resultTitle').textContent = takingBreak ? 'BREAK TIME' : won ? 'YOU ESCAPED' : 'YOU FELL';
    document.querySelector('#resultBlurb').textContent = takingBreak ? 'You made it through 15 floors. Here are your run totals.' : won ? 'The gate groans shut behind you. For now.' : 'The dungeon keeps what it catches. Descend again?';
    document.querySelector('#resultScore').textContent = formatNumber(score);
    document.querySelector('#resultKills').textContent = String(kills).padStart(2, '0');
    document.querySelector('#resultFloor').textContent = `${formatFloor(floor)} / ∞`;
  }

  function render() {
    ctx.clearRect(0, 0, view.w, view.h);
    if (!world || !player) return;
    const shakeX = (rand() - .5) * camera.shake;
    const shakeY = (rand() - .5) * camera.shake;
    ctx.save();
    ctx.translate(-camera.x + shakeX, -camera.y + shakeY);
    drawWorld();
    drawGate();
    weapons.filter((weapon) => weapon.active).forEach(drawWeapon);
    potions.filter((potion) => potion.active).forEach(drawPotion);
    wolves.forEach(drawWolf);
    monsters.filter((monster) => !monster.dead).forEach(drawMonster);
    if (boss && !boss.dead) drawBoss();
    drawPlayer();
    drawParticles();
    ctx.restore();
    drawDarkness();
    if (player.hurtTimer > 0) {
      ctx.fillStyle = `rgba(213, 44, 37, ${player.hurtTimer * .2})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  function drawWorld() {
    ctx.fillStyle = '#a9c7cc';
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.fillStyle = '#dcebe7';
    ctx.fillRect(35, 35, world.w - 70, world.h - 70);
    ctx.strokeStyle = 'rgba(34, 101, 111, .16)';
    ctx.lineWidth = 1;
    for (let x = 55; x < world.w - 40; x += 64) { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, world.h - 40); ctx.stroke(); }
    for (let y = 55; y < world.h - 40; y += 64) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(world.w - 40, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(24, 82, 92, .1)';
    for (let x = 45; x < world.w; x += 128) for (let y = 45; y < world.h; y += 128) ctx.fillRect(x, y, 2, 2);
    world.walls.forEach(drawWall);
    drawTorches();
  }

  function drawWall(wall) {
    ctx.save();
    ctx.shadowColor = 'rgba(24, 78, 88, .28)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
    ctx.fillStyle = wall.pillar ? '#85aab0' : '#73979e';
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(233,255,248,.7)'; ctx.strokeRect(wall.x + .5, wall.y + .5, wall.w - 1, wall.h - 1);
    ctx.strokeStyle = 'rgba(28,83,94,.16)';
    if (wall.w > wall.h) { for (let x = wall.x + 18; x < wall.x + wall.w; x += 42) { ctx.beginPath(); ctx.moveTo(x, wall.y); ctx.lineTo(x - 8, wall.y + wall.h); ctx.stroke(); } }
    else { for (let y = wall.y + 18; y < wall.y + wall.h; y += 42) { ctx.beginPath(); ctx.moveTo(wall.x, y); ctx.lineTo(wall.x + wall.w, y - 9); ctx.stroke(); } }
    ctx.restore();
  }

  function drawTorches() {
    const torches = [{ x: 250, y: 250 }, { x: 690, y: 850 }, { x: 1070, y: 420 }, { x: 1450, y: 1080 }, { x: 1825, y: 280 }, { x: 2200, y: 1160 }];
    torches.forEach((torch, index) => {
      const pulse = Math.sin(elapsed * 6 + index) * 3;
      const glow = ctx.createRadialGradient(torch.x, torch.y, 2, torch.x, torch.y, 110 + pulse);
      glow.addColorStop(0, 'rgba(88,215,199,.34)'); glow.addColorStop(1, 'rgba(88,215,199,0)');
      ctx.fillStyle = glow; ctx.fillRect(torch.x - 120, torch.y - 120, 240, 240);
      ctx.fillStyle = '#2f6570'; ctx.fillRect(torch.x - 3, torch.y, 6, 19);
      ctx.fillStyle = '#71e0cf'; ctx.beginPath(); ctx.arc(torch.x, torch.y - 5, 7 + pulse * .15, 0, TAU); ctx.fill();
    });
  }

  function drawGate() {
    const x = exitGate.x; const y = exitGate.y;
    ctx.save();
    ctx.translate(x, y);
    const pulse = 1 + Math.sin(elapsed * 3) * .08;
    ctx.globalAlpha = exitGate.open ? 1 : .45;
    ctx.strokeStyle = exitGate.open ? '#62d5c4' : '#657983'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(0, 0, 72, Math.PI, TAU); ctx.lineTo(72, 85); ctx.lineTo(-72, 85); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = exitGate.open ? `rgba(42,156,166,${.18 * pulse})` : 'rgba(30,42,54,.6)';
    ctx.fillRect(-63, -2, 126, 87);
    ctx.fillStyle = exitGate.open ? '#9df0dc' : '#8297a0'; ctx.beginPath(); ctx.arc(0, 10, 8 * pulse, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9bbab'; ctx.font = '700 10px ui-monospace'; ctx.textAlign = 'center'; ctx.fillText(exitGate.open ? 'EXIT' : 'SEALED', 0, 112);
    ctx.restore();
  }

  function drawPotion(potion) {
    const lift = Math.sin(potion.bob) * 5;
    ctx.save(); ctx.translate(potion.x, potion.y + lift);
    const data = {
      giant: { color: '#a9df8d', glow: 'rgba(169,223,141,.35)', label: 'GROW' },
      speed: { color: '#5ed8c9', glow: 'rgba(94,216,201,.35)', label: 'FAST' },
      immortal: { color: '#9ab9ff', glow: 'rgba(154,185,255,.38)', label: 'IMMORTAL' },
    }[potion.kind];
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 44); glow.addColorStop(0, data.glow); glow.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = glow; ctx.fillRect(-44, -44, 88, 88);
    ctx.fillStyle = '#b8d4d5'; ctx.fillRect(-6, -23, 12, 9); ctx.fillStyle = data.color; ctx.beginPath(); ctx.roundRect(-15, -14, 30, 36, 10); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(-9, -9, 5, 15);
    ctx.fillStyle = '#d5efea'; ctx.font = '800 8px ui-monospace'; ctx.textAlign = 'center'; ctx.fillText(data.label, 0, 39); ctx.restore();
  }

  function drawWeapon(weapon) {
    const lift = Math.sin(weapon.bob) * 5;
    const data = { sword: { color: '#f0c36a', label: 'SWORD' }, spear: { color: '#8fd8d0', label: 'SPEAR' } }[weapon.kind];
    ctx.save(); ctx.translate(weapon.x, weapon.y + lift); ctx.rotate(Math.sin(weapon.bob * .7) * .2);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 48); glow.addColorStop(0, `${data.color}66`); glow.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = glow; ctx.fillRect(-48, -48, 96, 96);
    ctx.strokeStyle = '#315964'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    if (weapon.kind === 'sword') {
      ctx.beginPath(); ctx.moveTo(-10, 12); ctx.lineTo(9, -12); ctx.stroke();
      ctx.strokeStyle = data.color; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(8, -13); ctx.lineTo(25, -31); ctx.stroke();
      ctx.strokeStyle = '#fff2c8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, -14); ctx.lineTo(26, -31); ctx.stroke();
    } else {
      ctx.strokeStyle = '#315964'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-19, 20); ctx.lineTo(20, -24); ctx.stroke();
      ctx.fillStyle = data.color; ctx.beginPath(); ctx.moveTo(20, -36); ctx.lineTo(30, -20); ctx.lineTo(12, -22); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#245767'; ctx.font = '800 8px ui-monospace'; ctx.textAlign = 'center'; ctx.fillText(data.label, 0, 42);
    ctx.restore();
  }

  function drawMonster(monster) {
    const flash = monster.hitTimer > 0;
    ctx.save(); ctx.translate(monster.x, monster.y);
    ctx.globalAlpha = flash ? .75 : 1;
    ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.beginPath(); ctx.ellipse(0, 30, monster.r * 1.25, monster.r * .42, 0, 0, TAU); ctx.fill();
    const shirt = monster.type === 'runner' ? '#427684' : '#6b596f';
    const skin = monster.type === 'runner' ? '#d09a82' : '#b87e73';
    ctx.strokeStyle = '#15242c'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, 19); ctx.lineTo(-9, 34); ctx.moveTo(6, 19); ctx.lineTo(9, 34); ctx.stroke();
    ctx.strokeStyle = skin; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-21, 13); ctx.moveTo(10, 0); ctx.lineTo(21, 13); ctx.stroke();
    ctx.fillStyle = flash ? '#b7fff0' : shirt; ctx.beginPath(); ctx.roundRect(-13, -5, 26, 30, 7); ctx.fill();
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -17, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b2830'; ctx.beginPath(); ctx.arc(0, -20, 11, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#27353a'; ctx.beginPath(); ctx.arc(-4, -16, 1.5, 0, TAU); ctx.arc(4, -16, 1.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c4e9df'; ctx.font = '800 8px ui-monospace'; ctx.textAlign = 'center'; ctx.fillText('!', 0, -35);
    ctx.restore();
    drawHealthBar(monster, 42, 4);
  }

  function drawWolf(wolf) {
    if (wolf.dead) return;
    const flash = wolf.hitTimer > 0 || wolf.hurtTimer > 0;
    const fur = flash ? '#c7fff1' : ['#557983', '#6c7f92', '#416d78'][wolf.index % 3];
    const giant = wolf.giantTimer > 0;
    ctx.save(); ctx.translate(wolf.x, wolf.y); ctx.scale(giant ? 1.45 : 1, giant ? 1.45 : 1);
    ctx.fillStyle = 'rgba(0,0,0,.34)'; ctx.beginPath(); ctx.ellipse(-1, 17, 22, 7, 0, 0, TAU); ctx.fill();
    if (giant) { ctx.strokeStyle = 'rgba(169,223,141,.82)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 28 + Math.sin(elapsed * 5 + wolf.index) * 2, 0, TAU); ctx.stroke(); }
    if (wolf.speedTimer > 0) { ctx.strokeStyle = 'rgba(94,216,201,.88)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 24 + Math.sin(elapsed * 7 + wolf.index) * 2, 0, TAU); ctx.stroke(); }
    if (wolf.immortalTimer > 0) { ctx.strokeStyle = 'rgba(154,185,255,.92)'; ctx.lineWidth = 3; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(0, 0, 32 + Math.sin(elapsed * 4 + wolf.index) * 2, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    ctx.strokeStyle = fur; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-12, 5); ctx.quadraticCurveTo(-30, -4, -25, -17); ctx.stroke();
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(-1, 7, 16, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(14, -5, 11, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -12); ctx.lineTo(10, -25); ctx.lineTo(16, -15); ctx.closePath(); ctx.moveTo(18, -13); ctx.lineTo(24, -24); ctx.lineTo(26, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d9fff1'; ctx.beginPath(); ctx.arc(18, -6, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#193c46'; ctx.beginPath(); ctx.arc(19, -7, 2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#efaaa0'; ctx.beginPath(); ctx.arc(25, -4, 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#b6edcf'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-9, 14); ctx.lineTo(-11, 23); ctx.moveTo(7, 14); ctx.lineTo(9, 23); ctx.stroke();
    ctx.strokeStyle = '#e0fff3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(6, 5, 13, -.35, .65); ctx.stroke();
    ctx.restore();
    drawHealthBar(wolf, 38, 4);
  }

  function drawBoss() {
    const flash = boss.hitTimer > 0;
    ctx.save(); ctx.translate(boss.x, boss.y);
    const pulse = 1 + Math.sin(boss.phase * 4) * .06;
    ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.beginPath(); ctx.ellipse(0, 65, 98, 33, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = flash ? '#b7fff0' : '#203b46'; ctx.beginPath(); ctx.moveTo(-64, 58); ctx.lineTo(-50, -42); ctx.lineTo(-23, -65); ctx.lineTo(0, -45); ctx.lineTo(28, -69); ctx.lineTo(58, -36); ctx.lineTo(72, 61); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2f7d80'; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#0a080e'; ctx.beginPath(); ctx.arc(0, -29, 40 * pulse, 0, TAU); ctx.fill();
    ctx.fillStyle = '#67e8d5'; ctx.shadowColor = '#67e8d5'; ctx.shadowBlur = 22; ctx.beginPath(); ctx.arc(-15, -34, 7, 0, TAU); ctx.arc(18, -34, 7, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = '#67bdb5'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-38, -64); ctx.lineTo(-52, -105); ctx.moveTo(36, -64); ctx.lineTo(50, -106); ctx.stroke();
    ctx.fillStyle = '#ded1bc'; ctx.font = '800 12px ui-monospace'; ctx.textAlign = 'center'; ctx.fillText('THE WARDEN', 0, 105); ctx.restore();
    drawHealthBar(boss, 132, 7);
  }

  function drawHealthBar(entity, width, height) {
    if (entity.hp >= entity.maxHp) return;
    const y = entity.y - entity.r - 16;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(entity.x - width / 2, y, width, height);
    ctx.fillStyle = entity === boss ? '#46c7c4' : '#4ca69d'; ctx.fillRect(entity.x - width / 2, y, width * clamp(entity.hp / entity.maxHp, 0, 1), height);
  }

  function drawPlayer() {
    const flash = player.hurtTimer > 0;
    const giant = player.giantTimer > 0;
    ctx.save(); ctx.translate(player.x, player.y); ctx.scale(giant ? 1.6 : 1, giant ? 1.6 : 1);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.ellipse(0, 23, 29, 10, 0, 0, TAU); ctx.fill();
    if (giant) { ctx.strokeStyle = 'rgba(169,223,141,.78)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 31 + Math.sin(elapsed * 5) * 3, 0, TAU); ctx.stroke(); }
    if (player.speedTimer > 0) { ctx.strokeStyle = 'rgba(94,216,201,.82)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 28 + Math.sin(elapsed * 7) * 3, 0, TAU); ctx.stroke(); }
    if (player.immortalTimer > 0) { ctx.strokeStyle = 'rgba(154,185,255,.88)'; ctx.lineWidth = 4; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(0, 0, 35 + Math.sin(elapsed * 4) * 2, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    const fur = flash ? '#b7fff0' : '#8fc9c5';
    const darkFur = '#427b82';
    const innerEar = '#ef9c9a';
    ctx.strokeStyle = darkFur; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-12, 11); ctx.quadraticCurveTo(-34, 18, -31, -2); ctx.quadraticCurveTo(-29, -14, -18, -17); ctx.stroke();
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(0, 8, 16, 18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(0, -12, 15, 0, TAU); ctx.fill();
    ctx.fillStyle = fur; ctx.beginPath(); ctx.moveTo(-13, -20); ctx.lineTo(-10, -36); ctx.lineTo(-1, -25); ctx.closePath(); ctx.moveTo(13, -20); ctx.lineTo(10, -36); ctx.lineTo(1, -25); ctx.closePath(); ctx.fill();
    ctx.fillStyle = innerEar; ctx.beginPath(); ctx.moveTo(-10, -24); ctx.lineTo(-9, -31); ctx.lineTo(-4, -26); ctx.closePath(); ctx.moveTo(10, -24); ctx.lineTo(9, -31); ctx.lineTo(4, -26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#25444b'; ctx.beginPath(); ctx.arc(-6, -13, 2.5, 0, TAU); ctx.arc(6, -13, 2.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f0b1a8'; ctx.beginPath(); ctx.arc(0, -7, 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#315e65'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-3, -5); ctx.quadraticCurveTo(0, -2, 3, -5); ctx.moveTo(-10, -7); ctx.lineTo(-25, -10); ctx.moveTo(-10, -4); ctx.lineTo(-25, 0); ctx.moveTo(10, -7); ctx.lineTo(25, -10); ctx.moveTo(10, -4); ctx.lineTo(25, 0); ctx.stroke();
    ctx.fillStyle = '#dcfff3'; ctx.beginPath(); ctx.ellipse(-8, 23, 6, 4, 0, 0, TAU); ctx.ellipse(8, 23, 6, 4, 0, 0, TAU); ctx.fill();
    if (player.weapon === 'sword') { ctx.strokeStyle = '#f0c36a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(12, 7); ctx.lineTo(39, -20); ctx.stroke(); ctx.strokeStyle = '#fff2c8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(40, -20); ctx.stroke(); }
    if (player.weapon === 'spear') { ctx.strokeStyle = '#315964'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(9, 9); ctx.lineTo(45, -25); ctx.stroke(); ctx.fillStyle = '#8fd8d0'; ctx.beginPath(); ctx.moveTo(45, -35); ctx.lineTo(53, -23); ctx.lineTo(39, -24); ctx.closePath(); ctx.fill(); }
    if (player.attackTimer > 0) { ctx.strokeStyle = `rgba(157,240,220,${player.attackTimer / .24})`; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(0, 0, 76, -1.15, 1.15); ctx.stroke(); ctx.strokeStyle = '#dcfff3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 86, -.98, .7); ctx.stroke(); }
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((particle) => { ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1); ctx.fillStyle = particle.color; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size, 0, TAU); ctx.fill(); });
    ctx.globalAlpha = 1;
  }

  function drawDarkness() {
    const px = player.x - camera.x; const py = player.y - camera.y;
    const darkness = ctx.createRadialGradient(px, py, 110, px, py, Math.max(view.w, view.h) * .65);
    darkness.addColorStop(0, 'rgba(2,2,6,0)'); darkness.addColorStop(.18, 'rgba(2,2,6,.01)'); darkness.addColorStop(.64, 'rgba(2,2,6,.08)'); darkness.addColorStop(1, 'rgba(2,2,6,.2)');
    ctx.fillStyle = darkness; ctx.fillRect(0, 0, view.w, view.h);
  }

  function setJoystick(clientX, clientY) {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2; const centerY = rect.top + rect.height / 2;
    const max = 45; const dx = clientX - centerX; const dy = clientY - centerY; const length = Math.hypot(dx, dy); const scale = Math.min(1, max / Math.max(1, length));
    const knobX = dx * scale; const knobY = dy * scale;
    input.targetMoveX = knobX / max; input.targetMoveY = knobY / max;
    joystickStick.style.transform = `translate(${knobX}px, ${knobY}px)`;
  }

  function updateKeyboardDirection() {
    if (joystickPointer !== null) return;
    const x = (keyboardState.right ? 1 : 0) - (keyboardState.left ? 1 : 0);
    const y = (keyboardState.down ? 1 : 0) - (keyboardState.up ? 1 : 0);
    const length = Math.hypot(x, y) || 1;
    input.targetMoveX = x / length;
    input.targetMoveY = y / length;
  }

  function bindControls() {
    joystick.addEventListener('pointerdown', (event) => { event.preventDefault(); joystickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); setJoystick(event.clientX, event.clientY); });
    joystick.addEventListener('pointermove', (event) => { if (event.pointerId === joystickPointer) { event.preventDefault(); setJoystick(event.clientX, event.clientY); } });
    const releaseJoystick = (event) => { if (event.pointerId === joystickPointer) { joystickPointer = null; input.targetMoveX = 0; input.targetMoveY = 0; updateKeyboardDirection(); joystickStick.style.transform = 'translate(0, 0)'; } };
    joystick.addEventListener('pointerup', releaseJoystick); joystick.addEventListener('pointercancel', releaseJoystick); joystick.addEventListener('lostpointercapture', releaseJoystick);
    attackButton.addEventListener('pointerdown', (event) => { event.preventDefault(); attackButton.classList.add('is-held'); attack(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => attackButton.addEventListener(eventName, () => attackButton.classList.remove('is-held')));
    sprintButton.addEventListener('pointerdown', (event) => { event.preventDefault(); input.sprint = true; sprintButton.classList.add('is-held'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => sprintButton.addEventListener(eventName, () => { input.sprint = false; sprintButton.classList.remove('is-held'); }));
  }

  const keyboardCodes = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') { event.preventDefault(); attack(); }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') input.sprint = true;
    const direction = keyboardCodes[event.code];
    if (direction) { event.preventDefault(); keyboardState[direction] = true; updateKeyboardDirection(); }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') input.sprint = false;
    const direction = keyboardCodes[event.code];
    if (direction) { event.preventDefault(); keyboardState[direction] = false; updateKeyboardDirection(); }
  });
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', saveGame);
  playButton.addEventListener('click', startGame);
  restartButton.addEventListener('click', startGame);
  gameRestartButton.addEventListener('click', startGame);
  breakYesButton.addEventListener('click', () => finishGame(true, 'break'));
  breakNoButton.addEventListener('click', continueAfterBreakPrompt);
  bindControls();
  resize();
  restoreGame();

  function frame(time) {
    const dt = Math.min(.05, (time - lastTime) / 1000 || 0);
    lastTime = time;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js?v=14').catch(() => {});
}
