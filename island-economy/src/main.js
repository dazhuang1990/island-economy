import * as THREE from 'three';
import { CFG, newGame, catchOne, plantCrop, harvestCrop, buildHut, buildGranary, buildDock, craftNet, buildBasket, buildFence, buildBoat, buildWorkbench, buildWell, buildFurnace, smeltIron, buildTrader, craftSteelTool, getEfficiency, deepFish, advanceDay, tierOf, hutCapacity, hireVillager, dismissVillager, idleCount, fisherCapital, marginal, ROLE_NAME, interestRate, depositFish, withdrawFish, serializeGame, deserializeGame, WEATHER_INFO, addFood, foodFreshness, workerHealthMul, useHerb, TECH_TREE, getCurrentGoal, ISLAND_DATA, arriveIsland } from './game.js';

const g = newGame();

// ---------- 场景基础 ----------
const scene = new THREE.Scene();
const SKY_COLORS = {
  sunny:  { bg: 0x87ceeb, fog: 0x87ceeb, ambient: 0.9, sun: 0.8 },
  cloudy: { bg: 0x9eaab5, fog: 0x9eaab5, ambient: 0.7, sun: 0.5 },
  rainy:  { bg: 0x6b7b8a, fog: 0x6b7b8a, ambient: 0.5, sun: 0.3 },
  stormy: { bg: 0x3d4a54, fog: 0x3d4a54, ambient: 0.3, sun: 0.15 },
};
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 40, 90);

// 天气视觉效果:雨滴粒子
const RAIN_COUNT = 300;
const rainGeo = new THREE.BufferGeometry();
const rainPositions = new Float32Array(RAIN_COUNT * 3);
for (let i = 0; i < RAIN_COUNT; i++) {
  rainPositions[i * 3] = (Math.random() - 0.5) * 40;
  rainPositions[i * 3 + 1] = Math.random() * 20;
  rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 40;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
const rainMat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.15, transparent: true, opacity: 0.6 });
const rainSystem = new THREE.Points(rainGeo, rainMat);
rainSystem.visible = false;
scene.add(rainSystem);

// 闪电效果(全屏白闪)
let lightningTimer = 0;
let lightningFlash = false;

// 天气视觉更新函数
function updateWeatherVisuals(dt) {
  const sc = SKY_COLORS[g.weather] || SKY_COLORS.sunny;
  // 平滑过渡天空颜色
  const targetBg = new THREE.Color(sc.bg);
  scene.background.lerp(targetBg, dt * 2);
  scene.fog.color.lerp(targetBg, dt * 2);
  hemi.intensity += (sc.ambient - hemi.intensity) * dt * 2;
  sun.intensity += (sc.sun - sun.intensity) * dt * 2;

  // 雨滴
  const isRaining = g.weather === 'rainy' || g.weather === 'stormy';
  rainSystem.visible = isRaining;
  if (isRaining) {
    const pos = rainGeo.attributes.position.array;
    const speed = g.weather === 'stormy' ? 25 : 15;
    for (let i = 0; i < RAIN_COUNT; i++) {
      pos[i * 3 + 1] -= speed * dt;
      if (pos[i * 3 + 1] < 0) {
        pos[i * 3 + 1] = 18 + Math.random() * 2;
        pos[i * 3] = player.pos.x + (Math.random() - 0.5) * 40;
        pos[i * 3 + 2] = player.pos.z + (Math.random() - 0.5) * 40;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
    rainMat.opacity = g.weather === 'stormy' ? 0.8 : 0.5;
  }

  // 闪电(暴风雨随机闪白屏)
  if (g.weather === 'stormy') {
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningTimer = 3 + Math.random() * 8; // 3~11秒闪一次
      lightningFlash = true;
    }
    if (lightningFlash) {
      scene.background.set(0xffffff);
      lightningFlash = false;
    }
  }
}

// ---------- 出海探索系统 ----------
let currentScene = 'main'; // 'main' | 'ocean'
const OCEAN_SIZE = 200;
const ISLANDS = [
  { id: 'tropical', name: '热带岛', x: 40, z: -30, radius: 8, color: 0x4caf50, discovered: false, desc: '椰林沙滩,有香料和稀有水果' },
  { id: 'volcano',  name: '火山岛', x: -50, z: 50,  radius: 10, color: 0xd84315, discovered: false, desc: '火山岩地貌,有铜矿和温泉' },
  { id: 'snow',     name: '冰雪岛', x: 60, z: 70,   radius: 9, color: 0xe0e0e0, discovered: false, desc: '雪山冰湖,有煤矿和冰块' },
];
const oceanScene = new THREE.Scene();
oceanScene.background = new THREE.Color(0x1a6b8a);
oceanScene.fog = new THREE.Fog(0x1a6b8a, 60, 150);
const oceanHemi = new THREE.HemisphereLight(0xffffff, 0x4488aa, 0.8);
oceanScene.add(oceanHemi);
const oceanSun = new THREE.DirectionalLight(0xffffff, 0.6);
oceanSun.position.set(30, 50, 20);
oceanScene.add(oceanSun);

// 大海海面
const oceanWater = new THREE.Mesh(
  new THREE.PlaneGeometry(OCEAN_SIZE * 2, OCEAN_SIZE * 2),
  new THREE.MeshLambertMaterial({ color: 0x1565c0, transparent: true, opacity: 0.85 })
);
oceanWater.rotation.x = -Math.PI / 2;
oceanWater.position.y = 0;
oceanScene.add(oceanWater);

// 岛屿剪影(远处看到的低模)
const islandMeshes = [];
for (const isl of ISLANDS) {
  const grp = new THREE.Group();
  // 岛屿主体(锥形山)
  const mountain = new THREE.Mesh(
    new THREE.ConeGeometry(isl.radius, isl.radius * 1.5, 8),
    new THREE.MeshLambertMaterial({ color: isl.color })
  );
  mountain.position.y = isl.radius * 0.75;
  grp.add(mountain);
  // 沙滩环
  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(isl.radius + 1, isl.radius + 2, 0.5, 16),
    new THREE.MeshLambertMaterial({ color: 0xe2c290 })
  );
  beach.position.y = 0.25;
  grp.add(beach);
  grp.position.set(isl.x, 0, isl.z);
  grp.userData = { island: isl };
  oceanScene.add(grp);
  islandMeshes.push(grp);
}

// 玩家的船
const boatMesh = new THREE.Group();
const boatBody = new THREE.Mesh(
  new THREE.BoxGeometry(2, 0.5, 4),
  new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
);
boatBody.position.y = 0.3;
const boatMast = new THREE.Mesh(
  new THREE.CylinderGeometry(0.08, 0.08, 3, 6),
  new THREE.MeshLambertMaterial({ color: 0x5d4037 })
);
boatMast.position.y = 2;
const boatSail = new THREE.Mesh(
  new THREE.PlaneGeometry(1.5, 2),
  new THREE.MeshLambertMaterial({ color: 0xfafafa, side: THREE.DoubleSide })
);
boatSail.position.set(0.8, 2.2, 0);
boatSail.rotation.y = Math.PI / 2;
boatMesh.add(boatBody, boatMast, boatSail);
boatMesh.visible = false;
oceanScene.add(boatMesh);

// 大海漂浮物
const oceanFloaters = [];
function spawnOceanFloater() {
  const types = ['wood', 'fish', 'iron'];
  const type = types[Math.floor(Math.random() * types.length)];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.3, 0.4),
    new THREE.MeshLambertMaterial({ color: type === 'iron' ? 0x9e9e9e : type === 'fish' ? 0xff9800 : 0x8d6e63 })
  );
  const x = (Math.random() - 0.5) * OCEAN_SIZE * 1.5;
  const z = (Math.random() - 0.5) * OCEAN_SIZE * 1.5;
  mesh.position.set(x, 0.3, z);
  mesh.userData = { type, collected: false };
  oceanScene.add(mesh);
  oceanFloaters.push(mesh);
}
for (let i = 0; i < 15; i++) spawnOceanFloater();

// 场景切换
let boatPos = { x: 0, z: 0 };
let boatYaw = 0;
let islandDiscoveryShown = {};
function enterOcean() {
  currentScene = 'ocean';
  boatMesh.visible = true;
  boatPos = { x: 0, z: 0 };
  boatYaw = 0;
  boatMesh.position.set(0, 0, 0);
  boatMesh.rotation.y = 0;
  renderer.setAnimationLoop(oceanLoop);
}
function enterMain() {
  currentScene = 'main';
  boatMesh.visible = false;
  renderer.setAnimationLoop(loop);
}

// ---------- 岛屿场景系统 ----------
let currentIsland = null;
const islandScenes = {};

// 创建热带岛场景
function buildTropicalScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x87ceeb);
  s.fog = new THREE.Fog(0x87ceeb, 30, 70);
  s.add(new THREE.HemisphereLight(0xffffff, 0x4488aa, 0.9));
  const sun2 = new THREE.DirectionalLight(0xffffff, 0.7);
  sun2.position.set(15, 30, 10);
  s.add(sun2);
  // 地面(绿色草地)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(20, 32),
    new THREE.MeshLambertMaterial({ color: 0x4caf50 })
  );
  ground.rotation.x = -Math.PI / 2;
  s.add(ground);
  // 沙滩环
  const beach = new THREE.Mesh(
    new THREE.RingGeometry(18, 22, 32),
    new THREE.MeshLambertMaterial({ color: 0xe2c290, side: THREE.DoubleSide })
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.y = 0.01;
  s.add(beach);
  // 椰子树
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 8 + Math.random() * 8;
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 3 + Math.random(), 6), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
    trunk.position.y = 1.5;
    trunk.rotation.z = (Math.random() - 0.5) * 0.15;
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.5, 6, 4), new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
    leaves.position.y = 3.5;
    palm.add(trunk, leaves);
    palm.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    s.add(palm);
  }
  // 土著小屋
  const hut = new THREE.Group();
  const hutBody = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 2.5), new THREE.MeshLambertMaterial({ color: 0xd7ccc8 }));
  hutBody.position.y = 1.75;
  const hutRoof = new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 4), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
  hutRoof.position.y = 3;
  hutRoof.rotation.y = Math.PI / 4;
  hut.add(hutBody, hutRoof);
  hut.position.set(0, 0, -5);
  s.add(hut);
  // 土著(简单方块小人)
  const native = new THREE.Group();
  const nHead = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: 0xffcc80 }));
  nHead.position.y = 1.8;
  const nBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), new THREE.MeshLambertMaterial({ color: 0xff5722 }));
  nBody.position.y = 1.15;
  native.add(nHead, nBody);
  native.position.set(2, 0, -4);
  native.userData = { type: 'native', label: '与土著交易' };
  s.add(native);
  // 海水环绕
  const sea = new THREE.Mesh(
    new THREE.RingGeometry(22, 50, 32),
    new THREE.MeshLambertMaterial({ color: 0x1565c0, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.1;
  s.add(sea);
  return s;
}
islandScenes.tropical = buildTropicalScene();

// 岛屿相机和玩家位置
let islandCamPos = new THREE.Vector3(0, 5, 8);
let islandPlayerPos = new THREE.Vector3(0, 0, 10);
let lastIslandTime = performance.now();

function enterIslandScene(islandId) {
  currentScene = 'island';
  currentIsland = islandId;
  islandPlayerPos.set(0, 0, 10);
  islandCamPos.set(0, 5, 18);
  renderer.setAnimationLoop(islandLoop);
  flash(`🏝️ 进入${ISLAND_DATA[islandId].name}!WASD移动,靠近土著按E交易,Esc离岛。`);
}
function exitIsland() {
  currentScene = 'ocean';
  currentIsland = null;
  boatPos = { x: 0, z: 0 };
  renderer.setAnimationLoop(oceanLoop);
  flash('⛵ 离开岛屿,回到大海。');
}

// 贸易面板
let tradeOpen = false;
function openTrade(islandId) {
  if (tradeOpen) return;
  tradeOpen = true;
  const data = ISLAND_DATA[islandId];
  const overlay = $('sailOverlay');
  const text = $('sailText');
  overlay.style.display = 'flex';
  overlay.classList.add('active');
  overlay.style.background = 'rgba(10,20,30,0.92)';
  text.innerHTML = `
    <div style="text-align:center">
      <div style="font-size:32px;margin-bottom:12px">${data.emoji} ${data.name} · 土著交易</div>
      <div style="font-size:16px;color:#9fb8c6;margin-bottom:20px">${data.desc}</div>
      <div style="margin-bottom:12px;color:#ffd766">🎁 他们愿意给你: ${data.gives}</div>
      <div style="margin-bottom:20px;color:#8fe3a0">💰 他们想要: ${data.wants}</div>
      <button onclick="window._doTrade()" style="padding:12px 28px;font-size:16px;background:#2e7d32;color:#fff;border:none;border-radius:8px;cursor:pointer;margin:0 8px">🎁 接受礼物</button>
      <button onclick="window._closeTrade()" style="padding:12px 28px;font-size:16px;background:#455a64;color:#fff;border:none;border-radius:8px;cursor:pointer;margin:0 8px">关闭</button>
    </div>
  `;
}
window._doTrade = function() {
  const data = ISLAND_DATA[currentIsland];
  if (!data) return;
  const r = arriveIsland(g, currentIsland);
  flash(r.msg);
  updateHUD();
  window._closeTrade();
};
window._closeTrade = function() {
  tradeOpen = false;
  const overlay = $('sailOverlay');
  overlay.classList.remove('active');
  overlay.style.display = 'none';
  overlay.style.background = '';
  $('sailText').textContent = '';
};

// 岛屿主循环
function islandLoop() {
  const now = performance.now(), dt = Math.min(0.05, (now - lastIslandTime) / 1000); lastIslandTime = now;
  const speed = 6;
  const fwd = new THREE.Vector3(Math.sin(islandCamYaw), 0, Math.cos(islandCamYaw));
  const right = new THREE.Vector3(Math.cos(islandCamYaw), 0, -Math.sin(islandCamYaw));
  if (keys['KeyW']) islandPlayerPos.addScaledVector(fwd, speed * dt);
  if (keys['KeyS']) islandPlayerPos.addScaledVector(fwd, -speed * dt);
  if (keys['KeyA']) islandPlayerPos.addScaledVector(right, -speed * dt);
  if (keys['KeyD']) islandPlayerPos.addScaledVector(right, speed * dt);
  // 边界限制
  const d = Math.hypot(islandPlayerPos.x, islandPlayerPos.z);
  if (d > 17) { islandPlayerPos.x *= 17 / d; islandPlayerPos.z *= 17 / d; }
  islandPlayerPos.y = 0;
  // 相机跟随
  islandCamPos.lerp(new THREE.Vector3(
    islandPlayerPos.x - Math.sin(islandCamYaw) * 6,
    4,
    islandPlayerPos.z - Math.cos(islandCamYaw) * 6
  ), dt * 5);
  camera.position.copy(islandCamPos);
  camera.lookAt(islandPlayerPos.x, 1, islandPlayerPos.z);
  // 靠近土著按E交易
  const nativeDist = Math.hypot(islandPlayerPos.x - 2, islandPlayerPos.z + 4);
  $('prompt').textContent = nativeDist < 3 ? '按 E 与土著交易' : '';
  if (keys['KeyE'] && nativeDist < 3 && !tradeOpen) {
    openTrade(currentIsland);
  }
  // Esc离岛
  if (keys['Escape'] && !tradeOpen) {
    exitIsland();
    return;
  }
  const s = islandScenes[currentIsland];
  if (s) renderer.render(s, camera);
}
let islandCamYaw = 0;
function checkIslandDiscovery() {
  for (const isl of ISLANDS) {
    if (isl.discovered) continue;
    const dist = Math.hypot(boatPos.x - isl.x, boatPos.z - isl.z);
    if (dist < isl.radius + 8) {
      isl.discovered = true;
      islandDiscoveryShown[isl.id] = true;
      flash(`🏝️ 发现了新岛屿: ${isl.name}! ${isl.desc}`);
      flash('已标记在地图上,之后可从码头菜单快速前往。');
      // 保存发现状态
      if (!g.discoveredIslands) g.discoveredIslands = {};
      g.discoveredIslands[isl.id] = true;
      saveWorld();
    }
  }
}

// 大海主循环
let lastOcean = performance.now();
function oceanLoop() {
  const now = performance.now(), dt = Math.min(0.05, (now - lastOcean) / 1000); lastOcean = now;
  // 船移动
  const speed = 12;
  const turnSpeed = 1.5;
  if (keys['KeyA'] || keys['ArrowLeft']) boatYaw += turnSpeed * dt;
  if (keys['KeyD'] || keys['ArrowRight']) boatYaw -= turnSpeed * dt;
  const fwd = new THREE.Vector3(Math.sin(boatYaw), 0, Math.cos(boatYaw));
  if (keys['KeyW'] || keys['ArrowUp']) { boatPos.x += fwd.x * speed * dt; boatPos.z += fwd.z * speed * dt; }
  if (keys['KeyS'] || keys['ArrowDown']) { boatPos.x -= fwd.x * speed * dt * 0.5; boatPos.z -= fwd.z * speed * dt * 0.5; }
  boatMesh.position.set(boatPos.x, 0, boatPos.z);
  boatMesh.rotation.y = boatYaw;
  boatMesh.position.y = Math.sin(now / 800) * 0.15; // 船身随浪起伏
  // 相机跟随船
  camera.position.set(boatPos.x - Math.sin(boatYaw) * 8, 6, boatPos.z - Math.cos(boatYaw) * 8);
  camera.lookAt(boatPos.x, 1, boatPos.z);
  // 海面波动
  oceanWater.position.y = Math.sin(now / 1200) * 0.1;
  // 岛屿发现+靠近提示
  checkIslandDiscovery();
  // 检测靠近岛屿
  let nearIsland = null;
  for (const isl of ISLANDS) {
    const dist = Math.hypot(boatPos.x - isl.x, boatPos.z - isl.z);
    if (dist < isl.radius + 5) { nearIsland = isl; break; }
  }
  $('prompt').textContent = nearIsland ? `按 E 进入${nearIsland.name}` : '';
  if (keys['KeyE'] && nearIsland) {
    enterIslandScene(nearIsland.id);
    return;
  }
  // 漂浮物随浪漂动
  for (const f of oceanFloaters) {
    if (f.userData.collected) continue;
    f.position.y = 0.3 + Math.sin(now / 600 + f.position.x) * 0.1;
    // 检测是否靠近(可打捞)
    const dist = Math.hypot(boatPos.x - f.position.x, boatPos.z - f.position.z);
    if (dist < 3 && !f.userData.collected) {
      f.userData.collected = true;
      f.visible = false;
      if (f.userData.type === 'iron') {
        g.ironFragments = (g.ironFragments || 0) + 1;
        flash('⛏️ 捞到铁矿石碎片!');
      } else if (f.userData.type === 'fish') {
        addFood(g, 'fish', 2);
        flash('🐟 捞到 2 条鱼!');
      } else {
        g.wood += 3;
        flash('🪵 捞到 3 个木头!');
      }
      updateHUD();
    }
  }
  // 按 Esc 返回主岛
  if (keys['Escape']) {
    flash('⛵ 返航回主岛。');
    enterMain();
    return;
  }
  // 天气视觉
  updateWeatherVisuals(dt);
  renderer.render(oceanScene, camera);
}

// 游泳系统常量
const SAND_BORDER = 12.3;           // 水线:超过即下水(陆地限位12.5,刚好无缝衔接;草地≤9,沙滩9~13)
const DEEP_WATER = 20;              // 近海外径(体素岛 R=13 + 7),超出禁止;R 在下方体素岛段落定义,此处不可引用
const PLAYER_EYE = 2.5;
const PLAYER_SWIM_Y = 1.0;          // 游泳时眼高(胸口以上露出水面)
const SWIM_SPEED = 4;               // 游泳速度(陆地的一半)
const SWIM_FISH_RANGE = 3.2;        // 游泳时鱼在多少单位内可直接捕
let isSwimming = false;

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xffffff, 0x556b2f, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(20, 40, 10);
sun.castShadow = true;
scene.add(sun);

// ---------- 体素小岛 ----------
const GRID = 44, HALF = GRID / 2, R = 13;
const box = new THREE.BoxGeometry(1, 1, 1);

function biomeColor(d) {
  if (d <= 9) return new THREE.Color(0x4caf50);   // 草地
  if (d <= R) return new THREE.Color(0xe2c290);    // 沙滩
  return null;
}
function inIsland(x, z) { return Math.hypot(x, z) <= R; }

const land = [];
for (let x = -HALF; x < HALF; x++)
  for (let z = -HALF; z < HALF; z++) {
    const d = Math.hypot(x + 0.5, z + 0.5);
    if (d <= R) land.push([x, z, d]); // 草地(≤9)+沙滩(9~13)完整生成
  }

function makeLayer(yLevel, colorSub) {
  const mesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), land.length);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  land.forEach(([x, z, d], i) => {
    m.setPosition(x + 0.5, yLevel, z + 0.5);
    mesh.setMatrixAt(i, m);
    const c = (yLevel === 1) ? biomeColor(d) : colorSub;
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
scene.add(makeLayer(1));
scene.add(makeLayer(0, new THREE.Color(0x795548)));

// 海水
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: 0x2e7fd6, transparent: true, opacity: 0.75 })
);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.45;
scene.add(water);

