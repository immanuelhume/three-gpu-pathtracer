import {
	Vector2,
	Vector3,
	WebGLRenderer,
	ACESFilmicToneMapping,
	Scene,
	MeshBasicMaterial,
	CustomBlending,
	Group,
	SphereGeometry,
	MeshStandardMaterial,
	Mesh,
	Raycaster,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathTracingRenderer, PhysicalPathTracingMaterial, PhysicalCamera, BlurredEnvMapGenerator, GradientEquirectTexture, WebGLPathTracer } from '../src/index.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let renderer, controls, sceneInfo, camera, scene;
let samplesEl;
const mouse = new Vector2();
const focusPoint = new Vector3();
const params = {

	bounces: 3,
	samplesPerFrame: 1,
	resolutionScale: 1 / window.devicePixelRatio,
	filterGlossyFactor: 0.5,
	tiles: 1,
	autoFocus: true,

};

// clamp value for mobile
const aspectRatio = window.innerWidth / window.innerHeight;
if ( aspectRatio < 0.65 ) {

	params.bounces = Math.max( params.bounces, 6 );
	params.resolutionScale *= 0.5;
	params.tiles = 2;

}

init();

async function init() {

	renderer = new WebGLPathTracer( { antialias: true } );
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.tiles.set( params.tiles, params.tiles );
	document.body.appendChild( renderer.domElement );

	camera = new PhysicalCamera( 60, window.innerWidth / window.innerHeight, 0.025, 500 );
	camera.position.set( - 0.262, 0.5276, - 1.1606 );
	camera.apertureBlades = 6;
	camera.fStop = 0.6;
	camera.focusDistance = 1.1878;
	focusPoint.set( - 0.5253353217832674, 0.3031596413506029, 0.000777794185259223 );

	const gradientMap = new GradientEquirectTexture();
	gradientMap.topColor.set( 0x390f20 ).convertSRGBToLinear();
	gradientMap.bottomColor.set( 0x151b1f ).convertSRGBToLinear();
	gradientMap.update();

	scene = new Scene();
	scene.background = gradientMap;
	scene.environmentIntensity = 0.5;

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( - 0.182, 0.147, 0.06 );
	controls.update();
	controls.addEventListener( 'change', () => {

		renderer.reset();

	} );

	samplesEl = document.getElementById( 'samples' );

	const envMapPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/royal_esplanade_1k.hdr' )
		.then( texture => {

			const generator = new BlurredEnvMapGenerator( renderer._renderer );
			const blurredTex = generator.generate( texture, 0.35 );
			generator.dispose();
			texture.dispose();

			scene.environment = blurredTex;

		} );


	const gltfPromise = new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/sd-macross-city-standoff-diorama/scene.glb' )
		.then( gltf => {

			const group = new Group();

			const geometry = new SphereGeometry( 1, 10, 10 );
			const mat = new MeshStandardMaterial( {
				emissiveIntensity: 10,
				emissive: 0xffffff
			} );
			for ( let i = 0; i < 300; i ++ ) {

				const m = new Mesh(
					geometry,
					mat
				);
				m.scale.setScalar( 0.075 * Math.random() + 0.03 );
				m.position.randomDirection().multiplyScalar( 30 + Math.random() * 15 );
				group.add( m );

			}

			gltf.scene.scale.setScalar( 0.5 );
			gltf.scene.updateMatrixWorld();
			group.add( gltf.scene );

			gltf.scene.traverse( c => {

				if ( c.material ) {

					c.material.roughness = 0.05;
					c.material.metalness = 0.05;

				}

			} );

			scene.add( group );

		} );

	await Promise.all( [ gltfPromise, envMapPromise ] );
	renderer.updateScene( camera, scene );

	document.getElementById( 'loading' ).remove();

	onResize();
	window.addEventListener( 'resize', onResize );
	renderer.domElement.addEventListener( 'mouseup', onMouseUp );
	renderer.domElement.addEventListener( 'mousedown', onMouseDown );

	const gui = new GUI();
	const ptFolder = gui.addFolder( 'Path Tracing' );
	ptFolder.add( params, 'tiles', 1, 4, 1 ).onChange( value => {

		renderer.tiles.set( value, value );

	} );
	ptFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	ptFolder.add( params, 'bounces', 1, 30, 1 ).onChange( reset );
	ptFolder.add( params, 'resolutionScale', 0.1, 1 ).onChange( v => {

		renderer.resolutionScale = v;
		renderer.reset();

	} );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( camera, 'focusDistance', 1, 100 ).onChange( reset ).listen();
	cameraFolder.add( camera, 'apertureBlades', 0, 10, 1 ).onChange( function ( v ) {

		camera.apertureBlades = v === 0 ? 0 : Math.max( v, 3 );
		this.updateDisplay();
		reset();

	} );
	cameraFolder.add( camera, 'apertureRotation', 0, 12.5 ).onChange( reset );
	cameraFolder.add( camera, 'anamorphicRatio', 0.1, 10.0 ).onChange( reset );
	cameraFolder.add( camera, 'bokehSize', 0, 100 ).onChange( reset ).listen();
	cameraFolder.add( camera, 'fStop', 0.02, 20 ).onChange( reset ).listen();
	cameraFolder.add( camera, 'fov', 25, 100 ).onChange( () => {

		camera.updateProjectionMatrix();
		reset();

	} ).listen();
	cameraFolder.add( params, 'autoFocus' );

	animate();

}

function onMouseDown( e ) {

	mouse.set( e.clientX, e.clientY );

}

function onMouseUp( e ) {

	const deltaMouse = Math.abs( mouse.x - e.clientX ) + Math.abs( mouse.y - e.clientY );
	if ( deltaMouse < 2 && sceneInfo ) {

		const bvh = sceneInfo.bvh;
		const raycaster = new Raycaster();
		raycaster.setFromCamera( {

			x: ( e.clientX / window.innerWidth ) * 2 - 1,
			y: - ( e.clientY / window.innerHeight ) * 2 + 1,

		}, camera );

		const hit = bvh.raycastFirst( raycaster.ray );
		if ( hit ) {

			focusPoint.copy( hit.point );
			camera.focusDistance = hit.distance - camera.near;
			reset();

		}

	}

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();

}

function reset() {

	renderer.filterGlossyFactor = params.filterGlossyFactor;
	renderer.bounces = params.bounces;

	renderer.updateScene( camera, scene );

}

function animate() {

	requestAnimationFrame( animate );

	if ( params.autoFocus ) {

		camera.focusDistance = camera.position.distanceTo( focusPoint ) - camera.near;
		reset();

	}

	renderer.renderSample();

	samplesEl.innerText = `Samples: ${ Math.floor( renderer.samples ) }`;

}




