/* ──────────────────────────────────────────────────────────────
 *  Blob / Space — interactive blob playground
 *  Three.js scene with a live control surface for shape, light,
 *  and orbit. Click the blob for a pulse.
 * ────────────────────────────────────────────────────────────── */

let renderer, scene, camera, controls;
let sphereBg, nucleus, stars;
let sceneRoot;
let ringA, ringB;
let lightWarm, lightHot, lightBack;
let raycaster, pointer;

const container = document.getElementById("canvas_container");
const noise = new SimplexNoise();

let timeout_Debounce;
let pulseLevel = 0;

const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

/* ── Live parameters ────────────────────────────────────────── */
const params = {
    amplitude:  6.0,   // blob noise amplitude
    detail:     1.0,   // noise frequency multiplier
    turbulence: 1.0,   // noise time speed multiplier
    spin:       1.0,   // rotation/orbit speed multiplier
    hue:        210,   // emissive hue (deg)
    glow:       0.9,   // emissive intensity
    shine:      42,    // material shininess
    rings:      true,
    autoOrbit:  true,
};

// Smooth ramp target values (so preset transitions lerp nicely)
const target = Object.assign({}, params);

/* ── Presets ────────────────────────────────────────────────── */
const presets = {
    aurora: { amplitude: 6.0,  detail: 1.0,  turbulence: 1.0, spin: 1.0,  hue: 185, glow: 0.9, shine: 42,  rings: true,  autoOrbit: true },
    ember:  { amplitude: 10.0, detail: 1.6,  turbulence: 1.9, spin: 1.6,  hue: 22,  glow: 1.6, shine: 28,  rings: true,  autoOrbit: true },
    abyss:  { amplitude: 3.5,  detail: 0.7,  turbulence: 0.5, spin: 0.4,  hue: 258, glow: 0.5, shine: 70,  rings: false, autoOrbit: true },
    bloom:  { amplitude: 7.5,  detail: 1.2,  turbulence: 1.1, spin: 1.0,  hue: 322, glow: 1.3, shine: 55,  rings: true,  autoOrbit: true },
    pulse:  { amplitude: 4.0,  detail: 2.2,  turbulence: 2.4, spin: 2.0,  hue: 150, glow: 1.1, shine: 90,  rings: true,  autoOrbit: true },
};

init();
wireControls();
animate();


function init() {
    scene = new THREE.Scene();
    sceneRoot = new THREE.Group();
    scene.add(sceneRoot);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(0, 0, 230);

    // Lighting
    const directionalLight = new THREE.DirectionalLight("#dfe8ff", 2.2);
    directionalLight.position.set(0, 50, -20);
    scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight("#6b7590", 0.65);
    scene.add(ambientLight);

    lightWarm = new THREE.PointLight(0xff9a5a, 2.2, 320, 2);
    lightHot  = new THREE.PointLight(0x7cf1ff, 2.0, 320, 2);
    lightBack = new THREE.PointLight(0xff5a8a, 0.9, 260, 2);
    lightBack.position.set(0, -30, -120);
    sceneRoot.add(lightWarm, lightHot, lightBack);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (renderer.outputEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
    }
    container.appendChild(renderer.domElement);

    // Orbit controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 2.4;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 360;
    controls.minDistance = 150;
    controls.enablePan = false;

    // Textures
    const loader = new THREE.TextureLoader();
    const textureSphereBg  = loader.load('https://i.ibb.co/4gHcRZD/bg3-je3ddz.jpg');
    const textureNucleus   = loader.load('https://i.ibb.co/hcN2qXk/star-nc8wkw.jpg');
    const textureStar      = loader.load('https://i.ibb.co/ZKsdYSz/p1-g3zb2a.png');
    const texture1         = loader.load('https://i.ibb.co/F8by6wW/p2-b3gnym.png');
    const texture2         = loader.load('https://i.ibb.co/yYS2yx5/p3-ttfn70.png');
    const texture4         = loader.load('https://i.ibb.co/yWfKkHh/p4-avirap.png');

    // Nucleus (blob)
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

    // Orbital rings
    ringA = buildRing(52, 0.18, 0x7cf1ff, 0.55);
    ringA.rotation.x = Math.PI * 0.48;
    ringA.rotation.y = 0.25;
    sceneRoot.add(ringA);

    ringB = buildRing(68, 0.10, 0xff9a5a, 0.35);
    ringB.rotation.x = Math.PI * 0.22;
    ringB.rotation.z = 0.6;
    sceneRoot.add(ringB);

    // Background sphere
    textureSphereBg.anisotropy = 16;
    const geometrySphereBg = new THREE.SphereBufferGeometry(150, 40, 40);
    const materialSphereBg = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        map: textureSphereBg,
    });
    sphereBg = new THREE.Mesh(geometrySphereBg, materialSphereBg);
    scene.add(sphereBg);

    // Streak stars
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

    // Fixed stars
    sceneRoot.add(createStars(texture1, 15, 28));
    sceneRoot.add(createStars(texture2, 5,  10));
    sceneRoot.add(createStars(texture4, 7,  10));

    // Interaction
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
        size,
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
    return new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
    );
}

