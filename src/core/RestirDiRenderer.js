import { RGBAFormat, FloatType, Color, Vector2, WebGLRenderTarget, NoBlending, NormalBlending, Vector4, NearestFilter } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/fullscreen/BlendMaterial.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';
import { RestirDiMaterial, Pass } from '../materials/di/RestirDiMaterial.js';

function* renderTask() {

	const {
		_renderer,
        _samplesQuad,
		_fsQuad,
		_blendQuad,
		_primaryTarget,
		_blendTargets,
        _samplesTarget,
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
			material.blending = NoBlending;
			material.opacity = 1;

		} else {

			material.opacity = this._opacityFactor / ( this.samples + 1 );
			material.blending = NormalBlending;

		}

		const [ subX, subY, subW, subH ] = _subframe;

		const w = _primaryTarget.width;
		const h = _primaryTarget.height;
		material.resolution.set( w * subW, h * subH );
		material.sobolTexture = _sobolTarget.texture;
		material.stratifiedTexture.init( 20, material.bounces + material.transmissiveBounces + 5 );
		material.stratifiedTexture.next();
		material.seed ++;

        // store og state
        const ogRenderTarget = _renderer.getRenderTarget();
        const ogAutoClear = _renderer.autoClear;

		/*
        _renderer.setRenderTarget( _samplesTarget );
        _renderer.autoClear = false;
        _samplesQuad.render( _renderer );
		*/

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
        this._samplesTarget = new WebGLRenderTarget( 1, 1, { format: RGBAFormat, type: FloatType, count: 4 } )

		// function for listening to for triggered compilation so we can wait for compilation to finish
		// before starting to render
		this._compileFunction = () => {

			const promise = this.compileMaterial( this._fsQuad._mesh );
			promise.then( () => {

				if ( this._compilePromise === promise ) {

					this._compilePromise = null;

				}

			} );

			this._compilePromise = promise;

		};

		this.material.addEventListener( 'recompilation', this._compileFunction );

	}

	compileMaterial() {

		return this._renderer.compileAsync( this._fsQuad._mesh );

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

		material.setDefine( 'CAMERA_TYPE', cameraType );

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

		this.material.stratifiedTexture.stableNoise = this.stableNoise;
		if ( this.stableNoise ) {

			this.material.seed = 0;
			this.material.stratifiedTexture.reset();

		}

	}

	update() {

		// ensure we've updated our defines before rendering so we can ensure we
		// can wait for compilation to finish
		this.material.onBeforeRender();
		if ( this.isCompiling ) {

			return;

		}

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}
