export const emissive_triangles_struct = /* glsl */`

    struct EmissiveTrianglesInfo {

        usampler2D tex;
        uint count;

    };

    struct EmissiveTriangle {

        float area;
        uvec3 indices;
        vec3 vertices[3];
        vec3 faceNormal;
        Material material;

    };

    struct EmissiveTriangleSample {

        EmissiveTriangle tri;
        vec3 barycoord;
        vec3 normal; // geometry normal (interpolated from vertices)

    };

    EmissiveTriangle readEmissiveTriangleInfo( usampler2D tex, uint index ) {

        uvec3 indices = uTexelFetch1D( tex, index ).xyz;

        uint materialIndex = uTexelFetch1D( materialIndexAttribute, indices.x ).r;
        Material material = readMaterialInfo( materials, materialIndex );

        vec3 a = texelFetch1D( bvh.position, indices.x ).xyz;
        vec3 b = texelFetch1D( bvh.position, indices.y ).xyz;
        vec3 c = texelFetch1D( bvh.position, indices.z ).xyz;

        EmissiveTriangle ret;

        ret.area = 0.5 * length( cross( b - a,  c - a ) );
        ret.indices = indices;
        ret.vertices = vec3[]( a, b, c );
        ret.faceNormal = normalize( cross( b - a,  c - a ) );
        ret.material = material;

        return ret;

    }

    EmissiveTriangle randomEmissiveTriangle( EmissiveTrianglesInfo info ) {

        float r = rand( 9 );
        uint nTriangles = info.count;
        uint index = min( nTriangles - 1u, uint( r * float( nTriangles ) ) );

        return readEmissiveTriangleInfo( info.tex, index );

    }

    vec3 randomBarycentric( vec3 vertices[3] ) {

        vec2 xi = vec2( rand( 11 ), rand( 13 ) );
        float sqrtXi1 = sqrt( xi.x );
        float b0 = 1.0 - sqrtXi1;
        float b1 = xi.y * sqrtXi1;
        float b2 = 1.0 - b0 - b1;

        vec3 v0 = vertices[0];
        vec3 v1 = vertices[1];
        vec3 v2 = vertices[2];

        vec3 sampledPoint = b0 * v0 + b1 * v1 + b2 * v2;

        return sampledPoint;

    }

	EmissiveTriangleSample randomEmissiveTriangleSample( EmissiveTrianglesInfo info ) {

        EmissiveTriangleSample samp;

		samp.tri = randomEmissiveTriangle( info );
        samp.barycoord = randomBarycentric( samp.tri.vertices );
        samp.normal = normalize( textureSampleBarycoord(
			attributesArray,
			ATTR_NORMAL,
			samp.barycoord,
			samp.tri.indices
		).xyz );

        return samp;

	}

`;