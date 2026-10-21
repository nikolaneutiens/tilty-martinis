import * as THREE from 'three/webgpu';
import { wgslFn, uniform, uv, vec2, color, mix, smoothstep, texture, colorSpaceToWorking } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PhysicsTower, GLASS_SCALE } from './physics.js';
import { body, isTracking, calibrate, startBodyTracking, changeSensitivity } from './bodypose.js';
import { createHud, itemAt, MENU_ITEMS, OVER_ITEMS, HUD_WIDTH, HUD_HEIGHT } from './hud.js';
import { loadNumber, saveNumber } from './storage.js';

import bubblesShader from './shaders/bubbles/fragment.wgsl?raw';
import cartoonShader from './shaders/cartoon/fragment.wgsl?raw';
import crtShader from './shaders/crt/fragment.wgsl?raw';

const $canvas = document.getElementById('webgl');

const FPS = 30;
const LIVES = 3;
const BEST_KEY = 'tilty-martinis-best';

const RAISE_HAND_TIME = 1;
const CALIBRATE_TIME = 1.5;
const CALIBRATE_LEVEL = THREE.MathUtils.degToRad(6);
const CALIBRATE_STILL = THREE.MathUtils.degToRad(1.5);

const MAX_TILT = THREE.MathUtils.degToRad(30);
const KEY_TILT_SPEED = THREE.MathUtils.degToRad(70);
const KEY_RETURN_SPEED = THREE.MathUtils.degToRad(90);
const STIFFNESS = 45;
const DAMPING = 9;
const IMBALANCE_FORCE = 9;
const HEIGHT_WOBBLE = 20;
const MAX_SOFTNESS = 0.5;
const DRIFT_START = 2.5;
const DRIFT_MAX = 6;

const FALL_SPEED_START = 0.7;
const FALL_SPEED_MAX = 1.6;
const SPAWN_INTERVAL_START = 2.4;
const SPAWN_INTERVAL_MIN = 1.0;
const SPAWN_SPREAD = 0.28;

const MAX_FOV = 80;
const SHAKE_DISTANCE = 0.12;
const SHAKE_ROLL = THREE.MathUtils.degToRad(4);
const MENU_CAMERA = new THREE.Vector3(-0.7, 0.9, -0.3);
const MENU_LOOK_AT = new THREE.Vector3(-2.8, 1.5, -3.1);
const MENU_DRIFT = 0.08;
const FLIGHT_TIME = 3;

const DRINK_BOTTOM = 0.58;
const DRINK_TOP = 0.87;
const BAR_TOP = 1.1;

let renderer, scene, camera, postCamera;
let sceneTarget, filmTarget, filmScene, crtScene;
let pivot, glassTemplate, tower;

const hud = createHud();
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const iTime = uniform(0);
const filmResolution = uniform(new THREE.Vector2(4, 3));
const filmDamage = uniform(0);
const cameraHome = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
const menuPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
const keys = { left: false, right: false };

let state = 'start';
let menuPage = 'main';
let menuSelection = 0;
let overSelection = 0;
let raiseTimer = 0;
let calibrateTimer = 0;
let calibrateAverage = 0;
let calibration = { hint: '', shoulderAngle: 0, steady: false };
let score = 0;
let lives = LIVES;
let best = loadNumber(BEST_KEY, 0);
let droppedThisGame = 0;
let dropJolt = 0;
let leanTarget = 0;
let tilt = 0;
let tiltVelocity = 0;
let spawnTimer = 1;
let bumpTimer = 6;
let baseFov = 45;
let targetFov = 45;
let flight = 0;
let frameTime = 0;