// ---------- 可交互资源:树 / 石 / 果丛 ----------
const interactives = []; // 所有可用空格采集的物体

function scatterPos(minD, avoid) {
  for (let t = 0; t < 200; t++) {
    const x = (Math.random() - 0.5) * 18, z = (Math.random() - 0.5) * 18;
    if (Math.hypot(x, z) > 9.5) continue;
    if (Math.hypot(x, z) < minD) continue;
    if (avoid && avoid.some((p) => Math.hypot(x - p[0], z - p[1]) < 2.2)) continue;
    return [x, z];
  }
  return null;
}

const occupied = [];

// 树(几何体/材质共享:资源会反复重生,每次新建会稳定泄漏显存)
const TREE_GEO = {
  trunk: new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6),
  leaf1: new THREE.ConeGeometry(1.1, 1.8, 7),
  leaf2: new THREE.ConeGeometry(0.8, 1.4, 7),
};
const TREE_MAT = {
  trunk: new THREE.MeshLambertMaterial({ color: 0x6d4c41 }),
  leaf1: new THREE.MeshLambertMaterial({ color: 0x2e7d32 }),
  leaf2: new THREE.MeshLambertMaterial({ color: 0x388e3c }),
};
function makeTreeMesh() {
  const grp = new THREE.Group();
  const trunk = new THREE.Mesh(TREE_GEO.trunk, TREE_MAT.trunk);
  trunk.position.y = 1.8; trunk.castShadow = true;
  const leaf1 = new THREE.Mesh(TREE_GEO.leaf1, TREE_MAT.leaf1);
  leaf1.position.y = 3.2; leaf1.castShadow = true;
  const leaf2 = new THREE.Mesh(TREE_GEO.leaf2, TREE_MAT.leaf2);
  leaf2.position.y = 4.1; leaf2.castShadow = true;
  grp.add(trunk, leaf1, leaf2);
  return grp;
}
const trees = [];
function spawnTree(regrowAt = 0) {
  const p = scatterPos(1.5, occupied);
  if (!p) return;
  const grp = makeTreeMesh();
  grp.position.set(p[0], 0, p[1]);
  grp.userData = { type: 'tree', label: '砍树 (+3 木头)', regrowAt, slot: p };
  scene.add(grp); trees.push(grp); interactives.push(grp); occupied.push(p);
}
for (let i = 0; i < 12; i++) spawnTree();

// 石头
const rocks = [];
const ROCK_GEO = new THREE.DodecahedronGeometry(0.55);
const ROCK_MAT = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
const PLOT_MAT = new THREE.MeshLambertMaterial({ color: 0x8bc34a });
const SPROUT_MAT = new THREE.MeshLambertMaterial({ color: 0x7cb342 });
function spawnRock() {
  const p = scatterPos(1.5, occupied); if (!p) return;
  const rock = new THREE.Mesh(ROCK_GEO, ROCK_MAT);
  rock.position.set(p[0], 1.4, p[1]);
  rock.castShadow = true;
  rock.userData = { type: 'rock', label: '采石 (+2 石头)', slot: p };
  scene.add(rock); rocks.push(rock); interactives.push(rock); occupied.push(p);
}
for (let i = 0; i < 6; i++) spawnRock();

// 野果丛(谷穗来源,开局零资源的种子)
const bushes = [];
const BUSH_GEO = new THREE.SphereGeometry(0.55, 8, 6);
const BERRY_GEO = new THREE.SphereGeometry(0.12);
const BUSH_MAT = new THREE.MeshLambertMaterial({ color: 0x33691e });
const BERRY_MAT = new THREE.MeshLambertMaterial({ color: 0xffc107 });
function spawnBush() {
  const p = scatterPos(1.2, occupied); if (!p) return;
  const grp = new THREE.Group();
  const b = new THREE.Mesh(BUSH_GEO, BUSH_MAT);
  b.position.y = 1.5; b.castShadow = true;
  for (let i = 0; i < 4; i++) {
    const berry = new THREE.Mesh(BERRY_GEO, BERRY_MAT);
    const a = (i / 4) * Math.PI * 2;
    berry.position.set(Math.cos(a) * 0.4, 1.6, Math.sin(a) * 0.4);
    grp.add(berry);
  }
  grp.add(b);
  grp.position.set(p[0], 0, p[1]);
  grp.userData = { type: 'bush', label: '摘谷穗 (+1 谷穗:能吃也能当种子)', slot: p };
  scene.add(grp); bushes.push(grp); interactives.push(grp); occupied.push(p);
}
for (let i = 0; i < 7; i++) spawnBush();

// ---------- 农田(8 块肥沃地块,集中在岛心) ----------
const plots = [];
const plotGeo = new THREE.BoxGeometry(1.4, 0.1, 1.4);
function makePlot(i) {
  const base = new THREE.Mesh(plotGeo, new THREE.MeshLambertMaterial({ color: 0x8bc34a }));
  const ang = (i / 8) * Math.PI * 2;
  const x = Math.cos(ang) * 3.2, z = Math.sin(ang) * 3.2;
  base.position.set(x, 1.56, z);
  base.receiveShadow = true;
  // 作物苗(播种后出现)
  const sprouts = new THREE.Group();
  for (let s = 0; s < 5; s++) {
    const st = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), new THREE.MeshLambertMaterial({ color: 0x7cb342 }));
    st.position.set((Math.random() - 0.5) * 0.9, 0.3, (Math.random() - 0.5) * 0.9);
    sprouts.add(st);
  }
  const golds = new THREE.Group();
  for (let s = 0; s < 5; s++) {
    const gt = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 5), new THREE.MeshLambertMaterial({ color: 0xffc107 }));
    gt.position.set((Math.random() - 0.5) * 0.9, 0.45, (Math.random() - 0.5) * 0.9);
    golds.add(gt);
  }
  base.userData = { type: 'plot', state: 'wild', sprouts, golds };
  base.add(sprouts); base.add(golds);
  sprouts.visible = false; golds.visible = false;
  scene.add(base); plots.push(base); interactives.push(base);
  occupied.push([x, z]);
  return base;
}
for (let i = 0; i < 8; i++) makePlot(i);

function plotLabel(p) {
  if (p.userData.state === 'wild') return '播种 (耗 1 谷穗当种子)';
  if (p.userData.state === 'growing') return `谷子生长中…(第 ${p.userData.age}/${CFG.CROP_DAYS} 天)`;
  return '收谷穗! (+6 谷穗)';
}

// ---------- 鱼(真鱼形:躯体+尾鳍+背鳍+眼睛;水域能游动、会躲避) ----------
const fishBodyMat = new THREE.MeshLambertMaterial({ color: 0xff9800 });
const fishFinMat = new THREE.MeshLambertMaterial({ color: 0xf57c00 });
function makeFishMesh() {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), fishBodyMat);
  body.scale.set(1.5, 0.85, 0.65); body.castShadow = true;   // 前向 = 本地 +X
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 6), fishFinMat);
  tail.position.x = -0.52; tail.rotation.z = Math.PI / 2; tail.castShadow = true;
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 5), fishFinMat);
  dorsal.position.set(0, 0.26, 0);
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x263238 });
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.08), eyeMat); e1.position.set(0.32, 0.06, 0.12);
  const e2 = e1.clone(); e2.position.z = -0.12;
  grp.add(body, tail, dorsal, e1, e2);
  return grp;
}
const fishes = [];
function spawnFish() {
  if (fishes.length >= CFG.FISH_MAX) return;
  const f = makeFishMesh();
  const ang = Math.random() * Math.PI * 2, r = 13.8 + Math.random() * 5;
  f.position.set(Math.cos(ang) * r, 0.6, Math.sin(ang) * r);
  f.userData = {
    type: 'fish', label: '捕鱼', base: 0.6,
    heading: Math.random() * Math.PI * 2,
    speed: 0.8 + Math.random() * 0.6,          // 巡游速度
    turnTimer: 1 + Math.random() * 2,
    fleeCharge: 0,                              // 警觉蓄力(防躲避过灵敏)
    fleeBoost: 0,                               // 受惊逃窜剩余时间
    attempts: 0,                                // 被尝试捕捉次数(提升下次成功率)
  };
  scene.add(f); fishes.push(f);
}
for (let i = 0; i < 10; i++) spawnFish();

// ---------- 建筑 ----------
const hutMeshes = [];
const hutBodyGeo = new THREE.BoxGeometry(1.6, 1.2, 1.6);
const hutRoofGeo = new THREE.ConeGeometry(1.3, 0.8, 4);
function spawnHut(pos) {
  const grp = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: 0xa1887f });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
  // 墙体
  const body = new THREE.Mesh(hutBodyGeo, woodMat);
  body.position.y = 1.6; body.castShadow = true;
  // 屋顶
  const roof = new THREE.Mesh(hutRoofGeo, roofMat);
  roof.position.y = 2.6; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  // 门(正面小方块)
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.05), new THREE.MeshLambertMaterial({ color: 0x3e2723 }));
  door.position.set(0, 1.35, 0.82);
  // 窗户(两侧小方块)
  const windowMat = new THREE.MeshLambertMaterial({ color: 0x81d4fa });
  const winL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.3), windowMat);
  winL.position.set(-0.82, 1.7, 0);
  const winR = winL.clone();
  winR.position.set(0.82, 1.7, 0);
  // 烟囱
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.25), new THREE.MeshLambertMaterial({ color: 0x795548 }));
  chimney.position.set(0.5, 3.0, -0.3);
  grp.add(body, roof, door, winL, winR, chimney);
  const p = pos || scatterPos(1.5, occupied) || [8, 8];
  grp.position.set(p[0], 0, p[1]);
  scene.add(grp); hutMeshes.push(grp); occupied.push(p);
}

let granaryMesh = null, dockMesh = null;
function buildGranaryMesh() {
  const grp = new THREE.Group();
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xd7ccc8 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
  // 主体(圆角仓库感)
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2), wallMat);
  body.position.y = 1.9; body.castShadow = true;
  // 屋顶
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2, 1, 4), roofMat);
  roof.position.y = 3.3; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  // 顶上鱼形标记
  const fishSign = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshLambertMaterial({ color: 0x42a5f5 }));
  fishSign.scale.set(1.5, 0.8, 0.7);
  fishSign.position.y = 3.9; fishSign.castShadow = true;
  // 粮仓门(双开门效果)
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.0, 0.05), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
  doorL.position.set(-0.2, 1.4, 1.02);
  const doorR = doorL.clone();
  doorR.position.set(0.2, 1.4, 1.02);
  // 门框
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.06), new THREE.MeshLambertMaterial({ color: 0x4e342e }));
  frame.position.set(0, 1.45, 1.01);
  // 窗户
  const winMat = new THREE.MeshLambertMaterial({ color: 0xffe082 });
  const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), winMat);
  win1.position.set(-0.6, 2.1, 1.02);
  const win2 = win1.clone();
  win2.position.set(0.6, 2.1, 1.02);
  grp.add(body, roof, fishSign, frame, doorL, doorR, win1, win2);
  grp.position.set(-6.5, 0, 5.5);
  grp.userData = { type: 'granary', label: '打开鱼仓(存鱼/取鱼)' };
  scene.add(grp); granaryMesh = grp;
  interactives.push(grp);
}
function buildDockMesh() {
  const grp = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
  const darkWoodMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
  // 主甲板(多段,有层次感)
  for (let i = 0; i < 3; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 1.8), woodMat);
    plank.position.set(0, 1.4, i * 1.6);
    plank.castShadow = true; plank.receiveShadow = true;
    grp.add(plank);
  }
  // 甲板护栏(左右两侧栏杆)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), darkWoodMat);
      rail.position.set(side * 0.85, 1.9, i * 1.4);
      grp.add(rail);
    }
    // 横杆
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 4.8), darkWoodMat);
    bar.position.set(side * 0.85, 2.1, 2.4);
    grp.add(bar);
  }
  // 支撑桩(插在水里)
  for (const [px, pz] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 2.5], [0.7, 2.5], [-0.7, 4.8], [0.7, 4.8]]) {
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.5, 6), darkWoodMat);
    pile.position.set(px, 0.2, pz);
    pile.castShadow = true;
    grp.add(pile);
  }
  // 系缆桩(小圆柱,拴绳用)
  const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.25, 8), new THREE.MeshLambertMaterial({ color: 0x9e9e9e }));
  bollard.position.set(-0.6, 1.6, 0.3);
  grp.add(bollard);
  const bollard2 = bollard.clone();
  bollard2.position.set(0.6, 1.6, 0.3);
  grp.add(bollard2);
  // 灯笼(码头标志性光源,增加辨识度)
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.15), new THREE.MeshLambertMaterial({ color: 0xffc107, emissive: 0xff8f00, emissiveIntensity: 0.3 }));
  lantern.position.set(0, 2.55, 0.3);
  grp.add(lantern);
  // 灯杆
  const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), darkWoodMat);
  lampPost.position.set(0, 2.35, 0.3);
  grp.add(lampPost);
  // 位置:沙滩最外缘,朝海延伸
  grp.position.set(2.5, 0, 12.5);
  grp.rotation.y = 0; // 朝+z方向(海的方向)
  scene.add(grp); dockMesh = grp;
}

