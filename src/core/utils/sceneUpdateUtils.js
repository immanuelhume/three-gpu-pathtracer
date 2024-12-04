import { Vector3 } from 'three';

function uuidSort( a, b ) {

	if ( a.uuid < b.uuid ) return 1;
	if ( a.uuid > b.uuid ) return - 1;
	return 0;

}

// we must hash the texture to determine uniqueness using the encoding, as well, because the
// when rendering each texture to the texture array they must have a consistent color space.
export function getTextureHash( t ) {

	return `${ t.source.uuid }:${ t.colorSpace }`;

}

// reduce the set of textures to just those with a unique source while retaining
// the order of the textures.
function reduceTexturesToUniqueSources( textures ) {

	const sourceSet = new Set();
	const result = [];
	for ( let i = 0, l = textures.length; i < l; i ++ ) {

		const tex = textures[ i ];
		const hash = getTextureHash( tex );
		if ( ! sourceSet.has( hash ) ) {

			sourceSet.add( hash );
			result.push( tex );

		}

	}

	return result;

}

export function getIesTextures( lights ) {

	const textures = lights.map( l => l.iesMap || null ).filter( t => t );
	const textureSet = new Set( textures );
	return Array.from( textureSet ).sort( uuidSort );

}

export function getTextures( materials ) {

	const textureSet = new Set();
	for ( let i = 0, l = materials.length; i < l; i ++ ) {

		const material = materials[ i ];
		for ( const key in material ) {

			const value = material[ key ];
			if ( value && value.isTexture ) {

				textureSet.add( value );

			}

		}

	}

	const textureArray = Array.from( textureSet );
	return reduceTexturesToUniqueSources( textureArray ).sort( uuidSort );

}

export function getLights( scene ) {

	const lights = [];
	scene.traverse( c => {

		if ( c.visible ) {

			if (
				c.isRectAreaLight ||
				c.isSpotLight ||
				c.isPointLight ||
				c.isDirectionalLight
			) {

				lights.push( c );

			}

		}

	} );

	return lights.sort( uuidSort );

}

export function getEmissiveTriangles( scene ) {

	// TODO: fix up this function, and think of how we want to use it.

	return getEmissiveMeshes( scene ).flatMap( meshToTriangles );

}

function getEmissiveMeshes( scene ) {

	// While this supports emissive objects, it still does not support emissive
	// textures!
	//
	// Would this be able to retrieve a single emissive triangle in a broader
	// mesh?

	const emissiveObject = [];
	scene.traverse( c => {

		if ( c.isMesh && c.visible ) {

			if ( c.material?.emissiveIntensity > 0 && c.material?.emissive.getHex() > 0 ) {

				emissiveObject.push( c );

			}

		}

	} );

	return emissiveObject.sort( uuidSort );

}

export function meshToTriangles( mesh ) {

	const triangles = [];

	const geometry = mesh.geometry;

	const positionAttribute = geometry.attributes.position;
	const indexAttribute = geometry.index;

	const indices = indexAttribute ? indexAttribute.array : null;
	const vertexCount = indexAttribute ? indexAttribute.count : positionAttribute.count;

	// TODO: I think we need to iterate through groups in the geometry. Since
	// even if the mesh is emissive, it's possible that some triangles are not?

	for (let i = 0; i < vertexCount; i += 3) {

		const triangle = { vertices: [], area: 0, emissiveColor: null };

		for (let j = 0; j < 3; j++) {

			const idx = indices ? indices[i + j] : i + j;

			const vertexLocal = new Vector3().fromBufferAttribute( positionAttribute, idx )
            const vertexWorld = mesh.localToWorld( vertexLocal );
			triangle.vertices.push( vertexWorld );

		}

		triangles.push(triangle);

	}

	return triangles;

}
