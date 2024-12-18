import { PathTracingSceneGenerator } from './PathTracingSceneGenerator.js';
import { RestirDiMaterial, SimpleMaterial, Pass, AverageSamplesMaterial } from '../materials/di/RestirDiMaterial.js';
import { ClampedInterpolationMaterial } from '../materials/fullscreen/ClampedInterpolationMaterial.js';
import { MATERIAL_PIXELS } from '../uniforms/MaterialsTexture.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';
import { getTextures } from './utils/sceneUpdateUtils.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { NoBlending, WebGLRenderer, WebGLRenderTarget, RGBAFormat, FloatType, NearestFilter, Vector2, Matrix4, HalfFloatType, ClampToEdgeWrapping } from 'three';
import { MeshBVHUniformStruct, UIntVertexAttributeTexture, BVHShaderGLSL, BVHWorker } from 'three-mesh-bvh';

// uniforms
import { PhysicalCameraUniform } from '../uniforms/PhysicalCameraUniform.js';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { LightsInfoUniformStruct } from '../uniforms/LightsInfoUniformStruct.js';
import { EmissiveTrianglesInfoUniformStruct } from '../uniforms/EmissiveTrianglesInfoUniformStruct.js';
import { AttributesTextureArray } from '../uniforms/AttributesTextureArray.js';
import { MaterialsTexture, MATERIAL_PIXELS } from '../uniforms/MaterialsTexture.js';
import { RenderTarget2DArray } from '../uniforms/RenderTarget2DArray.js';
import { StratifiedSamplesTexture } from '../uniforms/StratifiedSamplesTexture.js';
import { BlueNoiseTexture } from '../textures/BlueNoiseTexture.js';

import * as THREE from 'three';

export class RestirPathTracer {

    /**
     * 
     * @param {WebGLRenderer} renderer 
     */
    constructor( renderer ) {

        this.renderer = renderer;
        this.nSamples = 0;
        this.generator = new PathTracingSceneGenerator();
		this.textureSize = new Vector2( 1024, 1024 );

        this.sharedDefines = {

            FEATURE_MIS: 1,
            FEATURE_RUSSIAN_ROULETTE: 1,
            FEATURE_DOF: 1,
            FEATURE_BACKGROUND_MAP: 0,
            FEATURE_FOG: 1,

            // 0 = PCG
            // 1 = Sobol
            // 2 = Stratified List
            RANDOM_TYPE: 1,

            // 0 = Perspective
            // 1 = Orthographic
            // 2 = Equirectangular
            CAMERA_TYPE: 0,

            DEBUG_MODE: 0,

            ATTR_NORMAL: 0,
            ATTR_TANGENT: 1,
            ATTR_UV: 2,
            ATTR_COLOR: 3,
            MATERIAL_PIXELS: MATERIAL_PIXELS,

        };

        this.sharedUniforms = {

            // path trace uniforms
            resolution: { value: new Vector2() },
            opacity: { value: 1 },
            bounces: { value: 10 },
            transmissiveBounces: { value: 10 },
            filterGlossyFactor: { value: 0 },

            // camera uniforms
            physicalCamera: { value: new PhysicalCameraUniform() },
            cameraWorldMatrix: { value: new Matrix4() },
            invProjectionMatrix: { value: new Matrix4() },

            // scene uniforms
            bvh: { value: new MeshBVHUniformStruct() },
            attributesArray: { value: new AttributesTextureArray() },
            materialIndexAttribute: { value: new UIntVertexAttributeTexture() },
            materials: { value: new MaterialsTexture() },
            textures: { value: new RenderTarget2DArray().texture },

            // light uniforms
            lights: { value: new LightsInfoUniformStruct() },
            iesProfiles: { value: new RenderTarget2DArray( 360, 180, {
                type: HalfFloatType,
                wrapS: ClampToEdgeWrapping,
                wrapT: ClampToEdgeWrapping,
            } ).texture },
            environmentIntensity: { value: 1.0 },
            environmentRotation: { value: new Matrix4() },
            envMapInfo: { value: new EquirectHdrInfoUniform() },
            emissiveTriangles: { value: new EmissiveTrianglesInfoUniformStruct() },

            // background uniforms
            backgroundBlur: { value: 0.0 },
            backgroundMap: { value: null },
            backgroundAlpha: { value: 1.0 },
            backgroundIntensity: { value: 1.0 },
            backgroundRotation: { value: new Matrix4() },

            // randomness uniforms
            seed: { value: 0 },
            sobolTexture: { value: null },
            stratifiedTexture: { value: new StratifiedSamplesTexture() },
            stratifiedOffsetTexture: { value: new BlueNoiseTexture( 64, 1 ) },

        };
        this.sharedUniforms.stratifiedTexture.value.init( 20, 24 ); // @todo: what should this be?

        this.passGenSample = new FullScreenQuad( new RestirDiMaterial( Pass.GenSample, { blending: THREE.NoBlending } ) );
        this.passShadePixel = new FullScreenQuad( new RestirDiMaterial( Pass.ShadePixel ) );
        this.passAverageSamples = new FullScreenQuad( new AverageSamplesMaterial() );
        this.passToneMap = new FullScreenQuad( new ClampedInterpolationMaterial( {
			map: null,
			transparent: true,
			blending: NoBlending,

			premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
        } ) );

        this.pingTarget = new WebGLRenderTarget( 1, 1, {

            format: RGBAFormat,
            type: FloatType,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            depthBuffer: false,
            generateMipmaps: false,

        } );
        this.pongTarget = new WebGLRenderTarget( 1, 1, {

            format: RGBAFormat,
            type: FloatType,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            depthBuffer: false,
            generateMipmaps: false,

        } );
        this.pungTarget = new WebGLRenderTarget( 1, 1, {

            format: RGBAFormat,
            type: FloatType,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            depthBuffer: false,
            generateMipmaps: false,

        } );
        this.samplesTarget = new WebGLRenderTarget( 1, 1, {

			format: RGBAFormat,
			type: FloatType,
			depthBuffer: false,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
            internalFormat: 'RGBA32F',
			count: 5,

		} );
        this.sobolTarget = new SobolNumberMapGenerator().generate( renderer );

        this.passGenSample.material.uniforms = {

            ...this.passGenSample.material.uniforms,
            ...this.sharedUniforms,

        };
        this.passGenSample.material.defines = {

            ...this.passGenSample.material.defines,
            ...this.sharedDefines,

        };

        this.passGenSample.material.uniforms = {
            
            ...this.passGenSample.material.uniforms,
            ...this.sharedUniforms,
            M_area: { value: 0 },
            M_bsdf: { value: 1 },

        };
        this.passShadePixel.material.uniforms = {

            ...this.passShadePixel.material.uniforms,
            ...this.sharedUniforms,
            surfaceHit_faceIndices: { value: this.samplesTarget.textures[ 0 ] },
            surfaceHit_barycoord_side: { value: this.samplesTarget.textures[ 1 ] },
            surfaceHit_faceNormal_dist: { value: this.samplesTarget.textures[ 2 ] },
            pathX2: { value: this.samplesTarget.textures[ 3 ] },
            pathInfo: { value: this.samplesTarget.textures[ 4 ] },

        };
        this.passShadePixel.material.defines = {

            ...this.passShadePixel.material.defines,
            ...this.sharedDefines,

        };

        // set dummy scene and camera
		this.setScene( new THREE.Scene(), new THREE.PerspectiveCamera() );

    }