// ---------- 岛民(方块小人:四肢枢轴摆动 + 职业配色 + 头顶徽章 + 工作状态机) ----------
const islanders = [];
const ROLE_SHIRT = { idle: 0x1565c0, fisher: 0xef6c00, farmer: 0xf9a825, woodcutter: 0x6d4c41, miner: 0x78909c };
const ROLE_UNIT = { fisher: ['🐟', '#ffd54f'], farmer: ['🌾', '#ffe082'], woodcutter: ['🪵', '#e0b38a'], miner: ['⛏️', '#cfd8dc'] };

// 每个职业干活时的产出符号(干活飘字用,不触发真实资源变化)
const ROLE_FLOAT = {
  fisher: ['+1🐟', '#42a5f5'],
  farmer: ['+1🌾', '#ffd54f'],
  woodcutter: ['+1🪵', '#a1887f'],
  miner: ['+1⛏️', '#b0bec5'],
};
// 帮工实时产出配置(Phase 2.1.2):帮工砍树/敲石比玩家慢一点(玩家3斧1.35s,帮工5击2.25s)
const WORKER_HITS_TREE = 5, WORKER_HITS_ROCK = 6, WORKER_HIT_INT = 0.45;
const WORKER_CYCLE_TREE = WORKER_HITS_TREE * WORKER_HIT_INT; // 2.25s 砍完一棵
const WORKER_CYCLE_ROCK = WORKER_HITS_ROCK * WORKER_HIT_INT; // 2.7s 敲完一块
const WORKER_CYCLE_FARM = 4 + 0.5 * 4;                     // 4~6s 检查一次田(农夫弯腰+收割+补种)

function makeVillager() {
  const grp = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: ROLE_SHIRT.idle });
  const skin = new THREE.MeshLambertMaterial({ color: 0xffcc80 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x455a64 });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x263238 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), skin);
  head.position.y = 1.6; head.castShadow = true;
  const eL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.02), eyeMat); eL.position.set(-0.11, 1.63, 0.235);
  const eR = eL.clone(); eR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.24), shirt);
  torso.position.y = 1.0; torso.castShadow = true;
  function limb(x, pivotY, mat) {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), mat);
    m.position.y = -0.35; m.castShadow = true;
    pivot.add(m);
    return pivot;
  }
  const legL = limb(-0.12, 0.7, pants), legR = limb(0.12, 0.7, pants);
  const armL = limb(-0.33, 1.3, shirt), armR = limb(0.33, 1.3, shirt);
  grp.add(head, eL, eR, torso, legL, legR, armL, armR);
  // 迷你工具(挂右臂,按职业显示斧头/锤头)
  const tool = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
  const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.05), new THREE.MeshLambertMaterial({ color: 0xb0bec5 }));
  axeHead.position.y = 0.21;
  const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0x6d4c41 }));
  hammerHead.position.y = 0.18;
  tool.add(handle, axeHead, hammerHead);
  tool.position.set(0, -0.7, 0.06); tool.rotation.x = Math.PI / 2;
  armR.add(tool); tool.visible = false;
  grp.userData = {
    role: 'idle', state: 'idle',
    parts: { legL, legR, armL, armR },
    shirt, badge: null, tool, axeHead, hammerHead,
    baseX: 0, baseZ: 0, ph: Math.random() * 10,
    target: null, workObj: null, bodyYaw: 0, walkPhase: 0, workTimer: 0, hitTimer: 0, floatTimer: 0, workerHits: 0,
  };
  return grp;
}

// 头顶职业徽章(几何体,体素风)
function makeBadge(role) {
  let m = null;
  if (role === 'fisher') {
    m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshLambertMaterial({ color: 0xff9800 }));
    m.scale.set(1.7, 0.8, 0.7);   // 小鱼形
  } else if (role === 'farmer') {
    m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 5), new THREE.MeshLambertMaterial({ color: 0xffc107 })); // 谷穗
  } else if (role === 'woodcutter') {
    m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0x8d6e63 })); // 木料
  } else if (role === 'miner') {
    m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12), new THREE.MeshLambertMaterial({ color: 0xb0bec5 }));  // 矿石
  }
  if (m) m.position.y = 2.3;
  return m;
}

function islandRandPoint() {
  const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 8;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
}
// 各职业工作点(直线前往,不做寻路)
function workPointFor(role) {
  if (role === 'fisher') {
    if (g.dock && dockMesh) {
      // 站在码头甲板上,面向大海(朝+z方向甩竿)
      const dx = (Math.random() - 0.5) * 1.2; // 左右偏移
      const dz = 13.5 + Math.random() * 2.5;   // 甲板上 z=13.5~16
      return { pos: new THREE.Vector3(2.5 + dx, 1.4, dz), obj: null }; // y=1.4 站在甲板上
    }
    const a = Math.random() * Math.PI * 2;
    return { pos: new THREE.Vector3(Math.cos(a) * 11.2, 0, Math.sin(a) * 11.2), obj: null }; // 沙滩巡钓
  }
  if (role === 'farmer') {
    // 农夫:有田种田,有野果丛也摘(30%概率去摘果丛,70%去农田)
    if (bushes.length > 0 && (!plots.length || Math.random() < 0.3)) {
      const b = bushes[Math.floor(Math.random() * bushes.length)];
      const a = Math.random() * Math.PI * 2;
      return { pos: new THREE.Vector3(b.position.x + Math.cos(a) * 1.2, 0, b.position.z + Math.sin(a) * 1.2), obj: b, gatherKind: 'bush' };
    }
    if (plots.length) {
      const p = plots[Math.floor(Math.random() * plots.length)];
      return { pos: new THREE.Vector3(p.position.x + (Math.random() - 0.5) * 1.6, 0, p.position.z + (Math.random() - 0.5) * 1.6), obj: p };
    }
    // 没田了,全去摘果丛
    if (bushes.length) {
      const b = bushes[Math.floor(Math.random() * bushes.length)];
      const a = Math.random() * Math.PI * 2;
      return { pos: new THREE.Vector3(b.position.x + Math.cos(a) * 1.2, 0, b.position.z + Math.sin(a) * 1.2), obj: b, gatherKind: 'bush' };
    }
  }
  if (role === 'woodcutter' && trees.length) {
    const t = trees[Math.floor(Math.random() * trees.length)];
    const a = Math.random() * Math.PI * 2;
    return { pos: new THREE.Vector3(t.position.x + Math.cos(a) * 1.2, 0, t.position.z + Math.sin(a) * 1.2), obj: t };
  }
  if (role === 'miner' && rocks.length) {
    const r = rocks[Math.floor(Math.random() * rocks.length)];
    const a = Math.random() * Math.PI * 2;
    return { pos: new THREE.Vector3(r.position.x + Math.cos(a) * 1.1, 0, r.position.z + Math.sin(a) * 1.1), obj: r };
  }
  return { pos: islandRandPoint(), obj: null };
}

function applyRole(v, role) {
  const u = v.userData;
  u.role = role;
  u.shirt.color.setHex(ROLE_SHIRT[role] ?? ROLE_SHIRT.idle);
  if (u.badge) { v.remove(u.badge); u.badge = null; }
  const b = makeBadge(role);
  if (b) { v.add(b); u.badge = b; }
  u.axeHead.visible = role === 'woodcutter';
  u.hammerHead.visible = role === 'miner';
  u.tool.visible = false;
  if (role === 'idle') { u.state = 'idle'; u.target = null; u.workObj = null; }
  else { u.state = 'go'; const w = workPointFor(role); u.target = w.pos; u.workObj = w.obj; }
}

// 按在职顺序给岛民分配职业(帮工优先占位)
function assignRoles() {
  const order = [];
  for (const r of ['fisher', 'farmer', 'woodcutter', 'miner']) for (let i = 0; i < g.workers[r]; i++) order.push(r);
  islanders.forEach((v, i) => {
    const role = order[i] || 'idle';
    if (v.userData.role !== role) applyRole(v, role);
  });
}

function syncIslanders() {
  while (islanders.length < g.pop - 1) {
    const v = makeVillager();
    const anchor = hutMeshes.length ? hutMeshes[islanders.length % hutMeshes.length].position : new THREE.Vector3(2, 0, 2);
    v.position.set(anchor.x + (Math.random() - 0.5) * 2, 1.5, anchor.z + (Math.random() - 0.5) * 2);
    v.userData.baseX = v.position.x; v.userData.baseZ = v.position.z;
    scene.add(v); islanders.push(v);
  }
  while (islanders.length > g.pop - 1) { const v = islanders.pop(); scene.remove(v); }
}

function faceBody(u, dirYaw, dt) {
  let diff = dirYaw - u.bodyYaw;
  diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  u.bodyYaw += diff * Math.min(1, dt * 10);
}

// 岛民逐帧更新:散工闲逛 / 帮工 走去工作点 → 干活动画 → 换点

// ---------- 统一碰撞体系(Phase 2.1.4):树/石/果丛/建筑/帮工/玩家 共用一套 ----------
// 设计:所有障碍物在 XZ 平面用圆形近似(半径 = 模型冠部/建筑半宽),移动采用"分离轴分步":
// 先尝试 X 轴位移,再尝试 Z 轴位移,单轴被挡则保留原值 → 沿障碍表面自然滑行,不卡死不隧穿。
// 拓扑近似误差说明:树冠锥形叠放(视觉大)但碰撞按树干 0.5;果丛/石头 y 悬浮,碰撞只看 XZ。
const OBSTACLE_R = { tree: 0.5, rock: 0.55, bush: 0.55 };      // 资源(可点击采集物=障碍物)
const BUILDING_R = 0.85;                                       // 建筑基准半径(棚屋;粮仓/码头 +0.3~0.5)
const ENTITY_R = { player: 0.35, villager: 0.4 };              // 移动实体半径
const VILLAGER_CLEARANCE = 0.55;                               // 帮工互避安全距离

// 单点 (x,z) 加实体半径 r 是否碰到建筑;ignoreDock=true 时跳过码头(渔夫要站上甲板干活)
function hitBuilding(x, z, r, ignoreDock) {
  for (const h of hutMeshes) {
    if (Math.hypot(x - h.position.x, z - h.position.z) < BUILDING_R + r) return true;
  }
  if (granaryMesh && Math.hypot(x - granaryMesh.position.x, z - granaryMesh.position.z) < BUILDING_R + 0.3 + r) return true;
  if (!ignoreDock && dockMesh && Math.hypot(x - dockMesh.position.x, z - dockMesh.position.z) < BUILDING_R + 0.5 + r) return true;
  return false;
}
// 单点加实体半径是否碰到任何障碍(资源+建筑);excludeObj=允许穿透的目标(正在采集的树/正在敲的石头等)
// ignoreDock:渔夫需站码头甲板,传 u.role==='fisher'
function hitObstacle(x, z, r, excludeObj, ignoreDock) {
  for (const arr of [trees, rocks, bushes]) {
    for (const o of arr) {
      if (o === excludeObj || !o.parent) continue; // 已砍倒/被移除的不再挡路
      if (Math.hypot(x - o.position.x, z - o.position.z) < OBSTACLE_R[o.userData.type] + r) return true;
    }
  }
  return hitBuilding(x, z, r, ignoreDock);
}
// 通用滑行步进:从 (px,pz) 沿 (dx,dz) 走一步。
// 核心:撞墙时扫描360° 找所有可行方向,选最接近目标方向的那个 → 真正的自动绕行
function slideStep(px, pz, dx, dz, r, excludeObj, ignoreDock) {
  const nx = px + dx, nz = pz + dz;
  // 1) 尝试完整移动(对角或直线)
  if (!hitObstacle(nx, nz, r, excludeObj, ignoreDock)) return { x: nx, z: nz };
  // 2) 完整移动被挡,尝试沿移动方向的单轴滑行(快速路径)
  if (dx !== 0 && !hitObstacle(nx, pz, r, excludeObj, ignoreDock)) return { x: nx, z: pz };
  if (dz !== 0 && !hitObstacle(px, nz, r, excludeObj, ignoreDock)) return { x: px, z: nz };
  // 3) 单轴也被挡 → 360° 方向扫描,找最接近目标方向的可行路径
  const wantAng = Math.atan2(dz, dx);
  const step = Math.sqrt(dx * dx + dz * dz);
  let bestAng = null, bestDiff = Infinity;
  const scanSteps = 16; // 每22.5°扫一次
  for (let i = 0; i < scanSteps; i++) {
    const a = (i / scanSteps) * Math.PI * 2;
    const tx = px + Math.cos(a) * step;
    const tz = pz + Math.sin(a) * step;
    if (!hitObstacle(tx, tz, r, excludeObj, ignoreDock)) {
      let diff = Math.abs(a - wantAng);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bestDiff) { bestDiff = diff; bestAng = a; }
    }
  }
  if (bestAng !== null) {
    return { x: px + Math.cos(bestAng) * step, z: pz + Math.sin(bestAng) * step };
  }
  // 4) 360° 全被挡住(极端情况) → 缩小步长再扫
  const halfStep = step * 0.5;
  for (let i = 0; i < scanSteps; i++) {
    const a = (i / scanSteps) * Math.PI * 2;
    const tx = px + Math.cos(a) * halfStep;
    const tz = pz + Math.sin(a) * halfStep;
    if (!hitObstacle(tx, tz, r, excludeObj, ignoreDock)) {
      let diff = Math.abs(a - wantAng);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bestDiff) { bestDiff = diff; bestAng = a; }
    }
  }
  if (bestAng !== null) {
    return { x: px + Math.cos(bestAng) * halfStep, z: pz + Math.sin(bestAng) * halfStep };
  }
  // 5) 全被卡住,保持原位
  return { x: px, z: pz };
}

