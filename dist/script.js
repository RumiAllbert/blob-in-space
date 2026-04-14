/* ──────────────────────────────────────────────────────────────
 *  Blob / Space — orbital observatory
 *  Enhanced Three.js scene + live spatial-interface HUD
 * ────────────────────────────────────────────────────────────── */

let renderer, scene, camera, controls;
let sphereBg, nucleus, stars;
let sceneRoot;               // parallax group
let ringA, ringB;            // orbital rings
let lightWarm, lightHot;     // rotating colored rim lights
let raycaster, pointer;

const container = document.getElementById("canvas_container");
const noise = new SimplexNoise();

let timeout_Debounce;
const blobScaleBase = 6;
let pulseLevel = 0;          // 0..1, decays back to 0 on click

const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

// HUD state
const startTime = performance.now();
const hud = {
    sessionId:   document.getElementById("sessionId"),
    mass:        document.getElementById("statMass"),
    lum:         document.getElementById("statLum"),
    flux:        document.getElementById("statFlux"),
    drift:       document.getElementById("statDrift"),
    coordA:      document.getElementById("coordA"),
    coordD:      document.getElementById("coordD"),
    coordR:      document.getElementById("coordR"),
    clock:       document.getElementById("missionClock"),
    fps:         document.getElementById("fpsValue"),
    wave:        document.getElementById("waveformPath"),
};
const flux = { value: 0, history: new Array(60).fill(0.5) };
let fpsEMA = 60;
let lastFrameTs = performance.now();

init();
seedHud();
animate();


function init() {
    scene = new THREE.Scene();
    sceneRoot = new THREE.Group();
    scene.add(sceneRoot);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(0, 0, 230);

    // ── Lighting ────────────────────────────────────────────────
    const directionalLight = new THREE.DirectionalLight("#dfe8ff", 2.2);
    directionalLight.position.set(0, 50, -20);
    scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight("#6b7590", 0.65);
    scene.add(ambientLight);

    // Warm + hot rim lights orbit the nucleus for iridescent shading
    lightWarm = new THREE.PointLight(0xff9a5a, 2.2, 320, 2);
    lightHot  = new THREE.PointLight(0x7cf1ff, 2.0, 320, 2);
    sceneRoot.add(lightWarm);
    sceneRoot.add(lightHot);

    // Subtle key-rim accent from behind
    const backRim = new THREE.PointLight(0xff5a8a, 0.9, 260, 2);
    backRim.position.set(0, -30, -120);
    sceneRoot.add(backRim);

    // ── Renderer ────────────────────────────────────────────────
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (renderer.outputEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
    }
    container.appendChild(renderer.domElement);

    // ── Orbit controls ──────────────────────────────────────────
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 2.4;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 360;
    controls.minDistance = 150;
    controls.enablePan = false;

    // ── Textures ────────────────────────────────────────────────
    const loader = new THREE.TextureLoader();
    const textureSphereBg  = loader.load('https://i.ibb.co/4gHcRZD/bg3-je3ddz.jpg');
    const textureNucleus   = loader.load('https://i.ibb.co/hcN2qXk/star-nc8wkw.jpg');
    const textureStar      = loader.load('https://i.ibb.co/ZKsdYSz/p1-g3zb2a.png');
    const texture1         = loader.load('https://i.ibb.co/F8by6wW/p2-b3gnym.png');
    const texture2         = loader.load('https://i.ibb.co/yYS2yx5/p3-ttfn70.png');
    const texture4         = loader.load('https://i.ibb.co/yWfKkHh/p4-avirap.png');

    // ── Nucleus (blob) ──────────────────────────────────────────
    textureNucleus.anisotropy = 16;
    const icosahedronGeometry = new THREE.IcosahedronGeometry(30, 10);
    const nucleusMaterial = new THREE.MeshPhongMaterial({
        map: textureNucleus,
        emissive: new THREE.Color(0x120a1e),
        emissiveIntensity: 0.9,
        shininess: 42,
        specular: new THREE.Color(0xffc9a8),
    });
    nucleus = new THREE.Mesh(icosahedronGeometry, nucleusMaterial);
    sceneRoot.add(nucleus);

    // ── Orbital rings ───────────────────────────────────────────
    ringA = buildRing(52, 0.18, 0x7cf1ff, 0.55);
    ringA.rotation.x = Math.PI * 0.48;
    ringA.rotation.y = 0.25;
    sceneRoot.add(ringA);

    ringB = buildRing(68, 0.10, 0xff9a5a, 0.35);
    ringB.rotation.x = Math.PI * 0.22;
    ringB.rotation.z = 0.6;
    sceneRoot.add(ringB);

    // ── Background sphere ───────────────────────────────────────
    textureSphereBg.anisotropy = 16;
    const geometrySphereBg = new THREE.SphereBufferGeometry(150, 40, 40);
    const materialSphereBg = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        map: textureSphereBg,
    });
    sphereBg = new THREE.Mesh(geometrySphereBg, materialSphereBg);
    scene.add(sphereBg);

    // ── Streaking stars (fall towards center) ───────────────────
    const starsGeometry = new THREE.Geometry();
    for (let i = 0; i < 80; i++) {
        const particleStar = randomPointSphere(150);
        particleStar.velocity = THREE.MathUtils.randInt(50, 200);
        particleStar.startX = particleStar.x;
        particleStar.startY = particleStar.y;
        particleStar.startZ = particleStar.z;
        starsGeometry.vertices.push(particleStar);
    }
    const starsMaterial = new THREE.PointsMaterial({
        size: 5,
        color: "#ffffff",
        transparent: true,
        opacity: 0.85,
        map: textureStar,
        blending: THREE.AdditiveBlending,
    });
    starsMaterial.depthWrite = false;
    stars = new THREE.Points(starsGeometry, starsMaterial);
    sceneRoot.add(stars);

    // ── Fixed stars (parallax layer) ────────────────────────────
    sceneRoot.add(createStars(texture1, 15, 28));
    sceneRoot.add(createStars(texture2, 5,  10));
    sceneRoot.add(createStars(texture4, 7,  10));

    // ── Interaction ─────────────────────────────────────────────
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
}

