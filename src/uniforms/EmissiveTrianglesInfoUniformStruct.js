import { DataTexture, RGBAFormat, ClampToEdgeWrapping, FloatType, Vector3, Quaternion, Matrix4, NearestFilter } from 'three';
import { bufferToHash } from '../utils/bufferToHash.js';

const LIGHT_PIXELS = 3;

export class EmissiveTrianglesInfoUniformStruct {

	constructor() {

		const tex = new DataTexture( new Float32Array( 4 ), 1, 1 );
		tex.format = RGBAFormat;
		tex.type = FloatType;
		tex.wrapS = ClampToEdgeWrapping;
		tex.wrapT = ClampToEdgeWrapping;
		tex.generateMipmaps = false;
		tex.minFilter = NearestFilter;
		tex.magFilter = NearestFilter;

		this.tex = tex;
		this.count = 0;

	}

	updateFrom( triangles ) {

		console.log( triangles );

		const tex = this.tex;
		const pixelCount = Math.max( triangles.length * LIGHT_PIXELS, 1 );
		const dimension = Math.ceil( Math.sqrt( pixelCount ) );

		if ( tex.image.width !== dimension ) {

			tex.dispose();

			tex.image.data = new Float32Array( dimension * dimension * 4 );
			tex.image.width = dimension;
			tex.image.height = dimension;

		}

		const floatArray = tex.image.data;

		for ( let i = 0; i < triangles.length; i ++ ) {

			const t = triangles[ i ];

			const baseIndex = i * LIGHT_PIXELS * 4;
			let index = 0;

			// initialize to 0
			for ( let p = 0; p < LIGHT_PIXELS * 4; p ++ ) {

				floatArray[ baseIndex + p ] = 0;

			}

			for ( const v of t.vertices ) {

				floatArray[ baseIndex + ( index ++ ) ] = v.x;
				floatArray[ baseIndex + ( index ++ ) ] = v.y;
				floatArray[ baseIndex + ( index ++ ) ] = v.z;
				floatArray[ baseIndex + ( index ++ ) ] = 1.0; // not used

			}


		}

		console.log(floatArray)

		this.count = triangles.length;

		const hash = bufferToHash( floatArray.buffer );
		if ( this.hash !== hash ) {

			this.hash = hash;
			tex.needsUpdate = true;
			return true;

		}

		return false;

	}

}
