// js/main.js
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let camera, scene, renderer, clock, mixer, controls;
let floor;
let actions = {};
let activeAction;
let character = null;

let modelHeight = 1;

// ----- AJUSTES DE TAMAÑO -----
const TARGET_DESKTOP_HEIGHT = 140; // tamaño en modo normal (un poco más grande en pantalla)
const TARGET_AR_HEIGHT = 0.8;      // altura aprox. en metros en AR (vertical)
const AR_EXTRA_DOWN = 0.45;        // baja un poco el modelo para tocar mejor el suelo
// --------------------------------

// WebXR / AR
let reticle, raycaster, interactableGroup;
let currentGazeTarget = null;
let gazeDwellTime = 0;
const DWELL_TIME_THRESHOLD = 1.3;
let inAR = false;

// Gestos táctiles en AR
let primaryPointer = null;
let secondaryPointer = null;
let dragStart = { x: 0, y: 0 };
let modelStartPos = new THREE.Vector3();
let pinchStartDistance = 0;
let modelStartScale = 1;

// Nombres de recursos
const modelName = 'personaje';
const animationAssets = [
  'Bicycle Crunch',
  'Center Block',
  'Illegal Elbow Punch',
  'Jogging',
  'Strafe'
];

// DOM
const container = document.getElementById('app-container');
const uiOverlay = document.getElementById('ui-overlay');
const buttonsContainer = document.getElementById('buttons-container');
const xrStatusText = document.getElementById('xr-status-text');

window.triggerAnimation = function (name) { fadeToAction(name, 0.45); };

init();

function init() {
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050814, 200, 1000);

  const hemiLight = new THREE.HemisphereLight(0xf5f7ff, 0x141414, 1.7);
  hemiLight.position.set(0, 200, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(70, 220, 90);
  dirLight.castShadow = true;
  dirLight.shadow.camera.top = 180;
  dirLight.shadow.camera.bottom = -100;
  dirLight.shadow.camera.left = -120;
  dirLight.shadow.camera.right = 120;
  scene.add(dirLight);

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x222733,
    metalness: 0.25,
    roughness: 0.9
  });
  floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.position.y = 0;
  scene.add(floor);

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 110, 260);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.setAnimationLoop(animate);

  container.appendChild(renderer.domElement);

  const arButton = ARButton.createButton(renderer);
  document.body.appendChild(arButton);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 90, 0);
  controls.enableDamping = true;

  const loader = new FBXLoader();

  const modelUrl = `./models/${modelName}.fbx`;
  console.log('Cargando modelo desde:', modelUrl);

  loader.load(
    modelUrl,
    (object) => {
      console.log('✅ Modelo cargado OK');
      character = object;
      character.scale.setScalar(1);

      character.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(character);
      const size = new THREE.Vector3();
      box.getSize(size);
      modelHeight = size.y || 1;

      applyDesktopPose();

      scene.add(character);

      mixer = new THREE.AnimationMixer(character);

      loadAnimations(loader);
      createHTMLButtons();
      createVRInterface();
    },
    undefined,
    (e) => {
      console.error('❌ Error cargando el modelo:', e);
    }
  );

  setupXRInteractions();
  setupTouchGestures();

  renderer.xr.addEventListener('sessionstart', () => {
    inAR = true;
    uiOverlay.style.display = 'none';
    floor.visible = false;
    scene.fog.near = 99999;
    scene.fog.far = 100000;
    xrStatusText.textContent = 'En sesión AR · Mira los botones tácticos junto al soldado';
    if (character) applyARPose();
  });

  renderer.xr.addEventListener('sessionend', () => {
    inAR = false;
    uiOverlay.style.display = 'flex';
    floor.visible = true;
    scene.fog.near = 200;
    scene.fog.far = 1000;
    xrStatusText.textContent = 'Listo · Presiona el botón AR para desplegar al soldado';
    if (character) applyDesktopPose();
  });

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', () => {
    updateARScaleByOrientation();
  });
}

/* ---------- ESCALA AR SEGÚN ORIENTACIÓN ---------- */