// 帮工移动:出生重叠推出 + 岛边界 clamp + 障碍滑行 + 帮工互避 + 卡住换点。返回新的 {x,z}。
function villagerMove(v, dx, dz) {
  const u = v.userData;
  const r = ENTITY_R.villager;
  const ignoreDock = u.role === 'fisher';
  let x = v.position.x, z = v.position.z;
  // 0) 出生点/卡点若与障碍重叠 → 向所有重叠障碍的反方向合力推出
  for (let i = 0; i < 8 && hitObstacle(x, z, r, u.workObj, ignoreDock); i++) {
    let pushX = 0, pushZ = 0, anyHit = false;
    for (const arr of [trees, rocks, bushes]) {
      for (const o of arr) {
        if (o === u.workObj || !o.parent) continue;
        const od = Math.hypot(x - o.position.x, z - o.position.z);
        const minD = OBSTACLE_R[o.userData.type] + r + 0.05;
        if (od < minD && od > 0.001) {
          const push = (minD - od) * 0.6;
          pushX += ((x - o.position.x) / od) * push;
          pushZ += ((z - o.position.z) / od) * push;
          anyHit = true;
        }
      }
    }
    for (const h of hutMeshes) {
      const od = Math.hypot(x - h.position.x, z - h.position.z);
      const minD = BUILDING_R + r + 0.05;
      if (od < minD && od > 0.001) {
        pushX += ((x - h.position.x) / od) * (minD - od) * 0.6;
        pushZ += ((z - h.position.z) / od) * (minD - od) * 0.6;
        anyHit = true;
      }
    }
    if (granaryMesh) {
      const od = Math.hypot(x - granaryMesh.position.x, z - granaryMesh.position.z);
      const minD = BUILDING_R + 0.3 + r + 0.05;
      if (od < minD && od > 0.001) {
        pushX += ((x - granaryMesh.position.x) / od) * (minD - od) * 0.6;
        pushZ += ((z - granaryMesh.position.z) / od) * (minD - od) * 0.6;
        anyHit = true;
      }
    }
    if (!ignoreDock && dockMesh) {
      const od = Math.hypot(x - dockMesh.position.x, z - dockMesh.position.z);
      const minD = BUILDING_R + 0.5 + r + 0.05;
      if (od < minD && od > 0.001) {
        pushX += ((x - dockMesh.position.x) / od) * (minD - od) * 0.6;
        pushZ += ((z - dockMesh.position.z) / od) * (minD - od) * 0.6;
        anyHit = true;
      }
    }
    if (!anyHit) break;
    x += pushX; z += pushZ;
  }
  // 1) 岛边界 clamp
  const d = Math.hypot(x + dx, z + dz);
  let clampedDx = dx, clampedDz = dz;
  if (d > R - 0.5) { const k = (R - 0.5) / d; clampedDx = dx * k; clampedDz = dz * k; }
  // 2) 障碍滑行
  const s = slideStep(x, z, clampedDx, clampedDz, r, u.workObj, ignoreDock);
  x = s.x; z = s.z;
  // 3) 帮工互避
  for (const other of islanders) {
    if (other === v) continue;
    const ox = x - other.position.x, oz = z - other.position.z;
    const od = Math.hypot(ox, oz);
    if (od < VILLAGER_CLEARANCE && od > 0.001) {
      const push = (VILLAGER_CLEARANCE - od) * 0.5;
      x += (ox / od) * push; z += (oz / od) * push;
    }
  }
  // 4) 卡住检测:基于"是否在接近目标"判断(推挤不算移动)
  if (u.target && u.state === 'go') {
    const distToTarget = Math.hypot(x - u.target.x, z - u.target.z);
    if (u._prevTargetDist == null) u._prevTargetDist = distToTarget;
    const progress = u._prevTargetDist - distToTarget;
    u._prevTargetDist = distToTarget;
    if (!u._stuckTimer) u._stuckTimer = 0;
    if (!u._detourSide) u._detourSide = 0; // 绕行方向:0=不绕,1=左,-1=右
    if (progress > 0.005) {
      u._stuckTimer = 0;
      u._detourSide = 0;
    } else {
      u._stuckTimer += 0.016;
      // 卡了0.3秒 → 立即开始绕行(不让撞墙动画被人看到)
      if (u._stuckTimer > 0.3 && u._detourSide === 0) {
        u._detourSide = Math.random() < 0.5 ? 1 : -1;
      }
      // 卡了1.5秒 → 换绕行方向
      if (u._stuckTimer > 1.5 && Math.abs(u._detourSide) === 1) {
        u._detourSide = -u._detourSide;
      }
      // 卡了3秒 → 换工作目标
      if (u._stuckTimer > 3) {
        const w = workPointFor(u.role);
        u.target = w.pos; u.workObj = w.obj;
        u._stuckTimer = 0; u._detourSide = 0;
        u._prevTargetDist = Math.hypot(x - u.target.x, z - u.target.z);
      }
    }
    // 绕行:在目标方向基础上偏转45°~90°
    if (u._detourSide !== 0 && u._stuckTimer > 1) {
      const wantAng = Math.atan2(u.target.z - z, u.target.x - x);
      const detourAng = wantAng + u._detourSide * (Math.PI * 0.35 + Math.random() * 0.2);
      const detourStep = 2.6 * 0.016; // 一帧的速度
      x += Math.cos(detourAng) * detourStep;
      z += Math.sin(detourAng) * detourStep;
      // 边界 clamp
      const bd = Math.hypot(x, z);
      if (bd > R - 0.5) { x *= (R - 0.5) / bd; z *= (R - 0.5) / bd; }
      // 障碍检测:绕行方向也被挡就跳过这帧
      if (hitObstacle(x, z, r, u.workObj, ignoreDock)) {
        x -= Math.cos(detourAng) * detourStep;
        z -= Math.sin(detourAng) * detourStep;
        u._detourSide = -u._detourSide; // 换方向
      }
    }
  } else {
    u._stuckTimer = 0;
    u._prevTargetDist = null;
    u._detourSide = 0;
  }
  return { x, z };
}

// 玩家移动:与帮工同一套障碍(半径略小);exclude = 当前采集/自动任务目标,确保能贴近资源
function playerSlide(dx, dz) {
  const excl = (autoTask && autoTask.obj) ? autoTask.obj : (action ? action.target : null);
  return slideStep(player.pos.x, player.pos.z, dx, dz, ENTITY_R.player, excl);
}

function updateVillagers(dt, now) {
  for (const v of islanders) {
    const u = v.userData, P = u.parts;
    let moving = false, bend = 0, working = false;
    // === 全局卡住检测:只在 go 状态检测,work 状态是正常站着干活不能算卡 ===
    if (u.state === 'go') {
      if (!u._lastPos) u._lastPos = { x: v.position.x, z: v.position.z, timer: 0 };
      const distMoved = Math.hypot(v.position.x - u._lastPos.x, v.position.z - u._lastPos.z);
      if (distMoved < 0.05) {
        u._lastPos.timer += dt;
      } else {
        u._lastPos.x = v.position.x; u._lastPos.z = v.position.z; u._lastPos.timer = 0;
      }
      if (u._lastPos.timer > 5 && u.role !== 'idle') {
        u._lastPos.timer = 0;
        u._lastPos.x = v.position.x; u._lastPos.z = v.position.z;
        const w = workPointFor(u.role);
        u.target = w.pos; u.workObj = w.obj;
        u._stuckTimer = 0; u._detourSide = 0;
      }
    } else {
      if (u._lastPos) u._lastPos.timer = 0;
    }
    // === 原有逻辑 ===
    if (u.role === 'idle') {
      // 散工:在住处附近小范围溜达
      const nx = u.baseX + Math.sin(now / 1600 + u.ph) * 0.6;
      const nz = u.baseZ + Math.cos(now / 2100 + u.ph) * 0.6;
      const mdx = nx - v.position.x, mdz = nz - v.position.z;
      moving = Math.hypot(mdx, mdz) > 0.002;
      v.position.x = nx; v.position.z = nz;
      if (moving) faceBody(u, Math.atan2(mdx, mdz), dt);
    } else {
      if (u.state === 'go' && u.target) {
        const dx = u.target.x - v.position.x, dz = u.target.z - v.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.8) {
          // 农夫采果丛:即时采集
          if (u.role === 'farmer' && u.workObj && u.workObj.userData.type === 'bush' && u.workObj.parent) {
            harvestBush(u.workObj);
            addFloater('+1🌾', '#ffd54f', v.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
            u.workObj = null;
            const w = workPointFor(u.role);
            u.target = w.pos; u.workObj = w.obj;
          } else if (u.role === 'farmer' && u.workObj && u.workObj.userData.type === 'bush' && !u.workObj.parent) {
            // 果丛已被人摘走,换目标
            const w = workPointFor(u.role);
            u.target = w.pos; u.workObj = w.obj;
          } else {
            // 到达工作点,开始干活
            u.state = 'work';
            u.hitTimer = 0; u.workerHits = 0;
            u.workTimer = u.role === 'farmer' ? (4 + Math.random() * 4)
              : u.role === 'woodcutter' ? WORKER_CYCLE_TREE
              : u.role === 'miner' ? WORKER_CYCLE_ROCK
              : 4;
            u.floatTimer = 0.5 + Math.random() * 0.5;
          }
        } else {
          moving = true;
          const wantDx = (dx / dist) * 2.6 * dt;
          const wantDz = (dz / dist) * 2.6 * dt;
          // 统一碰撞:岛边界 + 资源 + 建筑 + 帮工互避(Phase 2.1.4)
          const np = villagerMove(v, wantDx, wantDz);
          v.position.x = np.x;
          v.position.z = np.z;
          faceBody(u, Math.atan2(dx, dz), dt);
        }
      }
      if (u.state === 'work') {
        working = true;
        u.workTimer -= dt; u.hitTimer -= dt;
        const sw = Math.sin(now / 240 + u.ph);
        if (u.role === 'woodcutter' || u.role === 'miner') {
          // 挥工具(玩家同款节奏 0.45s/击),带火星/树晃特效
          u.tool.visible = true;
          P.armR.rotation.x = -0.4 - Math.max(0, sw) * 1.7;
          P.armL.rotation.x = -0.3;
          if (u.hitTimer <= 0) {
            u.hitTimer = WORKER_HIT_INT;
            const obj = u.workObj;
            if (obj && obj.parent) {
              u.workerHits++;
              if (u.role === 'miner') burstSparks(obj.position);
              else obj.rotation.z = 0.12; // 树晃(主循环衰减)
              // 累计够 N 击 → 实时结算产出
              const need = (u.role === 'woodcutter') ? WORKER_HITS_TREE : WORKER_HITS_ROCK;
              if (u.workerHits >= need) {
                u.workerHits = 0;
                if (u.role === 'woodcutter') workerChopTree(obj);
                else workerMineRock(obj);
                u.workObj = null; // 强制换下一个目标
              }
            } else {
              u.workObj = null; // 目标被人抢走/已消失,直接换
            }
          }
        } else if (u.role === 'farmer') {
          // 弯腰侍弄庄稼
          bend = Math.max(0, Math.sin(now / 500 + u.ph)) * 0.55;
          P.armR.rotation.x = -1.0 * bend;
          P.armL.rotation.x = -0.8 * bend;
        } else if (u.role === 'fisher') {
          // 甩竿收线
          P.armR.rotation.x = -1.2 + Math.sin(now / 350 + u.ph) * 0.7;
          P.armL.rotation.x = -0.4;
        }
        // 一个工作周期结束 → 农夫先处理当前田,再换目标
        if (u.workTimer <= 0) {
          if (u.role === 'farmer' && u.workObj && u.workObj.parent) {
            const p = u.workObj;
            const st = p.userData.state;
            if (st === 'ready') { // 熟了:收割+4谷,有种子就补种
              const yieldN = 4;
              addFood(g, 'grain', yieldN);
              // 补种
              if (g.grain >= 1) {
                g.grain -= 1;
                p.userData.state = 'growing'; p.userData.age = 0;
                p.userData.sprouts.visible = true; p.userData.golds.visible = false;
              } else {
                p.userData.state = 'wild'; p.userData.age = 0;
                p.userData.sprouts.visible = false; p.userData.golds.visible = false;
              }
              updateHUD();
              addFloater('+' + yieldN + '🌾', '#ffd54f', v.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
            } else if (st === 'wild' && g.grain >= 1) { // 荒田:播种
              g.grain -= 1;
              p.userData.state = 'growing'; p.userData.age = 0;
              p.userData.sprouts.visible = true; p.userData.golds.visible = false;
              updateHUD();
              addFloater('播种🌱', '#7cb342', v.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
            } else if (st === 'growing') {
              addFloater('🌾生长中…', '#a5d6a7', v.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
            }
          }
          // 渔夫:每个工作周期捕鱼一次(四六分成)
          if (u.role === 'fisher') {
            const P2 = Math.max(1, Math.round(2 * fisherCapital(g) * marginal(1)));
            const mine = Math.round(P2 * 0.6);
            addFood(g, 'fish', mine);
            updateHUD();
            addFloater('+' + mine + '🐟', '#42a5f5', v.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
          }
          const w = workPointFor(u.role);
          u.target = w.pos; u.workObj = w.obj; u.state = 'go'; u.tool.visible = false;
        }
        // 工作对象中途消失(被人抢/被另一帮工砍了)→ 换
        if (u.workObj && (!u.workObj.parent || (u.role !== 'fisher' && u.role !== 'farmer' && !u.workObj.parent))) {
          u.workObj = null; u.target = null; u.state = 'go'; u.tool.visible = false;
        }
      }
      // 帮工干活时头顶飘产出(每2秒飘一次,玩家立刻看到"在干活")
      u.floatTimer -= dt;
      if (u.floatTimer <= 0 && u.state === 'work') {
        u.floatTimer = 1.8 + Math.random() * 0.8; // 1.8~2.6s 随机间隔,避免所有帮工同时飘
        const [sym, color] = ROLE_FLOAT[u.role] || ['+1', '#fff'];
        addFloater(sym, color, v.position.clone().add(new THREE.Vector3(0, 2.8, 0)));
      }
    }
    // 行走摆臂摆腿(工作姿态覆盖手臂)
    u.walkPhase += dt * 9 * (moving ? 1 : 0);
    const leg = Math.sin(u.walkPhase) * 0.7 * (moving ? 1 : 0);
    P.legL.rotation.x = leg; P.legR.rotation.x = -leg;
    if (!working) { P.armL.rotation.x = -leg * 0.8; P.armR.rotation.x = leg * 0.8; }
    else P.armL.rotation.x = -leg * 0.3;
    v.rotation.set(bend, u.bodyYaw, 0, 'YXZ');
    if (u.badge) u.badge.position.y = 2.3 + Math.sin(now / 400 + u.ph) * 0.06; // 徽章上下浮动
  }
}

// ---------- 产出飘字(Canvas Sprite,晨间汇报) ----------
const floaters = [];
function addFloater(text, color, pos) {
  const cnv = document.createElement('canvas');
  cnv.width = 256; cnv.height = 64;
  const ctx = cnv.getContext('2d');
  ctx.font = 'bold 38px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cnv), transparent: true, depthTest: false }));
  spr.scale.set(2.4, 0.6, 1);
  spr.position.set(pos.x, pos.y + 2.6, pos.z);
  scene.add(spr);
  floaters.push({ spr, life: 4.5 });
}
function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.spr.position.y += dt * 0.55;
    f.spr.material.opacity = Math.min(1, f.life / 1.2);
    if (f.life <= 0) {
      scene.remove(f.spr);
      f.spr.material.map.dispose(); f.spr.material.dispose();
      floaters.splice(i, 1);
    }
  }
}
function showWorkerFloaters() {
  const rep = g.workerReport; if (!rep) return;
  for (const v of islanders) {
    const u = v.userData;
    if (u.role === 'idle' || !rep[u.role] || !g.workers[u.role]) continue;
    const n = Math.max(1, Math.round(rep[u.role] / g.workers[u.role]));
    const [icon, color] = ROLE_UNIT[u.role];
    addFloater('+' + n + icon, color, v.position);
  }
}
// 鱼仓生崽飘字(Phase 2.1):利率不显示数字,玩家只看鱼苗数量感知"存划算不划算"
function showInterestFloater() {
  if (!granaryMesh || g.interestLast <= 0) return;
  addFloater('+' + g.interestLast + '🐟', '#b3e5fc', granaryMesh.position);
}

// ---------- 玩家控制(Minecraft 式:指针锁定 + 拖拽兜底 + 平滑视角) ----------
const MAX_PITCH = Math.PI / 2 - 0.02;
// 视角灵敏度(rad/像素),左下角滑块可实时调并记忆到本地
let LOOK_SENS = 0.0015;
try {
  const saved = Number(localStorage.getItem('island.lookSens'));
  if (saved >= 0.0003 && saved <= 0.003) LOOK_SENS = saved;   // 只接受合理区间,脏数据忽略
} catch (err) { /* 隐私模式/禁用存储:用默认值,不报错 */ }
const LOOK_CLAMP = 50;      // 单次事件最大像素增量:防浏览器 movementX 尖峰导致疯转
const player = { pos: new THREE.Vector3(0, PLAYER_EYE, 0), yaw: 0, pitch: 0 };
let targetYaw = 0, targetPitch = -0.8;
const keys = {};
let locked = false, dragging = false, lockBroken = false;
let dragDist = 0, lastX = 0, lastY = 0;
let thirdPerson = true, camDist = 15;
const dom = renderer.domElement;

function applyLook(dx, dy) {
  // 钳制单次增量,过滤指针锁定偶发的巨大 movement 跳变
  dx = Math.max(-LOOK_CLAMP, Math.min(LOOK_CLAMP, dx));
  dy = Math.max(-LOOK_CLAMP, Math.min(LOOK_CLAMP, dy));
  targetYaw -= dx * LOOK_SENS;
  targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, targetPitch - dy * LOOK_SENS));
}
function tryLock() {
  try {
    const p = dom.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (err) { /* 指针锁定不可用 → 自动走拖拽模式 */ }
}
dom.addEventListener('click', (e) => {
  if (dragDist >= 5) return; // 拖拽视角不算点击
  if (locked) {
    // 锁定模式:准星中心。先判资源 → 命中则派自动采集任务,否则地面移动
    const obj = objectAtNDC(0, 0);
    if (obj) { setGatherTask(obj); return; }
    const p = groundPoint(0, 0);
    if (p) setMoveTarget(p);
  } else if (lockBroken) {
    // 预览/拖拽模式:点击哪里走哪里,点到资源则去采集
    const rect = dom.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const obj = objectAtNDC(nx, ny);
    if (obj) { setGatherTask(obj); return; }
    const p = groundPoint(nx, ny);
    if (p) setMoveTarget(p);
  } else {
    tryLock(); // 未锁定:第一次点击先锁鼠标
  }
});
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === dom; });
document.addEventListener('pointerlockerror', () => {
  if (lockBroken) return;
  lockBroken = true;
  flash('🖱️ 当前环境不支持鼠标锁定(预览面板常见),已切换为拖拽模式:按住左键拖动即可 360° 转视角。');
});
document.addEventListener('mousemove', (e) => {
  if (currentScene === 'island') {
    if (locked || dragging) {
      const dx = locked ? e.movementX : (e.clientX - lastX);
      islandCamYaw -= dx * LOOK_SENS;
      if (!locked) { lastX = e.clientX; lastY = e.clientY; dragDist += Math.abs(dx); }
    }
    return;
  }
  if (locked) { applyLook(e.movementX, e.movementY); return; }
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    applyLook(dx, dy);
    dragDist += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
  }
});
dom.addEventListener('mousedown', (e) => {
  if (locked || e.button !== 0) return;
  dragging = true; dragDist = 0; lastX = e.clientX; lastY = e.clientY;
});
addEventListener('mouseup', () => { dragging = false; });
dom.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (thirdPerson) {
    camDist = Math.max(2, Math.min(15, camDist + Math.sign(e.deltaY) * 0.8));
  } else {
    camera.fov = Math.max(45, Math.min(95, camera.fov + Math.sign(e.deltaY) * 4));
    camera.updateProjectionMatrix();
  }
}, { passive: true });

