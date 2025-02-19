import {
	ACESFilmicToneMapping,
	Scene,
	WebGLRenderer,
	PerspectiveCamera,
    PlaneGeometry,
    MeshPhysicalMaterial,
    Mesh,
    RectAreaLight,
    PointLight,
    Quaternion,
} from 'three';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { ShapedAreaLight, WebGLPathTracer, RestirPathTracer } from '..';

let pathTracer, renderer, controls;
let camera, scene;
let loader;
let box1, box2;
let clock;

const moveSpeed = 0.1;
const move = { forward: 0, backward: 0, left: 0, right: 0, up: 0, down: 0 };


init();

async function init() {
	const { tiles, renderScale } = getScaledSettings();

    clock = new THREE.Clock();

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild( renderer.domElement );

    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "Unknown";
    const rendererInfo = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "Unknown";

    console.log("GPU Vendor:", vendor);
    console.log("GPU Renderer:", rendererInfo);

	// path tracer
	// pathTracer = new WebGLPathTracer( renderer );
	// pathTracer.filterGlossyFactor = 0.5;
	// pathTracer.renderScale = renderScale;
	// pathTracer.tiles.set( tiles, tiles );
	// pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
    // pathTracer.dynamicLowRes = true;
    // pathTracer.lowResScale = 1.0;
    // pathTracer.bounces = 3;

    pathTracer = new RestirPathTracer( renderer );
    pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );

	// camera
	camera = new PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 2.7, 2.7, 16 );
	camera.lookAt( 2.7, 2.7, 15 );

	// controls = new FlyControls( camera, renderer.domElement );
	controls = new PointerLockControls( camera, renderer.domElement );
    document.addEventListener( "click", () => controls.lock() );

    document.addEventListener('keydown', (event) => {
        switch (event.code) {
            case 'KeyW': move.forward = 1; break;
            case 'KeyS': move.backward = 1; break;
            case 'KeyA': move.left = 1; break;
            case 'KeyD': move.right = 1; break;
            case 'KeyE': move.up = 1; break;
            case 'KeyQ': move.down = 1; break;
        }
    });

    document.addEventListener('keyup', (event) => {
        switch (event.code) {
            case 'KeyW': move.forward = 0; break;
            case 'KeyS': move.backward = 0; break;
            case 'KeyA': move.left = 0; break;
            case 'KeyD': move.right = 0; break;
            case 'KeyE': move.up = 0; break;
            case 'KeyQ': move.down = 0; break;
        }
    });

	// controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	// controls.update();

	// controls.target.set( 2, 0, 0 );
	// camera.lookAt( controls.target );

    // scene
	scene = new Scene();
	// scene.backgroundBlurriness = 0.05;

    const plane = new PlaneGeometry(5.55, 5.55);

    const ceilingMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const floorMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const rightMaterial = new THREE.MeshPhysicalMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
    const leftMaterial = new THREE.MeshPhysicalMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const backMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, side: THREE.DoubleSide });

    const floor = new THREE.Mesh(plane, floorMaterial);
    floor.position.x = 5.55 / 2;
    floor.position.y = 0;
    floor.position.z = 5.55 / 2;
    floor.rotateX(-Math.PI/2);

    const back = new THREE.Mesh(plane, backMaterial);
    back.position.x = 5.55 / 2;
    back.position.y = 5.55 / 2;
    back.position.z = 0;

    const left = new THREE.Mesh(plane, leftMaterial);
    left.position.x = 0;
    left.position.y = 5.55 / 2;
    left.position.z = 5.55 / 2;
    left.rotateY(Math.PI/2);

    const right = new THREE.Mesh(plane, rightMaterial);
    right.position.x = 5.55;
    right.position.y = 5.55 / 2;
    right.position.z = 5.55 / 2;
    right.rotateY(-Math.PI/2);

    const ceiling = new THREE.Mesh(plane, ceilingMaterial);
    ceiling.position.x = 5.55 / 2;
    ceiling.position.y = 5.55;
    ceiling.position.z = 5.55 / 2;
    ceiling.rotateX(Math.PI/2);

    const areaLight = new THREE.RectAreaLight(0xffffff, 10, 1, 1);
    areaLight.position.x = 5.55 / 2;
    areaLight.position.y = 5.55 - 1e-5;
    areaLight.position.z = 5.55 / 2;
    areaLight.rotateX(-Math.PI/2);

    const lightGeom = new THREE.PlaneGeometry(1, 1);
    const lightEmissiveMat = new THREE.MeshPhysicalMaterial({ emissive: 0xffffff, emissiveIntensity: 10.0 });
    const lightEmissiveTile = new THREE.Mesh(lightGeom, lightEmissiveMat);
    lightEmissiveTile.position.x = 5.55 / 2;
    lightEmissiveTile.position.y = 5.55 - 1e-5;
    lightEmissiveTile.position.z = 5.55 / 2;
    lightEmissiveTile.rotateX(Math.PI/2);

    const box1Geom = new THREE.BoxGeometry(1.65, 3.3, 1.65);
    const box1Mat = new THREE.MeshPhysicalMaterial();
    box1 = new THREE.Mesh(box1Geom, box1Mat);
    box1.translateX(1.25 + 1.65/2);
    box1.translateY(0 + 3.3/2);
    box1.translateZ(0.95 + 1.65/2);
    box1.rotateY(0.3925);

    const box2Geom = new THREE.BoxGeometry(1.65, 1.65, 1.65);
    const box2Mat = new THREE.MeshPhysicalMaterial();
    box2 = new THREE.Mesh(box2Geom, box2Mat);
    box2.translateX(2.6 + 1.65/2);
    box2.translateY(0 + 1.65/2);
    box2.translateZ(3.25 + 1.65/2);
    box2.rotateY(-0.314);

    // box2.position.z = 2.0;
    // box2.position.y = 0.7;
    // box2.position.x = 1.3;

    // box2.rotateY(-Math.PI/7);

    scene.add(floor);
    scene.add(ceiling);
    scene.add(left);
    scene.add(right);
    scene.add(back);

    // scene.add(areaLight);
    scene.add(lightEmissiveTile);

    scene.add(box1);
    scene.add(box2);

    pathTracer.setScene( scene, camera );

    loader.setPercentage( 100 );
    // await pathTracer.setSceneAsync(scene, camera, {
    //     onProgress: v => {
    //         loader.setPercentage(v);
    //     }
    // });

	onResize();
	window.addEventListener( 'resize', onResize );
	animate();

    const dpr = window.devicePixelRatio;
    const size = new THREE.Vector2();
    renderer.getSize(size);

    const fragmentWidth = size.width * dpr;
    const fragmentHeight = size.height * dpr;

    console.log(`Fragment resolution: ${fragmentWidth} x ${fragmentHeight}`);

}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

function animate() {

    requestAnimationFrame( animate );

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    
    if (move.forward) camera.position.addScaledVector(direction, moveSpeed);
    if (move.backward) camera.position.addScaledVector(direction, -moveSpeed);
    
    const right = new THREE.Vector3();
    right.crossVectors(direction, camera.up).normalize();

    if (move.left) camera.position.addScaledVector(right, -moveSpeed);
    if (move.right) camera.position.addScaledVector(right, moveSpeed);

    if (move.up) camera.position.addScaledVector(camera.up, moveSpeed);
    if (move.down) camera.position.addScaledVector(camera.up, -moveSpeed);

    pathTracer.updateCamera();

    pathTracer.renderSample();

    scene.updateMatrixWorld();

	loader.setSamples( pathTracer.nSamples, false );
	// loader.setSamples( pathTracer.samples, pathTracer.isCompiling );

}
