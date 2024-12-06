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
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/src/workers/ParallelMeshBVHWorker.js';
import { getScaledSettings } from './utils/getScaledSettings.js';
import { LoaderElement } from './utils/LoaderElement.js';
import { ShapedAreaLight, WebGLPathTracer } from '..';

let pathTracer, renderer, controls;
let camera, scene;
let loader;

init();

async function init() {
	const { tiles, renderScale } = getScaledSettings();

	loader = new LoaderElement();
	loader.attach( document.body );

	// renderer
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild( renderer.domElement );

	// path tracer
	pathTracer = new WebGLPathTracer( renderer );
	pathTracer.filterGlossyFactor = 0.5;
	pathTracer.renderScale = renderScale;
	pathTracer.tiles.set( tiles, tiles );
	pathTracer.setBVHWorker( new ParallelMeshBVHWorker() );
    pathTracer.dynamicLowRes = true;
    pathTracer.lowResScale = 1.0;

	// camera
	camera = new PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( 0, 2, 16 );
    camera.lookAt( 0, 2, 0 );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => pathTracer.updateCamera() );
	controls.update();

    // scene
	scene = new Scene();
	// scene.backgroundBlurriness = 0.05;

    const plane = new PlaneGeometry(4, 4);

    const ceilingMaterial = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
    const floorMaterial = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, clearcoat: 1.0, roughness: 0.5, metalness: 0.5 });
    const leftMaterial = new THREE.MeshPhysicalMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const rightMaterial = new THREE.MeshPhysicalMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
    const backMaterial = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });

    const floor = new THREE.Mesh(plane, floorMaterial);
    floor.position.z = 2;
    floor.rotateX(-Math.PI/2);

    const back = new THREE.Mesh(plane, backMaterial);
    back.position.y = 2;

    const left = new THREE.Mesh(plane, leftMaterial);
    left.position.x = -2;
    left.position.y = 2;
    left.position.z = 2;
    left.rotateY(Math.PI/2);

    const right = new THREE.Mesh(plane, rightMaterial);
    right.position.x = 2;
    right.position.y = 2;
    right.position.z = 2;
    right.rotateY(-Math.PI/2);

    const ceiling = new THREE.Mesh(plane, ceilingMaterial);
    ceiling.position.y = 4;
    ceiling.position.z = 2;
    ceiling.rotateX(Math.PI/2);

    const areaLight = new THREE.RectAreaLight(0xffffff, 5, 1, 1);
    areaLight.position.y = 3.999;
    areaLight.position.z = 2;
    areaLight.rotateX(-Math.PI/2);

    const lightGeom = new THREE.PlaneGeometry(1, 1);
    const lightEmissiveMat = new THREE.MeshPhysicalMaterial({ emissive: 0xffffff, emissiveIntensity: 2.0 });
    const lightEmissiveTile = new THREE.Mesh(lightGeom, lightEmissiveMat);
    lightEmissiveTile.position.y = 3.999;
    lightEmissiveTile.position.z = 2;
    lightEmissiveTile.rotateX(Math.PI/2);

    const box1Geom = new THREE.BoxGeometry(1.2, 2.7);
    const box1Mat = new THREE.MeshPhysicalMaterial();
    const box1 = new THREE.Mesh(box1Geom, box1Mat);
    box1.position.z = 1.35;
    box1.position.y = 1;
    box1.position.x = -0.7;
    box1.rotateY(Math.PI/9);

    const box2Geom = new THREE.BoxGeometry(1.2, 1.2);
    const box2Mat = new THREE.MeshPhysicalMaterial();
    const box2 = new THREE.Mesh(box2Geom, box2Mat);
    box2.position.z = 2.5;
    box2.position.y = 0.6;
    box2.position.x = 0.7;
    box2.rotateY(-Math.PI/7);

    scene.add(floor);
    scene.add(ceiling);
    scene.add(left);
    scene.add(right);
    scene.add(back);

    // scene.add(areaLight);
    scene.add(lightEmissiveTile);

    scene.add(box1);
    scene.add(box2);

    await pathTracer.setSceneAsync(scene, camera, {
        onProgress: v => {
            loader.setPercentage(v);
        }
    });

	onResize();
	window.addEventListener( 'resize', onResize );
	animate();
}

function onResize() {

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	pathTracer.updateCamera();

}

renderer.setAnimationLoop(animate);
function animate() {
    // renderer.render(scene, camera);
    pathTracer.renderSample();
	loader.setSamples( pathTracer.samples, pathTracer.isCompiling );
}
