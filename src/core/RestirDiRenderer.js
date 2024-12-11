import { RGBAFormat, FloatType, Color, Vector2, WebGLRenderTarget, NoBlending, NormalBlending, Vector4, NearestFilter } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/fullscreen/BlendMaterial.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';
import { RestirDiMaterial, Pass, SimpleMaterial } from '../materials/di/RestirDiMaterial.js';

function* renderTask() {

	const {
		_renderer,
		_fsQuad,
		_blendQuad,
		_samplesQuad,
		_simpleQuad,
		_primaryTarget,
		_blendTargets,
        _samplesTarget,
		_simpleTarget,
		_sobolTarget,
		_subframe,
		alpha,
		material,
	} = this;
	const blendMaterial = _blendQuad.material;
	let [ blendTarget1, blendTarget2 ] = _blendTargets;

	while ( true ) {

		if ( alpha ) {

			blendMaterial.opacity = this._opacityFactor / ( this.samples + 1 );
			_fsQuad.material.blending = NoBlending;
			_samplesQuad.material.opacity = 1;

		} else {

			_fsQuad.material.opacity = this._opacityFactor / ( this.samples + 1 );
			_fsQuad.material.blending = NormalBlending;

			_samplesQuad.material.opacity = this._opacityFactor / ( this.samples + 1 );
			_samplesQuad.material.blending = NormalBlending;

		}

		const [ subX, subY, subW, subH ] = _subframe;

		const w = _primaryTarget.width;
		const h = _primaryTarget.height;
		_fsQuad.material.resolution.set( w * subW, h * subH );
		_fsQuad.material.sobolTexture = _sobolTarget.texture;
		_fsQuad.material.stratifiedTexture.init( 20, material.bounces + material.transmissiveBounces + 5 );
		_fsQuad.material.stratifiedTexture.next();
		_fsQuad.material.seed ++;

		// _samplesQuad.material.resolution.set( w * subW, h * subH );
		// _samplesQuad.material.sobolTexture = _sobolTarget.texture;
		// _samplesQuad.material.stratifiedTexture.init( 20, material.bounces + material.transmissiveBounces + 5 );
		// _samplesQuad.material.stratifiedTexture.next();
		// _samplesQuad.material.seed ++;

        // store og state
        const ogRenderTarget = _renderer.getRenderTarget();
        const ogAutoClear = _renderer.autoClear;

		// const program1 = _renderer.info.programs[ 1 ];
		// console.log( program1.getUniforms() );
		// const program2 = _renderer.info.programs[ 2 ];
		// console.log( program2.getUniforms() );

		_renderer.setRenderTarget( _simpleTarget );
		_renderer.autoClear = false;
		_simpleQuad.render( _renderer );

        _renderer.setRenderTarget( _samplesTarget );
        _renderer.autoClear = false;
        _samplesQuad.render( _renderer );

        _renderer.setRenderTarget( _primaryTarget );
        _renderer.autoClear = false;
        _fsQuad.render( _renderer );

        // reset original renderer state
        _renderer.setRenderTarget( ogRenderTarget );
        _renderer.autoClear = ogAutoClear;

        // swap and blend alpha targets
        if ( alpha ) {

            blendMaterial.target1 = blendTarget1.texture;
            blendMaterial.target2 = _primaryTarget.texture;

            _renderer.setRenderTarget( blendTarget2 );
            _blendQuad.render( _renderer );
            _renderer.setRenderTarget( ogRenderTarget );

        }

        this.samples += 1;

        yield;

		[ blendTarget1, blendTarget2 ] = [ blendTarget2, blendTarget1 ];

	}

}

const ogClearColor = new Color();
export class RestirDiRenderer {

	get material() {

		return this._fsQuad.material;

	}

	set material( v ) {

		this._fsQuad.material.removeEventListener( 'recompilation', this._compileFunction );
		v.addEventListener( 'recompilation', this._compileFunction );

		this._fsQuad.material = v;

	}

	get target() {

		return this._alpha ? this._blendTargets[ 1 ] : this._primaryTarget;

	}

	set alpha( v ) {

		if ( this._alpha === v ) {

			return;

		}

		if ( ! v ) {

			this._blendTargets[ 0 ].dispose();
			this._blendTargets[ 1 ].dispose();

		}

		this._alpha = v;
		this.reset();

	}

	get alpha() {

		return this._alpha;

	}

	get isCompiling() {

		return Boolean( this._compilePromise );

	}