const init = async () => {
  renderer = new THREE.WebGPURenderer({ canvas: $canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(...frameSize(), false);
  await renderer.init();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120a06);

  const loader = new GLTFLoader();
  const [pub, props] = await Promise.all([
    loader.loadAsync(`${import.meta.env.BASE_URL}assets/pub.glb`),
    loader.loadAsync(`${import.meta.env.BASE_URL}assets/props.glb`),
  ]);
  setupPub(pub);
  setupProps(props);
  setupPostProcessing();
  tower = await PhysicsTower.create(scene, pivot);

  updateHud();
  Promise.all([
    document.fonts.load('150px "Mr Dafoe"'),
    document.fonts.load('700 76px "Caveat"'),
    document.fonts.load('500 38px "Caveat"'),
  ]).then(updateHud, updateHud);

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  $canvas.addEventListener('mousemove', onMouseMove);
  $canvas.addEventListener('click', onClick);
  resize();
  renderer.setAnimationLoop(draw);
  startBodyTracking();
};

const setupPub = (gltf) => {
  const bakedTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/baked.jpg`);
  bakedTexture.flipY = false;
  bakedTexture.colorSpace = THREE.SRGBColorSpace;
  const bakedMaterial = new THREE.MeshBasicMaterial({ map: bakedTexture });

  const plainSurfaces = {
    Window_Plane: new THREE.MeshBasicMaterial({ color: 0x10141f }),
    Neon_Sign: new THREE.MeshBasicMaterial({ color: 0x140a0c }),
    Fire_Plane: new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
    TV_Screen: new THREE.MeshBasicMaterial({ color: 0x6f8fb0 }),
  };
  gltf.scene.traverse((child) => {
    if (child.isMesh) child.material = plainSurfaces[child.name] ?? bakedMaterial;
  });
  scene.add(gltf.scene);

  const blenderCamera = gltf.cameras[0];
  camera = new THREE.PerspectiveCamera(blenderCamera.fov, 4 / 3, 0.05, 60);
  blenderCamera.updateWorldMatrix(true, false);
  blenderCamera.matrixWorld.decompose(camera.position, camera.quaternion, new THREE.Vector3());
  baseFov = targetFov = camera.fov;
  cameraHome.position.copy(camera.position);
  cameraHome.quaternion.copy(camera.quaternion);
};

const setupProps = (gltf) => {
  const tray = gltf.scene.getObjectByName('Tray');
  glassTemplate = gltf.scene.getObjectByName('Glass_Martini');
  const liquid = gltf.scene.getObjectByName('Liquid_Martini');

  pivot = new THREE.Group();
  pivot.position.set(tray.position.x, 1.15, camera.position.z - 2.4);
  tray.position.set(0, 0, 0);
  tray.material = new THREE.MeshStandardMaterial({ color: 0xc9c2b8, metalness: 0.35, roughness: 0.35 });
  pivot.add(tray);
  scene.add(pivot);

  const bubbles = wgslFn(bubblesShader);
  liquid.material = createLiquidMaterial(bubbles);
  liquid.position.set(0, 0, 0);
  glassTemplate.material = createGlassMaterial(bubbles);
  glassTemplate.position.set(0, 0, 0);
  glassTemplate.add(liquid, ...createOliveOnPick());
  glassTemplate.scale.setScalar(GLASS_SCALE);
  glassTemplate.removeFromParent();

  addMartiniPyramid();

  scene.add(new THREE.HemisphereLight(0xffd2a0, 0x2a1408, 1.4));
  const lamp = new THREE.DirectionalLight(0xffc98a, 2.5);
  lamp.position.set(-1, 4, 1);
  scene.add(lamp);
};

const createLiquidMaterial = (bubbles) => {
  const resolution = uniform(new THREE.Vector2(1, 1));
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = colorSpaceToWorking(
    bubbles({ fragCoord: uv().mul(resolution), iTime: iTime.mul(3), iResolution: resolution }),
    THREE.SRGBColorSpace,
  );
  return material;
};

const createGlassMaterial = (bubbles) => {
  const glassUv = vec2(uv().x, uv().y.oneMinus());
  const drinkUv = vec2(glassUv.x, glassUv.y.sub(DRINK_BOTTOM).div(DRINK_TOP - DRINK_BOTTOM));
  const resolution = uniform(new THREE.Vector2(4, 1));
  const drink = colorSpaceToWorking(
    bubbles({ fragCoord: drinkUv.mul(0.4).add(0.3).mul(resolution), iTime: iTime.mul(3), iResolution: resolution }),
    THREE.SRGBColorSpace,
  ).rgb;
  const inDrink = smoothstep(DRINK_BOTTOM - 0.01, DRINK_BOTTOM + 0.02, glassUv.y).mul(
    smoothstep(DRINK_TOP + 0.01, DRINK_TOP - 0.01, glassUv.y),
  );
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.25 });
  material.colorNode = mix(color(0xe8f0ec), drink, inDrink);
  material.emissiveNode = drink.mul(inDrink).mul(0.45);
  return material;
};

const createOliveOnPick = () => {
  const olive = new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x6f7d24, roughness: 0.45 }),
  );
  olive.scale.set(1, 1.25, 1);
  olive.position.set(0.012, 0.118, 0);
  const pimento = new THREE.Mesh(
    new THREE.SphereGeometry(0.004, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xb8231c, roughness: 0.5 }),
  );
  pimento.position.set(0, 0.009, 0);
  olive.add(pimento);

  const pickStart = new THREE.Vector3(0, 0.105, 0);
  const pickEnd = new THREE.Vector3(0.055, 0.2, 0);
  const pick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0015, 0.0015, pickStart.distanceTo(pickEnd), 6),
    new THREE.MeshStandardMaterial({ color: 0xd9b37a, roughness: 0.7 }),
  );
  pick.position.lerpVectors(pickStart, pickEnd, 0.5);
  pick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pickEnd.clone().sub(pickStart).normalize());
  return [olive, pick];
};

const addMartiniPyramid = () => {
  const spacing = 0.17;
  const step = 0.165 * GLASS_SCALE;
  [3, 2, 1].forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * spacing;
      const glass = glassTemplate.clone();
      glass.position.set(-2.62 + offset * 0.8, BAR_TOP + row * step, -2.2 - offset * 0.6);
      glass.rotation.y = i * 1.3 + row;
      scene.add(glass);
    }
  });
};

const setupPostProcessing = () => {
  postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fullscreenQuad = (material) => new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);

  sceneTarget = new THREE.RenderTarget(4, 3, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthTexture: new THREE.DepthTexture(4, 3),
  });
  const cartoonFilm = wgslFn(cartoonShader);
  const sceneTexture = texture(sceneTarget.texture);
  const filmMaterial = new THREE.MeshBasicNodeMaterial();
  filmMaterial.colorNode = colorSpaceToWorking(
    cartoonFilm({
      fragCoord: uv().mul(filmResolution),
      iTime,
      iResolution: filmResolution,
      iChannel0: sceneTexture,
      iChannel0Sampler: sceneTexture,
      iChannel1: texture(sceneTarget.depthTexture),
      cameraNear: uniform(camera.near),
      cameraFar: uniform(camera.far),
      damage: filmDamage,
    }),
    THREE.SRGBColorSpace,
  );
  const hudPlane = fullscreenQuad(new THREE.MeshBasicMaterial({ map: hud.texture, transparent: true, depthTest: false }));
  hudPlane.renderOrder = 1;
  filmScene = new THREE.Scene();
  filmScene.add(fullscreenQuad(filmMaterial), hudPlane);

  filmTarget = new THREE.RenderTarget(4, 3, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const crtScreen = wgslFn(crtShader);
  const filmTexture = texture(filmTarget.texture);
  const crtMaterial = new THREE.MeshBasicNodeMaterial();
  crtMaterial.colorNode = crtScreen({
    fragCoord: uv().mul(filmResolution),
    iTime,
    iResolution: filmResolution,
    iChannel0: filmTexture,
    iChannel0Sampler: filmTexture,
  });
  crtScene = new THREE.Scene();
  crtScene.add(fullscreenQuad(crtMaterial));
};

const startGame = () => {
  tower.reset();
  droppedThisGame = 0;
  score = 0;
  lives = LIVES;
  tilt = tiltVelocity = leanTarget = 0;
  spawnTimer = 1 + (1 - flight) * FLIGHT_TIME;
  bumpTimer = 6;
  targetFov = baseFov;
  state = 'playing';
  updateHud();
};

const beginCalibration = () => {
  if (body.status !== 'tracking' && body.status !== 'starting') {
    startGame();
    return;
  }
  state = 'calibrating';
  calibrateTimer = 0;
  calibrateAverage = body.angle;
  updateHud();
};

const calibrationHint = (tracked, level, still) => {
  if (!tracked) return 'step into view of the camera';
  if (!level) return 'level your shoulders';
  if (!still) return 'hold still…';
  return 'perfect, hold it…';
};

const updateCalibration = (dt) => {
  if (body.status === 'error') {
    startGame();
    return;
  }
  calibrateAverage += (body.angle - calibrateAverage) * Math.min(dt * 4, 1);
  const tracked = isTracking();
  const level = Math.abs(body.angle) < CALIBRATE_LEVEL;
  const still = Math.abs(body.angle - calibrateAverage) < CALIBRATE_STILL;
  const ok = tracked && level && still;
  calibrateTimer = ok ? calibrateTimer + dt : Math.max(0, calibrateTimer - dt * 2);

  calibration = { hint: calibrationHint(tracked, level, still), shoulderAngle: tracked ? body.angle : 0, steady: ok };
  updateHud();

  if (calibrateTimer >= CALIBRATE_TIME) {
    calibrate();
    startGame();
  }
};

const gameOver = () => {
  state = 'over';
  overSelection = 0;
  raiseTimer = 0;
  best = Math.max(best, score);
  saveNumber(BEST_KEY, best);
  updateHud();
};

const backToMenu = () => {
  tower.reset();
  score = 0;
  droppedThisGame = 0;
  targetFov = baseFov;
  state = 'start';
  menuPage = 'main';
  updateHud();
};

const updateRaiseHand = (dt) => {
  const raised = isTracking() && body.handRaised;
  const previous = raiseTimer;
  raiseTimer = raised ? raiseTimer + dt : Math.max(0, raiseTimer - dt * 2);
  if (raiseTimer >= RAISE_HAND_TIME) {
    raiseTimer = 0;
    beginCalibration();
    return;
  }
  if (raiseTimer !== previous) {
    overSelection = raiseTimer > 0 ? 0 : overSelection;
    updateHud();
  }
};

const loseLife = () => {
  droppedThisGame++;
  dropJolt = 1.5;
  lives--;
  updateHud();
  if (lives <= 0) gameOver();
};

const hudMode = () => {
  if (state === 'start') return menuPage === 'guide' ? 'guide' : 'menu';
  if (state === 'calibrating') return 'calibrate';
  if (state === 'over') return 'over';
  return 'game';
};

const updateHud = () => {
  hud.draw({
    mode: hudMode(),
    score,
    best,
    lives,
    maxLives: LIVES,
    selection: state === 'over' ? overSelection : menuSelection,
    raiseProgress: Math.min(raiseTimer / RAISE_HAND_TIME, 1),
    calibrateProgress: Math.min(calibrateTimer / CALIBRATE_TIME, 1),
    ...calibration,
  });
};

const activeItems = () => (state === 'over' ? OVER_ITEMS : MENU_ITEMS);

const chooseItem = (index) => {
  const id = activeItems()[index].id;
  if (id === 'play' || id === 'retry') beginCalibration();
  if (id === 'guide') menuPage = 'guide';
  if (id === 'menu') backToMenu();
  updateHud();
};

const moveSelection = (direction) => {
  const count = activeItems().length;
  if (state === 'over') overSelection = (overSelection + direction + count) % count;
  else menuSelection = (menuSelection + direction + count) % count;
  updateHud();
};

const hasMenu = () => (state === 'start' && menuPage === 'main') || state === 'over';

const closeGuide = () => {
  menuPage = 'main';
  updateHud();
};

const onMenuKey = (e) => {
  if (state === 'start' && menuPage === 'guide') {
    if (['Space', 'Enter', 'Escape', 'Backspace'].includes(e.code)) closeGuide();
    return;
  }
  if (e.key === 'ArrowUp') moveSelection(-1);
  if (e.key === 'ArrowDown') moveSelection(1);
  if (e.code === 'Space' || e.code === 'Enter') chooseItem(state === 'over' ? overSelection : menuSelection);
};

const screenToHud = (event) => {
  const rect = $canvas.getBoundingClientRect();
  let x = ((event.clientX - rect.left) / rect.width - 0.5) * 2.2;
  let y = ((event.clientY - rect.top) / rect.height - 0.5) * 2.2;
  x *= 1 + (Math.abs(y) / 3.2) ** 2;
  y *= 1 + (Math.abs(x) / 3.2) ** 2;
  return { x: (x / 2 + 0.5) * HUD_WIDTH, y: (y / 2 + 0.5) * HUD_HEIGHT };
};

const onMouseMove = (event) => {
  if (!hasMenu()) {
    $canvas.style.cursor = '';
    return;
  }
  const { x, y } = screenToHud(event);
  const index = itemAt(activeItems(), x, y);
  $canvas.style.cursor = index >= 0 ? 'pointer' : '';
  const selection = state === 'over' ? overSelection : menuSelection;
  if (index >= 0 && index !== selection) moveSelection(index - selection);
};

const onClick = (event) => {
  if (state === 'start' && menuPage === 'guide') {
    closeGuide();
    return;
  }
  if (!hasMenu()) return;
  const { x, y } = screenToHud(event);
  const index = itemAt(activeItems(), x, y);
  if (index < 0) return;
  $canvas.style.cursor = '';
  chooseItem(index);
};

const onKeyDown = (e) => {
  if (e.key === 'ArrowLeft') keys.left = true;
  if (e.key === 'ArrowRight') keys.right = true;
  if (e.key === '+' || e.key === '=') changeSensitivity(0.1);
  if (e.key === '-') changeSensitivity(-0.1);
  if (e.code === 'Space') e.preventDefault();

  if (state === 'start' || state === 'over') onMenuKey(e);
  else if (e.code === 'Space' && state === 'calibrating') startGame();
};

const onKeyUp = (e) => {
  if (e.key === 'ArrowLeft') keys.left = false;
  if (e.key === 'ArrowRight') keys.right = false;
};

const difficulty = () => Math.min(score / 40, 1);

const updateLean = (dt) => {
  const direction = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  if (direction !== 0) {
    leanTarget += direction * KEY_TILT_SPEED * dt;
  } else if (isTracking()) {
    leanTarget = body.lean;
  } else {
    leanTarget -= Math.sign(leanTarget) * Math.min(Math.abs(leanTarget), KEY_RETURN_SPEED * dt);
  }
  leanTarget = THREE.MathUtils.clamp(leanTarget, -MAX_TILT, MAX_TILT);
};

const drift = (time) => {
  if (state !== 'playing' || tower.count === 0) return 0;
  const wander = Math.sin(time * 0.7) * 0.6 + Math.sin(time * 1.9 + 1.3) * 0.3 + Math.sin(time * 3.1 + 4.0) * 0.1;
  return wander * THREE.MathUtils.lerp(DRIFT_START, DRIFT_MAX, difficulty());
};

const updateBalance = (dt, time) => {
  const softness = Math.min(tower.height() * HEIGHT_WOBBLE, STIFFNESS * MAX_SOFTNESS);
  const stiffness = STIFFNESS - softness;
  const acceleration =
    stiffness * (leanTarget - tilt) - IMBALANCE_FORCE * tower.imbalance() - DAMPING * tiltVelocity + drift(time);
  tiltVelocity += acceleration * dt;
  tilt = THREE.MathUtils.clamp(tilt + tiltVelocity * dt, -MAX_TILT * 1.3, MAX_TILT * 1.3);
  pivot.rotation.z = tilt;

  bumpTimer -= dt;
  if (bumpTimer <= 0 && tower.count > 3) {
    tiltVelocity += (Math.random() < 0.5 ? -1 : 1) * (0.4 + difficulty() * 0.8);
    bumpTimer = THREE.MathUtils.lerp(9, 4, difficulty()) + Math.random() * 3;
  }
};

const isOffscreen = (position) => {
  const p = position.clone().project(camera);
  return p.y < -1.15 || Math.abs(p.x) > 1.15 || p.z > 1;
};

const updateTray = (dt) => {
  const fallSpeed = THREE.MathUtils.lerp(FALL_SPEED_START, FALL_SPEED_MAX, difficulty());
  const lost = tower.update(dt, fallSpeed, isOffscreen);
  if (state !== 'playing') return;
  if (score !== tower.count) {
    score = tower.count;
    updateHud();
  }
  for (let i = 0; i < lost && state === 'playing'; i++) loseLife();
};

const viewYAt = (ndcY, z) => {
  raycaster.setFromCamera(new THREE.Vector2(0, ndcY), camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), hit) ? hit.y : null;
};

const spawnGlass = () => {
  const top = viewYAt(1.05, pivot.position.z) ?? pivot.position.y + 1.5;
  const position = new THREE.Vector3(
    pivot.position.x + (Math.random() * 2 - 1) * SPAWN_SPREAD,
    Math.max(top, pivot.position.y + tower.height() + 0.6),
    pivot.position.z,
  );
  tower.drop(glassTemplate.clone(), position);
};

const updateSpawning = (dt) => {
  spawnTimer -= dt;
  if (spawnTimer > 0) return;
  spawnGlass();
  spawnTimer = THREE.MathUtils.lerp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_MIN, difficulty());
};

const updateCameraFraming = (dt) => {
  const top = new THREE.Vector3(0, tower.height() + 0.3, 0);
  pivot.localToWorld(top).project(camera);
  const caughtUp = Math.abs(targetFov - camera.fov) < 0.5;
  if (state !== 'start' && top.y > 0.55 && caughtUp) targetFov = Math.min(targetFov + 3, MAX_FOV);

  const fov = camera.fov + (targetFov - camera.fov) * Math.min(dt * 2, 1);
  if (Math.abs(fov - camera.fov) > 0.001) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
};

const updateCamera = (dt, time) => {
  const flightTarget = state === 'start' ? 0 : 1;
  flight = THREE.MathUtils.clamp(flight + Math.sign(flightTarget - flight) * (dt / FLIGHT_TIME), 0, 1);

  menuPose.position.copy(MENU_CAMERA);
  menuPose.position.x += Math.sin(time * 0.15) * MENU_DRIFT;
  menuPose.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().lookAt(menuPose.position, MENU_LOOK_AT, camera.up),
  );

  const t = flight * flight * (3 - 2 * flight);
  camera.position.lerpVectors(menuPose.position, cameraHome.position, t);
  camera.quaternion.slerpQuaternions(menuPose.quaternion, cameraHome.quaternion, t);

  const shake = Math.min(dropJolt / 1.5, 1);
  if (shake === 0) return;
  camera.position.x += (Math.random() - 0.5) * 2 * SHAKE_DISTANCE * shake;
  camera.position.y += (Math.random() - 0.5) * 2 * SHAKE_DISTANCE * shake;
  camera.rotateZ((Math.random() - 0.5) * 2 * SHAKE_ROLL * shake);
};

const update = (dt, time) => {
  if (state === 'playing') {
    updateLean(dt);
    updateSpawning(dt);
  } else {
    leanTarget = 0;
  }
  if (state === 'calibrating') updateCalibration(dt);
  if (state === 'over') updateRaiseHand(dt);
  updateBalance(dt, time);
  updateCameraFraming(dt);
  updateTray(dt);

  dropJolt = Math.max(0, dropJolt - dt * 2);
  filmDamage.value = droppedThisGame + dropJolt;
};

const render = () => {
  renderer.setRenderTarget(sceneTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(filmTarget);
  renderer.render(filmScene, postCamera);
  renderer.setRenderTarget(null);
  renderer.render(crtScene, postCamera);
};

const draw = () => {
  frameTime += clock.getDelta();
  if (frameTime < 1 / FPS) return;
  const dt = Math.min(frameTime, 1 / 15);
  frameTime %= 1 / FPS;

  const time = clock.elapsedTime;
  iTime.value = time;
  update(dt, time);
  updateCamera(dt, time);
  if (window.innerWidth > 0 && window.innerHeight > 0) render();
};

const frameSize = () => {
  const width = Math.min(window.innerWidth, (window.innerHeight * 4) / 3);
  return [Math.round(width), Math.round((width * 3) / 4)];
};

const resize = () => {
  const [width, height] = frameSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  const pixels = renderer.getDrawingBufferSize(new THREE.Vector2());
  sceneTarget.setSize(pixels.x, pixels.y);
  filmTarget.setSize(pixels.x, pixels.y);
  filmResolution.value.copy(pixels);
};

init();
