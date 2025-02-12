import { PathTracingSceneGenerator } from './PathTracingSceneGenerator.js';
import { RestirDiMaterial, SimpleMaterial, Pass, AverageSamplesMaterial } from '../materials/di/RestirDiMaterial.js';
import { ClampedInterpolationMaterial } from '../materials/fullscreen/ClampedInterpolationMaterial.js';
import { MATERIAL_PIXELS } from '../uniforms/MaterialsTexture.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';
import { getTextures } from './utils/sceneUpdateUtils.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { NoBlending, WebGLRenderer, WebGLRenderTarget, WebGLArrayRenderTarget, RGBAFormat, FloatType, NearestFilter, Vector2, Matrix4, HalfFloatType, ClampToEdgeWrapping } from 'three';
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

            // restir details
            hasPrevFrame: { value: 0 },

            // camera uniforms
            physicalCamera: { value: new PhysicalCameraUniform() },
            cameraWorldMatrix: { value: new Matrix4() },
            invCameraWorldMatrix: { value: new Matrix4() },       // current frame's view mat
            invCameraWorldMatrixPrev: { value: new Matrix4() },   // previous frame's view mat
            cameraProjectionMatrix: { value: new Matrix4() },     // current frame's proj mat
            cameraProjectionMatrixPrev: { value: new Matrix4() }, // previous frame's proj mat
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
            // stratifiedTexture: { value: new StratifiedSamplesTexture() },
            // stratifiedOffsetTexture: { value: new BlueNoiseTexture( 64, 1 ) },

        };
        // this.sharedUniforms.stratifiedTexture.value.init( 20, 24 ); // @todo: what should this be?

        this.passGenSample = new FullScreenQuad( new RestirDiMaterial( Pass.GenSample, { blending: THREE.NoBlending } ) );
        // this.passSpatialReuse = new FullScreenQuad( new RestirDiMaterial( Pass.SpatialReuse, { blending: THREE.NoBlending } ) );
        this.passTemporalReuse = new FullScreenQuad( new RestirDiMaterial( Pass.TemporalReuse, { blending: THREE.NoBlending } ) );
        this.passSaveSample = new FullScreenQuad( new RestirDiMaterial( Pass.SaveSample, { blending: THREE.NoBlending } ) );
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
			count: 7,

		} );
        // this.spatialReuseTarget = new WebGLRenderTarget( 1, 1, {

		// 	format: RGBAFormat,
		// 	type: FloatType,
		// 	depthBuffer: false,
		// 	magFilter: NearestFilter,
		// 	minFilter: NearestFilter,
        //     internalFormat: 'RGBA32F',
		// 	count: 2,

		// } );
        this.temporalReuseTargetA = new WebGLRenderTarget( 1, 1, {

			format: RGBAFormat,
			type: FloatType,
			depthBuffer: false,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
            internalFormat: 'RGBA32F',
			count: 4,

		} );
        this.temporalReuseTargetB = new WebGLRenderTarget( 1, 1, {

			format: RGBAFormat,
			type: FloatType,
			depthBuffer: false,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
            internalFormat: 'RGBA32F',
			count: 4,

		} );
        this.sobolTarget = new SobolNumberMapGenerator().generate( renderer );

        this.passGenSample.material.uniforms = {

            ...this.passGenSample.material.uniforms,
            ...this.sharedUniforms,
            M_area: { value: 8 },
            M_bsdf: { value: 1 }, // @todo: remove this

        };
        this.passGenSample.material.defines = {

            ...this.passGenSample.material.defines,
            ...this.sharedDefines,

        };

        // this.passSpatialReuse.material.uniforms = {

        //     ...this.passSpatialReuse.material.uniforms,
        //     ...this.sharedUniforms,
        //     surfaceHit_faceIndices: { value: this.samplesTarget.textures[ 0 ] },
        //     surfaceHit_barycoord_side: { value: this.samplesTarget.textures[ 1 ] },
        //     surfaceHit_faceNormal_dist: { value: this.samplesTarget.textures[ 2 ] },
        //     pathX1_in: { value: this.samplesTarget.textures[ 3 ] },
        //     pathX2_in: { value: this.samplesTarget.textures[ 4 ] },
        //     pathInfo_in: { value: this.samplesTarget.textures[ 5 ] },

        // };
        // this.passSpatialReuse.material.defines = {

        //     ...this.passSpatialReuse.material.defines,
        //     ...this.sharedDefines,

        // };

        this.passTemporalReuse.material.uniforms = {

            ...this.passTemporalReuse.material.uniforms,
            ...this.sharedUniforms,
            surfaceHit_faceIndices: { value: this.samplesTarget.textures[ 0 ] },
            surfaceHit_barycoord_side: { value: this.samplesTarget.textures[ 1 ] },
            surfaceHit_faceNormal_dist: { value: this.samplesTarget.textures[ 2 ] },
            pathX2_in: { value: this.samplesTarget.textures[ 3 ] },
            pathInfo_in: { value: this.samplesTarget.textures[ 4 ] },
            pathInfo_Li_in: { value: this.samplesTarget.textures[ 5 ] },
            pathInfo_wi_in: { value: this.samplesTarget.textures[ 6 ] },

        };
        this.passTemporalReuse.material.defines = {

            ...this.passTemporalReuse.material.defines,
            ...this.sharedDefines,

        };

        this.passShadePixel.material.uniforms = {

            ...this.passShadePixel.material.uniforms,
            ...this.sharedUniforms,
            surfaceHit_faceIndices: { value: this.samplesTarget.textures[ 0 ] },
            surfaceHit_barycoord_side: { value: this.samplesTarget.textures[ 1 ] },
            surfaceHit_faceNormal_dist: { value: this.samplesTarget.textures[ 2 ] },

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
        // this.sharedUniforms.stratifiedTexture.value.next();
        this.sharedUniforms.seed.value++;

        // generate sample
        this.passGenSample.material.onBeforeRender();
        this.renderer.setRenderTarget( this.samplesTarget );
        this.passGenSample.render( this.renderer );

        // spatial reuse
        // this.passSpatialReuse.material.onBeforeRender();
        // this.renderer.setRenderTarget( this.spatialReuseTarget );
        // this.passSpatialReuse.render( this.renderer );

        // temporal reuse
        this.passTemporalReuse.material.uniforms.pathX2_in_prev = { value: this.temporalReuseTargetB.textures[ 0 ] };
        this.passTemporalReuse.material.uniforms.pathInfo_in_prev = { value: this.temporalReuseTargetB.textures[ 1 ] };
        this.passTemporalReuse.material.uniforms.pathX2_Li_in_prev = { value: this.temporalReuseTargetB.textures[ 2 ] };
        this.passTemporalReuse.material.uniforms.pathX2_wi_in_prev = { value: this.temporalReuseTargetB.textures[ 3 ] };
        this.passTemporalReuse.material.onBeforeRender();
        this.renderer.setRenderTarget( this.temporalReuseTargetA );
        this.passTemporalReuse.render( this.renderer );

        // save current sample
        this.passSaveSample.material.uniforms.pathX2_in = { value: this.temporalReuseTargetA.textures[ 0 ] };
        this.passSaveSample.material.uniforms.pathInfo_in = { value: this.temporalReuseTargetA.textures[ 1 ] };
        this.passSaveSample.material.uniforms.pathX2_Li_in = { value: this.temporalReuseTargetA.textures[ 2 ] };
        this.passSaveSample.material.uniforms.pathX2_wi_in = { value: this.temporalReuseTargetA.textures[ 3 ] };
        this.passSaveSample.material.onBeforeRender();
        this.renderer.setRenderTarget( this.temporalReuseTargetB );
        this.passSaveSample.render( this.renderer );

        // shade pixel
        this.passShadePixel.material.uniforms.pathX2 = { value: this.temporalReuseTargetA.textures[ 0 ] };
        this.passShadePixel.material.uniforms.pathInfo = { value: this.temporalReuseTargetA.textures[ 1 ] };
        this.passSaveSample.material.uniforms.pathX2_Li = { value: this.temporalReuseTargetA.textures[ 2 ] };
        this.passSaveSample.material.uniforms.pathX2_wi = { value: this.temporalReuseTargetA.textures[ 3 ] };
        this.passShadePixel.material.onBeforeRender();
        this.renderer.setRenderTarget( this.pingTarget );
        this.passShadePixel.render( this.renderer );

        // average samples, @todo: remove this stage, or make it optional
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

        // this.nSamples++;

        [ this.pongTarget, this.pungTarget ] = [ this.pungTarget, this.pongTarget ];
        [ this.temporalReuseTargetA, this.temporalReuseTargetB ] = [ this.temporalReuseTargetB, this.temporalReuseTargetA ];

        this.sharedUniforms.invCameraWorldMatrixPrev.value.copy( this.camera.matrixWorldInverse );
        this.sharedUniforms.cameraProjectionMatrixPrev.value.copy( this.camera.projectionMatrix );
        this.sharedUniforms.hasPrevFrame.value = 1;

        // console.log( "view matrix:", this.sharedUniforms.invCameraWorldMatrixPrev.value );
        // console.log( "proj matrix:", this.sharedUniforms.cameraProjectionMatrixPrev.value );

    }

    updateCamera() {

        this.camera.updateMatrixWorld();

        this.sharedUniforms.cameraWorldMatrix.value.copy( this.camera.matrixWorld );
        this.sharedUniforms.invCameraWorldMatrix.value.copy( this.camera.matrixWorldInverse );
        this.sharedUniforms.cameraProjectionMatrix.value.copy( this.camera.projectionMatrix );
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

        // this.reset();

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
        // this.spatialReuseTarget.setSize( w, h );
        this.temporalReuseTargetA.setSize( w, h );
        this.temporalReuseTargetB.setSize( w, h );

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

        console.log( "reset happened" );

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

        // this.renderer.setRenderTarget( this.spatialReuseTarget );
        // this.renderer.setClearColor( 0, 0 );
        // this.renderer.clearColor();

        this.renderer.setRenderTarget( this.temporalReuseTargetA );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.clearColor();

        this.renderer.setRenderTarget( this.temporalReuseTargetB );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.clearColor();

        this.renderer.setRenderTarget( ogRenderTarget );
        this.renderer.setClearColor( ogClearColor, ogClearAlpha );

        this.nSamples = 0;

        // @todo: consider if we need the stable noise stuff

    }

}