function updateARScaleByOrientation() {
  if (!character || !inAR || !modelHeight) return;

  const portrait = window.innerHeight >= window.innerWidth;
  const scaleFactor = portrait ? 1.0 : 0.55;

  const baseScale = TARGET_AR_HEIGHT / modelHeight;
  character.scale.setScalar(baseScale * scaleFactor);
}

/* ---------- POSES ---------- */

function applyDesktopPose() {
  if (!character) return;

  const desktopScale = TARGET_DESKTOP_HEIGHT / modelHeight;
  character.scale.setScalar(desktopScale);

  const box = new THREE.Box3().setFromObject(character);
  const minY = box.min.y;

  character.position.set(0, -minY, 0);
}

function applyARPose() {
  if (!character) return;

  updateARScaleByOrientation();

  const box = new THREE.Box3().setFromObject(character);
  const minY = box.min.y;

  character.position.set(0, -minY - AR_EXTRA_DOWN, -0.7);
}

/* ---------- ANIMACIONES ---------- */

function loadAnimations(loader) {
  animationAssets.forEach((assetName, index) => {
    const url = `./models/${assetName}.fbx`;
    console.log('Cargando animación:', url);

    loader.load(
      url,
      (fbx) => {
        if (fbx.animations.length > 0) {
          const clip = fbx.animations[0];
          clip.name = assetName;

          const action = mixer.clipAction(clip);
          actions[assetName] = action;

          if (index === 0) {
            activeAction = actions[assetName];
            activeAction.play();
            updateButtonsVisuals(assetName);
          }
        }
      },
      undefined,
      (e) => {
        console.warn(`⚠️ No se pudo cargar la animación ${assetName}`, e);
      }
    );
  });
}

function fadeToAction(name, duration) {
  if (!actions[name]) return;

  const previousAction = activeAction;
  activeAction = actions[name];

  if (previousAction !== activeAction) {
    if (previousAction) previousAction.fadeOut(duration);

    activeAction
      .reset()
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .fadeIn(duration)
      .play();

    updateButtonsVisuals(name);
  }
}