// 方块小人(MC 经典比例:头0.5/躯干0.75/四肢0.75;四肢挂在肩/胯枢轴上便于摆动)
const playerBody = new THREE.Group();
let legL, legR, armL, armR;
{
  const skin = new THREE.MeshLambertMaterial({ color: 0xffcc80 });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x388e3c });
  const pants = new THREE.MeshLambertMaterial({ color: 0x37474f });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x263238 });
  // 头(脸朝本地 +Z)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
  head.position.y = 1.75; head.castShadow = true;
  const eL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.02), eyeMat); eL.position.set(-0.12, 1.78, 0.26);
  const eR = eL.clone(); eR.position.x = 0.12;
  // 躯干
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.25), shirt);
  torso.position.y = 1.125; torso.castShadow = true;
  // 四肢:枢轴在肩/胯,网格向下偏移半长 → rotation.x 即为摆动
  function limb(x, pivotY, mat) {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), mat);
    m.position.y = -0.375; m.castShadow = true;
    pivot.add(m);
    return pivot;
  }
  legL = limb(-0.13, 0.75, pants); legR = limb(0.13, 0.75, pants);
  armL = limb(-0.36, 1.45, shirt); armR = limb(0.36, 1.45, shirt);
  playerBody.add(head, eL, eR, torso, legL, legR, armL, armR);
}
playerBody.visible = false;
scene.add(playerBody);

// 小人动画状态
let bodyYaw = 0;      // 小人实际朝向(平滑转身)
let walkPhase = 0;    // 走路摆动相位
let swimPhase = 0;    // 游泳划水相位(连续轮转)
let poseBlend = 0;    // 0=直立 ↔ 1=游泳(平滑过渡)
let moveAmt = 0;      // 0=待机 ↔ 1=移动(平滑过渡)

// 工具(挂在右臂枢轴末端,随动作显隐)
const axe = new THREE.Group();
{
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.06), new THREE.MeshLambertMaterial({ color: 0xb0bec5 }));
  head.position.y = 0.25;
  axe.add(handle, head);
  axe.position.set(0, -0.75, 0.08); axe.rotation.x = Math.PI / 2;
  armR.add(axe); axe.visible = false;
}
const hammer = new THREE.Group();
{
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: 0x6d4c41 }));
  head.position.y = 0.2;
  hammer.add(handle, head);
  hammer.position.set(0, -0.75, 0.08); hammer.rotation.x = Math.PI / 2;
  armR.add(hammer); hammer.visible = false;
}

addEventListener('keydown', (e) => { keys[e.code] = true; handleKey(e); });
addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------- 准星交互 ----------
const ray = new THREE.Raycaster();
// withFish=true 时把鱼也纳入检测(空格交互用);点击派任务只检测可采集资源
function pickAt(ndcX, ndcY, withFish) {
  camera.updateMatrixWorld(true);
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hit = ray.intersectObjects(withFish ? [...interactives, ...fishes] : interactives, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o && !o.userData.type) o = o.parent;   // 命中树叶/果子时向上找宿主
  return o && o.userData.type ? o : null;
}
function targetUnderCrosshair() {
  return pickAt(0, 0, true);
}

// 砍掉的资源排入再生队列
const regrowPending = [];
function queueRegrow(kind, obj) {
  obj.userData.regrowAt = g.day + (kind === 'tree' ? CFG.TREE_REGROW : kind === 'rock' ? CFG.ROCK_REGROW : CFG.BUSH_REGROW);
  regrowPending.push({ kind, day: obj.userData.regrowAt });
}

// ---------- 采集动作系统:砍树(3斧)/敲石(4锤)/种植(挖土+播种) ----------
const HIT_INT = 0.45;               // 每次挥击间隔(秒)
let action = null;                  // {type:'chop'|'mine'|'plant', target, need, hits, phase, timer}

// 火星粒子池(敲石特效)
const sparks = [];
{
  const sg = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  const sm = new THREE.MeshBasicMaterial({ color: 0xffc107 });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Mesh(sg, sm);
    s.visible = false; scene.add(s);
    sparks.push({ mesh: s, vel: new THREE.Vector3(), life: 0 });
  }
}
function burstSparks(pos) {
  let n = 6;
  for (const s of sparks) {
    if (n <= 0) break;
    if (s.life > 0) continue;
    s.life = 0.3 + Math.random() * 0.2;
    s.mesh.visible = true;
    s.mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3));
    s.vel.set((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
    n--;
  }
}

// 倒下的树(倒地动画后移除)
const fallingTrees = [];

function startAction(type, target, need) {
  action = { type, target, need: need || 0, hits: 0, phase: 0, timer: type === 'plant' ? 0.8 : 0.2 };
}
function cancelAction() { action = null; }

// 统一移除资源:清数组 + 归还散布槽位(occupied),否则槽位只增不减会让资源永久不再重生
function removeAt(arr, item) { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); }
function releaseSlot(o) {
  const slot = o.userData && o.userData.slot;
  if (!slot) return;
  const i = occupied.indexOf(slot);
  if (i >= 0) occupied.splice(i, 1);
}

function performHit() {
  const a = action; if (!a) return;
  const t = a.target;
  const dx = t.position.x - player.pos.x, dz = t.position.z - player.pos.z;
  if (!t.parent || Math.hypot(dx, dz) > 5) { cancelAction(); return; } // 离开范围/目标消失
  a.hits++;
  if (a.type === 'chop') {
    t.rotation.z = 0.12;  // 树晃动(主循环里衰减)
    if (a.hits >= a.need) {
      const woodAmt = Math.round(CFG.TREE_WOOD * getEfficiency(g, 'wood'));
      g.wood += woodAmt;
      queueRegrow('tree', t);
      fallingTrees.push({ tree: t, t: 0 });
      removeAt(trees, t);
      removeAt(interactives, t);
      releaseSlot(t);
      flash(`树倒了!+${woodAmt} 木头,树桩 ${CFG.TREE_REGROW} 天后长回。`);
      cancelAction();
    } else flash(`挥斧砍树 ${a.hits}/${a.need}…`);
  } else if (a.type === 'mine') {
    burstSparks(t.position);
    t.rotation.z = 0.15;
    if (a.hits >= a.need) {
      const stoneAmt = Math.round(CFG.ROCK_STONE * getEfficiency(g, 'stone'));
      g.stone += stoneAmt;
      queueRegrow('rock', t);
      scene.remove(t);
      removeAt(rocks, t);
      removeAt(interactives, t);
      releaseSlot(t);
      flash(`石头碎裂!+${stoneAmt}。`);
      cancelAction();
    } else flash(`锤击岩石 ${a.hits}/${a.need}…`);
  }
}

// 帮工实时采集(Phase 2.1.2):帮工不刷"挥斧 N/N"飘字,只结算产出
function workerChopTree(t) {
  if (!t || !t.parent) return false;
  const woodAmt = Math.round(CFG.TREE_WOOD * getEfficiency(g, 'wood'));
  g.wood += woodAmt;
  queueRegrow('tree', t);
  fallingTrees.push({ tree: t, t: 0 });
  removeAt(trees, t);
  removeAt(interactives, t);
  releaseSlot(t);
  updateHUD();
  return true;
}
function workerMineRock(r) {
  if (!r || !r.parent) return false;
  const stoneAmt = Math.round(CFG.ROCK_STONE * getEfficiency(g, 'stone'));
  g.stone += stoneAmt;
  queueRegrow('rock', r);
  scene.remove(r);
  removeAt(rocks, r);
  removeAt(interactives, r);
  releaseSlot(r);
  updateHUD();
  return true;
}

// 捕鱼成功率:基础 35%,每失败一次 +20%,封顶 95%
// 织网当天(g.craftingDay)分心编网 → 成功率减半,这是 R2「延迟消费」的第二重代价
const CATCH_BASE = 0.35, CATCH_STEP = 0.20, CATCH_MAX = 0.95;
function catchProb(f) {
  const p = Math.min(CATCH_MAX, CATCH_BASE + CATCH_STEP * (f.userData.attempts || 0));
  return g.craftingDay ? p * 0.5 : p;
}

// 捕鱼尝试:概率随尝试次数递增(35%→55%→75%→95%),失败鱼受惊逃窜
function attemptCatch(f) {
  const u = f.userData;
  const prob = catchProb(f);
  u.attempts++;
  if (Math.random() < prob) {
    const r = catchOne(g);
    scene.remove(f); fishes.splice(fishes.indexOf(f), 1);
    flash(`逮住了!${r.msg}`);
  } else {
    u.fleeBoost = 1.0;
    u.heading = Math.atan2(f.position.z - player.pos.z, f.position.x - player.pos.x);
    const next = Math.round(catchProb(f) * 100);
    flash(`鱼溜走了!它放松警惕中,下次成功率 ${next}%${g.craftingDay ? '(今天手在编网,手感差一半)' : ''}`);
  }
}

// ---------- 点击移动 ----------
let moveTarget = null;
let autoTask = null;        // 自动采集任务:{ obj, kind } —— 走到站位后自动开工
let facingTarget = null;    // 采集时朝向目标:{ x, z, life }
const targetMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.35, 0.55, 24),
  new THREE.MeshBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
);
targetMarker.rotation.x = -Math.PI / 2;
targetMarker.visible = false;
scene.add(targetMarker);

// 选中资源的高亮环(青色,标在目标脚下;黄环标的是"走到的站位")
const selectRing = new THREE.Mesh(
  new THREE.RingGeometry(0.62, 0.82, 24),
  new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);
selectRing.rotation.x = -Math.PI / 2;
selectRing.visible = false;
scene.add(selectRing);
function clearSelection() { selectRing.visible = false; }

function groundPoint(ndcX, ndcY) {
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const dir = ray.ray.direction;
  if (Math.abs(dir.y) < 1e-4) return null;
  const tHit = (1.5 - ray.ray.origin.y) / dir.y;
  if (tHit <= 0) return null;
  const p = ray.ray.origin.clone().addScaledVector(dir, tHit);
  const d = Math.hypot(p.x, p.z);
  if (d > DEEP_WATER) { p.x *= DEEP_WATER / d; p.z *= DEEP_WATER / d; } // 最远点到近海边界
  return p;
}
function setMoveTarget(p) {
  autoTask = null;
  clearSelection();
  moveTarget = p;
  cancelAction();
  targetMarker.position.set(p.x, Math.hypot(p.x, p.z) > SAND_BORDER ? 0.6 : 1.56, p.z);
  targetMarker.visible = true;
}

// ---------- 即时采集(果丛 / 成熟农田):点击任务与空格共用 ----------
function harvestBush(t) {
  addFood(g, 'grain', CFG.BUSH_GRAIN);
  queueRegrow('bush', t);
  scene.remove(t);
  removeAt(bushes, t);
  removeAt(interactives, t);
  releaseSlot(t);
  flash(`摘到 ${CFG.BUSH_GRAIN} 份谷穗(能吃也能当种子)。`);
}
function harvestPlot(t) {
  if (t.userData.state !== 'ready') { flash('这块田还没到收的时候。'); return false; }
  const r = harvestCrop(g);
  if (r.ok) {
    t.userData.state = 'wild';
    t.userData.sprouts.visible = false;
    t.userData.golds.visible = false;
  }
  flash(r.msg);
  return r.ok;
}

// ---------- 点击资源自动采集:小人走过去 → 到位自动完成整套动作 ----------
// 点击派任务只认可采集资源(树/石/果丛/农田),不含鱼——鱼会逃窜,自动追击体验差,保持手动
function objectAtNDC(ndcX, ndcY) { return pickAt(ndcX, ndcY, false); }
// 站位:目标旁 1.3 单位(靠玩家这一侧),并限制在岛内
function standPointFor(obj) {
  const dx = player.pos.x - obj.position.x, dz = player.pos.z - obj.position.z;
  const d = Math.hypot(dx, dz);
  const ux = d < 0.01 ? 1 : dx / d, uz = d < 0.01 ? 0 : dz / d;
  let x = obj.position.x + ux * 1.3, z = obj.position.z + uz * 1.3;
  const dd = Math.hypot(x, z);
  if (dd > R - 0.8) { x *= (R - 0.8) / dd; z *= (R - 0.8) / dd; }
  return { x, z };
}
const TASK_LABEL = { tree: '砍树', rock: '采石', bush: '摘谷穗', plot: '侍弄农田' };
function setGatherTask(obj) {
  // 粮仓是 UI 入口,不走过去,直接打开面板
  if (obj.userData.type === 'granary') { openGranaryPanel(); return; }
  // 重复点击同一目标:正在砍/已在赶路 → 忽略,否则会重置连击进度导致永远砍不倒
  if (action && action.target === obj) return;
  if (autoTask && autoTask.obj === obj) return;
  const kind = obj.userData.type;
  if (obj.userData.state === 'growing') {
    flash(`谷子还要长 ${CFG.CROP_DAYS - obj.userData.age} 天,急不来——先去忙别的。`);
    return;
  }
  if (kind === 'plot' && obj.userData.state === 'wild' && g.grain < CFG.PLANT_COST) {
    flash(`❌ 播种需要 ${CFG.PLANT_COST} 份谷穗,先去摘野果丛凑种子。`);
    return;
  }
  cancelAction();
  const sp = standPointFor(obj);
  setMoveTarget(new THREE.Vector3(sp.x, 0, sp.z));  // 内部会清空 autoTask
  autoTask = { obj, kind };                          // 移动目标设好后再登记采集任务
  selectRing.position.set(obj.position.x, 1.58, obj.position.z);
  selectRing.visible = true;
  flash(`🚶 走去${TASK_LABEL[kind]}…(WASD 可随时接管)`);
}
// 到位后自动开工(树/石走连击动作,果丛/熟田即时结算)
function beginGather() {
  const task = autoTask;
  autoTask = null;
  targetMarker.visible = false;
  clearSelection();
  if (!task) return;
  const obj = task.obj;
  if (!obj.parent) { flash('目标已经不在了(可能被收走了)。'); return; }
  facingTarget = { x: obj.position.x, z: obj.position.z, life: 0.8 };  // 面向目标,别背对着干活
  if (task.kind === 'tree') { startAction('chop', obj, 3); flash('举起斧头,开砍!(连击 3 斧)'); }
  else if (task.kind === 'rock') { startAction('mine', obj, 4); flash('举起石锤,开敲!(连击 4 锤)'); }
  else if (task.kind === 'bush') harvestBush(obj);
  else if (task.kind === 'plot') {
    if (obj.userData.state === 'wild') {
      if (g.grain < CFG.PLANT_COST) { flash(`❌ 谷穗不够播种了(需要 ${CFG.PLANT_COST} 份)。`); return; }
      startAction('plant', obj);
      flash('弯腰挖坑,准备播种…');
    } else harvestPlot(obj);
  }
}