    renderSample() {

        const ogRenderTarget = this.renderer.getRenderTarget();
        const ogAutoClear = this.renderer.autoClear;

        if ( this.queueReset ) {
            
            this.doReset();
            this.queueReset = false;

        }

        this.updateScale();

        this.renderer.autoClear = false;

        // update uniforms
        this.sharedUniforms.opacity.value = THREE.NoBlending;
        this.sharedUniforms.resolution.value.set( this.pingTarget.width, this.pingTarget.height ); // @todo: subwidth, as in the original code?
        this.sharedUniforms.sobolTexture.value = this.sobolTarget.texture;
        this.sharedUniforms.stratifiedTexture.value.next();
        this.sharedUniforms.seed.value++;

        // generate sample
        this.passGenSample.material.onBeforeRender();
        this.renderer.setRenderTarget( this.samplesTarget );
        this.passGenSample.render( this.renderer );

        // shade pixel
        this.passShadePixel.material.onBeforeRender();
        this.renderer.setRenderTarget( this.pingTarget );
        this.passShadePixel.render( this.renderer );

        // average samples
        this.passAverageSamples.material.uniforms.nSamples.value = this.nSamples;
        this.passAverageSamples.material.uniforms.curr.value = this.pungTarget.texture;
        this.passAverageSamples.material.uniforms.newSample.value = this.pingTarget.texture;
        this.renderer.setRenderTarget( this.pongTarget );
        this.passAverageSamples.render( this.renderer );

        // tone map
        this.renderer.setRenderTarget( ogRenderTarget );
        this.renderer.autoClear = ogAutoClear;
        this.passToneMap.material.onBeforeRender();
        this.passToneMap.material.uniforms.map.value = this.pongTarget.texture;
        this.passToneMap.render( this.renderer );

        this.nSamples++;

        [ this.pongTarget, this.pungTarget ] = [ this.pungTarget, this.pongTarget ];

    }

