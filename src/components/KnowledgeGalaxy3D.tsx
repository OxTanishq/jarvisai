import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GraphData, GraphLink, GraphNode } from '../types/jarvis.ts';

export const GROUP_PALETTE: Record<string, { hex: number; css: string; label: string }> = {
  strategy: { hex: 0xf59e0b, css: '#f59e0b', label: 'Strategy' },
  operations: { hex: 0x06b6d4, css: '#06b6d4', label: 'Operations' },
  clients: { hex: 0x10b981, css: '#10b981', label: 'Clients' },
  finance: { hex: 0x818cf8, css: '#818cf8', label: 'Finance' },
  product: { hex: 0xf43f5e, css: '#f43f5e', label: 'Product' },
  captures: { hex: 0xfde047, css: '#fde047', label: 'Captures' },
  root: { hex: 0xe2e8f0, css: '#e2e8f0', label: 'General' }
};

export interface KnowledgeGalaxyHandle {
  /** ONE VIEWER FUNCTION FOR NEW NOTES (Prompt 05): birth, link, pulse, fly */
  addNote: (node: GraphNode, newLinks: GraphLink[], relatedNodeId: number) => void;
  flyToNode: (nodeId: number) => void;
  highlightCluster: (nodeIds: number[]) => void;
  resetCamera: () => void;
}

interface KnowledgeGalaxy3DProps {
  initialGraph: GraphData;
  selectedNodeId: number | null;
  highlightedIds: number[];
  activeGroupFilter: string | null;
  onSelectNode: (node: GraphNode | null) => void;
}

interface StarVisualEntry {
  node: GraphNode;
  groupObj: THREE.Group;
  coreMat: THREE.MeshStandardMaterial;
  ringMat: THREE.MeshStandardMaterial;
  haloMat: THREE.SpriteMaterial;
  hitMesh: THREE.Mesh;
  baseColor: THREE.Color;
  targetPos: THREE.Vector3;
}

interface BirthPulseEffect {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
}

// Pre-allocated math helpers outside animation loop (zero per-frame GC)
const _camDir = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();
const _dimWhite = new THREE.Color(0x334155);

const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return false;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

function createRadialGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.22, 'rgba(255, 255, 255, 0.72)');
  grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.16)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const KnowledgeGalaxy3D = forwardRef<KnowledgeGalaxyHandle, KnowledgeGalaxy3DProps>(
  function KnowledgeGalaxy3D(
    { initialGraph, selectedNodeId, highlightedIds, activeGroupFilter, onSelectNode },
    ref
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [hoveredLabel, setHoveredLabel] = useState<{
      title: string;
      group: string;
      x: number;
      y: number;
    } | null>(null);

    // Mutable scene refs so React HUD updates never tear down WebGL
    const onSelectNodeRef = useRef(onSelectNode);
    onSelectNodeRef.current = onSelectNode;

    const selectedIdRef = useRef<number | null>(selectedNodeId);
    selectedIdRef.current = selectedNodeId;

    const highlightedSetRef = useRef<Set<number>>(new Set(highlightedIds));
    highlightedSetRef.current = new Set(highlightedIds);

    const groupFilterRef = useRef<string | null>(activeGroupFilter);
    groupFilterRef.current = activeGroupFilter;

    const sceneApiRef = useRef<{
      stars: Map<number, StarVisualEntry>;
      links: GraphLink[];
      rebuildLinkGeometry: () => void;
      spawnStarVisual: (node: GraphNode, startAt?: THREE.Vector3) => StarVisualEntry;
      triggerBirthPulse: (origin: THREE.Vector3, colorHex: number) => void;
      glideCameraTo: (focusTarget: THREE.Vector3, distance: number) => void;
      cancelCameraGlide: () => void;
    } | null>(null);

    useImperativeHandle(ref, () => ({
      addNote(node: GraphNode, newLinks: GraphLink[], relatedNodeId: number) {
        const api = sceneApiRef.current;
        if (!api) return;
        const parentStar = api.stars.get(relatedNodeId);
        const birthOrigin = parentStar
          ? parentStar.groupObj.position.clone()
          : new THREE.Vector3(node.x, node.y, node.z);

        // 1. Birth at parent star position, spring-gliding out to its orbital coordinate
        api.spawnStarVisual(node, birthOrigin);

        // 2. Link into constellation live
        for (const l of newLinks) {
          api.links.push(l);
        }
        api.rebuildLinkGeometry();

        // 3. Brief expanding luminescence pulse
        const palette = GROUP_PALETTE[node.group] ?? GROUP_PALETTE.captures;
        api.triggerBirthPulse(new THREE.Vector3(node.x, node.y, node.z), palette.hex);

        // 4. Fly camera to newly born star
        api.glideCameraTo(new THREE.Vector3(node.x, node.y, node.z), 32);
      },

      flyToNode(nodeId: number) {
        const api = sceneApiRef.current;
        if (!api) return;
        const star = api.stars.get(nodeId);
        if (!star) return;
        api.glideCameraTo(star.targetPos.clone(), 30);
      },

      highlightCluster(nodeIds: number[]) {
        const api = sceneApiRef.current;
        if (!api || nodeIds.length === 0) return;
        _centroid.set(0, 0, 0);
        let count = 0;
        for (const id of nodeIds) {
          const st = api.stars.get(id);
          if (st) {
            _centroid.add(st.targetPos);
            count++;
          }
        }
        if (count > 0) {
          _centroid.divideScalar(count);
          api.glideCameraTo(_centroid.clone(), count >= 4 ? 76 : 36);
        }
      },

      resetCamera() {
        const api = sceneApiRef.current;
        if (!api) return;
        api.glideCameraTo(new THREE.Vector3(0, 0, 0), 128);
      }
    }));

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x06080d);
      scene.fog = new THREE.FogExp2(0x06080d, 0.0022);

      const camera = new THREE.PerspectiveCamera(52, width / height, 0.5, 900);
      camera.position.set(0, 34, 128);

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance'
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      container.appendChild(renderer.domElement);

      // Studio PBR Environment reflection (mandatory per threejs skill)
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = envRT.texture;
      pmremGenerator.dispose();

      // Warm Key Light + Cool Hemisphere Fill + Rim Light
      const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
      scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.45);
      keyLight.position.set(60, 90, 75);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
      rimLight.position.set(-70, -40, -60);
      scene.add(rimLight);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.06;
      controls.minDistance = 12;
      controls.maxDistance = 280;
      controls.autoRotate = !isSoftwareGl;
      controls.autoRotateSpeed = 0.35;

      const glowTex = createRadialGlowTexture();
      glowTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

      // Deep background starfield (2,200 stars)
      const bgStarCount = 2200;
      const bgPositions = new Float32Array(bgStarCount * 3);
      const bgColors = new Float32Array(bgStarCount * 3);
      for (let i = 0; i < bgStarCount; i++) {
        const r = 160 + Math.random() * 340;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        bgPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        bgPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        bgPositions[i * 3 + 2] = r * Math.cos(phi);

        const tint = 0.68 + Math.random() * 0.32;
        bgColors[i * 3] = tint * 0.92;
        bgColors[i * 3 + 1] = tint * 0.96;
        bgColors[i * 3 + 2] = tint;
      }
      const bgStarGeo = new THREE.BufferGeometry();
      bgStarGeo.setAttribute('position', new THREE.BufferAttribute(bgPositions, 3));
      bgStarGeo.setAttribute('color', new THREE.BufferAttribute(bgColors, 3));
      const bgStarMat = new THREE.PointsMaterial({
        size: 2.2,
        map: glowTex,
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const bgStarPoints = new THREE.Points(bgStarGeo, bgStarMat);
      scene.add(bgStarPoints);

      // Shared geometries for multi-part composite celestial nodes
      const coreGeo = new THREE.IcosahedronGeometry(1.22, 1);
      const ringGeo = new THREE.TorusGeometry(2.15, 0.085, 8, 36);
      const hitGeo = new THREE.SphereGeometry(2.9, 10, 10);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const pulseGeo = new THREE.RingGeometry(1.4, 2.0, 40);

      const galaxyRoot = new THREE.Group();
      scene.add(galaxyRoot);

      const stars = new Map<number, StarVisualEntry>();
      const hitTargets: THREE.Object3D[] = [];
      const links: GraphLink[] = [...initialGraph.links];
      const pulses: BirthPulseEffect[] = [];

      let linkMesh: THREE.LineSegments | null = null;

      function spawnStarVisual(node: GraphNode, startAt?: THREE.Vector3): StarVisualEntry {
        const existing = stars.get(node.id);
        if (existing) return existing;

        const palette = GROUP_PALETTE[node.group] ?? GROUP_PALETTE.root;
        const baseColor = new THREE.Color(palette.hex);

        // Composite 3-part procedural celestial star node (core + astrolabe ring + corona sprite)
        const groupObj = new THREE.Group();
        const targetPos = new THREE.Vector3(node.x, node.y, node.z);
        groupObj.position.copy(startAt ?? targetPos);

        const coreMat = new THREE.MeshStandardMaterial({
          color: baseColor,
          emissive: baseColor,
          emissiveIntensity: 0.55,
          roughness: 0.2,
          metalness: 0.55
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        groupObj.add(coreMesh);

        const ringMat = new THREE.MeshStandardMaterial({
          color: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
          emissive: baseColor,
          emissiveIntensity: 0.22,
          roughness: 0.52,
          metalness: 0.88
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.set(
          ((node.id * 47) % 180) * (Math.PI / 180),
          ((node.id * 83) % 180) * (Math.PI / 180),
          0
        );
        groupObj.add(ringMesh);

        const haloMat = new THREE.SpriteMaterial({
          map: glowTex,
          color: baseColor,
          transparent: true,
          opacity: 0.68,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        const haloSprite = new THREE.Sprite(haloMat);
        haloSprite.scale.set(7.5, 7.5, 1);
        groupObj.add(haloSprite);

        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.layers.set(1);
        hitMesh.userData = { nodeId: node.id };
        groupObj.add(hitMesh);
        hitTargets.push(hitMesh);

        galaxyRoot.add(groupObj);

        const entry: StarVisualEntry = {
          node,
          groupObj,
          coreMat,
          ringMat,
          haloMat,
          hitMesh,
          baseColor,
          targetPos
        };
        stars.set(node.id, entry);
        return entry;
      }

      for (const n of initialGraph.nodes) {
        spawnStarVisual(n);
      }

      function rebuildLinkGeometry() {
        if (linkMesh) {
          galaxyRoot.remove(linkMesh);
          linkMesh.geometry.dispose();
          (linkMesh.material as THREE.Material).dispose();
          linkMesh = null;
        }
        if (links.length === 0) return;

        const positions = new Float32Array(links.length * 6);
        const colors = new Float32Array(links.length * 6);

        for (let i = 0; i < links.length; i++) {
          const l = links[i];
          const s = stars.get(l.source);
          const t = stars.get(l.target);
          if (!s || !t) continue;
          positions[i * 6] = s.groupObj.position.x;
          positions[i * 6 + 1] = s.groupObj.position.y;
          positions[i * 6 + 2] = s.groupObj.position.z;
          positions[i * 6 + 3] = t.groupObj.position.x;
          positions[i * 6 + 4] = t.groupObj.position.y;
          positions[i * 6 + 5] = t.groupObj.position.z;

          colors[i * 6] = s.baseColor.r * 0.45;
          colors[i * 6 + 1] = s.baseColor.g * 0.45;
          colors[i * 6 + 2] = s.baseColor.b * 0.45;
          colors[i * 6 + 3] = t.baseColor.r * 0.45;
          colors[i * 6 + 4] = t.baseColor.g * 0.45;
          colors[i * 6 + 5] = t.baseColor.b * 0.45;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });

        linkMesh = new THREE.LineSegments(geo, mat);
        galaxyRoot.add(linkMesh);
      }

      rebuildLinkGeometry();

      function triggerBirthPulse(origin: THREE.Vector3, colorHex: number) {
        const mat = new THREE.MeshBasicMaterial({
          color: colorHex,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        const mesh = new THREE.Mesh(pulseGeo, mat);
        mesh.position.copy(origin);
        mesh.lookAt(camera.position);
        galaxyRoot.add(mesh);
        pulses.push({ mesh, mat, age: 0, duration: 1.6 });
      }

      // Camera smooth exponential glide state
      let isGliding = false;
      const desiredTarget = new THREE.Vector3(0, 0, 0);
      const desiredCamPos = new THREE.Vector3(0, 34, 128);

      function glideCameraTo(focusTarget: THREE.Vector3, distance: number) {
        desiredTarget.copy(focusTarget);
        _camDir.subVectors(camera.position, controls.target);
        if (_camDir.lengthSq() < 0.01) {
          _camDir.set(0, 0.3, 1);
        }
        _camDir.normalize();
        desiredCamPos.copy(focusTarget).addScaledVector(_camDir, distance);
        controls.autoRotate = false;
        isGliding = true;
      }

      function cancelCameraGlide() {
        isGliding = false;
      }

      // Cancel scripted transition immediately when user manually grabs OrbitControls
      controls.addEventListener('start', () => {
        isGliding = false;
        controls.autoRotate = false;
      });

      sceneApiRef.current = {
        stars,
        links,
        rebuildLinkGeometry,
        spawnStarVisual,
        triggerBirthPulse,
        glideCameraTo,
        cancelCameraGlide
      };

      // Raycasting on dedicated layer 1
      const raycaster = new THREE.Raycaster();
      raycaster.layers.set(1);
      const pointer = new THREE.Vector2();
      let hoveredId: number | null = null;
      let lastMoveRaycast = 0;
      let pointerDownPos = { x: 0, y: 0 };

      const onPointerDown = (e: PointerEvent) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
      };

      const onPointerUp = (e: PointerEvent) => {
        const dx = e.clientX - pointerDownPos.x;
        const dy = e.clientY - pointerDownPos.y;
        if (dx * dx + dy * dy > 36) return; // Dragged orbit, not a click

        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(hitTargets, false);
        if (hits.length > 0) {
          const hitId = hits[0].object.userData.nodeId as number;
          const entry = stars.get(hitId);
          if (entry) {
            glideCameraTo(entry.targetPos.clone(), 30);
            onSelectNodeRef.current(entry.node);
          }
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        const now = performance.now();
        if (now - lastMoveRaycast < 45) return;
        lastMoveRaycast = now;

        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(hitTargets, false);

        if (hits.length > 0) {
          const hitId = hits[0].object.userData.nodeId as number;
          hoveredId = hitId;
          renderer.domElement.style.cursor = 'pointer';
          const st = stars.get(hitId);
          if (st) {
            _projVec.copy(st.groupObj.position).project(camera);
            setHoveredLabel({
              title: st.node.label,
              group: st.node.group,
              x: ((_projVec.x + 1) / 2) * rect.width,
              y: ((-_projVec.y + 1) / 2) * rect.height
            });
          }
        } else {
          if (hoveredId !== null) {
            hoveredId = null;
            renderer.domElement.style.cursor = 'grab';
            setHoveredLabel(null);
          }
        }
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
      renderer.domElement.addEventListener('pointermove', onPointerMove);

      const onResize = () => {
        if (!container) return;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      const clock = new THREE.Clock();
      let frameId = 0;
      let unmounted = false;

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
        if (gl.flush) gl.flush();
        if (!sync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const poll = () => {
          if (unmounted) return;
          const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      }

      function tick() {
        if (unmounted) return;
        const dt = Math.min(0.05, clock.getDelta());

        // Determine active/neighbour highlight sets
        const selId = selectedIdRef.current;
        const hiSet = highlightedSetRef.current;
        const groupFilter = groupFilterRef.current;
        const neighbourSet = new Set<number>();

        if (selId !== null) {
          neighbourSet.add(selId);
          for (const l of links) {
            if (l.source === selId) neighbourSet.add(l.target);
            if (l.target === selId) neighbourSet.add(l.source);
          }
        }
        for (const id of hiSet) {
          neighbourSet.add(id);
        }

        const hasFocus = selId !== null || hiSet.size > 0 || groupFilter !== null;
        let positionsMoved = false;

        stars.forEach((st, id) => {
          // Smooth spring-damping for newly born stars gliding from parent star
          if (st.groupObj.position.distanceToSquared(st.targetPos) > 0.002) {
            st.groupObj.position.x = THREE.MathUtils.damp(st.groupObj.position.x, st.targetPos.x, 4.5, dt);
            st.groupObj.position.y = THREE.MathUtils.damp(st.groupObj.position.y, st.targetPos.y, 4.5, dt);
            st.groupObj.position.z = THREE.MathUtils.damp(st.groupObj.position.z, st.targetPos.z, 4.5, dt);
            positionsMoved = true;
          }

          // Subtle orbital rotation on ring
          const ringChild = st.groupObj.children[1];
          if (ringChild) {
            ringChild.rotation.z += dt * 0.35;
          }

          const isPrimary = id === selId || hiSet.has(id) || id === hoveredId;
          const isNeighbour = neighbourSet.has(id);
          const matchesGroup = !groupFilter || st.node.group === groupFilter;

          let targetScale = 1.0;
          let targetEmissive = 0.55;
          let targetHaloOpacity = 0.65;

          if (isPrimary) {
            targetScale = 1.55;
            targetEmissive = 1.35;
            targetHaloOpacity = 0.98;
          } else if (hasFocus) {
            if (isNeighbour && matchesGroup) {
              targetScale = 1.18;
              targetEmissive = 0.82;
              targetHaloOpacity = 0.78;
            } else if (!groupFilter || !matchesGroup) {
              targetScale = 0.78;
              targetEmissive = 0.14;
              targetHaloOpacity = 0.16;
            }
          }

          const nextS = THREE.MathUtils.damp(st.groupObj.scale.x, targetScale, 8, dt);
          st.groupObj.scale.setScalar(nextS);
          st.coreMat.emissiveIntensity = THREE.MathUtils.damp(st.coreMat.emissiveIntensity, targetEmissive, 8, dt);
          st.haloMat.opacity = THREE.MathUtils.damp(st.haloMat.opacity, targetHaloOpacity, 8, dt);
        });

        // Update link line positions & brightness when stars move or focus changes
        if (linkMesh) {
          const posAttr = linkMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
          const colAttr = linkMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

          for (let i = 0; i < links.length; i++) {
            const l = links[i];
            const s = stars.get(l.source);
            const t = stars.get(l.target);
            if (!s || !t) continue;

            if (positionsMoved) {
              posAttr.setXYZ(i * 2, s.groupObj.position.x, s.groupObj.position.y, s.groupObj.position.z);
              posAttr.setXYZ(i * 2 + 1, t.groupObj.position.x, t.groupObj.position.y, t.groupObj.position.z);
            }

            const linkActive =
              (selId !== null && (l.source === selId || l.target === selId)) ||
              (hiSet.has(l.source) && hiSet.has(l.target)) ||
              (groupFilter !== null && s.node.group === groupFilter && t.node.group === groupFilter);

            const mult = linkActive ? 1.15 : hasFocus ? 0.12 : 0.42;
            _colorA.copy(s.baseColor).lerp(_dimWhite, linkActive ? 0 : 0.3).multiplyScalar(mult);
            _colorB.copy(t.baseColor).lerp(_dimWhite, linkActive ? 0 : 0.3).multiplyScalar(mult);
            colAttr.setXYZ(i * 2, _colorA.r, _colorA.g, _colorA.b);
            colAttr.setXYZ(i * 2 + 1, _colorB.r, _colorB.g, _colorB.b);
          }

          if (positionsMoved) posAttr.needsUpdate = true;
          colAttr.needsUpdate = true;
        }

        // Update birth shockwave pulses
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.age += dt;
          const progress = p.age / p.duration;
          if (progress >= 1) {
            galaxyRoot.remove(p.mesh);
            p.mat.dispose();
            pulses.splice(i, 1);
          } else {
            const scale = 1 + progress * 9.5;
            p.mesh.scale.setScalar(scale);
            p.mesh.lookAt(camera.position);
            p.mat.opacity = (1 - progress) * 0.9;
          }
        }

        // Smooth camera exponential glide
        if (isGliding) {
          camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredCamPos.x, 4.2, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCamPos.y, 4.2, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredCamPos.z, 4.2, dt);

          controls.target.x = THREE.MathUtils.damp(controls.target.x, desiredTarget.x, 5.2, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, desiredTarget.y, 5.2, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, desiredTarget.z, 5.2, dt);

          if (
            camera.position.distanceToSquared(desiredCamPos) < 0.25 &&
            controls.target.distanceToSquared(desiredTarget) < 0.1
          ) {
            isGliding = false;
            if (selectedIdRef.current === null && highlightedSetRef.current.size === 0 && !isSoftwareGl) {
              controls.autoRotate = true;
            }
          }
        } else if (selectedIdRef.current === null && highlightedSetRef.current.size === 0 && !isSoftwareGl) {
          controls.autoRotate = true;
        }

        bgStarPoints.rotation.y += dt * 0.008;
        controls.update();
        renderer.render(scene, camera);

        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
      }

      tick();

      return () => {
        unmounted = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        window.removeEventListener('resize', onResize);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        controls.dispose();
        coreGeo.dispose();
        ringGeo.dispose();
        hitGeo.dispose();
        hitMat.dispose();
        pulseGeo.dispose();
        bgStarGeo.dispose();
        bgStarMat.dispose();
        glowTex.dispose();
        envRT.dispose();
        stars.forEach((st) => {
          st.coreMat.dispose();
          st.ringMat.dispose();
          st.haloMat.dispose();
        });
        if (linkMesh) {
          linkMesh.geometry.dispose();
          (linkMesh.material as THREE.Material).dispose();
        }
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      };
      // Initialize WebGL canvas strictly once; incremental additions flow via addNote() handle
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <div className="relative w-full h-full select-none">
        {/* Isolated WebGL mount container */}
        <div ref={mountRef} className="absolute inset-0 w-full h-full" />

        {/* Projected 2D star hover label (no backdrop-filter over WebGL) */}
        {hoveredLabel && (
          <div
            className="pointer-events-none absolute z-20 px-3 py-1.5 rounded-md bg-[#090d16]/95 border border-white/15 shadow-lg text-xs text-slate-100 whitespace-nowrap"
            style={{
              transform: `translate3d(${Math.round(hoveredLabel.x + 14)}px, ${Math.round(hoveredLabel.y - 14)}px, 0)`
            }}
          >
            <span className="font-medium">{hoveredLabel.title}</span>
            <span className="mx-1.5 text-slate-500">·</span>
            <span className="text-slate-400 capitalize">{hoveredLabel.group}</span>
          </div>
        )}
      </div>
    );
  }
);