function doAction() {
  // 游泳模式:不依赖准星射线,改为找最近的鱼近距离捕
  if (isSwimming) {
    let closest = null, closestDist = SWIM_FISH_RANGE;
    for (const f of fishes) {
      const dist = player.pos.distanceTo(f.position);
      if (dist < closestDist) { closestDist = dist; closest = f; }
    }
    if (closest) attemptCatch(closest);
    else flash('🏊 附近没有鱼,再往前游一点。(靠近鱼 3 个身位以内按空格)');
    return;
  }
  // 陆地模式:准星射线检测
  camera.updateMatrixWorld(true);
  const t = targetUnderCrosshair();
  if (!t) { flash('准星没对准可交互的东西(鱼/树/石头/果丛/农田)。'); return; }
  const type = t.userData.type;
  if (action && action.target === t) return; // 正在处理该目标,动作自动连击
  // 手动接管同一目标:撤掉待办的自动任务,否则走到后会二次结算(1颗种子换6谷穗的刷资源漏洞)
  if (autoTask && autoTask.obj === t) {
    autoTask = null; moveTarget = null;
    targetMarker.visible = false; clearSelection();
  }
  if (type === 'fish') {
    attemptCatch(t);
  } else if (type === 'tree') {
    startAction('chop', t, 3);
    flash('举起斧头,开砍!(连击 3 斧)');
  } else if (type === 'rock') {
    startAction('mine', t, 4);
    flash('举起石锤,开敲!(连击 4 锤)');
  } else if (type === 'bush') {
    harvestBush(t);
  } else if (type === 'plot') {
    const st = t.userData.state;
    if (st === 'wild') {
      if (g.grain < CFG.PLANT_COST) { flash(`❌ 播种需要 ${CFG.PLANT_COST} 份谷穗,先去摘野果丛(空格对准果丛)。`); return; }
      startAction('plant', t);
      flash('弯腰挖坑,准备播种…');
    } else if (st === 'growing') {
      flash(`还要长 ${CFG.CROP_DAYS - t.userData.age} 天,急不来——这就是"先延迟满足,后大丰收"。`);
    } else {
      harvestPlot(t);
    }
  } else if (type === 'granary') {
    openGranaryPanel();  // 准星对准粮仓按空格 → 打开鱼仓面板
  }
}

function toggleWorkerPanel() {
  const p = $('workerPanel');
  p.classList.toggle('hidden');
  const open = !p.classList.contains('hidden');
  if (open && document.pointerLockElement) { try { document.exitPointerLock(); } catch (err) { /* 预览环境无指针锁 */ } }
  return open;
}

// ---------- 鱼仓面板(Phase 2.1) ----------
// 设计:玩家看不到百分比,只看鱼苗数量;利率通过小鱼苗数量自然感知
function openGranaryPanel() {
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (err) { /* 预览环境无指针锁 */ } }
  $('granaryPanel').classList.remove('hidden');
  refreshGranaryPanel();
  $('granaryInput').focus();
}
function closeGranaryPanel() { $('granaryPanel').classList.add('hidden'); }
function refreshGranaryPanel() {
  $('gpFish').textContent = g.fish;
  $('gpSavings').textContent = g.savings;
  $('gpRate').textContent = `${Math.round(interestRate(g) * 100)}%`;
  // 鱼苗提示:利率越高,提示越明确
  const r = interestRate(g);
  $('gpHint').textContent = r >= 0.15 ? '✨ 岛上鱼少,鱼仓特别欢迎存鱼——生崽飞快'
    : r >= 0.08 ? '🐟 鱼仓生崽正常,长期来看存鱼比吃鱼攒多'
    : r >= 0.04 ? '🐟 鱼仓生崽变慢了——岛上鱼太多了'
    : '⚠️ 鱼仓快满了,生崽基本停了——再存也涨不动';
}
function granaryDeposit() {
  const n = parseInt($('granaryInput').value, 10);
  const r = depositFish(g, Number.isFinite(n) ? n : 0);
  flash(r.msg);
  $('granaryInput').value = '';
  refreshGranaryPanel();
  updateHUD();
}
function granaryWithdraw() {
  const n = parseInt($('granaryInput').value, 10);
  const r = withdrawFish(g, Number.isFinite(n) ? n : 0);
  flash(r.msg);
  $('granaryInput').value = '';
  refreshGranaryPanel();
  updateHUD();
}

function handleKey(e) {
  if (e.code === 'Space') { e.preventDefault(); doAction(); }
  else if (e.code === 'KeyT') { sleep(); }
  else if (e.code === 'KeyV') {
    const open = toggleWorkerPanel();
    flash(open ? '👥 岛民事务所:花 5 份食物雇佣帮工,四六分成/管饭换劳力。' : '岛民事务所已收起。');
  }
  else if (e.code === 'KeyC') {
    thirdPerson = !thirdPerson;
    flash(thirdPerson ? '🎥 第三人称视角(滚轮调整镜头距离)' : '🎥 第一人称视角(滚轮调整视场大小)');
  }
  else if (e.code === 'Escape' && !$('granaryPanel').classList.contains('hidden')) {
    closeGranaryPanel();
  }
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
function flash(msg) {
  g.log = g.log || [];
  g.log.unshift(msg); if (g.log.length > 6) g.log.pop();
  $('log').innerHTML = g.log.map((l) => `<div>· ${l}</div>`).join('');
  updateHUD();
}
// 估算每天库存需供养的口粮:玩家1 + 散工(产出入库再吃回) + 需供养帮工
function estEatNeed() {
  let n = 1 + idleCount(g);
  n += g.workers.farmer + g.workers.woodcutter + g.workers.miner;
  for (let i = 1; i <= g.workers.fisher; i++) {
    if (Math.max(1, Math.round(2 * fisherCapital(g) * marginal(i))) < 2) n++; // 收成差的渔夫吃库存
  }
  return n;
}

function renderWorkerPanel() {
  const idle = idleCount(g);
  $('wpPop').textContent = g.pop;
  $('wpIdle').textContent = idle;
  const afford = (g.fish + g.grain) >= CFG.HIRE_COST && idle > 0;
  $('wpHire').innerHTML = ['fisher', 'farmer', 'woodcutter', 'miner'].map((r) =>
    `<button data-hire="${r}" ${afford ? '' : 'disabled'}>雇佣${ROLE_NAME[r]}<span class="cost">安家费 ${CFG.HIRE_COST} 食物</span></button>`
  ).join('');
  let list = '';
  for (const r of ['fisher', 'farmer', 'woodcutter', 'miner']) {
    if (!g.workers[r]) continue;
    const health = (g.workerHealth || {})[r] || 'ok';
    const healthIcon = health === 'sick' ? ' 🤒生病' : health === 'weak' ? ' 😵虚弱' : '';
    const healBtn = health === 'sick' && (g.herbs || 0) > 0 ? `<button data-heal="${r}">🌿治疗</button>` : '';
    list += `<div class="wrow"><span>${ROLE_NAME[r]} × ${g.workers[r]}${healthIcon}</span>${healBtn}<button data-fire="${r}">解约</button></div>`;
  }
  $('wpList').innerHTML = list || '<div class="empty">还没有帮工。散工只自给自足,雇佣后才有产出。</div>';
}

function updateHUD() {
  $('day').textContent = g.day;
  $('tier').textContent = tierOf(g.prosperity);
  $('prosperity').textContent = g.prosperity;
  // 天气显示
  const wi = WEATHER_INFO[g.weather] || WEATHER_INFO.sunny;
  const weatherEl = $('weather');
  if (weatherEl) weatherEl.textContent = `${wi.icon} ${wi.name} (${g.weatherTimer}天)`;
  $('pop').textContent = g.pop;
  $('house').textContent = `${g.pop} / ${hutCapacity(g)}`;
  $('fish').textContent = g.fish;
  $('grain').textContent = g.grain;
  // 食物新鲜度颜色
  const fishFresh = foodFreshness(g, 'fish');
  const grainFresh = foodFreshness(g, 'grain');
  $('fish').style.color = g.fish > 0 ? (fishFresh > 0.6 ? '#8fe3a0' : fishFresh > 0.3 ? '#ffd766' : '#ff6b6b') : '';
  $('grain').style.color = g.grain > 0 ? (grainFresh > 0.6 ? '#8fe3a0' : grainFresh > 0.3 ? '#ffd766' : '#ff6b6b') : '';
  $('wood').textContent = g.wood;
  $('stone').textContent = g.stone;
  // 采集篓状态
  const basketEl = $('baskets');
  if (basketEl) basketEl.textContent = g.baskets > 0 ? `🧺 ${g.baskets}/${CFG.BASKET_MAX} (🥔${g.root || 0})` : '未建';
  // 围栏/野猪状态
  const fenceEl = $('fenceInfo');
  if (fenceEl) {
    if (g.pigEvent) fenceEl.textContent = `🐗 野猪啃第${g.pigTargetPlot + 1}块田(${g.pigDaysLeft}天)`;
    else if (g.fences > 0) fenceEl.textContent = `🛡️ 围栏保护${g.fences}块田`;
    else fenceEl.textContent = '无围栏';
  }
  $('net').textContent = (g.hasNet ? '渔网 ×2' : '徒手 ×1') + (g.craftingDay ? '　🧵 手在编网(成功率减半,睡一觉恢复)' : '');
  $('dock').textContent = g.dock ? '已建 ×3' : '未建';
  $('savings').textContent = g.granary ? g.savings : '—（先盖粮仓）';
  const w = g.workers;
  const h = g.workerHealth || {};
  function wStatus(role) {
    if (!w[role]) return '';
    const health = h[role] || 'ok';
    const icon = health === 'sick' ? '🤒' : health === 'weak' ? '😵' : '';
    return `${ROLE_NAME[role]}${w[role]}${icon}`;
  }
  $('workers').textContent = w.fisher || w.farmer || w.woodcutter || w.miner
    ? ['fisher','farmer','woodcutter','miner'].map(wStatus).filter(Boolean).join(' ') + ` · 散工${idleCount(g)}`
    : `无(散工${idleCount(g)} 人自给自足)`;
  $('eats').textContent = estEatNeed();
  // 草药
  const herbEl = $('herbs');
  if (herbEl) herbEl.textContent = g.herbs || 0;
  // 目标追踪
  const goal = getCurrentGoal(g);
  const goalTextEl = $('goalText');
  if (goalTextEl) goalTextEl.textContent = goal.text;
  // 按钮显隐(根据科技树进度)
  const show = (id, cond) => { const el = $(id); if (el) el.style.display = cond ? '' : 'none'; };
  show('bBoat', g.dock && !g.hasBoat);
  show('bDeepFish', g.hasBoat);
  show('bSail', g.hasBoat);
  show('bWorkbench', (g.iron || 0) >= 3 && !g.hasWorkbench);
  show('bWell', g.hasWorkbench && !g.hasWell);
  show('bFurnace', g.hasWorkbench && !g.hasFurnace);
  show('bSmelt', g.hasFurnace);
  show('bTrader', g.hasFurnace && !g.hasTrader);
  show('bSteelTools', g.hasWorkbench && (g.refinedIron || 0) >= 2);
  // 快速旅行按钮(出海探索发现的岛屿)
  const disc = g.discoveredIslands || {};
  show('bTravelTropical', disc.tropical);
  show('bTravelVolcano', disc.volcano);
  show('bTravelSnow', disc.snow);
  // 铁矿石 HUD
  const ironEl = $('ironInfo');
  if (ironEl) {
    if (g.hasBoat || (g.ironFragments || 0) > 0 || (g.iron || 0) > 0) {
      ironEl.textContent = `⛏️ 碎片${g.ironFragments || 0}/${CFG.IRON_PER_ORE} 铁矿${g.iron || 0}` + ((g.refinedIron || 0) > 0 ? ` 精炼铁${g.refinedIron}` : '');
      ironEl.style.display = '';
    } else { ironEl.style.display = 'none'; }
  }
  renderWorkerPanel();
}

// ---------- 存档 / 读档(Phase 2.1.1) ----------
function saveWorld() {
  const state = {
    game: serializeGame(g),
    trees: trees.map((t) => ({ x: t.position.x, z: t.position.z, regrowAt: t.userData.regrowAt || 0 })),
    rocks: rocks.map((r) => ({ x: r.position.x, z: r.position.z })),
    bushes: bushes.map((b) => ({ x: b.position.x, z: b.position.z })),
    plots: plots.map((p) => ({ state: p.userData.state, age: p.userData.age || 0 })),
    huts: hutMeshes.map((h) => ({ x: h.position.x, z: h.position.z })),
    occupied: occupied.map((o) => [...o]),
    regrowPending: regrowPending.map((r) => ({ kind: r.kind, day: r.day })),
  };
  try { localStorage.setItem('island.save', JSON.stringify(state)); } catch (err) { /* 存储满时静默 */ }
}

function loadGameFromStorage() {
  let raw;
  try { raw = localStorage.getItem('island.save'); } catch (err) { return false; }
  if (!raw) return false;
  let s;
  try { s = JSON.parse(raw); } catch (err) { return false; }
  if (!s || !s.game) return false;
  // 恢复 game state
  const restored = deserializeGame(s.game);
  if (!restored) return false;
  Object.assign(g, restored);
  // 重建 3D 场景(清除默认生成的,用存档数据重建)
  for (const t of trees) scene.remove(t);
  for (const r of rocks) scene.remove(r);
  for (const b of bushes) scene.remove(b);
  for (const p of plots) scene.remove(p);
  trees.length = 0; rocks.length = 0; bushes.length = 0; plots.length = 0;
  interactives.length = 0; occupied.length = 0; regrowPending.length = 0;
  // 恢复再生队列
  if (s.regrowPending) {
    for (const r of s.regrowPending) regrowPending.push({ kind: r.kind, day: r.day });
  }
  // 树
  for (const td of (s.trees || [])) {
    const grp = makeTreeMesh();
    grp.position.set(td.x, 0, td.z);
    const age = td.regrowAt || 0;
    grp.userData = { type: 'tree', label: '砍树 (+3 木头)', regrowAt: age };
    scene.add(grp); trees.push(grp); interactives.push(grp); occupied.push([td.x, td.z]);
    if (age > g.day) regrowPending.push({ kind: 'tree', day: age });
  }
  // 旧存档没有树数据 → 重新生成12棵树
  if (trees.length === 0) {
    for (let i = 0; i < 12; i++) spawnTree();
  }
  // 石头
  for (const rd of (s.rocks || [])) {
    const rock = new THREE.Mesh(ROCK_GEO, ROCK_MAT);
    rock.position.set(rd.x, 1.4, rd.z); rock.castShadow = true;
    rock.userData = { type: 'rock', label: '采石 (+2 石头)' };
    scene.add(rock); rocks.push(rock); interactives.push(rock); occupied.push([rd.x, rd.z]);
  }
  // 果丛
  for (const bd of (s.bushes || [])) {
    const grp = new THREE.Group();
    const bush = new THREE.Mesh(BUSH_GEO, BUSH_MAT);
    bush.position.y = 1.5; bush.castShadow = true;
    for (let i = 0; i < 4; i++) {
      const berry = new THREE.Mesh(BERRY_GEO, BERRY_MAT);
      const a = (i / 4) * Math.PI * 2; berry.position.set(Math.cos(a) * 0.4, 1.6, Math.sin(a) * 0.4); grp.add(berry);
    }
    grp.add(bush); grp.position.set(bd.x, 0, bd.z);
    grp.userData = { type: 'bush', label: '摘谷穗 (+1 谷穗:能吃也能当种子)' };
    scene.add(grp); bushes.push(grp); interactives.push(grp); occupied.push([bd.x, bd.z]);
  }
  // 农田
  for (let i = 0; i < (s.plots || []).length; i++) {
    const pd = s.plots[i];
    const ang = (i / 8) * Math.PI * 2;
    const px = Math.cos(ang) * 3.2, pz = Math.sin(ang) * 3.2;
    const base = new THREE.Mesh(plotGeo, PLOT_MAT);
    base.position.set(px, 1.56, pz); base.receiveShadow = true;
    const sprouts = new THREE.Group();
    for (let s2 = 0; s2 < 5; s2++) {
      const st = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), SPROUT_MAT);
      st.position.set((Math.random() - 0.5) * 0.9, 0.3, (Math.random() - 0.5) * 0.9); sprouts.add(st);
    }
    const golds = new THREE.Group();
    for (let s2 = 0; s2 < 5; s2++) {
      const gt = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 5), BERRY_MAT);
      gt.position.set((Math.random() - 0.5) * 0.9, 0.45, (Math.random() - 0.5) * 0.9); golds.add(gt);
    }
    base.userData = { type: 'plot', state: pd.state, age: pd.age, sprouts, golds };
    base.add(sprouts); base.add(golds);
    if (pd.state === 'growing') { sprouts.visible = true; golds.visible = false; }
    else if (pd.state === 'ready') { sprouts.visible = false; golds.visible = true; }
    else { sprouts.visible = false; golds.visible = false; }
    scene.add(base); plots.push(base); interactives.push(base); occupied.push([px, pz]);
  }
  // 重建 3D 建筑
  for (const h of hutMeshes) scene.remove(h);
  hutMeshes.length = 0;
  for (const hd of (s.huts || [])) spawnHut([hd.x, hd.z]);
  if (g.granary && !granaryMesh) buildGranaryMesh();
  if (g.dock && !dockMesh) buildDockMesh();
  // 鱼群
  while (fishes.length) { scene.remove(fishes.pop()); }
  for (let i = 0; i < 10; i++) spawnFish();
  // 岛民 + 角色
  syncIslanders(); assignRoles();
  return true;
}