function updateButtonsVisuals(activeName) {
  document.querySelectorAll('.anim-btn').forEach((btn) => {
    if (btn.dataset.anim === activeName) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function createHTMLButtons() {
  buttonsContainer.innerHTML = '';

  animationAssets.forEach((name, idx) => {
    const btn = document.createElement('button');
    btn.className = 'anim-btn';
    btn.dataset.anim = name;

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = name;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = idx === 0 ? 'Idle' : 'XR';

    btn.appendChild(label);
    btn.appendChild(badge);

    btn.onclick = () => triggerAnimation(name);
    buttonsContainer.appendChild(btn);
  });
}

/* ---------- BOTONES INMERSIVOS EN 3D (AR) ---------- */

function setupXRInteractions() {
  raycaster = new THREE.Raycaster();
  interactableGroup = new THREE.Group();
  scene.add(interactableGroup);

  const reticleGeo = new THREE.RingGeometry(0.002, 0.004, 32);
  const reticleMat = new THREE.MeshBasicMaterial({
    color: 0xe0f4ff,
    opacity: 0.9,
    transparent: true,
    depthTest: false
  });

  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.position.z = -0.8;
  reticle.renderOrder = 999;

  camera.add(reticle);
  scene.add(camera);
}

function createButtonMesh(text, animationName, yOffset) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 160;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#1b3b5a');
  gradient.addColorStop(0.5, '#1b9aaa');
  gradient.addColorStop(1, '#f6aa1c');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffe66d';
  ctx.setLineDash([22, 18]);
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

  ctx.fillStyle = '#f8f9fa';
  ctx.font = 'bold 42px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipMapLinearFilter;

  const geometry = new THREE.PlaneGeometry(0.2, 0.06);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = animationName;
  mesh.renderOrder = 998;

  mesh.position.set(0.30, 0.55 + yOffset, -0.7);
  mesh.rotation.y = -0.25;

  return mesh;
}

function createVRInterface() {
  const gap = 0.075; // separación vertical
  const start = ((animationAssets.length - 1) * gap) / 2;

  animationAssets.forEach((animName, index) => {
    const yOffset = start - index * gap;
    const btn = createButtonMesh(animName, animName, yOffset);
    interactableGroup.add(btn);
  });
}

/* ---------- GESTOS TÁCTILES EN AR (mover y escalar) ---------- */

function setupTouchGestures() {
  const dom = renderer.domElement;

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
}

function onPointerDown(event) {
  if (!inAR || !character) return;

  domSetPointerCapture(event);

  if (!primaryPointer) {
    primaryPointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    dragStart.x = event.clientX;
    dragStart.y = event.clientY;
    modelStartPos.copy(character.position);
  } else if (!secondaryPointer && event.pointerId !== primaryPointer.id) {
    secondaryPointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    pinchStartDistance = distanceBetweenPointers();
    modelStartScale = character.scale.x;
  }
}

function onPointerMove(event) {
  if (!inAR || !character) return;

  if (primaryPointer && event.pointerId === primaryPointer.id) {
    primaryPointer.x = event.clientX;
    primaryPointer.y = event.clientY;
  } else if (secondaryPointer && event.pointerId === secondaryPointer.id) {
    secondaryPointer.x = event.clientX;
    secondaryPointer.y = event.clientY;
  }

  // pinch (dos dedos) → escalar
  if (primaryPointer && secondaryPointer) {
    const currentDist = distanceBetweenPointers();
    if (pinchStartDistance > 0) {
      const factor = currentDist / pinchStartDistance;
      let newScale = modelStartScale * factor;
      const baseARScale = TARGET_AR_HEIGHT / modelHeight;
      newScale = THREE.MathUtils.clamp(newScale, 0.4 * baseARScale, 1.6 * baseARScale);
      character.scale.setScalar(newScale);
    }
    return;
  }

  // drag (un dedo) → mover en X/Z
  if (primaryPointer && !secondaryPointer) {
    const dx = (primaryPointer.x - dragStart.x) / window.innerWidth;
    const dy = (primaryPointer.y - dragStart.y) / window.innerHeight;

    const moveX = dx * 1.5;
    const moveZ = dy * 1.5;

    character.position.x = modelStartPos.x + moveX;
    character.position.z = modelStartPos.z + moveZ;
  }
}

function onPointerUp(event) {
  if (primaryPointer && event.pointerId === primaryPointer.id) {
    primaryPointer = secondaryPointer;
    secondaryPointer = null;
    pinchStartDistance = 0;
  } else if (secondaryPointer && event.pointerId === secondaryPointer.id) {
    secondaryPointer = null;
    pinchStartDistance = 0;
  }
}

function distanceBetweenPointers() {
  if (!primaryPointer || !secondaryPointer) return 0;
  const dx = primaryPointer.x - secondaryPointer.x;
  const dy = primaryPointer.y - secondaryPointer.y;
  return Math.hypot(dx, dy);
}

function domSetPointerCapture(event) {
  try {
    event.target.setPointerCapture(event.pointerId);
  } catch (_) {}
}

/* ---------- LOOP ANIMACIÓN ---------- */

function animate() {
  const delta = clock.getDelta();

  if (mixer) mixer.update(delta);

  if (controls && !renderer.xr.isPresenting) {
    controls.update();
  }

  handleGazeInteraction(delta);
  renderer.render(scene, camera);
}

function handleGazeInteraction(delta) {
  if (!renderer.xr.isPresenting) return;

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const intersects = raycaster.intersectObjects(interactableGroup.children, false);

  let target = null;
  if (intersects.length > 0) target = intersects[0].object;

  if (target !== currentGazeTarget) {
    currentGazeTarget = target;
    gazeDwellTime = 0;
    interactableGroup.children.forEach((c) => c.scale.set(1, 1, 1));
  }

  if (currentGazeTarget) {
    currentGazeTarget.scale.set(1.06, 1.06, 1.06);
    gazeDwellTime += delta;

    if (gazeDwellTime >= DWELL_TIME_THRESHOLD) {
      triggerAnimation(currentGazeTarget.name);
      gazeDwellTime = 0;
      currentGazeTarget.scale.set(0.96, 0.96, 0.96);
    }
  }
}

/* ---------- EVENTOS ---------- */

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
