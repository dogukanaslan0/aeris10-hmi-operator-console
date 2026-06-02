/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : 3D Holographic Tactical Dome & WebGL Sensor Array
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.1.0 (Nexus Active Deployment — Bloom + Trajectory)
 * ============================================================================
 *
 * v1.1.0 enhancements:
 *   - UnrealBloomPass post-processing (selective glow on bright emitters)
 *   - FXAAShader anti-aliasing (clean edges at any DPR)
 *   - Camera damping (inertial release) + 8 s idle auto-rotate
 *   - Volumetric phased-array beam wedge (5° cone) replacing thin needle
 *   - Threat-trajectory prediction (5 s extrapolated dashed path) for
 *     warning/critical targets
 *   - Vertical selection column (glowing cylinder from selected target to
 *     ground) replacing the dashed drop line for selected target
 *   - Concentric range-gate hemispheres (depth cue layered onto the dome)
 *   - HUD: RESET CAM + AUTO-ROTATE toggle buttons
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

import { useTargetStore } from '../../stores/radarStore';
import { useSystemStore } from '../../stores/systemStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { shortId, formatRange } from '../command/TargetList';
import { CornerBrackets } from '../common/CornerBrackets';
import { MissionModeRail } from '../common/MissionModeRail';
import { IconScan } from '../icons';

import './Radar3D.css';

// ── Constants ──────────────────────────────────────────────────────────────
const DOME_RADIUS = 250;
const CAM_INIT = { rotationX: 0.45, rotationY: 0.78, radius: 420 };
const IDLE_AUTO_ROTATE_MS = 8_000;
const DAMPING = 0.92; // velocity decay per frame
const PREDICTION_HORIZON_S = 5; // future path duration
const PREDICTION_SEGMENTS = 24;
const BEAM_HALF_ANGLE_DEG = 5;