function sleep() {
  if (window._sleepAnim) return;
  window._sleepAnim = true;
  const overlay = document.getElementById('dayNightOverlay');
  const moon = document.getElementById('dnMoon');
  const zzz = document.getElementById('dnZzz');
  const sun = document.getElementById('dnSun');
  const dayNum = document.getElementById('dnDayNum');
  let ev = [];
  if (!overlay) { window._sleepAnim = false; return; }

  // ---- 阶段1:夜幕降临(0~1s) ----
  // 确保全屏覆盖在最顶层
  overlay.style.cssText = 'display:flex!important;position:fixed!important;inset:0!important;z-index:9999!important;background:#000!important;opacity:1!important;pointer-events:auto!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;gap:16px!important;';
  moon.style.cssText = 'font-size:120px;transition:all 0.8s ease-out;opacity:1;transform:translateY(0) scale(1);filter:drop-shadow(0 0 30px rgba(255,255,150,0.7));';
  zzz.style.cssText = 'font-size:48px;color:#fff;font-weight:bold;letter-spacing:12px;text-shadow:0 0 15px rgba(255,255,255,0.6);transition:opacity 0.5s ease-in 0.3s;opacity:1;';
  sun.style.cssText = 'font-size:120px;transition:none;opacity:0;transform:translateY(80px) scale(0.3);filter:drop-shadow(0 0 40px rgba(255,200,50,0.9));';
  dayNum.style.cssText = 'font-size:42px;color:#ffd766;font-weight:bold;text-shadow:0 3px 12px rgba(0,0,0,0.9);transition:none;opacity:0;';

  // ---- 阶段2:午夜(1s后) ----
  setTimeout(() => {
    g.crops = plots.map((p) => ({ age: p.userData.state === 'wild' ? -1 : (p.userData.age || 0), ready: p.userData.state === 'ready' }));
    ev = advanceDay(g);
    plots.forEach((p, i) => {
      const c = g.crops[i];
      if (c.ready) {
        if (p.userData.state !== 'ready') { p.userData.state = 'ready'; p.userData.sprouts.visible = false; p.userData.golds.visible = true; }
      } else if (c.age >= 0) {
        if (p.userData.state !== 'growing') { p.userData.state = 'growing'; p.userData.sprouts.visible = true; p.userData.golds.visible = false; }
        p.userData.age = c.age;
      } else {
        p.userData.state = 'wild'; p.userData.age = 0;
        p.userData.sprouts.visible = false; p.userData.golds.visible = false;
      }
    });
    while (fishes.length < Math.min(CFG.FISH_MAX, fishes.length + CFG.FISH_RESPAWN)) spawnFish();
    // 暴风雨吹倒树木(20%概率,留树桩10天后重生)
    if (g.weather === 'stormy' && trees.length > 0 && Math.random() < CFG.STORM_TREE_FALL_CHANCE) {
      const victim = trees[Math.floor(Math.random() * trees.length)];
      queueRegrow('tree', victim);
      // 改为树桩(缩短重生期)
      regrowPending[regrowPending.length - 1].day = g.day + CFG.TREE_STUMP_REGROW;
      fallingTrees.push({ tree: victim, t: 0 });
      removeAt(trees, victim);
      removeAt(interactives, victim);
      releaseSlot(victim);
      ev.push('🌬️ 暴风雨吹倒了一棵树!留下树桩,10天后重新长出。');
    }
    for (let i = regrowPending.length - 1; i >= 0; i--) {
      const r = regrowPending[i];
      if (g.day >= r.day) {
        if (r.kind === 'tree') spawnTree();
        else if (r.kind === 'rock') spawnRock();
        else spawnBush();
        regrowPending.splice(i, 1);
      }
    }
    autoTask = null; moveTarget = null; facingTarget = null;
    cancelAction();
    targetMarker.visible = false; clearSelection();
    syncIslanders(); assignRoles();
    // 月亮淡出,显示天数
    moon.style.transition = 'opacity 0.5s ease-out';
    moon.style.opacity = '0';
    zzz.style.transition = 'opacity 0.3s ease-out';
    zzz.style.opacity = '0';
    dayNum.textContent = '第 ' + g.day + ' 天';
    dayNum.style.transition = 'opacity 0.6s ease-in';
    dayNum.style.opacity = '1';
  }, 1000);

  // ---- 阶段3:日出(2s后) ----
  setTimeout(() => {
    sun.style.transition = 'all 1.2s ease-out';
    sun.style.opacity = '1';
    sun.style.transform = 'translateY(0) scale(1)';
    showWorkerFloaters(); showInterestFloater();
  }, 2000);

  // ---- 阶段4:天亮(3s后) ----
  setTimeout(() => {
    overlay.style.transition = 'opacity 1.2s ease-in-out';
    overlay.style.opacity = '0';
    if (ev.length) flash(ev.join('　') + '　‖　新的一天(第 ' + g.day + ' 天)');
    else flash(`新的一天(第 ${g.day} 天)。`);
    saveWorld();
  }, 3000);

  // ---- 结束(4.5s后) ----
  setTimeout(() => {
    overlay.style.cssText = 'display:none!important;position:fixed!important;inset:0!important;z-index:9999!important;';
    window._sleepAnim = false;
  }, 4500);
}