/* ──────────────────────────────────────────────────────────────
 *  Controls wiring
 * ────────────────────────────────────────────────────────────── */

function wireControls() {
    // Sliders
    document.querySelectorAll('.field[data-control]').forEach(field => {
        const key = field.dataset.control;
        const input = field.querySelector('input[type="range"]');
        const output = field.querySelector('output');

        const apply = (fromUser) => {
            const v = parseFloat(input.value);
            target[key] = v;
            if (fromUser) params[key] = v;       // instant for direct edits
            output.textContent = formatValue(key, v);
            input.style.setProperty('--fill', fillPercent(input) + '%');
        };

        input.addEventListener('input', () => {
            field.classList.add('is-active');
            apply(true);
        });
        input.addEventListener('change', () => {
            setTimeout(() => field.classList.remove('is-active'), 400);
        });
        apply(false);
    });

    // Toggles
    const rings = document.getElementById('toggleRings');
    const auto  = document.getElementById('toggleAuto');
    rings.addEventListener('change', () => {
        params.rings = target.rings = rings.checked;
        ringA.visible = ringB.visible = rings.checked;
    });
    auto.addEventListener('change', () => {
        params.autoOrbit = target.autoOrbit = auto.checked;
        controls.autoRotate = auto.checked;
    });

    // Action buttons
    document.getElementById('btnPulse').addEventListener('click', () => {
        pulseLevel = Math.min(1, pulseLevel + 0.9);
    });

    document.getElementById('btnRandom').addEventListener('click', () => {
        applyPreset({
            amplitude:  rand(1, 16),
            detail:     rand(0.4, 2.6),
            turbulence: rand(0.2, 2.6),
            spin:       rand(-2, 2.5),
            hue:        Math.round(rand(0, 360)),
            glow:       rand(0.2, 2),
            shine:      Math.round(rand(10, 110)),
            rings:      Math.random() > 0.25,
            autoOrbit:  params.autoOrbit,
        }, 'RANDOM');
    });

    // Presets
    document.querySelectorAll('.preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.preset;
            const p = presets[name];
            if (!p) return;
            document.querySelectorAll('.preset').forEach(b => b.classList.toggle('is-active', b === btn));
            applyPreset(p, name.toUpperCase());
        });
    });

    // Collapse panel
    const panel = document.getElementById('controls');
    const toggle = document.getElementById('controlsToggle');
    toggle.addEventListener('click', () => {
        const collapsed = panel.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
    });
}

function applyPreset(p, name) {
    Object.assign(target, p);
    if (typeof p.rings === 'boolean') {
        params.rings = p.rings;
        document.getElementById('toggleRings').checked = p.rings;
        ringA.visible = ringB.visible = p.rings;
    }
    if (typeof p.autoOrbit === 'boolean') {
        params.autoOrbit = p.autoOrbit;
        document.getElementById('toggleAuto').checked = p.autoOrbit;
        controls.autoRotate = p.autoOrbit;
    }
    // Reflect on sliders
    document.querySelectorAll('.field[data-control]').forEach(field => {
        const key = field.dataset.control;
        const input = field.querySelector('input[type="range"]');
        const output = field.querySelector('output');
        if (p[key] !== undefined) {
            input.value = p[key];
            output.textContent = formatValue(key, p[key]);
            input.style.setProperty('--fill', fillPercent(input) + '%');
            field.classList.add('is-active');
            setTimeout(() => field.classList.remove('is-active'), 600);
        }
    });
    const label = document.getElementById('activePreset');
    if (label && name) label.textContent = name;

    // gentle pulse when a preset is applied
    pulseLevel = Math.min(1, pulseLevel + 0.4);
}

function fillPercent(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const v = parseFloat(input.value);
    return ((v - min) / (max - min)) * 100;
}

function formatValue(key, v) {
    switch (key) {
        case 'hue':        return Math.round(v) + '°';
        case 'shine':      return String(Math.round(v));
        case 'amplitude':  return v.toFixed(1);
        case 'spin':       return v.toFixed(1);
        default:           return v.toFixed(2);
    }
}

function rand(a, b) { return a + Math.random() * (b - a); }

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
    pulseLevel = Math.min(1, pulseLevel + (hit && hit.length ? 0.9 : 0.25));
}

/* ──────────────────────────────────────────────────────────────
 *  Animate
 * ────────────────────────────────────────────────────────────── */