export function Radar3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Geographic projection geometry & uniform refs
  const terrainGeomRef = useRef<THREE.PlaneGeometry | null>(null);
  const terrainUniformsRef = useRef<any>(null);

  // HUD value refs for zero-overhead 60Hz rendering
  const camElevRef = useRef<HTMLSpanElement>(null);
  const camAzRef = useRef<HTMLSpanElement>(null);
  const camZoomRef = useRef<HTMLSpanElement>(null);
  const beamAzRef = useRef<HTMLSpanElement>(null);
  const beamElRef = useRef<HTMLSpanElement>(null);
  const trkCountRef = useRef<HTMLSpanElement>(null);

  // Camera orbit state — extended with velocity, last-interaction stamp
  const orbitRef = useRef({
    rotationX: CAM_INIT.rotationX,
    rotationY: CAM_INIT.rotationY,
    radius: CAM_INIT.radius,
    isDragging: false,
    startX: 0,
    startY: 0,
    startRotX: CAM_INIT.rotationX,
    startRotY: CAM_INIT.rotationY,
    vx: 0,
    vy: 0,
    lastInteractMs: performance.now(),
  });

  // Auto-rotate toggle (operator-controlled override)
  const [autoRotate, setAutoRotate] = useState(false);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const rangeScale = useSystemStore((s) => s.radarRangeScale);
  const gpsLat = useSystemStore((s) => s.current?.gps_lat ?? 41.0082);
  const gpsLon = useSystemStore((s) => s.current?.gps_lon ?? 28.9784);

  // Live mirror of the range scale read by the rAF loop. The heavy scene-setup
  // effect must NOT re-run when the operator drags the Range slider — that would
  // tear down and rebuild the entire WebGL scene (and snap the camera back to
  // its default orbit) on every slider tick. Instead the animation loop reads
  // this ref, so range changes rescale target positions live without a rebuild.
  const rangeScaleRef = useRef(rangeScale);
  rangeScaleRef.current = rangeScale;
  const setRadarMode = useSystemStore((s) => s.setRadarMode);
  const layoutPreset = useSystemStore((s) => s.layoutPreset);

  // Imperative reset camera handle — set by setup effect, called by button
  const resetCamRef = useRef<() => void>(() => {});

  // Smoothed beam-steering radians — lerped toward the live telemetry value
  // every frame so the steering needle + volumetric wedge glide between
  // discrete scan-index steps instead of teleporting.
  const smoothBeamRef = useRef({ az: 0, el: 0, initialized: false });

  // ── Three.js Scene Setup ──────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1) Scene & Camera
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020304, 0.0018);

    const camera = new THREE.PerspectiveCamera(45, width / height, 10, 2000);

    // 2) Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 2b) Post-processing — RenderPass → UnrealBloomPass → FXAA
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.0, // strength — disabled for Mil-Spec zero-bloom precision
      0.55,
      0.18,
    );
    // composer.addPass(bloomPass); // bypassed for flat rugged console rendering

    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.set(
      1 / (width * dpr),
      1 / (height * dpr),
    );
    composer.addPass(fxaaPass);

    // 3) High-Tech Lighting System
    const ambientLight = new THREE.AmbientLight(0xc7ccd4, 0.25);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xc7ccd4, 1.5, 800);
    pointLight.position.set(0, 150, 0);
    scene.add(pointLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(200, 300, 100);
    scene.add(dirLight);

    const secondaryLight = new THREE.DirectionalLight(0x8d93a1, 0.5);
    secondaryLight.position.set(-200, 100, -200);
    scene.add(secondaryLight);

    // 4) Core Grids
    const gridColor = 0xc7ccd4;

    // Horizontal Polar Floor Grid
    const floorGroup = new THREE.Group();
    scene.add(floorGroup);

    const ringMaterial = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.12,
    });

    const boldRingMaterial = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.22,
    });

    const ringRadii = [50, 100, 150, 200, 250];
    ringRadii.forEach((r) => {
      const segments = 64;
      const geom = new THREE.BufferGeometry();
      const vertices: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        vertices.push(r * Math.cos(theta), 0, r * Math.sin(theta));
      }
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const line = new THREE.Line(geom, r === 250 ? boldRingMaterial : ringMaterial);
      floorGroup.add(line);
    });

    // Cross axes (N-S, E-W) with dashed styles
    const axesMaterial = new THREE.LineDashedMaterial({
      color: gridColor,
      dashSize: 3,
      gapSize: 3,
      transparent: true,
      opacity: 0.20,
    });

    const xAxesGeom = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-270, 0, 0, 270, 0, 0], 3),
    );
    const xAxis = new THREE.Line(xAxesGeom, axesMaterial);
    xAxis.computeLineDistances();
    floorGroup.add(xAxis);

    const zAxesGeom = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, -270, 0, 0, 270], 3),
    );
    const zAxis = new THREE.Line(zAxesGeom, axesMaterial);
    zAxis.computeLineDistances();
    floorGroup.add(zAxis);

    // Fine radial ticks around the boundary ring
    const tickMat = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.35,
    });
    for (let deg = 0; deg < 360; deg += 10) {
      const rad = (deg * Math.PI) / 180;
      const isMajor = deg % 30 === 0;
      const tickLen = isMajor ? 6 : 3;
      const startR = 250;
      const endR = 250 + tickLen;
      const tickGeom = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            startR * Math.cos(rad), 0, startR * Math.sin(rad),
            endR * Math.cos(rad), 0, endR * Math.sin(rad),
          ],
          3,
        ),
      );
      const tick = new THREE.Line(tickGeom, tickMat);
      floorGroup.add(tick);
    }

    // ── NEW: Topographic X-Ray Scanning Terrain & Shaders (Unbounded Map) ──
    const terrainVertexShader = `
      uniform float uTime;
      uniform vec2 uMapCenter;
      uniform float uMapScale;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;
      varying vec2 vUv;

      void main() {
        vec3 pos = position;
        float dist = length(pos.xz);
        
        // Dynamic radial chirp wave propagating outward from the center
        // Only ripple outside the 40m flattened origin
        if (dist > 40.0) {
          float wave = sin(dist * 0.05 - uTime * 5.0) * 3.5;
          // Fade wave out at larger distances
          wave *= (1.0 - smoothstep(150.0, 400.0, dist));
          pos.y += wave;
        }

        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vLocalPosition = position;
        
        // Map Projection UV mapping
        vUv = vec2(
          uMapCenter.x + position.x * uMapScale,
          uMapCenter.y - position.z * uMapScale
        );

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;

    const terrainFragmentShader = `
      uniform float uSweepAngle;
      uniform float uScanHeight;
      uniform vec3 uBaseColor;
      uniform vec3 uScanColor;
      uniform float uMaxRadius;
      
      uniform sampler2D uMapTexture;
      uniform float uHasTexture;
      
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;
      varying vec2 vUv;

      void main() {
        float dist = length(vWorldPosition.xz);
        
        vec3 terrainColor = uBaseColor;
        float alpha = 0.40;

        if (uHasTexture > 0.5) {
          if (vUv.x >= 0.0 && vUv.x <= 1.0 && vUv.y >= 0.0 && vUv.y <= 1.0) {
            vec4 tex = texture2D(uMapTexture, vUv);
            float g = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
            
            // Grayscale segmentation for geographic classification
            if (g > 0.06) {
              // Land
              terrainColor = mix(vec3(0.015, 0.045, 0.075), vec3(0.03, 0.09, 0.14), (g - 0.06) / 0.1);
              alpha = 0.70;
            } else {
              // Water
              terrainColor = mix(vec3(0.005, 0.015, 0.03), vec3(0.01, 0.03, 0.05), g / 0.06);
              alpha = 0.45;
            }
            if (g > 0.12) {
              // Structural buildings, streets and infrastructure footprints - bright tactical cyan
              vec3 structureGlow = vec3(0.0, 0.70, 0.85);
              terrainColor = mix(terrainColor, structureGlow, (g - 0.12) / 0.18);
              alpha = mix(alpha, 0.90, (g - 0.12) / 0.18);
            }
          }
        }

        // Screen-space constant-width grid line generator (15m spacing)
        float gridSize = 15.0;
        float xFract = fract(vLocalPosition.x / gridSize);
        float zFract = fract(vLocalPosition.z / gridSize);
        
        float gridX = abs(xFract - 0.5) / (fwidth(vLocalPosition.x) / gridSize);
        float gridZ = abs(zFract - 0.5) / (fwidth(vLocalPosition.z) / gridSize);
        float gridLine = 1.0 - min(gridX, gridZ);
        gridLine = clamp(gridLine, 0.0, 1.0);

        vec3 gridColor = vec3(0.0, 0.65, 0.8);
        vec3 compositeColor = mix(terrainColor, gridColor, gridLine * 0.22);
        float compositeAlpha = max(alpha, gridLine * 0.35);

        // Radial radar sweep scanline
        float pixelAngle = atan(vWorldPosition.x, -vWorldPosition.z);
        if (pixelAngle < 0.0) pixelAngle += 6.28318530718;

        float diff = uSweepAngle - pixelAngle;
        if (diff < 0.0) diff += 6.28318530718;

        float radialGlow = 0.0;
        if (diff < 1.0471975512) { // 60 degrees arc
          radialGlow = exp(-diff * 4.0); // sharp decay
        }

        // Horizontal topographic contour scanline
        float heightDiff = abs(vWorldPosition.y - uScanHeight);
        float heightGlow = 0.0;
        if (heightDiff < 2.5) {
          heightGlow = (1.0 - (heightDiff / 2.5)) * 0.7;
        }

        vec3 scanGlowColor = vec3(0.0, 0.9, 1.0);
        vec3 finalColor = mix(compositeColor, scanGlowColor, radialGlow * 0.55 + heightGlow * 0.45);
        float finalAlpha = max(compositeAlpha, radialGlow * 0.65 + heightGlow * 0.5);

        // Soft edge fade at the absolute outer boundaries of our rectangular grid
        float edgeFade = 1.0 - smoothstep(380.0, 480.0, dist);
        finalAlpha *= edgeFade;

        gl_FragColor = vec4(finalColor, finalAlpha);
      }
    `;

    const terrainSize = 1000; // Expanded to 1000m for unbounded map
    const terrainGeom = new THREE.PlaneGeometry(terrainSize, terrainSize, 96, 96); // Dense rugged segments
    terrainGeom.rotateX(-Math.PI / 2); // lay flat

    // Mathematical displacement for rugged topographic hills/valleys (default on-mount fallback)
    const pos = terrainGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x, z);
      let y = 0;
      if (d < 500) {
        y = Math.sin(x * 0.015) * Math.cos(z * 0.015) * 22
            + Math.sin(x * 0.04) * Math.sin(z * 0.04) * 8
            + Math.cos(x * 0.08) * Math.cos(z * 0.08) * 3;
        // Flatten center
        if (d < 40) {
          y *= (d / 40);
        }
      }
      pos.setY(i, y);
    }
    terrainGeom.computeVertexNormals();

    // Reference the geometry for async dynamic mapping
    terrainGeomRef.current = terrainGeom;

    const terrainUniforms = {
      uTime: { value: 0 },
      uSweepAngle: { value: 0 },
      uScanHeight: { value: 0 },
      uBaseColor: { value: new THREE.Color(0x141419) },
      uScanColor: { value: new THREE.Color(0xc7ccd4) },
      uMaxRadius: { value: 500 },
      // Geographic projection uniforms
      uMapTexture: { value: new THREE.Texture() },
      uMapCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uMapScale: { value: 0.0001 },
      uHasTexture: { value: 0.0 },
    };

    // Reference the uniforms for async dynamic mapping
    terrainUniformsRef.current = terrainUniforms;

    const terrainMat = new THREE.ShaderMaterial({
      vertexShader: terrainVertexShader,
      fragmentShader: terrainFragmentShader,
      uniforms: terrainUniforms,
      wireframe: false, // Set to false to show the beautiful segmented map solid texture
      transparent: true,
      depthWrite: false,
    });

    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    scene.add(terrainMesh);

    // ── HOLOGRAPHIC SCANNING DOME CAGE (Bypassed for flat unbounded map console) ──
    /*
    const domeGeom = new THREE.SphereGeometry(DOME_RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0xc7ccd4,
      wireframe: true,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const domeMesh = new THREE.Mesh(domeGeom, domeMat);
    scene.add(domeMesh);

    // ── RANGE-GATE HEMISPHERES — concentric translucent depth shells ────────
    const gateRadii = [83, 167, 250]; // 1/3, 2/3, 3/3 of dome radius
    const gateOpacities = [0.025, 0.035, 0];
    gateRadii.forEach((r, i) => {
      if (gateOpacities[i] === 0) return; // skip outermost (dome already there)
      const gateGeom = new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const gateMat = new THREE.MeshBasicMaterial({
        color: 0xc7ccd4,
        wireframe: true,
        transparent: true,
        opacity: gateOpacities[i],
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      scene.add(new THREE.Mesh(gateGeom, gateMat));
    });

    // Bold glowing base ring
    const baseRingGeom = new THREE.RingGeometry(248, 252, 64);
    baseRingGeom.rotateX(Math.PI / 2);
    const baseRingMat = new THREE.MeshBasicMaterial({
      color: 0xc7ccd4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const baseRing = new THREE.Mesh(baseRingGeom, baseRingMat);
    scene.add(baseRing);

    // Meridian scale arches
    const meridianMat = new THREE.LineBasicMaterial({
      color: 0xc7ccd4,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
    });

    const nsArchGeom = new THREE.BufferGeometry();
    const nsVerts: number[] = [];
    for (let i = 0; i <= 32; i++) {
      const theta = (i / 32) * Math.PI;
      nsVerts.push(0, 250 * Math.sin(theta), -250 * Math.cos(theta));
    }
    nsArchGeom.setAttribute('position', new THREE.Float32BufferAttribute(nsVerts, 3));
    scene.add(new THREE.Line(nsArchGeom, meridianMat));

    const ewArchGeom = new THREE.BufferGeometry();
    const ewVerts: number[] = [];
    for (let i = 0; i <= 32; i++) {
      const theta = (i / 32) * Math.PI;
      ewVerts.push(250 * Math.cos(theta), 250 * Math.sin(theta), 0);
    }
    ewArchGeom.setAttribute('position', new THREE.Float32BufferAttribute(ewVerts, 3));
    scene.add(new THREE.Line(ewArchGeom, meridianMat));

    // Vertically translating Range-Gate Scanner Laser Ring
    const scanRingGeom = new THREE.BufferGeometry();
    const scanRingVerts: number[] = [];
    for (let i = 0; i <= 64; i++) {
      const theta = (i / 64) * Math.PI * 2;
      scanRingVerts.push(Math.cos(theta), 0, Math.sin(theta));
    }
    scanRingGeom.setAttribute('position', new THREE.Float32BufferAttribute(scanRingVerts, 3));
    const scanRingMat = new THREE.LineBasicMaterial({
      color: 0xc7ccd4,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    const scanRing = new THREE.Line(scanRingGeom, scanRingMat);
    scene.add(scanRing);

    // ── HOLOGRAPHIC EMITTER (ORIGIN CONE) ───────────────────────────────────
    const emitterGroup = new THREE.Group();
    scene.add(emitterGroup);

    const emitterRings: THREE.Line[] = [];
    const emitterRingCount = 3;
    for (let i = 0; i < emitterRingCount; i++) {
      const ringGeom = new THREE.BufferGeometry();
      const verts: number[] = [];
      for (let j = 0; j <= 32; j++) {
        const theta = (j / 32) * Math.PI * 2;
        verts.push(Math.cos(theta), 0, Math.sin(theta));
      }
      ringGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const ringMat = new THREE.LineBasicMaterial({
        color: 0xc7ccd4,
        transparent: true,
        opacity: 0.35,
      });
      const ring = new THREE.Line(ringGeom, ringMat);
      emitterGroup.add(ring);
      emitterRings.push(ring);
    }

    const rayMat = new THREE.LineDashedMaterial({
      color: 0xc7ccd4,
      dashSize: 5,
      gapSize: 5,
      transparent: true,
      opacity: 0.15,
    });

    const rayGeoms: Array<[number, number, number]> = [
      [-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10],
    ];
    rayGeoms.forEach(([rx, ry, rz]) => {
      const geom = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute([rx, ry, rz, 0, 250, 0], 3),
      );
      const ray = new THREE.Line(geom, rayMat);
      ray.computeLineDistances();
      // emitterGroup.add(ray);
    });
    */

    // ── PHASED-ARRAY STEERING VECTOR (line + volumetric wedge) ──────────────
    const steerNeedleGeom = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -250], 3),
    );
    const steerNeedleMat = new THREE.LineBasicMaterial({
      color: 0xd8a553,
      transparent: true,
      opacity: 0.85,
    });
    const steerNeedle = new THREE.Line(steerNeedleGeom, steerNeedleMat);
    scene.add(steerNeedle);

    const probeGeom = new THREE.SphereGeometry(3.5, 8, 8);
    const probeMat = new THREE.MeshBasicMaterial({
      color: 0xd8a553,
      transparent: true,
      opacity: 0.9,
    });
    const probeMesh = new THREE.Mesh(probeGeom, probeMat);
    scene.add(probeMesh);

    // Volumetric beam wedge — bypassed for clean Mil-Spec needle vector
    /*
    const beamHalfAngleRad = (BEAM_HALF_ANGLE_DEG * Math.PI) / 180;
    const beamBaseRadius = DOME_RADIUS * Math.tan(beamHalfAngleRad);
    const beamWedgeGeom = new THREE.ConeGeometry(beamBaseRadius, DOME_RADIUS, 24, 1, true);
    // Translate so tip is at origin (cone default has tip at +Y, base at -Y)
    beamWedgeGeom.translate(0, -DOME_RADIUS / 2, 0);
    const beamWedgeMat = new THREE.MeshBasicMaterial({
      color: 0xd8a553,
      transparent: true,
      opacity: 0.10,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beamWedge = new THREE.Mesh(beamWedgeGeom, beamWedgeMat);
    scene.add(beamWedge);
    */

    // ── ALTITUDE GRID LADDER & TICKS ────────────────────────────────────────
    const ladderGroup = new THREE.Group();
    scene.add(ladderGroup);

    const heightLevels = [50, 100, 150, 200];
    heightLevels.forEach((h) => {
      const tickGeom = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute([-6, h, 0, 6, h, 0, 0, h, -6, 0, h, 6], 3),
      );
      const tick = new THREE.LineSegments(
        tickGeom,
        new THREE.LineBasicMaterial({
          color: 0xc7ccd4,
          transparent: true,
          opacity: 0.25,
        }),
      );
      ladderGroup.add(tick);
    });

    // ── INTER-TARGET DYNAMIC TELEMETRY KINEMATIC LINK ───────────────────────
    const linkLineGeom = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    );
    const linkLineMat = new THREE.LineDashedMaterial({
      color: 0x8d93a1,
      dashSize: 4,
      gapSize: 3,
      transparent: true,
      opacity: 0.7,
    });
    const linkLine = new THREE.Line(linkLineGeom, linkLineMat);
    linkLine.visible = false;
    scene.add(linkLine);

    // ── SELECTION LINE — dashed precise vertical drop line ──────────────────
    const selectionLineGeom = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    );
    const selectionLineMat = new THREE.LineDashedMaterial({
      color: 0xc7ccd4,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.8,
    });
    const selectionLine = new THREE.Line(selectionLineGeom, selectionLineMat);
    selectionLine.visible = false;
    scene.add(selectionLine);

    // ── PARTICLE PHOSPHOR CLOUD ─────────────────────────────────────────────
    const particleCount = 1200;
    const particleGeom = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const origPositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0) / 2.0;
      const r = 15 + Math.random() * 230;

      const px = r * Math.sin(phi) * Math.cos(theta);
      const py = r * Math.cos(phi);
      const pz = r * Math.sin(phi) * Math.sin(theta);

      particlePositions[i * 3] = px;
      particlePositions[i * 3 + 1] = py;
      particlePositions[i * 3 + 2] = pz;

      origPositions[i * 3] = px;
      origPositions[i * 3 + 1] = py;
      origPositions[i * 3 + 2] = pz;

      particleColors[i * 3] = 0.0;
      particleColors[i * 3 + 1] = 0.15;
      particleColors[i * 3 + 2] = 0.35;
    }

    particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeom.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 2.0,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particleCloud = new THREE.Points(particleGeom, particleMat);
    scene.add(particleCloud);

    // ── LIVE TARGET TRACKING MAP ────────────────────────────────────────────
    interface TargetVisual {
      group: THREE.Group;
      line: THREE.Line;
      shadow: THREE.Line;
      trail: THREE.Line;
      sensorRing: THREE.Mesh;
      innerMesh: THREE.Mesh;
      outerMesh: THREE.Mesh;
      rippleMesh: THREE.Mesh;
      boxMesh: THREE.Mesh;
      prediction: THREE.Line;
      rippleProgress: number;
      labelEl: HTMLDivElement;
    }
    const targetMeshesMap = new Map<string, TargetVisual>();

    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'radar-3d-labels';
    container.appendChild(labelsContainer);

    const THREAT_COLORS: Record<string, number> = {
      nominal: 0xaeb4bf,
      caution: 0xd8a553,
      warning: 0xd8a553,
      critical: 0xdc4f5d,
    };

    // 8) Cardinal Directions (N, S, E, W)
    const compassLabelsContainer = document.createElement('div');
    compassLabelsContainer.className = 'compass-3d-labels';
    container.appendChild(compassLabelsContainer);

    const COMPASS_POINTS = [
      { name: 'N', pos: new THREE.Vector3(0, 0, -260) },
      { name: 'E', pos: new THREE.Vector3(260, 0, 0) },
      { name: 'S', pos: new THREE.Vector3(0, 0, 260) },
      { name: 'W', pos: new THREE.Vector3(-260, 0, 0) },
    ];

    const compassEls = COMPASS_POINTS.map((cp) => {
      const el = document.createElement('div');
      el.className = `compass-label compass-label--${cp.name}`;
      el.innerText = cp.name;
      compassLabelsContainer.appendChild(el);
      return { el, pos: cp.pos };
    });

    const heightLabels = heightLevels.map((h) => {
      const el = document.createElement('div');
      el.className = 'radar-3d-height-label';
      el.innerText = `${h}m`;
      labelsContainer.appendChild(el);
      return { el, height: h };
    });

    const linkDistanceLabel = document.createElement('div');
    linkDistanceLabel.className = 'radar-3d-link-billboard';
    linkDistanceLabel.style.display = 'none';
    labelsContainer.appendChild(linkDistanceLabel);

    // ── Camera Reset (exposed via ref so HUD button can call) ────────────────
    resetCamRef.current = () => {
      const o = orbitRef.current;
      o.rotationX = CAM_INIT.rotationX;
      o.rotationY = CAM_INIT.rotationY;
      o.radius = CAM_INIT.radius;
      o.vx = 0;
      o.vy = 0;
      o.lastInteractMs = performance.now();
    };

    // ── Drag Orbit Control Event Listeners ───────────────────────────────────
    const orbit = orbitRef.current;

    const markInteract = () => {
      orbit.lastInteractMs = performance.now();
    };

    const onMouseDown = (e: MouseEvent) => {
      orbit.isDragging = true;
      orbit.startX = e.clientX;
      orbit.startY = e.clientY;
      orbit.startRotX = orbit.rotationX;
      orbit.startRotY = orbit.rotationY;
      orbit.vx = 0;
      orbit.vy = 0;
      markInteract();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!orbit.isDragging) return;
      const dx = e.clientX - orbit.startX;
      const dy = e.clientY - orbit.startY;

      const newRotY = orbit.startRotY - dx * 0.006;
      const newRotX = Math.max(0.08, Math.min(Math.PI / 2 - 0.04, orbit.startRotX + dy * 0.006));

      // Track velocity for inertial release (frame-to-frame delta)
      orbit.vy = newRotY - orbit.rotationY;
      orbit.vx = newRotX - orbit.rotationX;

      orbit.rotationY = newRotY;
      orbit.rotationX = newRotX;
      markInteract();
    };

    const onMouseUp = () => {
      orbit.isDragging = false;
      markInteract();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbit.radius = Math.max(200, Math.min(850, orbit.radius + e.deltaY * 0.45));
      markInteract();
    };

    // ── WebGL Interactive Direct 3D Target Selection ─────────────────────────
    const onCanvasClick = (e: MouseEvent) => {
      if (orbit.isDragging && Math.hypot(e.clientX - orbit.startX, e.clientY - orbit.startY) > 5) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);

      const targetsList = Array.from(targetMeshesMap.entries());
      const meshesToTest = targetsList.flatMap(([_, obj]) => [obj.innerMesh, obj.outerMesh]);

      const intersects = raycaster.intersectObjects(meshesToTest);
      if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        const found = targetsList.find(
          ([_, obj]) => obj.innerMesh === hitMesh || obj.outerMesh === hitMesh,
        );
        if (found) {
          const [targetId] = found;
          useTargetStore.getState().selectTarget(targetId);
        }
      }
      markInteract();
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('click', onCanvasClick);

    // ── Resizing ─────────────────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0) return;
      const { width: w, height: h } = entries[0].contentRect;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      fxaaPass.material.uniforms['resolution'].value.set(1 / (w * dpr), 1 / (h * dpr));
    });
    resizeObserver.observe(container);

    // ── Animation / Loop Tick ────────────────────────────────────────────────
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // 1) Camera damping (inertial release) + idle auto-rotate
      if (!orbit.isDragging) {
        if (Math.abs(orbit.vy) > 0.00005 || Math.abs(orbit.vx) > 0.00005) {
          orbit.rotationY += orbit.vy;
          orbit.rotationX = Math.max(0.08, Math.min(Math.PI / 2 - 0.04, orbit.rotationX + orbit.vx));
          orbit.vy *= DAMPING;
          orbit.vx *= DAMPING;
        } else {
          orbit.vx = 0;
          orbit.vy = 0;
          // Auto-rotate when idle (operator toggle OR 8 s no interaction)
          const idle = performance.now() - orbit.lastInteractMs > IDLE_AUTO_ROTATE_MS;
          if (autoRotateRef.current || idle) {
            orbit.rotationY += 0.0009;
          }
        }
      }

      const targetX = orbit.radius * Math.sin(orbit.rotationY) * Math.cos(orbit.rotationX);
      const targetY = orbit.radius * Math.sin(orbit.rotationX);
      const targetZ = orbit.radius * Math.cos(orbit.rotationY) * Math.cos(orbit.rotationX);
      camera.position.set(targetX, targetY, targetZ);
      camera.lookAt(0, 0, 0);

      const camElDeg = (orbit.rotationX * 180) / Math.PI;
      const camAzDeg = ((orbit.rotationY * 180) / Math.PI) % 360;
      const normalizedCamAz = camAzDeg < 0 ? camAzDeg + 360 : camAzDeg;
      const zoomFactor = ((850 - orbit.radius) / (850 - 200)) * 10;

      if (camElevRef.current) camElevRef.current.innerText = `${camElDeg.toFixed(0)}°`;
      if (camAzRef.current) camAzRef.current.innerText = `${normalizedCamAz.toFixed(0)}°`;
      if (camZoomRef.current) camZoomRef.current.innerText = `${zoomFactor.toFixed(1)}x`;

      // 2) Particle rotation
      const time = Date.now() * 0.0005;
      particleCloud.rotation.y = time * 0.1;

      // 3) Translating scan ring (Commented out for unbounded map)
      /*
      const scanY = 125 + Math.sin(Date.now() * 0.0008) * 123;
      const scanR = Math.sqrt(Math.max(0, 250 * 250 - scanY * scanY));
      scanRing.position.y = scanY;
      scanRing.scale.set(scanR, 1, scanR);
      scanRingMat.opacity = (0.12 + 0.28 * Math.sin(Date.now() * 0.0012)) * (scanR / 250);
      */

      // 4) Emitter projector rings (Commented out for unbounded map)
      /*
      emitterRings.forEach((ring, idx) => {
        const speed = 0.012;
        const progress = ((Date.now() * speed + idx * (250 / emitterRingCount)) % 250) / 250;
        const scale = progress * 240;
        ring.scale.set(scale, 1, scale);
        (ring.material as THREE.LineBasicMaterial).opacity = (1.0 - progress) * 0.35;
      });
      */

      // Update terrain sweep & contour uniforms
      if (terrainMesh && terrainUniforms) {
        terrainUniforms.uTime.value = Date.now() * 0.001; // Pass dynamic uTime for radial waves
        terrainUniforms.uSweepAngle.value = (Date.now() * 0.00157079632) % (Math.PI * 2); // 90 deg/sec sweep rate
        const scanHeight = 25 + Math.sin(Date.now() * 0.0012) * 25;
        terrainUniforms.uScanHeight.value = scanHeight;
      }

      // 5) Phosphor Noise (Particles kept static for authentic CRT/LCD clutter)
      const posAttr = particleCloud.geometry.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = particleCloud.geometry.getAttribute('color') as THREE.BufferAttribute;

      // Pulse color slightly without swirling positions
      for (let i = 0; i < particleCount; i++) {
        const pPulse = 0.12 + 0.08 * Math.sin(time * 1.5 + i * 0.2);
        colorAttr.setXYZ(i, 0.0, pPulse * 0.5, pPulse * 0.8);
      }
      colorAttr.needsUpdate = true;

      const telState = useTelemetryStore.getState().current;
      const sysConfig = useSystemStore.getState().config;

      // 6) Phased-Array Steering Vector
      if (telState) {
        const targetAzRad = (telState.beam_azimuth_deg * Math.PI) / 180;
        const targetElRad =
          ((telState.beam_elevation_deg ?? sysConfig.elevation_deg ?? 15) * Math.PI) / 180;

        // First frame: snap to live values to avoid a long "wind-up" from 0.
        if (!smoothBeamRef.current.initialized) {
          smoothBeamRef.current.az = targetAzRad;
          smoothBeamRef.current.el = targetElRad;
          smoothBeamRef.current.initialized = true;
        } else {
          // Shortest-path lerp on the azimuth (handle the ±π wraparound).
          let azDelta = targetAzRad - smoothBeamRef.current.az;
          if (azDelta > Math.PI) azDelta -= 2 * Math.PI;
          else if (azDelta < -Math.PI) azDelta += 2 * Math.PI;

          const LERP_AZ = 0.06; // ~250 ms convergence @ 60 Hz
          const LERP_EL = 0.10; // elevation jumps less; faster catch-up
          smoothBeamRef.current.az += azDelta * LERP_AZ;
          smoothBeamRef.current.el +=
            (targetElRad - smoothBeamRef.current.el) * LERP_EL;
        }

        const azSteerRad = smoothBeamRef.current.az;
        const elSteerRad = smoothBeamRef.current.el;

        const vx = 250 * Math.cos(elSteerRad) * Math.sin(azSteerRad);
        const vy = 250 * Math.sin(elSteerRad);
        const vz = -250 * Math.cos(elSteerRad) * Math.cos(azSteerRad);

        const steerPos = steerNeedle.geometry.getAttribute('position') as THREE.BufferAttribute;
        steerPos.setXYZ(1, vx, vy, vz);
        steerPos.needsUpdate = true;

        probeMesh.position.set(vx, vy, vz);
        probeMesh.rotation.y += 0.03;

        // Volumetric wedge updates commented out for clean Mil-Spec vector
        /*
        beamWedge.position.set(0, 0, 0);
        const beamDir = new THREE.Vector3(vx, vy, vz).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, beamDir);
        beamWedge.setRotationFromQuaternion(quat);
        beamWedgeMat.opacity = 0.08 + 0.06 * Math.sin(Date.now() * 0.0025);
        */

        if (beamAzRef.current) beamAzRef.current.innerText = `${telState.beam_azimuth_deg.toFixed(1)}°`;
        if (beamElRef.current)
          beamElRef.current.innerText = `${(telState.beam_elevation_deg ?? sysConfig.elevation_deg ?? 0).toFixed(1)}°`;
      }

      // 7) Update Cardinal Compass + Height Labels (projected to screen)
      compassEls.forEach((cp) => {
        const tempV = cp.pos.clone().project(camera);
        const isBehind = tempV.z > 1;
        if (isBehind) {
          cp.el.style.display = 'none';
        } else {
          cp.el.style.display = 'block';
          const px = (tempV.x * 0.5 + 0.5) * container.clientWidth;
          const py = (-(tempV.y * 0.5) + 0.5) * container.clientHeight;
          cp.el.style.left = `${px}px`;
          cp.el.style.top = `${py}px`;
        }
      });

      heightLabels.forEach((hl) => {
        const tempV = new THREE.Vector3(0, hl.height, 0);
        tempV.project(camera);
        const isBehind = tempV.z > 1;
        if (isBehind) {
          hl.el.style.display = 'none';
        } else {
          hl.el.style.display = 'block';
          const px = (tempV.x * 0.5 + 0.5) * container.clientWidth;
          const py = (-(tempV.y * 0.5) + 0.5) * container.clientHeight;
          hl.el.style.left = `${px}px`;
          hl.el.style.top = `${py}px`;
        }
      });

      // 8) Targets, trails, predictions, selection
      const targetState = useTargetStore.getState();
      const currentTargets = Array.from(targetState.targets.values());
      const maxR = rangeScaleRef.current;
      const scaleFactor = 250 / maxR;

      if (trkCountRef.current) trkCountRef.current.innerText = `${currentTargets.length}`;

      // Evict stale targets
      for (const [id, value] of targetMeshesMap.entries()) {
        if (!targetState.targets.has(id)) {
          scene.remove(value.group);
          scene.remove(value.line);
          scene.remove(value.shadow);
          scene.remove(value.trail);
          scene.remove(value.prediction);

          value.line.geometry.dispose();
          (value.line.material as THREE.Material).dispose();
          value.shadow.geometry.dispose();
          (value.shadow.material as THREE.Material).dispose();
          value.trail.geometry.dispose();
          (value.trail.material as THREE.Material).dispose();
          value.prediction.geometry.dispose();
          (value.prediction.material as THREE.Material).dispose();
          value.innerMesh.geometry.dispose();
          (value.innerMesh.material as THREE.Material).dispose();
          value.outerMesh.geometry.dispose();
          (value.outerMesh.material as THREE.Material).dispose();
          value.sensorRing.geometry.dispose();
          (value.sensorRing.material as THREE.Material).dispose();
          value.rippleMesh.geometry.dispose();
          (value.rippleMesh.material as THREE.Material).dispose();
          value.boxMesh.geometry.dispose();
          (value.boxMesh.material as THREE.Material).dispose();

          value.labelEl.remove();
          targetMeshesMap.delete(id);
        }
      }

      let selectedCoords: THREE.Vector3 | null = null;
      const selectedId: string | null = targetState.selectedTargetId;

      currentTargets.forEach((tgt) => {
        const tx = tgt.x_m * scaleFactor;
        const ty = tgt.z_m * scaleFactor;
        const tz = -tgt.y_m * scaleFactor;

        let targetObj = targetMeshesMap.get(tgt.id);
        const colorVal = THREAT_COLORS[tgt.threat_level] || 0xc7ccd4;

        if (tgt.id === selectedId) {
          selectedCoords = new THREE.Vector3(tx, ty, tz);
        }

        if (!targetObj) {
          const group = new THREE.Group();
          scene.add(group);

          const innerGeom = new THREE.OctahedronGeometry(4.5, 0);
          const innerMat = new THREE.MeshPhongMaterial({
            color: colorVal,
            emissive: colorVal,
            emissiveIntensity: 0.9,
            transparent: true,
            opacity: 0.6,
            shininess: 80,
          });
          const innerMesh = new THREE.Mesh(innerGeom, innerMat);
          group.add(innerMesh);

          const outerGeom = new THREE.OctahedronGeometry(7, 0);
          const outerMat = new THREE.MeshBasicMaterial({
            color: colorVal,
            wireframe: true,
            transparent: true,
            opacity: 0.22,
          });
          const outerMesh = new THREE.Mesh(outerGeom, outerMat);
          group.add(outerMesh);

          const sensorRingGeom = new THREE.RingGeometry(8.5, 9.5, 16);
          sensorRingGeom.rotateX(Math.PI / 2);
          const sensorRingMat = new THREE.MeshBasicMaterial({
            color: colorVal,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.35,
          });
          const sensorRing = new THREE.Mesh(sensorRingGeom, sensorRingMat);
          group.add(sensorRing);

          const rippleGeom = new THREE.SphereGeometry(1.0, 16, 12);
          const rippleMat = new THREE.MeshBasicMaterial({
            color: colorVal,
            wireframe: true,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const rippleMesh = new THREE.Mesh(rippleGeom, rippleMat);
          group.add(rippleMesh);

          const boxGeom = new THREE.BoxGeometry(10, 10, 10);
          const boxMat = new THREE.MeshBasicMaterial({
            color: 0xdc4f5d,
            wireframe: true,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const boxMesh = new THREE.Mesh(boxGeom, boxMat);
          group.add(boxMesh);

          const lineGeom = new THREE.BufferGeometry().setAttribute(
            'position',
            new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
          );
          const lineMat = new THREE.LineDashedMaterial({
            color: colorVal,
            dashSize: 3,
            gapSize: 2,
            transparent: true,
            opacity: 0.5,
          });
          const line = new THREE.Line(lineGeom, lineMat);
          scene.add(line);

          const shadowGeom = new THREE.BufferGeometry();
          const shadowVerts: number[] = [];
          const shadowSegments = 16;
          for (let i = 0; i <= shadowSegments; i++) {
            const theta = (i / shadowSegments) * Math.PI * 2;
            shadowVerts.push(4 * Math.cos(theta), 0, 4 * Math.sin(theta));
          }
          shadowGeom.setAttribute('position', new THREE.Float32BufferAttribute(shadowVerts, 3));
          const shadowMat = new THREE.LineBasicMaterial({
            color: colorVal,
            transparent: true,
            opacity: 0.3,
          });
          const shadow = new THREE.Line(shadowGeom, shadowMat);
          scene.add(shadow);

          const trailGeom = new THREE.BufferGeometry();
          const trailMat = new THREE.LineBasicMaterial({
            color: colorVal,
            transparent: true,
            opacity: 0.45,
          });
          const trail = new THREE.Line(trailGeom, trailMat);
          scene.add(trail);

          // NEW: Trajectory prediction (dashed, dim, threat-coloured)
          const predictionGeom = new THREE.BufferGeometry();
          const predictionMat = new THREE.LineDashedMaterial({
            color: colorVal,
            dashSize: 3,
            gapSize: 4,
            transparent: true,
            opacity: 0.0,
          });
          const prediction = new THREE.Line(predictionGeom, predictionMat);
          scene.add(prediction);

          const labelEl = document.createElement('div');
          labelEl.className = `radar-3d-billboard radar-3d-billboard--${tgt.threat_level}`;
          labelsContainer.appendChild(labelEl);

          targetObj = {
            group,
            line,
            shadow,
            trail,
            sensorRing,
            innerMesh,
            outerMesh,
            rippleMesh,
            boxMesh,
            prediction,
            rippleProgress: 1.0,
            labelEl,
          };
          targetMeshesMap.set(tgt.id, targetObj);
        }

        targetObj.group.position.set(tx, ty, tz);
        targetObj.sensorRing.rotation.y += 0.025;
        targetObj.sensorRing.rotation.x = Math.sin(Date.now() * 0.001) * 0.05;

        const pulse = 1.0 + Math.sin(Date.now() * 0.015) * (tgt.threat_level === 'critical' ? 0.15 : 0.05);
        targetObj.innerMesh.scale.set(pulse, pulse, pulse);
        targetObj.outerMesh.scale.set(pulse, pulse, pulse);

        if (targetObj.rippleProgress >= 1.0) {
          if (Math.random() < 0.0035) {
            targetObj.rippleProgress = 0.0;
          }
        }
        if (targetObj.rippleProgress < 1.0) {
          targetObj.rippleProgress += 0.030;
          const scale = 1.0 + targetObj.rippleProgress * 30.0;
          targetObj.rippleMesh.scale.set(scale, scale, scale);
          const rippleMat = targetObj.rippleMesh.material as THREE.MeshBasicMaterial;
          rippleMat.opacity = Math.max(0.0, (1.0 - targetObj.rippleProgress) * 0.75);
        } else {
          (targetObj.rippleMesh.material as THREE.MeshBasicMaterial).opacity = 0.0;
        }

        const isSelected = targetState.selectedTargetId === tgt.id;
        if (isSelected) {
          targetObj.boxMesh.visible = true;
          targetObj.boxMesh.rotation.x += 0.025;
          targetObj.boxMesh.rotation.y += 0.035;
          const scalePulse = 1.0 + Math.sin(Date.now() * 0.01) * 0.08;
          targetObj.boxMesh.scale.set(scalePulse, scalePulse, scalePulse);
          const boxMat = targetObj.boxMesh.material as THREE.MeshBasicMaterial;
          boxMat.opacity = 0.35 + Math.sin(Date.now() * 0.015) * 0.15;
        } else {
          targetObj.boxMesh.visible = false;
        }

        // Vertical altitude drop line — hide for selected (selection column takes over)
        if (isSelected) {
          targetObj.line.visible = false;
        } else {
          targetObj.line.visible = true;
          const linePos = targetObj.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          linePos.setXYZ(0, tx, ty, tz);
          linePos.setXYZ(1, tx, 0, tz);
          linePos.needsUpdate = true;
          targetObj.line.computeLineDistances();
        }

        targetObj.shadow.position.set(tx, 0, tz);

        // History trail
        const history = targetState.targetHistory.get(tgt.id) || [];
        const trailVerts: number[] = [];
        history.forEach((pastTgt) => {
          trailVerts.push(pastTgt.x_m * scaleFactor, pastTgt.z_m * scaleFactor, -pastTgt.y_m * scaleFactor);
        });
        targetObj.trail.geometry.setAttribute('position', new THREE.Float32BufferAttribute(trailVerts, 3));
        (targetObj.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

        // ── NEW: Trajectory prediction (warning + critical only) ────────────
        const shouldPredict = tgt.threat_level === 'warning' || tgt.threat_level === 'critical';
        const predictionMat = targetObj.prediction.material as THREE.LineDashedMaterial;
        if (shouldPredict && history.length >= 2) {
          // Per-second velocity estimate from most recent history sample
          const last = history[history.length - 1];
          const prev = history[history.length - 2];
          const dtMs = Math.max(1, last.timestamp_ms - prev.timestamp_ms);
          const vxMps = (last.x_m - prev.x_m) / (dtMs / 1000);
          const vyMps = (last.y_m - prev.y_m) / (dtMs / 1000);
          const vzMps = (last.z_m - prev.z_m) / (dtMs / 1000);

          const predVerts: number[] = [];
          for (let i = 0; i <= PREDICTION_SEGMENTS; i++) {
            const tSec = (i / PREDICTION_SEGMENTS) * PREDICTION_HORIZON_S;
            const fx = (tgt.x_m + vxMps * tSec) * scaleFactor;
            const fz = -(tgt.y_m + vyMps * tSec) * scaleFactor;
            const fy = (tgt.z_m + vzMps * tSec) * scaleFactor;
            predVerts.push(fx, fy, fz);
          }
          targetObj.prediction.geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(predVerts, 3),
          );
          (targetObj.prediction.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
          targetObj.prediction.computeLineDistances();
          predictionMat.opacity = tgt.threat_level === 'critical' ? 0.7 : 0.45;
          targetObj.prediction.visible = true;
        } else {
          targetObj.prediction.visible = false;
          predictionMat.opacity = 0.0;
        }

        // HTML billboard
        const tempV = new THREE.Vector3(tx, ty + 12, tz);
        tempV.project(camera);
        const xPercent = (tempV.x * 0.5 + 0.5) * container.clientWidth;
        const yPercent = (-(tempV.y * 0.5) + 0.5) * container.clientHeight;

        const isBehind = tempV.z > 1;
        if (isBehind) {
          targetObj.labelEl.style.display = 'none';
        } else {
          targetObj.labelEl.style.display = 'block';
          targetObj.labelEl.style.left = `${xPercent}px`;
          targetObj.labelEl.style.top = `${yPercent}px`;
          targetObj.labelEl.innerHTML = `
            <div class="r3d-b__header">
              <span class="r3d-b__id">TGT-${shortId(tgt.id)}</span>
              <span class="r3d-b__type">${tgt.classification.toUpperCase()}</span>
            </div>
            <div class="r3d-b__metrics">
              <span>R: ${formatRange(tgt.range_m)}</span>
              <span>H: ${tgt.z_m.toFixed(0)}m</span>
              <span class="r3d-b__vel" data-tone="${tgt.doppler_mps < 0 ? 'critical' : 'nominal'}">
                ${tgt.doppler_mps > 0 ? '+' : ''}${tgt.doppler_mps.toFixed(0)}m/s
              </span>
            </div>
          `;
        }
      });

      // ── Selection line precise vertical drop vector ────────────────────────
      if (selectedCoords !== null) {
        const sc = selectedCoords as THREE.Vector3;
        const linePos = selectionLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        linePos.setXYZ(0, sc.x, sc.y, sc.z);
        // Precise drop vector down to the terrain ground Y=0 plane
        linePos.setXYZ(1, sc.x, 0, sc.z);
        linePos.needsUpdate = true;
        selectionLine.computeLineDistances();
        selectionLine.visible = true;
      } else {
        selectionLine.visible = false;
      }

      // 9) Inter-Target Kinematic Link
      if (selectedCoords !== null && selectedId !== null) {
        const sc = selectedCoords as THREE.Vector3;
        let closestNeighCoords: THREE.Vector3 | null = null;
        let closestDist = Infinity;

        currentTargets.forEach((tgt) => {
          if (tgt.id === selectedId) return;
          const tx = tgt.x_m * scaleFactor;
          const ty = tgt.z_m * scaleFactor;
          const tz = -tgt.y_m * scaleFactor;
          const dist = sc.distanceTo(new THREE.Vector3(tx, ty, tz));
          if (dist < closestDist) {
            closestDist = dist;
            closestNeighCoords = new THREE.Vector3(tx, ty, tz);
          }
        });

        if (closestNeighCoords !== null) {
          const nc = closestNeighCoords as THREE.Vector3;
          const linkPos = linkLine.geometry.getAttribute('position') as THREE.BufferAttribute;
          linkPos.setXYZ(0, sc.x, sc.y, sc.z);
          linkPos.setXYZ(1, nc.x, nc.y, nc.z);
          linkPos.needsUpdate = true;
          linkLine.computeLineDistances();
          linkLine.visible = true;

          const midX = (sc.x + nc.x) / 2;
          const midY = (sc.y + nc.y) / 2 + 5;
          const midZ = (sc.z + nc.z) / 2;
          const midV = new THREE.Vector3(midX, midY, midZ);
          midV.project(camera);

          const isBehind = midV.z > 1;
          if (isBehind) {
            linkDistanceLabel.style.display = 'none';
          } else {
            linkDistanceLabel.style.display = 'block';
            const px = (midV.x * 0.5 + 0.5) * container.clientWidth;
            const py = (-(midV.y * 0.5) + 0.5) * container.clientHeight;
            linkDistanceLabel.style.left = `${px}px`;
            linkDistanceLabel.style.top = `${py}px`;
            const distanceM = closestDist / scaleFactor;
            linkDistanceLabel.innerHTML = `<span class="r3d-link-label">REL RNG: ${distanceM.toFixed(0)}m</span>`;
          }
        } else {
          linkLine.visible = false;
          linkDistanceLabel.style.display = 'none';
        }
      } else {
        linkLine.visible = false;
        linkDistanceLabel.style.display = 'none';
      }

      // Final render through composer (bloom + FXAA)
      composer.render();
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('click', onCanvasClick);
      resizeObserver.disconnect();
      labelsContainer.remove();
      compassLabelsContainer.remove();

      // Free GPU resources for every object still parented to the scene.
      // scene.clear() only detaches children — it does NOT dispose their
      // geometries/materials — so without this traversal each 2D<->3D remount
      // leaks all the static scene furniture (dome, range gates, rings, axes,
      // particle cloud, beam wedge, compass arches…) plus any live target meshes.
      scene.traverse((obj) => {
        const node = obj as Partial<THREE.Mesh>;
        if (node.geometry) node.geometry.dispose();
        const mat = node.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });

      composer.dispose();
      scene.clear();
      renderer.dispose();
    };
    // Setup runs once on mount. The rAF loop reads `rangeScaleRef.current` for
    // live range changes, so this effect intentionally does not depend on it.
  }, []);

  // ── Asynchronous 3x3 Map Tile Loader & Topographic Displacement ───────────
  useEffect(() => {
    let active = true;

    const loadMapAndDisplace = async () => {
      const geom = terrainGeomRef.current;
      const uniforms = terrainUniformsRef.current;
      if (!geom || !uniforms) return;

      // 1) Derive appropriate Web Mercator Zoom based on radar Range Scale
      const maxRadiusPx = Math.max(40, 600 / 2 - 32);
      const targetMetersPerPixel = rangeScale / maxRadiusPx;
      const EARTH_CIRCUMFERENCE = 40075016.686;
      const latRad = (gpsLat * Math.PI) / 180;
      const EQUATOR_M_PER_PX_Z0 = 156543.03392;
      
      const idealZoom = Math.log2(
        (EQUATOR_M_PER_PX_Z0 * Math.cos(latRad)) / targetMetersPerPixel
      );
      const z = Math.max(1, Math.min(18, Math.round(idealZoom)));

      // 2) Calculate Web Mercator fractional tile coordinates
      const n = Math.pow(2, z);
      const xFrac = ((gpsLon + 180) / 360) * n;
      const yFrac =
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

      const xTile = Math.floor(xFrac);
      const yTile = Math.floor(yFrac);

      const dx = xFrac - xTile;
      const dy = yFrac - yTile;

      // Center coordinates inside our 3x3 canvas (each tile is 256px, canvas is 768px)
      const uCenter = (1 + dx) / 3;
      const vCenter = (2 - dy) / 3;

      // Width of a tile in ground meters at current latitude
      const wTile = (EARTH_CIRCUMFERENCE * Math.cos(latRad)) / n;

      // Map scale mapping Three.js mesh coordinates [-500, 500] to UV coordinate space
      const mapScale = rangeScale / (750 * wTile);

      // Create offscreen canvas for stitching
      const canvas = document.createElement('canvas');
      canvas.width = 768;
      canvas.height = 768;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#020304';
      ctx.fillRect(0, 0, 768, 768);

      // 3) Load the 9 tiles asynchronously in a 3x3 grid
      const tilePromises: Promise<{ img: HTMLImageElement | null; col: number; row: number }>[] = [];

      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          const X = xTile + col;
          const Y = yTile + row;
          const wrappedX = (X + n) % n;
          const wrappedY = Math.max(0, Math.min(n - 1, Y));
          const url = `https://basemaps.cartocdn.com/rastertiles/dark_all/${z}/${wrappedX}/${wrappedY}.png`;

          tilePromises.push(
            new Promise((resolve) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => resolve({ img, col: col + 1, row: row + 1 });
              img.onerror = () => resolve({ img: null, col: col + 1, row: row + 1 });
              img.src = url;
            })
          );
        }
      }

      const results = await Promise.all(tilePromises);
      if (!active) return;

      // 4) Draw the loaded tiles onto our canvas
      results.forEach(({ img, col, row }) => {
        if (img) {
          ctx.drawImage(img, col * 256, row * 256, 256, 256);
        }
      });

      // 5) Read canvas ImageData for real-time vertex displacement
      const imgData = ctx.getImageData(0, 0, 768, 768);
      const pixels = imgData.data;

      const pos = geom.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const xLocal = pos.getX(i);
        const zLocal = pos.getZ(i);

        const u = uCenter + xLocal * mapScale;
        const v = vCenter - zLocal * mapScale;

        const px = Math.min(767, Math.max(0, Math.floor(u * 768)));
        const py = Math.min(767, Math.max(0, Math.floor((1 - v) * 768)));

        const idx = (py * 768 + px) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        let y = 0;
        const dist = Math.hypot(xLocal, zLocal);

        if (gray > 0.06 && dist < 500) {
          const landFactor = Math.min(1.0, (gray - 0.06) / 0.1);
          // Natural rolling hills/mountains base height
          const noise = Math.sin(xLocal * 0.015) * Math.cos(zLocal * 0.015) * 22
                      + Math.sin(xLocal * 0.04) * Math.sin(zLocal * 0.04) * 8
                      + Math.cos(xLocal * 0.08) * Math.cos(zLocal * 0.08) * 3;
          y = (10.0 + Math.abs(noise)) * landFactor;

          // High-fidelity structural displacement (buildings, roads, highways)
          if (gray > 0.12) {
            // Generate micro-voxel rectangular plateau blocks simulating urban building densities
            const structureFactor = Math.min(1.5, (gray - 0.12) / 0.2);
            const sharpCol = Math.sin(xLocal * 0.40) * Math.cos(zLocal * 0.40); // high frequency voxel grid
            y += (8.0 + sharpCol * 2.5) * structureFactor;
          }

          if (dist < 40.0) {
            y *= (dist / 40.0);
          }
        }
        pos.setY(i, y);
      }

      pos.needsUpdate = true;
      geom.computeVertexNormals();

      // 6) Upload the stitched canvas as a Three.js Texture
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      
      if (uniforms.uMapTexture.value && uniforms.uMapTexture.value.dispose) {
        uniforms.uMapTexture.value.dispose();
      }
      uniforms.uMapTexture.value = texture;
      uniforms.uMapCenter.value.set(uCenter, vCenter);
      uniforms.uMapScale.value = mapScale;
      uniforms.uHasTexture.value = 1.0;
    };

    loadMapAndDisplace();

    return () => {
      active = false;
    };
  }, [gpsLat, gpsLon, rangeScale]);

  return (
    <div ref={containerRef} className="radar-3d-container" data-mode={layoutPreset}>
      <CornerBrackets size={14} thickness={1} inset={10} bindToConnection opacity={0.55} />

      <div className="ppi-label ppi-label--tl" aria-hidden>
        <IconScan size={11} /> <span>3D TACTICAL DOME</span>
      </div>

      {/* Camera & Phased-Array Steering Vector HUD */}
      <div className="radar-3d-hud" aria-hidden>
        <div className="r3d-hud-panel r3d-hud-panel--left">
          <div className="r3d-hud-item">
            <span className="r3d-hud-item__lbl">CAM ELEVATION</span>
            <span ref={camElevRef} className="r3d-hud-item__val">--°</span>
          </div>
          <div className="r3d-hud-item">
            <span className="r3d-hud-item__lbl">CAM AZIMUTH</span>
            <span ref={camAzRef} className="r3d-hud-item__val">--°</span>
          </div>
          <div className="r3d-hud-item">
            <span className="r3d-hud-item__lbl">ZOOM SCALE</span>
            <span ref={camZoomRef} className="r3d-hud-item__val">--x</span>
          </div>
        </div>
        <div className="r3d-hud-panel r3d-hud-panel--right">
          <div className="r3d-hud-item">
            <span className="r3d-hud-item__lbl">BEAM AZIMUTH</span>
            <span ref={beamAzRef} className="r3d-hud-item__val">--°</span>
          </div>
          <div className="r3d-hud-item">
            <span className="r3d-hud-item__lbl">BEAM ELEVATION</span>
            <span ref={beamElRef} className="r3d-hud-item__val">--°</span>
          </div>
          <div className="r3d-hud-item">
            <span className="r3d-hud-item__lbl">TRACKED FLTS</span>
            <span ref={trkCountRef} className="r3d-hud-item__val">--</span>
          </div>
        </div>
      </div>

      {/* Top-right cam controls — reset + auto-rotate */}
      <div className="radar-3d__cam-controls" aria-label="Camera controls">
        <button
          type="button"
          className="radar-3d__cam-btn"
          onClick={() => resetCamRef.current()}
          title="Reset camera to default angle"
        >
          RESET CAM
        </button>
        <button
          type="button"
          className="radar-3d__cam-btn"
          data-active={autoRotate || undefined}
          onClick={() => setAutoRotate((v) => !v)}
          title="Toggle continuous camera auto-rotate"
        >
          AUTO ROTATE {autoRotate ? '· ON' : '· OFF'}
        </button>
      </div>

      {/* Bottom 2D/3D mode toggle */}
      <div className="radar-3d__controls">
        <button
          type="button"
          className="radar-3d__toggle-btn"
          onClick={() => setRadarMode('2D')}
        >
          2D PPI VIEW
        </button>
        <button
          type="button"
          className="radar-3d__toggle-btn radar-3d__toggle-btn--active"
        >
          3D DOME VIEW
        </button>
      </div>

      <canvas ref={canvasRef} className="radar-3d-canvas" />
      <MissionModeRail />
    </div>
  );
}
