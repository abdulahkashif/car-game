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
const keys = { w:false, a:false, s:false, d:false, shift:false };

// Physics Constants
const HOVER_HEIGHT = 1.8;
const SPRING_K = 30000.0;
const DAMPING_C = 2000.0;
const RAY_LENGTH = 6.0;
const BASE_THRUST = 10000.0;
const NITRO_MULTIPLIER = 2.5;

// ---- Three.js Setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020205);
scene.fog = new THREE.FogExp2(0x020205, 0.002);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
// Default camera pos behind start line
camera.position.set(0, 10, 20);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 30;
controls.minDistance = 5;

// ---- Post-Processing ----
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.5;
bloomPass.strength = 1.2; // Neon glow
bloomPass.radius = 0.5;
composer.addPass(bloomPass);

const rgbShiftPass = new ShaderPass(RGBShiftShader);
rgbShiftPass.uniforms['amount'].value = 0.0015;
composer.addPass(rgbShiftPass);

// ---- Cannon-es Setup ----
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, 0, 0), // Base gravity is 0, we apply artificial gravity towards track
});
// Solver settings for stability
world.solver.iterations = 20;
world.solver.tolerance = 0.001;

// Materials
const physicsMaterial = new CANNON.Material("standard");
const physicsContactMaterial = new CANNON.ContactMaterial(physicsMaterial, physicsMaterial, {
  friction: 0.1,
  restitution: 0.0,
});
world.addContactMaterial(physicsContactMaterial);

// ---- Environment / Lighting ----
const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x443333, 1.0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xaaccff, 2.0);
dirLight.position.set(100, 200, 50);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 1000;
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
scene.add(dirLight);

// ---- Environment / Lighting ----
async function loadEnvironment() {
  const loader = new GLTFLoader();

  // 1. Load Road / Track
  loader.load('./road_template.glb', (gltf) => {
    const road = gltf.scene;
    road.updateMatrixWorld(true);
    road.traverse(child => {
      if (child.isMesh) {
        child.receiveShadow = true;
        child.castShadow = true;
        
        // Physics Trimesh for road
        let vertices = child.geometry.attributes.position.array;
        let indices = child.geometry.index ? child.geometry.index.array : null;

        if (vertices) {
          // If no indices, create them for a non-indexed geometry
          if (!indices) {
            indices = new Uint32Array(vertices.length / 3);
            for (let i = 0; i < indices.length; i++) indices[i] = i;
          }

          // Handle Mesh Scaling
          const worldScale = new THREE.Vector3();
          child.getWorldScale(worldScale);
          if (worldScale.x !== 1 || worldScale.y !== 1 || worldScale.z !== 1) {
            const scaledVertices = new Float32Array(vertices.length);
            for(let i=0; i<vertices.length; i+=3) {
              scaledVertices[i] = vertices[i] * worldScale.x;
              scaledVertices[i+1] = vertices[i+1] * worldScale.y;
              scaledVertices[i+2] = vertices[i+2] * worldScale.z;
            }
            vertices = scaledVertices;
          }

          const trimeshShape = new CANNON.Trimesh(vertices, indices);
          const roadBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
          roadBody.addShape(trimeshShape);
          // Sync position/rotation from visual to physics
          const worldPos = new THREE.Vector3();
          const worldQuat = new THREE.Quaternion();
          child.getWorldPosition(worldPos);
          child.getWorldQuaternion(worldQuat);
          roadBody.position.copy(worldPos);
          roadBody.quaternion.copy(worldQuat);
          world.addBody(roadBody);
        }
      }
    });
    scene.add(road);
    console.log("Road loaded.");
  });

  // 2. Load and Scatter Trees
  const treeModels = [
    './more_realistic_trees_free.glb',
    './realistic_tree.glb',
    './realistic_trees_pack_of_2_free.glb'
  ];

  treeModels.forEach(path => {
    loader.load(path, (gltf) => {
      for(let i=0; i<15; i++) {
        const tree = gltf.scene.clone();
        const angle = Math.random() * Math.PI * 2;
        const dist = 50 + Math.random() * 200;
        tree.position.set(Math.cos(angle)*dist, 0, Math.sin(angle)*dist);
        tree.rotation.y = Math.random() * Math.PI;
        const s = 1 + Math.random() * 2; // Scale trees appropriately
        tree.scale.set(s, s, s);
        scene.add(tree);
      }
    });
  });

  // 3. Load and Scatter Grass
  loader.load('./realistics_grass_06.glb', (gltf) => {
    const grassBase = gltf.scene;
    for(let i=0; i<100; i++) {
      const grass = grassBase.clone();
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 100;
      grass.position.set(Math.cos(angle)*dist, 0, Math.sin(angle)*dist);
      const s = 1 + Math.random() * 1.5;
      grass.scale.set(s, s, s);
      scene.add(grass);
    }
  });
}

