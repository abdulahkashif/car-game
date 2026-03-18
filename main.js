import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';

// ---- UI Elements ----
const uiLoader = document.getElementById('loading');
const uiSelector = document.getElementById('car-selector-container');
const uiHudTop = document.getElementById('hud-top');
const uiHudBottom = document.getElementById('hud-bottom');
const lapTimerEl = document.getElementById('lap-timer');
const speedometerEl = document.getElementById('speedometer');
const nitroFillEl = document.getElementById('nitro-fill');
const buttons = document.querySelectorAll('#car-selector button');

// ---- Game State ----
let gameStarted = false;
let carBody, carMesh, energyShield;
let hoverLights = [];
let nitroAmount = 100;
let isNitro = false;
let startTime = 0;
let modelPath = '';
const clock = new THREE.Clock();

// Variables for Input
const keys = { w: false, a: false, s: false, d: false, shift: false, arrowup: false, arrowdown: false, arrowleft: false, arrowright: false, ' ': false };

// Physics Constants — tuned for stability
const HOVER_HEIGHT = 1.6;
const SPRING_K = 40000.0; // Significant increase to support 800kg mass
const DAMPING_C = 2500.0; // Increase to stabilize the stronger spring
const RAY_LENGTH = 6.0;
const BASE_THRUST = 14000.0; // Increased to overcome drag and be faster
const NITRO_MULTIPLIER = 2.4;
const MAX_SPEED = 120; // m/s cap to prevent runaway velocity

// ---- Three.js Setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.FogExp2(0x050510, 0.003);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 8, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 40;
controls.minDistance = 5;

// ---- Post-Processing ----
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.4, 0.85
);
bloomPass.threshold = 0.6;
bloomPass.strength = 0.8;
bloomPass.radius = 0.4;
composer.addPass(bloomPass);

const rgbShiftPass = new ShaderPass(RGBShiftShader);
rgbShiftPass.uniforms['amount'].value = 0.001;
composer.addPass(rgbShiftPass);

// ---- Cannon-es Setup ----
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -30, 0), // Strong downward gravity
});
world.solver.iterations = 10;
world.solver.tolerance = 0.001;
world.broadphase = new CANNON.SAPBroadphase(world);

const physicsMaterial = new CANNON.Material('standard');
const physicsContactMaterial = new CANNON.ContactMaterial(physicsMaterial, physicsMaterial, {
  friction: 0.3,
  restitution: 0.0,
});
world.addContactMaterial(physicsContactMaterial);

// ---- Environment / Lighting ----
const ambientLight = new THREE.AmbientLight(0x8899bb, 0.6);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x443333, 0.8);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xeeddcc, 2.5);
dirLight.position.set(80, 150, 60);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 500;
dirLight.shadow.camera.left = -150;
dirLight.shadow.camera.right = 150;
dirLight.shadow.camera.top = 150;
dirLight.shadow.camera.bottom = -150;
scene.add(dirLight);