    updateCamera() {

        this.camera.updateMatrixWorld();

        this.sharedUniforms.cameraWorldMatrix.value.copy( this.camera.matrixWorld );
        this.sharedUniforms.invProjectionMatrix.value.copy( this.camera.projectionMatrixInverse );
        this.sharedUniforms.physicalCamera.value.updateFrom( this.camera );

		// Perspective camera (default)
		let cameraType = 0;

		// An orthographic projection matrix will always have the bottom right element == 1
		// And a perspective projection matrix will always have the bottom right element == 0
		if ( this.camera.projectionMatrix.elements[ 15 ] > 0 ) {

			// Orthographic
			cameraType = 1;

		}

		if ( this.camera.isEquirectCamera ) {

			// Equirectangular
			cameraType = 2;

		}

		this.passShadePixel.material.setDefine( 'CAMERA_TYPE', cameraType );
        this.passGenSample.material.setDefine( 'CAMERA_TYPE', cameraType );

        this.reset();

    }

    /**
     * 
     * @param {THREE.Camera} camera 
     */
    setCamera( camera ) {

		this.camera = camera;
        this.updateCamera();

    }

    updateScale() {

        const resolution = new THREE.Vector2();
        this.renderer.getDrawingBufferSize( resolution );

        this.setSize( resolution.x, resolution.y );

    }

    setSize( w, h ) {

        if (this.pingTarget.width === w && this.pingTarget.height === h) return;

        this.pingTarget.setSize( w, h );
        this.pongTarget.setSize( w, h );
        this.pungTarget.setSize( w, h );
        this.samplesTarget.setSize( w, h );

        this.reset();

    }

    /**
     * 
     * @param {THREE.Scene} scene 
     * @param {THREE.Camera} camera 
     */
    setScene( scene, camera ) {

        scene.updateMatrixWorld( true );
        camera.updateMatrixWorld();

        this.generator.setObjects( scene );
        const result = this.generator.generate();
        this.updateFromGeneratorResult( scene, camera, result );

    }

    /**
     * 
     * @param {BVHWorker} worker 
     */
    setBVHWorker( worker ) {

        this.generator.setBVHWorker( worker );

    }

    /**
     * 
     * @param {THREE.Scene} scene 
     * @param {THREE.Camera} camera 
     * @param {*} result 
     */
    updateFromGeneratorResult( scene, camera, result ) {

		const {
			materials,
			geometry,
			bvh,
			bvhChanged,
			needsMaterialIndexUpdate,
			emissiveTriangles,
		} = result;

        if ( bvhChanged ) {

            this.sharedUniforms.bvh.value.updateFrom( bvh );
            this.sharedUniforms.attributesArray.value.updateFrom(

				geometry.attributes.normal,
				geometry.attributes.tangent,
				geometry.attributes.uv,
				geometry.attributes.color,

            );
            
        }

		if ( needsMaterialIndexUpdate ) {

			this.sharedUniforms.materialIndexAttribute.value.updateFrom( geometry.attributes.materialIndex );

		}

        this.scene = scene;
        this.camera = camera;
        this.materials = materials;
        this.emissiveTriangles = emissiveTriangles;

        this.updateCamera();
        this.updateMaterials();
        this.updateEmissiveTriangles();

    }

    updateMaterials() {

        const textures = getTextures( this.materials );
        this.sharedUniforms.textures.value.setTextures( this.renderer, textures, this.textureSize.x, this.textureSize.y );
        this.sharedUniforms.materials.value.updateFrom( this.materials, textures );

        this.reset();

    }

    updateEmissiveTriangles() {

        this.sharedUniforms.emissiveTriangles.value.updateFrom( this.emissiveTriangles );

        this.reset();

    }

    reset() {

        this.queueReset = true;

    }

    doReset() {

        const ogRenderTarget = this.renderer.getRenderTarget();
        const ogClearAlpha = this.renderer.getClearAlpha();
        const ogClearColor = new THREE.Color();
        this.renderer.getClearColor( ogClearColor );

        this.renderer.setRenderTarget( this.pingTarget );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.clearColor();

        this.renderer.setRenderTarget( this.pongTarget );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.clearColor();

        this.renderer.setRenderTarget( this.pungTarget );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.clearColor();

        this.renderer.setRenderTarget( this.samplesTarget );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.clearColor();

        this.renderer.setRenderTarget( ogRenderTarget );
        this.renderer.setClearColor( ogClearColor, ogClearAlpha );

        this.nSamples = 0;

        // @todo: consider if we need the stable noise stuff

    }

}