function buildRing(radius, tube, color, opacity) {
    const geom = new THREE.TorusGeometry(radius, tube, 14, 220);
    const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    return new THREE.Mesh(geom, mat);
}

function createStars(texture, size, total) {
    const pointGeometry = new THREE.Geometry();
    const pointMaterial = new THREE.PointsMaterial({
        size: size,
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < total; i++) {
        const radius = THREE.MathUtils.randInt(70, 149);
        pointGeometry.vertices.push(randomPointSphere(radius));
    }
    return new THREE.Points(pointGeometry, pointMaterial);
}

function randomPointSphere(radius) {
    const theta = 2 * Math.PI * Math.random();
    const phi = Math.acos(2 * Math.random() - 1);
    const dx = radius * Math.sin(phi) * Math.cos(theta);
    const dy = radius * Math.sin(phi) * Math.sin(theta);
    const dz = radius * Math.cos(phi);
    return new THREE.Vector3(dx, dy, dz);
}

/* ──────────────────────────────────────────────────────────────
 *  Interaction
 * ────────────────────────────────────────────────────────────── */

function onPointerMove(e) {
    const nx = (e.clientX / window.innerWidth)  * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    pointer.x = nx;
    pointer.y = ny;
    parallax.tx = nx * 0.08;
    parallax.ty = -ny * 0.05;
}

function onPointerDown(e) {
    pointer.x = (e.clientX / window.innerWidth)  * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(nucleus, false);
    if (hit && hit.length) {
        pulseLevel = Math.min(1, pulseLevel + 0.8);
    } else {
        pulseLevel = Math.min(1, pulseLevel + 0.25);
    }
}

/* ──────────────────────────────────────────────────────────────
 *  HUD
 * ────────────────────────────────────────────────────────────── */

function seedHud() {
    if (hud.sessionId) {
        const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
        hud.sessionId.textContent = "OBS-" + hex.toUpperCase();
    }
}

function formatClock(ms) {
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `T+${hh}:${mm}:${ss}`;
}

function formatDeg(value, signed) {
    const sign = signed ? (value >= 0 ? "+" : "−") : "";
    const v = Math.abs(value);
    const d = Math.floor(v);
    const m = Math.floor((v - d) * 60);
    const s = Math.floor(((v - d) * 60 - m) * 60);
    return `${sign}${String(d).padStart(2, "0")}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″`;
}

function updateHud(tNow) {
    // clock
    if (hud.clock) hud.clock.textContent = formatClock(tNow - startTime);

    // flux (simplex-noise driven, smoothed)
    const fRaw = 0.5 + 0.5 * noise.noise3D(tNow * 0.00018, 0.7, tNow * 0.00009);
    flux.value += (fRaw - flux.value) * 0.08;
    flux.history.push(flux.value);
    flux.history.shift();

    // mass uses blob breathing size + pulse
    const effectiveScale = blobScaleBase * (1 + pulseLevel * 0.6);
    const mass = 1200 + Math.sin(tNow * 0.0008) * 35 + effectiveScale * 6 + pulseLevel * 200;
    const lum = 0.35 + 0.4 * flux.value + pulseLevel * 0.4;
    const drift = controls ? controls.autoRotateSpeed * 0.6 + pulseLevel * 1.2 : 0;

    if (hud.mass)  hud.mass.textContent  = mass.toFixed(1);
    if (hud.lum)   hud.lum.textContent   = lum.toFixed(2);
    if (hud.flux)  hud.flux.textContent  = (flux.value * 4 - 2).toFixed(2);
    if (hud.drift) hud.drift.textContent = drift.toFixed(2);

    // waveform polyline
    if (hud.wave) {
        const n = flux.history.length;
        const pts = new Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 120;
            const y = 32 - flux.history[i] * 32;
            pts[i] = x.toFixed(1) + "," + y.toFixed(1);
        }
        hud.wave.setAttribute("points", pts.join(" "));
    }

    // coordinates from camera spherical pos
    const p = camera.position;
    const r = p.length();
    const az = Math.atan2(p.x, p.z) * 180 / Math.PI;
    const el = Math.asin(p.y / r) * 180 / Math.PI;
    if (hud.coordA) hud.coordA.textContent = formatDeg((az + 360) % 360, false);
    if (hud.coordD) hud.coordD.textContent = formatDeg(el, true);
    if (hud.coordR) hud.coordR.textContent = (r / 100).toFixed(3) + " au";

    // fps
    const dt = tNow - lastFrameTs;
    lastFrameTs = tNow;
    if (dt > 0) {
        const instant = 1000 / dt;
        fpsEMA += (instant - fpsEMA) * 0.08;
    }
    if (hud.fps) hud.fps.textContent = Math.round(fpsEMA).toString().padStart(2, "0");
}