// ---- Build a FLAT Race Track (replaces the broken tube) ----
function buildTrack() {
  // Create a closed race circuit using CatmullRom curve
  const trackCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(80, 0, -30),
    new THREE.Vector3(120, 0, -100),
    new THREE.Vector3(80, 0, -180),
    new THREE.Vector3(0, 0, -220),
    new THREE.Vector3(-80, 0, -180),
    new THREE.Vector3(-120, 0, -100),
    new THREE.Vector3(-80, 0, -30),
  ], true, 'centripetal');

  // Create flat ribbon track from curve
  const trackWidth = 18;
  const segments = 200;
  const points = trackCurve.getPoints(segments);
  const trackVertices = [];
  const trackIndices = [];
  const trackUVs = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t).normalize();
    
    // Get perpendicular direction (right vector on flat plane)
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();

    const left = point.clone().add(right.clone().multiplyScalar(-trackWidth / 2));
    const rightPt = point.clone().add(right.clone().multiplyScalar(trackWidth / 2));

    trackVertices.push(left.x, left.y, left.z);
    trackVertices.push(rightPt.x, rightPt.y, rightPt.z);

    trackUVs.push(0, t * 10);
    trackUVs.push(1, t * 10);

    if (i < segments) {
      const idx = i * 2;
      trackIndices.push(idx, idx + 1, idx + 2);
      trackIndices.push(idx + 1, idx + 3, idx + 2);
    }
  }

  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(trackVertices, 3));
  trackGeo.setAttribute('uv', new THREE.Float32BufferAttribute(trackUVs, 2));
  trackGeo.setIndex(trackIndices);
  trackGeo.computeVertexNormals();

  // Dark asphalt with neon edge glow
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.6,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });
  const trackMesh = new THREE.Mesh(trackGeo, trackMat);
  trackMesh.receiveShadow = true;
  scene.add(trackMesh);

  // Neon edge strips
  for (let side = -1; side <= 1; side += 2) {
    const edgeVertices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = trackCurve.getPointAt(t);
      const tangent = trackCurve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
      const edgePt = point.clone().add(right.clone().multiplyScalar(side * trackWidth / 2));
      edgePt.y += 0.05;
      edgeVertices.push(edgePt);
    }
    const edgeCurve = new THREE.CatmullRomCurve3(edgeVertices, false);
    const tubeGeo = new THREE.TubeGeometry(edgeCurve, segments, 0.15, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: side === -1 ? 0x00f0ff : 0xff00aa,
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    scene.add(tubeMesh);
  }

  // Center line neon strip
  const centerVertices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = trackCurve.getPointAt(t);
    point.y += 0.03;
    centerVertices.push(point);
  }
  const centerCurve = new THREE.CatmullRomCurve3(centerVertices, false);
  const centerGeo = new THREE.TubeGeometry(centerCurve, segments, 0.05, 4, false);
  const centerMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.4 });
  scene.add(new THREE.Mesh(centerGeo, centerMat));

  // Physics ground plane for the track area — simple and stable
  const groundShape = new CANNON.Plane();
  const groundBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
  groundBody.addShape(groundShape);
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // face up
  world.addBody(groundBody);

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 3000; i++) {
    starPos.push(
      (Math.random() - 0.5) * 1500,
      200 + Math.random() * 500,
      (Math.random() - 0.5) * 1500
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.0, sizeAttenuation: true });
  scene.add(new THREE.Points(starGeo, starMat));

  // Ground plane visual (dark ground beneath track)
  const groundGeo = new THREE.PlaneGeometry(600, 600);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0a0a15, roughness: 0.9 });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.05;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

buildTrack();

// ---- Load Environment Models ----
function loadEnvironment() {
  const loader = new GLTFLoader();

  // Load Road
  loader.load('/road_template.glb', (gltf) => {
    const road = gltf.scene;
    road.traverse(child => {
      if (child.isMesh) {
        child.receiveShadow = true;
        child.castShadow = true;
      }
    });
    scene.add(road);
    console.log('Road model loaded.');
  }, undefined, (err) => console.warn('Road model not found, using procedural track.'));

  // Load Trees
  const treeModels = [
    '/realistic_tree.glb',
    '/realistic_trees_pack_of_2_free.glb'
  ];

  treeModels.forEach(path => {
    loader.load(path, (gltf) => {
      for (let i = 0; i < 15; i++) {
        const tree = gltf.scene.clone();
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 150;
        tree.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist - 100);
        tree.rotation.y = Math.random() * Math.PI * 2;
        const s = 1.0 + Math.random() * 2.0;
        tree.scale.set(s, s, s);
        tree.traverse(c => { if (c.isMesh) c.castShadow = true; });
        scene.add(tree);
      }
    }, undefined, () => {});
  });

  // Load Grass
  loader.load('/realistics_grass_06.glb', (gltf) => {
    const grassBase = gltf.scene;
    for (let i = 0; i < 80; i++) {
      const grass = grassBase.clone();
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 100;
      grass.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist - 100);
      const s = 0.8 + Math.random() * 1.5;
      grass.scale.set(s, s, s);
      scene.add(grass);
    }
  }, undefined, () => {});
}

loadEnvironment();

