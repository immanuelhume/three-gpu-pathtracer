import { DataTexture, RGBAFormat, RGBAIntegerFormat, ClampToEdgeWrapping, FloatType, IntType, UnsignedIntType, Vector3, Quaternion, Matrix4, NearestFilter } from 'three';
import { bufferToHash } from '../utils/bufferToHash.js';

export class EmissiveTrianglesInfoUniformStruct {

	constructor() {

		const tex = new DataTexture( new Uint32Array( 4 ), 1, 1 );
		tex.format = RGBAIntegerFormat;
		tex.internalFormat = "RGBA32UI";
		tex.type = UnsignedIntType;
		tex.wrapS = ClampToEdgeWrapping;
		tex.wrapT = ClampToEdgeWrapping;
		tex.generateMipmaps = false;
		tex.minFilter = NearestFilter;
		tex.magFilter = NearestFilter;

		this.tex = tex;
		this.count = 0;

	}

	updateFrom( indices ) {

		const tex = this.tex;
		const pixelCount = Math.max( indices.length, 1 );
		const dimension = Math.ceil( Math.sqrt( pixelCount ) );

		if ( tex.image.width !== dimension ) {

			tex.dispose();

			tex.image.data = new Uint32Array( dimension * dimension * 4 );
			tex.image.width = dimension;
			tex.image.height = dimension;

		}

		const data = tex.image.data;

		if ( indices.length % 3 != 0 ) {

			console.warn( "No. of indices for emissive triangles is not a multiple of 3:", indices.length );

		}

		const nTriangles = indices.length / 3;

		for ( let i = 0; i < nTriangles; ++i ) {

			const s = i * 4;
			const t = i * 3;
			data[ s + 0 ] = indices[ t + 0 ];
			data[ s + 1 ] = indices[ t + 1 ];
			data[ s + 2 ] = indices[ t + 2 ];
			data[ s + 3 ] = 0.0; // unused

		}

		console.log( "indices", indices );
		console.log( "emissive triangles buffer", data );

		/*
		for ( let i = 0; i < indices.length; i ++ ) {

			const t = indices[ i ];

			const baseIndex = i * NVERTICES * 4;
			let index = 0;

			// initialize to 0
			for ( let p = 0; p < NVERTICES * 4; p ++ ) {

				floatArray[ baseIndex + p ] = 0;

			}

			for ( const v of t.vertices ) {

				floatArray[ baseIndex + ( index ++ ) ] = v.x;
				floatArray[ baseIndex + ( index ++ ) ] = v.y;
				floatArray[ baseIndex + ( index ++ ) ] = v.z;
				floatArray[ baseIndex + ( index ++ ) ] = 1.0; // not used

			}

		}
		*/

		this.count = indices.length;

		const hash = bufferToHash( data.buffer );
		if ( this.hash !== hash ) {

			console.log("indices of emissive triangles", indices);

			this.hash = hash;
			tex.needsUpdate = true;
			return true;

		}

		return false;

	}

}