// Keep the procedural track as a visual element
function buildTrack() {
  const curvePoints = [];
  const segments = 100;
  for(let i=0; i<=segments; i++) {
    const t = i / segments;
    const a = t * Math.PI * 2 * 3;
    const x = Math.sin(a) * 400;
    const z = Math.cos(a) * 400 - 400;
    let y = Math.sin(t * Math.PI * 4) * 100;
    if (t > 0.4 && t < 0.6) {
      const loopT = (t - 0.4) * 5;
      const loopAng = loopT * Math.PI * 2;
      y += Math.sin(loopAng) * 150;
    }
    curvePoints.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal');
  const tubeGeo = new THREE.TubeGeometry(curve, 300, 60, 24, true);
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x445566,
    roughness: 0.5,
    metalness: 0.9,
    side: THREE.DoubleSide,
  });
  const trackMesh = new THREE.Mesh(tubeGeo, trackMat);
  scene.add(trackMesh);

  // Add Stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for(let i=0; i<5000; i++) {
    starPos.push((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, (Math.random()-0.5)*2000);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: true });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  const vertices = tubeGeo.attributes.position.array;
  const indices = tubeGeo.index.array;
  const trimeshShape = new CANNON.Trimesh(vertices, indices);
  const trackBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
  trackBody.addShape(trimeshShape);
  world.addBody(trackBody);
}

buildTrack();
loadEnvironment();