/* ──────────────────────────────────────────────────────────────
 *  Animate
 * ────────────────────────────────────────────────────────────── */

function animate() {
    const tNow = performance.now();
    const t = tNow * 0.001;

    // streak stars
    stars.geometry.vertices.forEach(function (v) {
        v.x += (0 - v.x) / v.velocity;
        v.y += (0 - v.y) / v.velocity;
        v.z += (0 - v.z) / v.velocity;

        v.velocity -= 0.3;

        if (v.x <= 5 && v.x >= -5 && v.z <= 5 && v.z >= -5) {
            v.x = v.startX;
            v.y = v.startY;
            v.z = v.startZ;
            v.velocity = THREE.MathUtils.randInt(50, 300);
        }
    });
    stars.geometry.verticesNeedUpdate = true;

    // blob breathing
    const effectiveScale = blobScaleBase * (1 + pulseLevel * 0.7);
    nucleus.geometry.vertices.forEach(function (v) {
        v.normalize();
        const n = noise.noise3D(
            v.x + tNow * 0.0005,
            v.y + tNow * 0.0003,
            v.z + tNow * 0.0008
        );
        const distance = nucleus.geometry.parameters.radius + n * effectiveScale;
        v.multiplyScalar(distance);
    });
    nucleus.geometry.verticesNeedUpdate = true;
    nucleus.geometry.normalsNeedUpdate = true;
    nucleus.geometry.computeVertexNormals();
    nucleus.geometry.computeFaceNormals();
    nucleus.rotation.y += 0.0022;
    nucleus.rotation.x = Math.sin(t * 0.17) * 0.1;

    // blob material: emissive tint + pulse glow
    const hue = 0.58 + Math.sin(t * 0.15) * 0.08;   // cyan → violet
    nucleus.material.emissive.setHSL(hue, 0.6, 0.12 + pulseLevel * 0.18);
    nucleus.material.emissiveIntensity = 0.8 + pulseLevel * 1.4;

    // orbital rings
    ringA.rotation.z += 0.0035;
    ringA.rotation.y += 0.0008;
    ringA.material.opacity = 0.45 + Math.sin(t * 1.2) * 0.08 + pulseLevel * 0.3;

    ringB.rotation.x += 0.0022;
    ringB.rotation.y -= 0.0011;
    ringB.material.opacity = 0.28 + Math.cos(t * 0.8) * 0.07 + pulseLevel * 0.2;

    // colored rim lights orbit the nucleus
    const r1 = 70;
    lightWarm.position.set(Math.cos(t * 0.9) * r1, Math.sin(t * 0.55) * 40, Math.sin(t * 0.9) * r1);
    const r2 = 80;
    lightHot.position.set(Math.cos(t * -0.6 + 1.3) * r2, Math.cos(t * 0.4) * 35, Math.sin(t * -0.6 + 1.3) * r2);
    lightWarm.intensity = 2.1 + pulseLevel * 2.2;
    lightHot.intensity  = 1.9 + pulseLevel * 1.8;

    // background sphere
    sphereBg.rotation.x += 0.0012;
    sphereBg.rotation.y += 0.0015;
    sphereBg.rotation.z += 0.0008;

    // parallax group — subtle mouse-driven tilt
    parallax.x += (parallax.tx - parallax.x) * 0.05;
    parallax.y += (parallax.ty - parallax.y) * 0.05;
    sceneRoot.rotation.y = parallax.x;
    sceneRoot.rotation.x = parallax.y;

    // pulse decay
    if (pulseLevel > 0) {
        pulseLevel *= 0.94;
        if (pulseLevel < 0.002) pulseLevel = 0;
    }

    controls.update();
    renderer.render(scene, camera);
    updateHud(tNow);
    requestAnimationFrame(animate);
}

/* ──────────────────────────────────────────────────────────────
 *  Resize
 * ────────────────────────────────────────────────────────────── */

window.addEventListener("resize", () => {
    clearTimeout(timeout_Debounce);
    timeout_Debounce = setTimeout(onWindowResize, 80);
});

function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}