// ---------- 主循环 ----------
let last = performance.now();
function loop() {
  // dt 钳制:切标签页回来时 dt 可达数秒,会让自动移动单帧跨过抵达判定而反复过冲
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;

  // 移动
  const distFromCenter = Math.hypot(player.pos.x, player.pos.z);
  const wasSwimming = isSwimming;
  isSwimming = distFromCenter > SAND_BORDER;

  // 游泳时速度减半
  const speed = isSwimming ? SWIM_SPEED : 8;
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  let newPos = player.pos.clone();
  if (keys['KeyW']) newPos.addScaledVector(fwd, speed * dt);
  if (keys['KeyS']) newPos.addScaledVector(fwd, -speed * dt);
  if (keys['KeyD']) newPos.addScaledVector(right, speed * dt);
  if (keys['KeyA']) newPos.addScaledVector(right, -speed * dt);
  const movedDx = newPos.x - player.pos.x, movedDz = newPos.z - player.pos.z;
  if (movedDx !== 0 || movedDz !== 0) {
    // 统一碰撞:资源/建筑滑行(自动任务目标可贴近)(Phase 2.1.4)
    const slid = playerSlide(movedDx, movedDz);
    newPos.x = slid.x; newPos.z = slid.z;
  }
  const newDist = Math.hypot(newPos.x, newPos.z);
  // 近海边界限制:不能游出深海(提示只在越过瞬间出一次,不刷屏)
  if (newDist > DEEP_WATER) {
    const clamp = (DEEP_WATER - 0.1) / newDist;
    newPos.x *= clamp; newPos.z *= clamp;
    if (distFromCenter < DEEP_WATER - 0.15) flash('🌊 前方是深海,暗流太急——不能再往前了!');
  }
  // 岛内限制(陆地时贴草地)
  if (!isSwimming && newDist > R - 0.5) {
    const clamp = (R - 0.5) / newDist;
    newPos.x *= clamp; newPos.z *= clamp;
  }
  player.pos.copy(newPos);
  // 游泳时胸口以上露出水面
  player.pos.y = isSwimming ? PLAYER_SWIM_Y : PLAYER_EYE;

  // 点击移动:朝标记目标自动走/游(WASD 随时可接管,重复点击随时改目标)
  let autoDirX = 0, autoDirZ = 0, autoMoving = false;
  // 赶路途中目标没了(被收走/被重生移除):立刻撤销,别走到空地才提示
  if (autoTask && !autoTask.obj.parent) {
    autoTask = null; moveTarget = null;
    targetMarker.visible = false; clearSelection();
    flash('目标不见了,任务取消。');
  }
  if (moveTarget) {
    const dx = moveTarget.x - player.pos.x, dz = moveTarget.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    const arrive = autoTask ? 0.6 : 0.5;   // 采集任务留一点余量,避免贴脸导致反复过冲
    if (dist < arrive) {
      moveTarget = null; targetMarker.visible = false;
      if (autoTask) beginGather();   // 走到资源旁,自动开始采集
    }
    else {
      autoMoving = true;
      autoDirX = dx / dist; autoDirZ = dz / dist;
      const stepX = autoDirX * speed * dt, stepZ = autoDirZ * speed * dt;
      // 自动寻路走统一碰撞滑行(slideStep 内含360° 绕行扫描)
      const slid = playerSlide(stepX, stepZ);
      player.pos.x = slid.x; player.pos.z = slid.z;
      let nd = Math.hypot(player.pos.x, player.pos.z);
      if (nd > DEEP_WATER) { const c = (DEEP_WATER - 0.1) / nd; player.pos.x *= c; player.pos.z *= c; }
      nd = Math.hypot(player.pos.x, player.pos.z);
      if (!isSwimming && nd > R - 0.5) { const c = (R - 0.5) / nd; player.pos.x *= c; player.pos.z *= c; }
    }
  }

  // 首次下水/上岸提示
  if (!wasSwimming && isSwimming) flash('🏊 下水了!游慢一点,靠近鱼按空格捕。');
  else if (wasSwimming && !isSwimming) flash('🏖️ 回到岸上,脚步恢复。');

  const s = Math.min(1, dt * 18);
  player.yaw += (targetYaw - player.yaw) * s;
  player.pitch += (targetPitch - player.pitch) * s;

  if (thirdPerson) {
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    const fwd3 = new THREE.Vector3(-Math.sin(player.yaw) * cp, sp, -Math.cos(player.yaw) * cp);
    camera.position.copy(player.pos).addScaledVector(fwd3, -camDist);
    if (camera.position.y < 1.8) camera.position.y = 1.8;
  } else {
    camera.position.copy(player.pos);
  }
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

  // ---------- 小人动画(三态:待机 / 行走 / 游泳) ----------
  // 1) 实际移动方向 → 小人朝向(WASD 组合方向,最短角平滑转身)
  const mvF = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const mvR = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const keyMoving = mvF !== 0 || mvR !== 0;
  // 手动操作随时接管:清任务、清朝向锁定、清进行中的动作
  if (keyMoving) {
    moveTarget = null; autoTask = null; facingTarget = null;
    targetMarker.visible = false; clearSelection(); cancelAction();
  }
  const moving = (keyMoving || autoMoving) ? 1 : 0;
  moveAmt += (moving - moveAmt) * Math.min(1, dt * 10);       // 待机↔移动幅度平滑
  // 朝向优先级:采集目标 > 移动方向(否则会背对着树挥斧)
  let faceYaw = null;
  if (action && action.target && action.target.parent) {
    faceYaw = Math.atan2(action.target.position.x - player.pos.x, action.target.position.z - player.pos.z);
  } else if (facingTarget && facingTarget.life > 0) {
    facingTarget.life -= dt;   // 即时采集(摘穗/收获)没有持续动作,靠计时维持朝向
    faceYaw = Math.atan2(facingTarget.x - player.pos.x, facingTarget.z - player.pos.z);
  } else if (moving) {
    const dirX = autoMoving ? autoDirX : fwd.x * mvF + right.x * mvR;
    const dirZ = autoMoving ? autoDirZ : fwd.z * mvF + right.z * mvR;
    faceYaw = Math.atan2(dirX, dirZ);
  }
  if (faceYaw !== null) {
    let diff = faceYaw - bodyYaw;
    diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; // 归一到(-π,π]
    bodyYaw += diff * Math.min(1, dt * 12);
  }
  // 2) 姿态过渡:直立↔游泳(平滑,无瞬切)
  poseBlend += ((isSwimming ? 1 : 0) - poseBlend) * Math.min(1, dt * 8);
  // 3) 动作相位:节奏随移动速度(陆速8/泳速4)
  walkPhase += dt * 9 * moveAmt;
  swimPhase += dt * 8 * moveAmt;
  const legSwing = Math.sin(walkPhase) * 0.7;                 // 走路:双脚交替迈步
  const stand = 1 - poseBlend;
  legL.rotation.x = legSwing * stand + Math.sin(swimPhase * 2.4) * 0.45 * poseBlend;           // 打水
  legR.rotation.x = -legSwing * stand + Math.sin(swimPhase * 2.4 + Math.PI) * 0.45 * poseBlend;
  armL.rotation.x = -legSwing * 0.8 * stand + swimPhase * poseBlend;                            // 自由式划水(整圈轮转)
  armR.rotation.x = legSwing * 0.8 * stand + (swimPhase + Math.PI) * poseBlend;                 // 双臂交替
  // 4) 身体变换:直立站在地面 ↔ 水平趴浮水面(MC 游泳姿态),附带浮力起伏
  const bob = Math.sin(now / 500) * 0.05 * poseBlend;
  playerBody.visible = thirdPerson;
  playerBody.position.set(player.pos.x, 1.5 + (0.6 - 1.5) * poseBlend + bob, player.pos.z);
  playerBody.rotation.set(poseBlend * (Math.PI / 2 - 0.15), bodyYaw, 0, 'YXZ');
  // 5) 动作姿态覆盖:砍树/敲石挥臂(工具显隐)+ 种植弯腰
  axe.visible = !!(action && action.type === 'chop');
  hammer.visible = !!(action && action.type === 'mine');
  if (action && (action.type === 'chop' || action.type === 'mine')) {
    const t01 = Math.max(0, Math.min(1, 1 - action.timer / HIT_INT));
    armR.rotation.x = -0.5 - Math.sin(t01 * Math.PI) * 1.8;   // 举高 → 劈下,命中点在 t=1
    armL.rotation.x = -0.3;
  } else if (action && action.type === 'plant') {
    const dur = action.phase === 0 ? 0.8 : 0.7;
    const t01 = Math.max(0, Math.min(1, 1 - action.timer / dur));
    const bend = Math.sin(t01 * Math.PI);
    playerBody.rotation.x += 0.55 * bend * stand;             // 弯腰(仅直立姿态叠加)
    armR.rotation.x = -1.1 * bend;
    armL.rotation.x = -0.9 * bend;
  }

  // 动画:水 / 岛民闲逛 / 移动标记脉动
  water.position.y = 0.45 + Math.sin(now / 1000) * 0.05;
  // 天气视觉效果
  updateWeatherVisuals(dt);
  if (targetMarker.visible) targetMarker.scale.setScalar(1 + Math.sin(now / 200) * 0.12);
  if (selectRing.visible) selectRing.scale.setScalar(1 + Math.sin(now / 180) * 0.1);
  // 岛民更新:散工闲逛 / 帮工走向工作点干活动画 + 产出飘字上飘
  updateVillagers(dt, now);
  updateFloaters(dt);
  // 鱼 AI:巡游 / 边界折返 / 延迟躲避(0.25s 反应,不会敏感到抓不到) / 受惊逃窜
  for (const f of fishes) {
    const u = f.userData;
    const pd = player.pos.distanceTo(f.position);
    if (pd < 4.5 && u.fleeBoost <= 0) {
      u.fleeCharge += dt;
      if (u.fleeCharge > 0.25) {  // 玩家持续靠近才触发,瞬间路过不惊扰
        u.fleeCharge = 0; u.fleeBoost = 0.9;
        u.heading = Math.atan2(f.position.z - player.pos.z, f.position.x - player.pos.x);
      }
    } else u.fleeCharge = Math.max(0, u.fleeCharge - dt * 2);
    u.fleeBoost = Math.max(0, u.fleeBoost - dt);
    u.turnTimer -= dt;
    if (u.turnTimer <= 0 && u.fleeBoost <= 0) { u.turnTimer = 1.5 + Math.random() * 2; u.heading += (Math.random() - 0.5) * 1.6; }
    const fd = Math.hypot(f.position.x, f.position.z);
    if (fd > 19) u.heading = Math.atan2(-f.position.z, -f.position.x) + (Math.random() - 0.5) * 0.6;   // 外圈折返
    else if (fd < 13.6) u.heading = Math.atan2(f.position.z, f.position.x) + (Math.random() - 0.5) * 0.6; // 靠岸折返
    const spd = u.speed * (u.fleeBoost > 0 ? 5 : 1);
    const vx = Math.cos(u.heading) * spd, vz = Math.sin(u.heading) * spd;
    f.position.x += vx * dt; f.position.z += vz * dt;
    f.position.y = u.base + Math.sin(now / 400 + f.id) * 0.08;
    f.rotation.y = -u.heading;  // 模型前向 = 本地 +X
    f.children[1].rotation.y = Math.sin(now / (u.fleeBoost > 0 ? 40 : 130)) * 0.5; // 尾鳍摆动,受惊时加快
  }
  // 树/石受击晃动衰减
  for (const tr of trees) tr.rotation.z *= Math.max(0, 1 - dt * 6);
  for (const rk of rocks) rk.rotation.z *= Math.max(0, 1 - dt * 6);
  // 倒树动画(倒向一侧后消失)
  for (let i = fallingTrees.length - 1; i >= 0; i--) {
    const ft = fallingTrees[i]; ft.t += dt;
    ft.tree.rotation.z = Math.min(Math.PI / 2, ft.t * 2.4);
    if (ft.t > 1.0) { scene.remove(ft.tree); fallingTrees.splice(i, 1); }
  }
  // 火星粒子(抛物线飞溅 + 缩小消失)
  for (const sp of sparks) {
    if (sp.life <= 0) continue;
    sp.life -= dt;
    if (sp.life <= 0) { sp.mesh.visible = false; continue; }
    sp.vel.y -= 9.8 * dt;
    sp.mesh.position.addScaledVector(sp.vel, dt);
    sp.mesh.scale.setScalar(Math.max(0.1, sp.life * 3));
  }
  // 采集动作推进(自动连击;种植两阶段)
  if (action) {
    action.timer -= dt;
    if (action.timer <= 0) {
      if (action.type === 'plant') {
        if (action.phase === 0) { action.phase = 1; action.timer = 0.7; flash('刨好坑,撒下谷种…'); }
        else {
          const r = plantCrop(g);
          if (r.ok) { action.target.userData.state = 'growing'; action.target.userData.age = 0; action.target.userData.sprouts.visible = true; action.target.userData.golds.visible = false; }
          flash(r.msg);
          cancelAction();
        }
      } else {
        performHit();
        if (action) action.timer = HIT_INT;
      }
    }
  }
  // 准星提示
  let tip = '';
  if (isSwimming) {
    let closest = null, minDist = Infinity;
    for (const f of fishes) { const d = player.pos.distanceTo(f.position); if (d < minDist) { minDist = d; closest = f; } }
    if (closest && minDist <= SWIM_FISH_RANGE) {
      const prob = Math.round(catchProb(closest) * 100);
      tip = `空格 捕鱼(成功率 ${prob}%${g.craftingDay ? ',手在编网' : ''})`;
    } else if (minDist < 8) tip = `🐟 距离 ${minDist.toFixed(1)}m,再游近一点`;
    else tip = '🏊 四周没看到鱼,往深处游';
  } else {
    camera.updateMatrixWorld(true);
    const t = targetUnderCrosshair();
    if (action && t === action.target) {
      tip = action.type === 'chop' ? `砍树中 ${action.hits}/${action.need}`
        : action.type === 'mine' ? `敲石中 ${action.hits}/${action.need}`
        : (action.phase === 0 ? '挖土中…' : '播种中…');
    } else if (action) {
      tip = '正忙…(走动可取消)';
    } else if (t) {
      const u = t.userData;
      const base = u.type === 'plot' ? plotLabel(t)
        : u.type === 'fish' ? `捕鱼(成功率 ${Math.round(catchProb(t) * 100)}%${g.craftingDay ? ',手在编网' : ''})`
        : u.type === 'tree' ? '砍树(连砍 3 斧)'
        : u.type === 'rock' ? '采石(连敲 4 锤)'
        : u.label;
      // 鱼要手动游过去抓,生长中的田无事可做 —— 其余资源点左键小人自动前往采集
      const auto = u.type !== 'fish' && !(u.type === 'plot' && u.state === 'growing');
      tip = auto ? `[左键]走过去自动采 · [空格]原地 ${base}`
        : (u.type === 'fish' ? '[空格] ' + base : base);
    }
  }
  $('prompt').textContent = tip;

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 按钮 ----------
$('bBasket').onclick = () => { const r = buildBasket(g); flash(r.msg); updateHUD(); };
$('bFence').onclick = () => { const r = buildFence(g); flash(r.msg); updateHUD(); };
$('bNet').onclick = () => { const r = craftNet(g); flash(r.msg); };
$('bHut').onclick = () => { const r = buildHut(g); if (r.ok) { spawnHut(); syncIslanders(); assignRoles(); } flash(r.msg); };
$('bGranary').onclick = () => {
  const r = buildGranary(g);
  if (r.ok) {
    buildGranaryMesh();
    // 首次钩子(仅一次):粮仓建好当天,老岛民建议你存点鱼
    if (!g.granaryHintShown) { g.granaryHintShown = true; setTimeout(() => flash('👴 一位老岛民走过来:"存点鱼吧,鱼少时存进去最划算——它们会生小崽。"'), 400); }
  }
  flash(r.msg);
};
$('bDock').onclick = () => { const r = buildDock(g); if (r.ok) buildDockMesh(); flash(r.msg); updateHUD(); };
$('bBoat').onclick = () => { const r = buildBoat(g); flash(r.msg); updateHUD(); };
$('bDeepFish').onclick = () => { const r = deepFish(g); flash(r.msg); updateHUD(); };
$('bSail').onclick = () => {
  if (g.weather === 'stormy') { flash('⛈️ 暴风雨天气无法出海!'); return; }
  const foodNeed = (g.pop - 1) * 5;
  if (foodTotal(g) < foodNeed) flash(`⚠️ 食物可能不够帮工消耗(需${foodNeed}份),确认要出海吗?`);
  flash('⛵ 出海了!WASD控制船,探索海面发现新岛屿,Esc返航。');
  enterOcean();
};
$('bWorkbench').onclick = () => { const r = buildWorkbench(g); flash(r.msg); updateHUD(); };
$('bWell').onclick = () => { const r = buildWell(g); flash(r.msg); updateHUD(); };
$('bFurnace').onclick = () => { const r = buildFurnace(g); flash(r.msg); updateHUD(); };
$('bSmelt').onclick = () => { const r = smeltIron(g); flash(r.msg); updateHUD(); };
$('bTrader').onclick = () => { const r = buildTrader(g); flash(r.msg); updateHUD(); };
$('bSteelTools').onclick = () => {
  const tools = ['钢斧', '钢镐', '钢锄'];
  const available = tools.filter(t => !(g.steelTools || {})[t]);
  if (available.length === 0) { flash('⚒️ 所有钢制工具已打造完毕!'); return; }
  const tool = available[0];
  const r = craftSteelTool(g, tool);
  flash(r.msg);
  updateHUD();
};

// 航海动画+快速旅行
function sailToIsland(islandId) {
  if (window._sailAnim) return;
  const data = ISLAND_DATA[islandId];
  if (!data) return;
  window._sailAnim = true;
  const overlay = $('sailOverlay');
  const text = $('sailText');
  overlay.style.display = 'flex';
  overlay.classList.add('active');
  text.textContent = `⛵ 驶向${data.name}...`;
  // 1.5秒后到达
  setTimeout(() => {
    const r = arriveIsland(g, islandId);
    text.textContent = `${data.emoji} ${data.name}到了!`;
    flash(r.msg);
    updateHUD();
    // 2秒后返航
    setTimeout(() => {
      text.textContent = '⛵ 返航中...';
      setTimeout(() => {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
        window._sailAnim = false;
        flash('🏠 回到主岛了。');
      }, 1500);
    }, 2000);
  }, 1500);
}
$('bTravelTropical').onclick = () => sailToIsland('tropical');
$('bTravelVolcano').onclick = () => sailToIsland('volcano');
$('bTravelSnow').onclick = () => sailToIsland('snow');
$('bDay').onclick = () => sleep();
$('bWork').onclick = () => toggleWorkerPanel();
// 鱼仓面板按钮
$('gpDeposit').onclick = granaryDeposit;
$('gpWithdraw').onclick = granaryWithdraw;
$('gpClose').onclick = closeGranaryPanel;
$('granaryInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { granaryDeposit(); e.preventDefault(); }
});
// 视角灵敏度滑块:实时生效 + 本地记忆 + 显示"转一圈需要多少厘米"
{
  const slider = $('sensSlider');
  // 参考鼠标 DPI(可在滑块上切换),用于把 rad/像素 换算成厘米的直观体感
  let dpi = Number(sessionStorage.getItem('island.dpi')) || 1600;
  function fmt() {
    const pxPerCm = dpi / 2.54;
    const px360 = (Math.PI * 2) / LOOK_SENS;   // 转一圈需要的像素数
    $('sensVal').textContent = LOOK_SENS.toFixed(4);
    $('sensCm').textContent = (px360 / pxPerCm).toFixed(1);
    $('sensDpi').textContent = dpi;
  }
  slider.value = String(Math.round(LOOK_SENS * 10000));
  fmt();
  slider.addEventListener('input', () => {
    LOOK_SENS = Number(slider.value) / 10000;
    try { localStorage.setItem('island.lookSens', String(LOOK_SENS)); } catch (err) { /* 存不进就本次有效 */ }
    fmt();
  });
  $('sensDpiBtn').addEventListener('click', () => {
    const presets = [800, 1200, 1600, 2400, 3200];
    dpi = presets[(presets.indexOf(dpi) + 1) % presets.length];
    try { sessionStorage.setItem('island.dpi', String(dpi)); } catch (err) { /* 忽略 */ }
    fmt();
  });
}

// 岛民事务所:雇佣/解约(事件委托)
$('workerPanel').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.hire) { const r = hireVillager(g, b.dataset.hire); flash(r.msg); }
  else if (b.dataset.fire) { const r = dismissVillager(g, b.dataset.fire); flash(r.msg); }
  else if (b.dataset.heal) { const r = useHerb(g, b.dataset.heal); flash(r.msg); }
  else return;
  assignRoles();
  updateHUD();
});

// 开场遮罩
$('startBtn').onclick = () => { $('overlay').classList.add('hidden'); tryLock(); };

// 目标追踪:点击展开科技树
$('goalPanel').onclick = () => {
  const tree = $('goalTree');
  if (!tree) return;
  const isOpen = !tree.classList.contains('hidden');
  if (isOpen) { tree.classList.add('hidden'); return; }
  // 渲染科技树
  let html = '';
  let lastPhase = 0;
  for (const tech of TECH_TREE) {
    const p = tech.progress(g);
    if (tech.phase !== lastPhase) {
      lastPhase = tech.phase;
      html += `<div class="tech-phase">阶段 ${tech.phase}</div>`;
    }
    const cls = p.done ? 'tech-done' : (tech.goal(g) ? 'tech-active' : 'tech-locked');
    const icon = p.done ? '✅' : (tech.goal(g) ? '🔶' : '🔒');
    html += `<div class="tech-node"><span class="tech-name">${icon} ${tech.name}</span><span class="tech-desc">${tech.desc}</span><span class="tech-status ${cls}">${p.text}</span></div>`;
  }
  tree.innerHTML = html;
  tree.classList.remove('hidden');
};

// 加载存档(如果有)或开始新游戏
let loaded = false;
try { loaded = loadGameFromStorage(); } catch (err) { console.error('[存档] 加载失败:', err); localStorage.removeItem('island.save'); }
updateHUD();
if (loaded) {
  $('overlay').classList.add('hidden');
  flash(`📂 存档已恢复(第 ${g.day} 天)。欢迎回来!`);
} else {
  flash('开局一无所有。先摘果丛凑谷穗(空格),播种、砍树、盖棚屋,吸引岛民上岛!');
}
// 只读调试句柄(自动化测试用,不暴露写接口)
// 暴露游戏状态到全局(方便控制台调试)
window.g = g;
window.__dbg = () => ({
  player: { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2) },
  trees: trees.length, rocks: rocks.length, bushes: bushes.length,
  huts: hutMeshes.length, granary: !!granaryMesh, dock: !!dockMesh,
  islanders: islanders.map((v) => ({ r: v.userData.role, s: v.userData.state || 'idle', x: +v.position.x.toFixed(2), z: +v.position.z.toFixed(2) })),
  wood: g.wood, stone: g.stone,
});

// ==================== 触控设备适配 ====================
(function initTouchControls() {
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!isTouchDevice) return;
  document.getElementById('touchControls').style.display = 'block';

  // --- 虚拟摇杆(左下) ---
  const joyArea = document.getElementById('joystickArea');
  const joyKnob = document.getElementById('joystickKnob');
  let joyActive = false, joyTouchId = null;
  const JOY_R = 50; // 摇杆最大偏移半径

  function handleJoyMove(cx, cy) {
    const rect = joyArea.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    let dx = cx - centerX, dy = cy - centerY;
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_R) { dx = dx / dist * JOY_R; dy = dy / dist * JOY_R; }
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // 映射到 WASD 按键状态
    const deadzone = 12;
    keys['KeyW'] = dy < -deadzone;
    keys['KeyS'] = dy > deadzone;
    keys['KeyA'] = dx < -deadzone;
    keys['KeyD'] = dx > deadzone;
  }
  function resetJoy() {
    joyActive = false; joyTouchId = null;
    joyKnob.style.transform = 'translate(-50%, -50%)';
    keys['KeyW'] = keys['KeyS'] = keys['KeyA'] = keys['KeyD'] = false;
  }
  joyArea.addEventListener('touchstart', (e) => {
    e.preventDefault(); joyActive = true;
    joyTouchId = e.changedTouches[0].identifier;
    handleJoyMove(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }, { passive: false });
  joyArea.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) handleJoyMove(t.clientX, t.clientY);
    }
  }, { passive: false });
  joyArea.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) resetJoy();
    }
  });
  joyArea.addEventListener('touchcancel', resetJoy);

  // --- 视角拖动(右半屏) ---
  let camTouchId = null, camLastX = 0, camLastY = 0;
  renderer.domElement.addEventListener('touchstart', (e) => {
    if (joyActive) return;
    for (const t of e.changedTouches) {
      if (t.clientX > innerWidth * 0.3) {
        camTouchId = t.identifier; camLastX = t.clientX; camLastY = t.clientY;
        break;
      }
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === camTouchId) {
        const dx = t.clientX - camLastX, dy = t.clientY - camLastY;
        applyLook(dx * 1.5, dy * 1.5);
        camLastX = t.clientX; camLastY = t.clientY;
        break;
      }
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === camTouchId) { camTouchId = null; break; }
    }
  });

  // --- 触控按钮 ---
  document.getElementById('tbAction').addEventListener('touchstart', (e) => {
    e.preventDefault(); doAction();
  }, { passive: false });
  document.getElementById('tbV').addEventListener('touchstart', (e) => {
    e.preventDefault(); toggleWorkerPanel();
  }, { passive: false });
  document.getElementById('tbC').addEventListener('touchstart', (e) => {
    e.preventDefault(); thirdPerson = !thirdPerson;
    flash(thirdPerson ? '🎥 第三人称' : '🎥 第一人称');
  }, { passive: false });
  document.getElementById('tbT').addEventListener('touchstart', (e) => {
    e.preventDefault(); sleep();
  }, { passive: false });
})();

loop();