// ---- Car / Hover System Initialization ----
function initCar(glbPath) {
  const correctedPath = glbPath.startsWith('/') ? glbPath : '/' + glbPath;

  carBody = new CANNON.Body({
    mass: 800,
    material: physicsMaterial,
    linearDamping: 0.3,
    angularDamping: 0.7,
    position: new CANNON.Vec3(0, 4, 0), // Spawn higher
  });

  const chassisShape = new CANNON.Box(new CANNON.Vec3(1.2, 0.4, 2.2));
  carBody.addShape(chassisShape);
  world.addBody(carBody);

  carMesh = new THREE.Group();
  scene.add(carMesh);

  // Energy Shield (Fresnel)
  const shieldGeo = new THREE.SphereGeometry(3.2, 32, 32);
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: {
      color1: { value: new THREE.Color(0x00f0ff) },
      color2: { value: new THREE.Color(0xb000ff) },
      fresnelBias: { value: 0.1 },
      fresnelScale: { value: 1.0 },
      fresnelPower: { value: 2.5 },
    },
    vertexShader: `
      varying vec3 vPositionW;
      varying vec3 vNormalW;
      void main() {
        vPositionW = vec3(modelMatrix * vec4(position, 1.0));
        vNormalW = normalize(vec3(modelMatrix * vec4(normal, 0.0)));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPositionW;
      varying vec3 vNormalW;
      uniform vec3 color1;
      uniform vec3 color2;
      uniform float fresnelBias;
      uniform float fresnelScale;
      uniform float fresnelPower;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPositionW);
        float fresnel = fresnelBias + fresnelScale * pow(1.0 - max(dot(viewDir, vNormalW), 0.0), fresnelPower);
        gl_FragColor = vec4(mix(color1, color2, fresnel), fresnel * 0.25);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  energyShield = new THREE.Mesh(shieldGeo, shieldMat);
  carMesh.add(energyShield);

  // Underglow lights
  hoverLights = [];
  for (let i = 0; i < 4; ++i) {
    const plight = new THREE.PointLight(0x00f0ff, 3.0, 12);
    carMesh.add(plight);
    hoverLights.push(plight);
  }
  hoverLights[0].position.set(1.5, -0.5, -2.0);
  hoverLights[1].position.set(-1.5, -0.5, -2.0);
  hoverLights[2].position.set(1.5, -0.5, 2.0);
  hoverLights[3].position.set(-1.5, -0.5, 2.0);

  // Headlight
  const headlight = new THREE.SpotLight(0xffffff, 5.0, 60, Math.PI / 5, 0.5);
  headlight.position.set(0, 0.3, -2.5);
  headlight.target.position.set(0, -0.5, -15);
  carMesh.add(headlight);
  carMesh.add(headlight.target);

  // Load GLB Model
  const loader = new GLTFLoader();
  console.log('Loading car:', correctedPath);

  loader.load(
    correctedPath,
    (gltf) => {
      uiLoader.style.display = 'none';
      const model = gltf.scene;

      // Center and scale
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 4.5 / maxDim;
      model.scale.set(scale, scale, scale);

      // Recalculate center after scaling
      const scaledBox = new THREE.Box3().setFromObject(model);
      const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
      model.position.sub(scaledCenter);

      // Hide wheels, improve materials
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          const name = child.name.toLowerCase();
          if (name.includes('wheel') || name.includes('tire') || name.includes('rim')) {
            child.visible = false;
          }
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => {
              mat.envMapIntensity = 1.5;
              if (mat.color) {
                mat.roughness = Math.min(mat.roughness, 0.3);
                mat.metalness = Math.max(mat.metalness, 0.6);
              }
            });
          }
        }
      });

      carMesh.add(model);
      startGame();
    },
    undefined,
    (error) => {
      console.warn('Model not found, using fallback.');
      uiLoader.style.display = 'none';
      const geo = new THREE.BoxGeometry(2.4, 0.8, 4.4);
      const mat = new THREE.MeshStandardMaterial({ color: 0x222244, roughness: 0.1, metalness: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      carMesh.add(mesh);
      startGame();
    }
  );
}

// ---- Hover Physics Logic ----
const hoverPoints = [
  new CANNON.Vec3(1.0, -0.4, -1.8),
  new CANNON.Vec3(-1.0, -0.4, -1.8),
  new CANNON.Vec3(1.0, -0.4, 1.8),
  new CANNON.Vec3(-1.0, -0.4, 1.8),
];

const raycastResult = new CANNON.RaycastResult();

function updatePhysics(dt) {
  if (!carBody) return;

  // Clamp dt to prevent physics explosions
  const safeDt = Math.min(dt, 0.033); // cap at ~30fps minimum

  let averageNormal = new CANNON.Vec3(0, 0, 0);
  let hitCount = 0;

  const localDown = new CANNON.Vec3(0, -1, 0);
  const worldDown = carBody.vectorToWorldFrame(localDown);

  for (let i = 0; i < hoverPoints.length; i++) {
    const worldPoint = carBody.pointToWorldFrame(hoverPoints[i]);
    const rayEnd = worldPoint.vadd(worldDown.scale(RAY_LENGTH));

    const hit = world.raycastClosest(worldPoint, rayEnd, {
      skipBackfaces: false,
      collisionFilterMask: -1,
    }, raycastResult);

    if (hit) {
      hitCount++;
      averageNormal.vadd(raycastResult.hitNormalWorld, averageNormal);

      const hitDist = raycastResult.distance;
      const relativePos = worldPoint.vsub(carBody.position);
      const pointVel = carBody.velocity.vadd(carBody.angularVelocity.cross(relativePos));
      const velAlongRay = pointVel.dot(worldDown);

      // Spring-damper: F = kx - cv
      const x = HOVER_HEIGHT - hitDist;
      let forceMag = x * SPRING_K - velAlongRay * DAMPING_C;

      // Clamp force to prevent explosions
      forceMag = Math.max(0, Math.min(forceMag, 50000));

      if (forceMag > 0) {
        const forceVec = worldDown.scale(-forceMag);
        carBody.applyForce(forceVec, worldPoint);
      }
    }
  }

  // Orientation alignment to track normal
  if (hitCount > 0) {
    averageNormal.normalize();
    // Gentle gravity towards surface
    const gravityForce = averageNormal.scale(-15.0 * carBody.mass);
    carBody.applyForce(gravityForce, carBody.position);
  }

  // Movement
  const localForward = new CANNON.Vec3(0, 0, -1);
  const worldForward = carBody.vectorToWorldFrame(localForward);
  const localRight = new CANNON.Vec3(1, 0, 0);
  const worldRight = carBody.vectorToWorldFrame(localRight);
  const localUp = new CANNON.Vec3(0, 1, 0);
  const worldUp = carBody.vectorToWorldFrame(localUp);

  let currentThrust = 0;

  const moveUp = keys.w || keys.arrowup;
  const moveDown = keys.s || keys.arrowdown;
  const moveLeft = keys.a || keys.arrowleft;
  const moveRight = keys.d || keys.arrowright;

  if (moveUp) {
    currentThrust = BASE_THRUST;
    const useNitro = keys.shift || keys[' '];
    if (useNitro && nitroAmount > 0) {
      currentThrust *= NITRO_MULTIPLIER;
      nitroAmount -= safeDt * 30;
      isNitro = true;
    } else {
      isNitro = false;
      if (!useNitro && nitroAmount < 100) nitroAmount += safeDt * 6;
    }
  } else {
    isNitro = false;
    if (nitroAmount < 100) nitroAmount += safeDt * 8;
  }

  if (moveDown) {
    currentThrust = -BASE_THRUST * 0.5;
  }

  // Only apply thrust when near ground
  if (currentThrust !== 0 && hitCount > 0) {
    carBody.applyForce(worldForward.scale(currentThrust), carBody.position);
  }

  // Steering
  const steeringForce = 4500;
  if (moveLeft) {
    carBody.applyTorque(worldUp.scale(steeringForce));
    carBody.applyTorque(worldForward.scale(1200)); // bank
  }
  if (moveRight) {
    carBody.applyTorque(worldUp.scale(-steeringForce));
    carBody.applyTorque(worldForward.scale(-1200)); // bank
  }

  // Lateral friction (grip)
  const vel = carBody.velocity;
  const lateralSpeed = vel.dot(worldRight);
  const lateralDrag = worldRight.scale(-lateralSpeed * carBody.mass * 3);
  carBody.applyForce(lateralDrag, carBody.position);

  // Speed cap to prevent runaway
  const speed = vel.length();
  if (speed > MAX_SPEED) {
    const factor = MAX_SPEED / speed;
    carBody.velocity.scale(factor, carBody.velocity);
  }

  // Clamp position to prevent falling into void
  if (carBody.position.y < -10) {
    carBody.position.set(0, 5, 0);
    carBody.velocity.set(0, 0, 0);
    carBody.angularVelocity.set(0, 0, 0);
  }

  world.step(1 / 60, safeDt, 3);
}

// ---- Game Loop ----
function startGame() {
  uiHudTop.style.display = 'block';
  uiHudBottom.style.display = 'block';
  gameStarted = true;
  startTime = clock.getElapsedTime();
}

function syncCar() {
  if (carBody && carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }
}

// Camera Follow
const cameraOffset = new THREE.Vector3(0, 4, 12);
function updateCamera() {
  if (!carBody) return;

  const bodyPos = new THREE.Vector3().copy(carBody.position);
  const bodyQuat = new THREE.Quaternion().copy(carBody.quaternion);

  const idealOffset = cameraOffset.clone().applyQuaternion(bodyQuat);
  const targetCamPos = bodyPos.clone().add(idealOffset);

  camera.position.lerp(targetCamPos, 0.08);

  // Camera up follows car orientation (for loops later)
  const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQuat);
  camera.up.lerp(bodyUp, 0.1);

  // Look ahead of the car
  const forwardOffset = new THREE.Vector3(0, 1, -8).applyQuaternion(bodyQuat);
  const lookAtPos = bodyPos.clone().add(forwardOffset);
  camera.lookAt(lookAtPos);

  controls.target.copy(bodyPos);
}

// UI Update
function updateUI() {
  if (!carBody) return;

  const speed = carBody.velocity.length();
  const kmh = Math.floor(speed * 3.6);
  speedometerEl.innerHTML = `${kmh}<span class="unit"> KM/H</span>`;

  nitroFillEl.style.transform = `scaleX(${Math.max(0, nitroAmount / 100)})`;

  if (isNitro) {
    rgbShiftPass.uniforms['amount'].value = 0.004;
    bloomPass.strength = 1.8;
    hoverLights.forEach(l => l.color.setHex(0xb000ff));
    if (energyShield) energyShield.material.uniforms.color1.value.setHex(0xb000ff);
    camera.fov = THREE.MathUtils.lerp(camera.fov, 95, 0.08);
  } else {
    const speedFactor = Math.min(speed / MAX_SPEED, 1.0);
    rgbShiftPass.uniforms['amount'].value = 0.0008 + speedFactor * 0.0015;
    bloomPass.strength = 0.8 + speedFactor * 0.4;
    hoverLights.forEach(l => l.color.setHex(0x00f0ff));
    if (energyShield) energyShield.material.uniforms.color1.value.setHex(0x00f0ff);
    camera.fov = THREE.MathUtils.lerp(camera.fov, 75, 0.08);
  }
  camera.updateProjectionMatrix();

  // Lap timer
  const elapsed = clock.getElapsedTime() - startTime;
  const mins = Math.floor(elapsed / 60);
  const secs = (elapsed % 60).toFixed(2);
  lapTimerEl.innerHTML = `Lap: ${mins.toString().padStart(2, '0')}:${secs.padStart(5, '0')}`;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (gameStarted) {
    updatePhysics(dt);
    syncCar();
    updateCamera();
    updateUI();
  } else {
    controls.update();
  }

  composer.render();
}
animate();

// ---- Event Listeners ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (keys.hasOwnProperty(k)) {
    keys[k] = true;
  } else if (k === 'arrowup') {
    keys.arrowup = true;
  } else if (k === 'arrowdown') {
    keys.arrowdown = true;
  } else if (k === 'arrowleft') {
    keys.arrowleft = true;
  } else if (k === 'arrowright') {
    keys.arrowright = true;
  }
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (keys.hasOwnProperty(k)) {
    keys[k] = false;
  } else if (k === 'arrowup') {
    keys.arrowup = false;
  } else if (k === 'arrowdown') {
    keys.arrowdown = false;
  } else if (k === 'arrowleft') {
    keys.arrowleft = false;
  } else if (k === 'arrowright') {
    keys.arrowright = false;
  }
});

// UI Selector
buttons.forEach(btn => {
  btn.addEventListener('click', () => {
    modelPath = btn.getAttribute('data-model');
    uiSelector.style.display = 'none';
    uiLoader.style.display = 'block';
    setTimeout(() => {
      initCar(modelPath);
    }, 100);
  });
});

uiSelector.style.display = 'block';
