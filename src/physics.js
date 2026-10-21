import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';

export const GLASS_SCALE = 1.4;
export const TRAY_RADIUS = 0.4;
const GLASS_HEIGHT = 0.165 * GLASS_SCALE;
const GLASS_RADIUS = 0.058 * GLASS_SCALE;
const BOWL_PROFILE = [
  [0.004, 0.09],
  [0.006, 0.095],
  [0.032, 0.13],
  [0.058, 0.165],
];

const TRAY_SURFACE = 0.008;
const TRAY_THICKNESS = 0.108;
const RIM_HEIGHT = 0.014;
const RIM_SEGMENTS = 32;

const TIMESTEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 10;
const SOLVER_ITERATIONS = 8;

const TRAY_FRICTION = 0.04;
const FOOT_FRICTION = 0.04;
const GLASS_FRICTION = 0.5;
const GLASS_BOUNCE = 0.05;
const SLIDE_DRAG = 2.5;
const ROCK_DAMPING = 4;
const SPIN_DAMPING = 12;

const STACK_UPRIGHT = 0.9;
const SINK_GUARD_UPRIGHT = 0.85;
const LOST_BELOW_TRAY = 0.06;
const LOST_PAST_EDGE = TRAY_RADIUS + 0.2;

const UP = new THREE.Vector3(0, 1, 0);
const toRapier = (v) => ({ x: v.x, y: v.y, z: v.z });
const toRapierQuat = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const toQuaternion = (r) => new THREE.Quaternion(r.x, r.y, r.z, r.w);
const upOf = (body) => UP.clone().applyQuaternion(toQuaternion(body.rotation()));

export class PhysicsTower {
  static async create(scene, pivot) {
    await RAPIER.init();
    return new PhysicsTower(scene, pivot);
  }

  constructor(scene, pivot) {
    this.scene = scene;
    this.pivot = pivot;
    this.stacks = [];
    this.accumulator = 0;
    this.prevPosition = pivot.position.clone();
    this.prevQuaternion = pivot.quaternion.clone();

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = TIMESTEP;
    this.world.numSolverIterations = SOLVER_ITERATIONS;

    this.createTray();
    this.bowlPoints = this.createBowlPoints();
  }