	constructor( renderer ) {

		this.camera = null;
		this.tiles = new Vector2( 3, 3 );

		this.stableNoise = false;
		this.stableTiles = true;

		this.samples = 0;
		this._subframe = new Vector4( 0, 0, 1, 1 );
		this._opacityFactor = 1.0;
		this._renderer = renderer;
		this._alpha = false;
		this._samplesQuad = new FullScreenQuad( new RestirDiMaterial( Pass.GenSample ) );
		this._fsQuad = new FullScreenQuad( new RestirDiMaterial( Pass.ShadePixel ) );
		this._simpleQuad = new FullScreenQuad( new SimpleMaterial() );
		this._blendQuad = new FullScreenQuad( new BlendMaterial() );
		this._task = null;
		this._currentTile = 0;
		this._compilePromise = null;

		this._sobolTarget = new SobolNumberMapGenerator().generate( renderer );

		this._primaryTarget = new WebGLRenderTarget( 1, 1, {
			format: RGBAFormat,
			type: FloatType,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
		} );
		this._blendTargets = [
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
				magFilter: NearestFilter,
				minFilter: NearestFilter,
			} ),
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
				magFilter: NearestFilter,
				minFilter: NearestFilter,
			} ),
		];
		this._simpleTarget = new WebGLRenderTarget( 1, 1, {
			format: RGBAFormat,
			type: FloatType,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
			count: 2,
		} );
        this._samplesTarget = new WebGLRenderTarget( 1, 1, {
			format: RGBAFormat,
			type: FloatType,
			// internalFormat: "RGBA32F",
			depthBuffer: false,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
			count: 4,
		} )

		// Copy references to each uniform.
		this._dummyMaterial = new RestirDiMaterial( Pass.Dummy );
		const sharedUniforms = this._dummyMaterial.uniforms;
		this._samplesQuad.material.uniforms = { ...sharedUniforms };
		this._fsQuad.material.uniforms = { ...sharedUniforms,

			pathX0: { value: this._samplesTarget.textures[0] },
			pathX1: { value: this._samplesTarget.textures[1] },
			pathX2: { value: this._samplesTarget.textures[2] },
			pathInfo: { value: this._samplesTarget.textures[3] },

		};

		// this._samplesQuad.material.uniforms["owo"] = { value: this._samplesTarget.textures[0] };

		// function for listening to for triggered compilation so we can wait for compilation to finish
		// before starting to render
		this._compileFunction = () => {

			const promise = this.compileMaterial();
			promise.then( () => {

				if ( this._compilePromise === promise ) {

					this._compilePromise = null;

				}

			} );

			this._compilePromise = promise;

		};

		this._fsQuad.material.addEventListener( 'recompilation', this._compileFunction );
		this._samplesQuad.material.addEventListener( 'recompilation', this._compileFunction );

	}

	async compileMaterial() {

		await this._renderer.compileAsync( this._fsQuad._mesh );
		return this._renderer.compileAsync( this._samplesQuad._mesh );

	}

	setCamera( camera ) {

		const { material } = this;
		material.cameraWorldMatrix.copy( camera.matrixWorld );
		material.invProjectionMatrix.copy( camera.projectionMatrixInverse );
		material.physicalCamera.updateFrom( camera );

		// Perspective camera (default)
		let cameraType = 0;

		// An orthographic projection matrix will always have the bottom right element == 1
		// And a perspective projection matrix will always have the bottom right element == 0
		if ( camera.projectionMatrix.elements[ 15 ] > 0 ) {

			// Orthographic
			cameraType = 1;

		}

		if ( camera.isEquirectCamera ) {

			// Equirectangular
			cameraType = 2;

		}

		this._fsQuad.material.setDefine( 'CAMERA_TYPE', cameraType );
		this._samplesQuad.material.setDefine( 'CAMERA_TYPE', cameraType );

		this.camera = camera;

	}

	setSize( w, h ) {

		w = Math.ceil( w );
		h = Math.ceil( h );

		if ( this._primaryTarget.width === w && this._primaryTarget.height === h ) {

			return;

		}

		this._primaryTarget.setSize( w, h );
		this._blendTargets[ 0 ].setSize( w, h );
		this._blendTargets[ 1 ].setSize( w, h );
        this._samplesTarget.setSize( w, h );
		this._simpleTarget.setSize( w, h );
		this.reset();

	}

	getSize( target ) {

		target.x = this._primaryTarget.width;
		target.y = this._primaryTarget.height;

	}

	dispose() {

		this._primaryTarget.dispose();
		this._blendTargets[ 0 ].dispose();
		this._blendTargets[ 1 ].dispose();
		this._sobolTarget.dispose();

		this._fsQuad.dispose();
		this._blendQuad.dispose();
		this._task = null;

	}

	reset() {

		const { _renderer, _primaryTarget, _blendTargets, _samplesTarget } = this;
		const ogRenderTarget = _renderer.getRenderTarget();
		const ogClearAlpha = _renderer.getClearAlpha();
		_renderer.getClearColor( ogClearColor );

		_renderer.setRenderTarget( _primaryTarget );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setRenderTarget( _blendTargets[ 0 ] );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setRenderTarget( _blendTargets[ 1 ] );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

        // TODO: verify if this works? do we need to do something different for mrt?
		_renderer.setRenderTarget( _samplesTarget );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setClearColor( ogClearColor, ogClearAlpha );
		_renderer.setRenderTarget( ogRenderTarget );

		this.samples = 0;
		this._task = null;

		this._dummyMaterial.stratifiedTexture.stableNoise = this.stableNoise;
		if ( this.stableNoise ) {

			this._dummyMaterial.seed = 0;
			this._dummyMaterial.stratifiedTexture.reset();

		}

	}

	update() {

		// ensure we've updated our defines before rendering so we can ensure we
		// can wait for compilation to finish
		this._samplesQuad.material.onBeforeRender();
		this._fsQuad.material.onBeforeRender();
		if ( this.isCompiling ) {

			return;

		}

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}