function animate() {
    const tNow = performance.now();
    const t = tNow * 0.001;

    // Smoothly ease params toward target (so presets slide in)
    const ease = 0.08;
    params.amplitude  += (target.amplitude  - params.amplitude)  * ease;
    params.detail     += (target.detail     - params.detail)     * ease;
    params.turbulence += (target.turbulence - params.turbulence) * ease;
    params.spin       += (target.spin       - params.spin)       * ease;
    params.hue        += shortestHueDelta(params.hue, target.hue) * ease;
    params.glow       += (target.glow       - params.glow)       * ease;
    params.shine      += (target.shine      - params.shine)      * ease;

    // Orbit control speed follows spin
    controls.autoRotateSpeed = 2.4 * params.spin;

    // Streak stars
    stars.geometry.vertices.forEach(v => {
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

    // Blob breathing — amplitude × detail (frequency) × turbulence (time)
    const ampEff = params.amplitude * (1 + pulseLevel * 0.7);
    const freq = 1 * params.detail;
    const timeScale = 0.0005 * params.turbulence;

    nucleus.geometry.vertices.forEach(v => {
        v.normalize();
        const n = noise.noise3D(
            v.x * freq + tNow * timeScale,
            v.y * freq + tNow * timeScale * 0.6,
            v.z * freq + tNow * timeScale * 1.6
        );
        const distance = nucleus.geometry.parameters.radius + n * ampEff;
        v.multiplyScalar(distance);
    });
    nucleus.geometry.verticesNeedUpdate = true;
    nucleus.geometry.normalsNeedUpdate = true;
    nucleus.geometry.computeVertexNormals();
    nucleus.geometry.computeFaceNormals();
    nucleus.rotation.y += 0.0022 * params.spin;
    nucleus.rotation.x = Math.sin(t * 0.17) * 0.1;

    // Blob material
    const hueNorm = (params.hue % 360 + 360) % 360 / 360;
    nucleus.material.emissive.setHSL(hueNorm, 0.7, 0.12 + pulseLevel * 0.18);
    nucleus.material.emissiveIntensity = params.glow + pulseLevel * 1.4;
    nucleus.material.shininess = params.shine;

    // Rings — tint with current hue, opacity modulation
    if (ringA.visible) {
        ringA.material.color.setHSL(hueNorm, 0.8, 0.6);
        ringA.rotation.z += 0.0035 * params.spin;
        ringA.rotation.y += 0.0008 * params.spin;
        ringA.material.opacity = 0.45 + Math.sin(t * 1.2) * 0.08 + pulseLevel * 0.3;
    }
    if (ringB.visible) {
        ringB.material.color.setHSL((hueNorm + 0.12) % 1, 0.75, 0.6);
        ringB.rotation.x += 0.0022 * params.spin;
        ringB.rotation.y -= 0.0011 * params.spin;
        ringB.material.opacity = 0.28 + Math.cos(t * 0.8) * 0.07 + pulseLevel * 0.2;
    }

    // Colored rim lights: tint them with the current hue too
    const lightColor = new THREE.Color().setHSL(hueNorm, 0.75, 0.6);
    const lightComp  = new THREE.Color().setHSL((hueNorm + 0.5) % 1, 0.6, 0.55);
    lightHot.color.copy(lightColor);
    lightWarm.color.copy(lightComp);

    const r1 = 70;
    lightWarm.position.set(Math.cos(t * 0.9 * params.spin) * r1, Math.sin(t * 0.55) * 40, Math.sin(t * 0.9 * params.spin) * r1);
    const r2 = 80;
    lightHot.position.set(Math.cos(-t * 0.6 * params.spin + 1.3) * r2, Math.cos(t * 0.4) * 35, Math.sin(-t * 0.6 * params.spin + 1.3) * r2);
    lightWarm.intensity = 2.1 + pulseLevel * 2.2;
    lightHot.intensity  = 1.9 + pulseLevel * 1.8;

    // Background sphere
    sphereBg.rotation.x += 0.0012;
    sphereBg.rotation.y += 0.0015;
    sphereBg.rotation.z += 0.0008;

    // Parallax
    parallax.x += (parallax.tx - parallax.x) * 0.05;
    parallax.y += (parallax.ty - parallax.y) * 0.05;
    sceneRoot.rotation.y = parallax.x;
    sceneRoot.rotation.x = parallax.y;

    // Pulse decay
    if (pulseLevel > 0) {
        pulseLevel *= 0.94;
        if (pulseLevel < 0.002) pulseLevel = 0;
    }

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

function shortestHueDelta(from, to) {
    let d = to - from;
    while (d > 180)  d -= 360;
    while (d < -180) d += 360;
    return d;
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