  createTray() {
    this.trayBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...this.pivot.position.toArray()),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(TRAY_THICKNESS / 2, TRAY_RADIUS)
        .setTranslation(0, TRAY_SURFACE - TRAY_THICKNESS / 2, 0)
        .setFriction(TRAY_FRICTION),
      this.trayBody,
    );

    const rimRadius = TRAY_RADIUS + 0.004;
    const halfLength = ((Math.PI * rimRadius) / RIM_SEGMENTS) * 1.1;
    for (let i = 0; i < RIM_SEGMENTS; i++) {
      const angle = (i / RIM_SEGMENTS) * Math.PI * 2;
      const rotation = new THREE.Quaternion().setFromAxisAngle(UP, -angle);
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.005, RIM_HEIGHT / 2, halfLength)
          .setTranslation(Math.cos(angle) * rimRadius, RIM_HEIGHT / 2, Math.sin(angle) * rimRadius)
          .setRotation(toRapierQuat(rotation)),
        this.trayBody,
      );
    }
  }

  createBowlPoints() {
    const points = [];
    for (const [radius, height] of BOWL_PROFILE) {
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        points.push(
          Math.cos(angle) * radius * GLASS_SCALE,
          height * GLASS_SCALE,
          Math.sin(angle) * radius * GLASS_SCALE,
        );
      }
    }
    return new Float32Array(points);
  }

  addGlassColliders(body, offset) {
    const S = GLASS_SCALE;
    const parts = [
      [RAPIER.ColliderDesc.cylinder(0.005 * S, 0.038 * S), 0.005 * S, 0.16, FOOT_FRICTION],
      [RAPIER.ColliderDesc.cylinder(0.041 * S, 0.004 * S), 0.049 * S, 0.03, GLASS_FRICTION],
      [RAPIER.ColliderDesc.convexHull(this.bowlPoints), 0, 0.12, GLASS_FRICTION],
    ];
    for (const [desc, y, mass, friction] of parts) {
      desc
        .setTranslation(offset.x, offset.y + y, offset.z)
        .setMass(mass)
        .setFriction(friction)
        .setRestitution(GLASS_BOUNCE);
      this.world.createCollider(desc, body);
    }
  }

  drop(mesh, position) {
    this.scene.add(mesh);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAngularDamping(ROCK_DAMPING)
        .setGravityScale(0),
    );
    this.addGlassColliders(body, new THREE.Vector3());
    this.stacks.push({
      body,
      glasses: [{ mesh, offset: new THREE.Vector3() }],
      state: 'falling',
      offsetZ: position.z - this.pivot.position.z,
    });
    this.syncMeshes();
  }

  removeStack(stack) {
    this.world.removeRigidBody(stack.body);
    for (const glass of stack.glasses) glass.mesh.removeFromParent();
  }

  reset() {
    for (const stack of this.stacks) this.removeStack(stack);
    this.stacks = [];
  }

  bodyMatrix(body, target = new THREE.Matrix4()) {
    const t = body.translation();
    return target.compose(new THREE.Vector3(t.x, t.y, t.z), toQuaternion(body.rotation()), new THREE.Vector3(1, 1, 1));
  }

  nextOffset(stack) {
    return stack.glasses.at(-1).offset.clone().addScaledVector(UP, GLASS_HEIGHT);
  }

  tryStack(falling) {
    const foot = falling.body.translation();
    for (const stack of this.landed()) {
      if (upOf(stack.body).y < STACK_UPRIGHT) continue;
      const offset = this.nextOffset(stack);
      const top = offset.clone().applyMatrix4(this.bodyMatrix(stack.body));
      const horizontal = Math.hypot(foot.x - top.x, foot.z - top.z);
      const vertical = foot.y - top.y;
      if (horizontal < GLASS_RADIUS && vertical < 0.02 && vertical > -GLASS_HEIGHT / 2) {
        this.addGlassColliders(stack.body, offset);
        stack.glasses.push({ mesh: falling.glasses[0].mesh, offset });
        this.world.removeRigidBody(falling.body);
        this.stacks.splice(this.stacks.indexOf(falling), 1);
        return true;
      }
    }
    return false;
  }

  landed() {
    return this.stacks.filter((s) => s.state === 'landed');
  }

  get count() {
    return this.landed().reduce((n, s) => n + s.glasses.length, 0);
  }

  localGlassPositions() {
    const positions = [];
    for (const stack of this.landed()) {
      const matrix = this.bodyMatrix(stack.body);
      for (const glass of stack.glasses) {
        positions.push(this.pivot.worldToLocal(glass.offset.clone().applyMatrix4(matrix)));
      }
    }
    return positions;
  }

  height() {
    return this.localGlassPositions().reduce((top, p) => Math.max(top, p.y + GLASS_HEIGHT), 0);
  }

  imbalance() {
    const positions = this.localGlassPositions();
    if (!positions.length) return 0;
    let sum = 0;
    for (const p of positions) {
      const side = THREE.MathUtils.clamp(p.x, -TRAY_RADIUS, TRAY_RADIUS) / TRAY_RADIUS;
      sum += side * (1 + Math.max(p.y, 0) * 0.6);
    }
    return sum / Math.max(positions.length, 6);
  }

  syncMeshes() {
    const matrix = new THREE.Matrix4();
    for (const stack of this.stacks) {
      this.bodyMatrix(stack.body, matrix);
      const rotation = stack.body.rotation();
      for (const glass of stack.glasses) {
        glass.mesh.position.copy(glass.offset).applyMatrix4(matrix);
        glass.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      }
    }
  }

  updateFalling(fallSpeed) {
    const falling = this.stacks.filter((s) => s.state === 'falling');
    for (const stack of falling) {
      if (this.tryStack(stack)) continue;
      const { body } = stack;
      const v = body.linvel();
      if (stack.started && v.y > -fallSpeed * 0.6) {
        stack.state = 'landed';
        body.setGravityScale(1, true);
        body.enableCcd(false);
        body.setLinvel({ x: v.x * 0.3, y: Math.max(v.y, -0.1), z: v.z * 0.3 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }
      stack.started = true;
      const dz = (this.pivot.position.z + stack.offsetZ - body.translation().z) * 5;
      body.setLinvel({ x: 0, y: -fallSpeed, z: dz }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  applySlideDragAndSpinDamping(trayUp) {
    for (const { body } of this.landed()) {
      const v = body.linvel();
      const along = new THREE.Vector3(v.x, v.y, v.z);
      along.addScaledVector(trayUp, -along.dot(trayUp));
      const drag = along.multiplyScalar(-body.mass() * Math.min(SLIDE_DRAG * TIMESTEP, 1));
      body.applyImpulseAtPoint(toRapier(drag), body.translation(), true);

      const axis = upOf(body);
      const w = body.angvel();
      const spin = (w.x * axis.x + w.y * axis.y + w.z * axis.z) * Math.min(SPIN_DAMPING * TIMESTEP, 1);
      body.setAngvel({ x: w.x - axis.x * spin, y: w.y - axis.y * spin, z: w.z - axis.z * spin }, true);
    }
  }

  liftSunkStacks(trayPosition, trayQuaternion) {
    const toTray = new THREE.Matrix4().compose(trayPosition, trayQuaternion, new THREE.Vector3(1, 1, 1));
    const toLocal = toTray.clone().invert();
    const trayUp = UP.clone().applyQuaternion(trayQuaternion);
    const foot = new THREE.Vector3();
    for (const { body } of this.landed()) {
      if (upOf(body).dot(trayUp) < SINK_GUARD_UPRIGHT) continue;
      const t = body.translation();
      foot.set(t.x, t.y, t.z).applyMatrix4(toLocal);
      if (foot.y >= TRAY_SURFACE - 0.001 || Math.hypot(foot.x, foot.z) > TRAY_RADIUS) continue;
      foot.y = TRAY_SURFACE;
      body.setTranslation(toRapier(foot.applyMatrix4(toTray)), true);
      const v = body.linvel();
      const into = v.x * trayUp.x + v.y * trayUp.y + v.z * trayUp.z;
      if (into < 0) {
        body.setLinvel({ x: v.x - trayUp.x * into, y: v.y - trayUp.y * into, z: v.z - trayUp.z * into }, true);
      }
    }
  }

  removeLostStacks(isOffscreen) {
    let lost = 0;
    const centre = new THREE.Vector3();
    this.stacks = this.stacks.filter((stack) => {
      const c = stack.body.worldCom();
      if (stack.state === 'lost') {
        const gone = c.y < -5 || stack.glasses.every((g) => isOffscreen(g.mesh.position));
        if (gone) this.removeStack(stack);
        return !gone;
      }
      this.pivot.worldToLocal(centre.set(c.x, c.y, c.z));
      const below = centre.y < -LOST_BELOW_TRAY;
      const pastEdge = centre.y < 0.3 && Math.hypot(centre.x, centre.z) > LOST_PAST_EDGE;
      if (below || pastEdge) {
        stack.state = 'lost';
        stack.body.setGravityScale(1, true);
        lost += stack.glasses.length;
      }
      return true;
    });
    return lost;
  }

  update(dt, fallSpeed, isOffscreen) {
    let steps = 0;
    this.accumulator += dt;
    while (this.accumulator >= TIMESTEP && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= TIMESTEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps;
      position.lerpVectors(this.prevPosition, this.pivot.position, t);
      quaternion.slerpQuaternions(this.prevQuaternion, this.pivot.quaternion, t);
      this.trayBody.setNextKinematicTranslation(toRapier(position));
      this.trayBody.setNextKinematicRotation(toRapierQuat(quaternion));

      this.updateFalling(fallSpeed);
      this.applySlideDragAndSpinDamping(UP.clone().applyQuaternion(quaternion));
      this.world.step();
      this.liftSunkStacks(position, quaternion);
    }
    this.prevPosition.copy(this.pivot.position);
    this.prevQuaternion.copy(this.pivot.quaternion);

    this.syncMeshes();
    return this.removeLostStacks(isOffscreen);
  }
}