// ---- Car / Hover System Initialization ----
function initCar(glbPath) {
  // Car Physics Body
  carBody = new CANNON.Body({
    mass: 1200, // kg
    material: physicsMaterial,
    linearDamping: 0.5,
    angularDamping: 0.8,
    position: new CANNON.Vec3(0, 10, -10)
  });
  
  // Main chassis shape
  const chassisShape = new CANNON.Box(new CANNON.Vec3(1.2, 0.5, 2.5)); // W, H, L over 2
  carBody.addShape(chassisShape);
  world.addBody(carBody);

  // Visual Car wrapper
  carMesh = new THREE.Group();
  scene.add(carMesh);

  // Energy Shield Shader (Fresnel)
  const shieldGeo = new THREE.SphereGeometry(3.5, 32, 32);
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: {
      color1: { value: new THREE.Color(0x00f0ff) },
      color2: { value: new THREE.Color(0xb000ff) },
      fresnelBias: { value: 0.1 },
      fresnelScale: { value: 1.0 },
      fresnelPower: { value: 2.0 },
      cameraPosition: { value: camera.position } // Auto updated by threejs actually, but we pass if needed
    },
    vertexShader: `
      varying vec3 vPositionW;
      varying vec3 vNormalW;
      void main() {
        vPositionW = vec3( modelMatrix * vec4( position, 1.0 ) );
        vNormalW = normalize( vec3( modelMatrix * vec4( normal, 0.0 ) ) );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
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
        vec3 viewDirectionW = normalize(cameraPosition - vPositionW);
        // Fresnel
        float fresnelTerm = fresnelBias + fresnelScale * pow(1.0 - max(dot(viewDirectionW, vNormalW), 0.0), fresnelPower);
        gl_FragColor = vec4(mix(color1, color2, fresnelTerm), fresnelTerm * 0.5);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  energyShield = new THREE.Mesh(shieldGeo, shieldMat);
  carMesh.add(energyShield);

  // Underglow lights
  for(let i=0; i<4; ++i) {
    const plight = new THREE.PointLight(0x00f0ff, 5.0, 20);
    carMesh.add(plight);
    hoverLights.push(plight);
  }
  // Headlight
  const headlight = new THREE.SpotLight(0xffffff, 10.0, 100, Math.PI/4, 0.5);
  headlight.position.set(0, 0, -2);
  headlight.target.position.set(0, 0, -10);
  carMesh.add(headlight);
  carMesh.add(headlight.target);
  hoverLights[0].position.set( 1.5, -0.5, -2.0);
  hoverLights[1].position.set(-1.5, -0.5, -2.0);
  hoverLights[2].position.set( 1.5, -0.5,  2.0);
  hoverLights[3].position.set(-1.5, -0.5,  2.0);

  // Load GLB Model
  const loader = new GLTFLoader();
  console.log("Attempting to load:", glbPath);
  
  // Since we don't have the explicit models, providing a fallback box if load fails
  loader.load(
    glbPath,
    (gltf) => {
      uiLoader.style.display = 'none';
      const model = gltf.scene;
      
      // Center and scale
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      
      // Scale to roughly 5 units long
      const scale = 5.0 / size.z;
      model.scale.set(scale, scale, scale);
      
      // Offset so center is 0,0,0
      model.position.sub(center.multiplyScalar(scale));

      // Hide wheels and add real-time reflections
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.name.toLowerCase().includes('wheel') || child.name.toLowerCase().includes('tire')) {
            child.visible = false;
          }
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
              mat.envMapIntensity = 2.0;
              // Improve paint look
              if (mat.color) {
                mat.roughness = Math.min(mat.roughness, 0.2);
                mat.metalness = Math.max(mat.metalness, 0.7);
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
      // Fallback if model doesn't exist locally
      console.warn("Model not found. Using Fallback Cyber-Box.");
      uiLoader.style.display = 'none';
      
      const fallbackGeo = new THREE.BoxGeometry(2.4, 1.0, 5.0);
      const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.1, metalness: 0.9 });
      const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
      fallbackMesh.position.y = 0.5; // Offset 
      fallbackMesh.castShadow = true;
      carMesh.add(fallbackMesh);
      
      startGame();
    }
  );
}

// ---- Hover Physics Logic ----
const hoverPoints = [
  new CANNON.Vec3( 1.2, -0.5, -2.0), // Front Right
  new CANNON.Vec3(-1.2, -0.5, -2.0), // Front Left
  new CANNON.Vec3( 1.2, -0.5,  2.0), // Back Right
  new CANNON.Vec3(-1.2, -0.5,  2.0)  // Back Left
];

const raycastResult = new CANNON.RaycastResult();

function updatePhysics(dt) {
  if (!carBody) return;

  let averageNormal = new CANNON.Vec3(0,0,0);
  let hitCount = 0;

  // Track the minimum distance to track to apply artificial gravity
  let minTrackDist = 999;

  // Local down of the car
  const localDown = new CANNON.Vec3(0, -1, 0);
  const worldDown = carBody.vectorToWorldFrame(localDown);

  for (let i = 0; i < hoverPoints.length; i++) {
    const localPoint = hoverPoints[i];
    const worldPoint = carBody.pointToWorldFrame(localPoint);
    
    // Cast ray further than hover height
    const rayEnd = worldPoint.vadd(worldDown.scale(RAY_LENGTH));
    
    const hit = world.raycastClosest(worldPoint, rayEnd, {
      skipBackfaces: false
    }, raycastResult);

    if (hit) {
      hitCount++;
      averageNormal.vadd(raycastResult.hitNormalWorld, averageNormal);

      const hitDist = raycastResult.distance;
      if (hitDist < minTrackDist) minTrackDist = hitDist;
      
      // Compute velocity of this specific point
      const relativePos = worldPoint.vsub(carBody.position);
      const pointVel = carBody.velocity.vadd(carBody.angularVelocity.cross(relativePos));
      
      // Velocity purely along the ray direction (+ means moving towards track)
      const velAlongRay = pointVel.dot(worldDown);
      
      // F = kx - cv
      const x = HOVER_HEIGHT - hitDist;
      let forceMag = x * SPRING_K - velAlongRay * DAMPING_C;
      
      if (forceMag > 0) {
        // Apply force up (opposite to down)
        const forceVec = worldDown.scale(-forceMag);
        carBody.applyForce(forceVec, worldPoint);
      }
    }
  }

  // Handle Gravity and Orientation
  if (hitCount > 0) {
    averageNormal.normalize();
    // Gravity pulls into the track normal uniformly
    const gravityForce = averageNormal.scale(-20.0 * carBody.mass); // Slightly stronger gravity for loops
    carBody.applyForce(gravityForce, carBody.position);
  } else {
    // Standard down gravity if completely off track
    carBody.applyForce(new CANNON.Vec3(0, -9.81 * carBody.mass, 0), carBody.position);
  }

  // Movement & Steering Input
  // Forward axis in THREE/Cannon is usually -Z
  const localForward = new CANNON.Vec3(0, 0, -1);
  const worldForward = carBody.vectorToWorldFrame(localForward);
  
  const localRight = new CANNON.Vec3(1, 0, 0);
  const worldRight = carBody.vectorToWorldFrame(localRight);
  
  const localUp = new CANNON.Vec3(0, 1, 0);
  const worldUp = carBody.vectorToWorldFrame(localUp);

  let currentThrust = 0;
  
  if (keys.w) {
    currentThrust = BASE_THRUST;
    if (keys.shift && nitroAmount > 0) {
      currentThrust *= NITRO_MULTIPLIER;
      nitroAmount -= dt * 20; // Deplete nitro
      isNitro = true;
    } else {
      isNitro = false;
      if (!keys.shift && nitroAmount < 100) nitroAmount += dt * 5; // slow recharge
    }
  } else {
    isNitro = false;
    if (nitroAmount < 100) nitroAmount += dt * 10;
  }
  
  if (keys.s) {
    // Air brake
    currentThrust = -BASE_THRUST * 0.5;
  }

  if (currentThrust !== 0) {
    const forcePos = carBody.position;
    // Apply at slightly lower point to prevent pitch up
    const offset = worldUp.scale(-0.5);
    carBody.applyForce(worldForward.scale(currentThrust), forcePos.vadd(offset));
  }

  // Steering & Bank Turning
  if (keys.a) {
    // Yaw
    const torque = worldUp.scale(15000);
    carBody.applyTorque(torque);
    // Bank Roll
    carBody.applyTorque(worldForward.scale(5000));
  }
  if (keys.d) {
    const torque = worldUp.scale(-15000);
    carBody.applyTorque(torque);
    carBody.applyTorque(worldForward.scale(-5000));
  }

  // Artificial Grip / Lateral Friction
  const vel = carBody.velocity;
  const lateralVel = worldRight.scale(vel.dot(worldRight));
  carBody.applyForce(lateralVel.scale(-carBody.mass * 5), carBody.position);

  world.step(1/60, dt, 3);
}

// ---- Main Game Loop ----
function startGame() {
  uiHudTop.style.display = 'block';
  uiHudBottom.style.display = 'block';
  gameStarted = true;
  startTime = clock.getElapsedTime();
}

// Sync Three JS and Cannon
function syncCar() {
  if (carBody && carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }
}

// Camera Follow
const cameraOffset = new THREE.Vector3(0, 3, 10); // Behind and above
function updateCamera() {
  if (!carBody) return;
  
  // Convert local offset to world position
  const bodyPos = new THREE.Vector3().copy(carBody.position);
  const bodyQuat = new THREE.Quaternion().copy(carBody.quaternion);
  
  // Calculate intended camera position
  const idealOffset = cameraOffset.clone().applyQuaternion(bodyQuat);
  const targetCamPos = bodyPos.clone().add(idealOffset);

  // Smooth interpolation for camera position
  camera.position.lerp(targetCamPos, 0.3);

  // Smooth interpolation for camera UP vector (crucial for loops/anti-gravity)
  const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQuat);
  camera.up.lerp(bodyUp, 0.2);

  // Look at somewhere in front of the car
  const forwardOffset = new THREE.Vector3(0, 0, -10).applyQuaternion(bodyQuat);
  const lookAtPos = bodyPos.clone().add(forwardOffset);
  
  camera.lookAt(lookAtPos);
  
  // Optional: Update OrbitControls target so user can pan around while paused
  controls.target.copy(bodyPos);
  // controls.update(); // We manually override camera anyway, but this keeps controls sane
}

// UI Update
function updateUI() {
  if (!carBody) return;
  
  // Speedometer
  const speed = carBody.velocity.length();
  const kmh = Math.floor(speed * 3.6); // m/s to km/h
  speedometerEl.innerHTML = `${kmh}<span class="unit"> KM/H</span>`;
  
  // Nitro Bar
  nitroFillEl.style.transform = `scaleX(${nitroAmount / 100})`;
  
  // Visual Effects
  if (isNitro) {
    rgbShiftPass.uniforms['amount'].value = 0.005; // High chromatic aberration
    bloomPass.strength = 2.0;
    // Engine glow turns purple
    hoverLights.forEach(l => l.color.setHex(0xb000ff));
    energyShield.material.uniforms.color1.value.setHex(0xb000ff);
    camera.fov = THREE.MathUtils.lerp(camera.fov, 100, 0.1);
  } else {
    // Normal speeds effect based on velocity
    const speedFactor = Math.min(speed / 100, 1.0);
    rgbShiftPass.uniforms['amount'].value = 0.001 + speedFactor * 0.002;
    bloomPass.strength = 1.2 + speedFactor * 0.5;
    // Engine glow is blue
    hoverLights.forEach(l => l.color.setHex(0x00f0ff));
    energyShield.material.uniforms.color1.value.setHex(0x00f0ff);
    camera.fov = THREE.MathUtils.lerp(camera.fov, 75, 0.1);
  }
  camera.updateProjectionMatrix();

  // Lap timer
  const elapsed = clock.getElapsedTime() - startTime;
  const mins = Math.floor(elapsed / 60);
  const secs = (elapsed % 60).toFixed(2);
  lapTimerEl.innerHTML = `Lap: ${mins.toString().padStart(2,'0')}:${secs.padStart(5,'0')}`;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (gameStarted) {
    updatePhysics(dt);
    syncCar();
    updateCamera();
    updateUI();
  } else {
    // Rotate camera around idle
    controls.update(); 
  }

  // Render via Composer
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
  if (keys.hasOwnProperty(k)) keys[k] = true;
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (keys.hasOwnProperty(k)) keys[k] = false;
});

// UI Selector
buttons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    modelPath = e.target.getAttribute('data-model');
    uiSelector.style.display = 'none';
    uiLoader.style.display = 'block';
    // Small timeout to allow UI update
    setTimeout(() => {
      initCar(modelPath);
    }, 100);
  });
});

// On Load Show UI
uiSelector.style.display = 'block';
