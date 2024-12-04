export const emissive_triangles_struct = /* glsl */`

    struct EmissiveTrianglesInfo {

        sampler2D tex;
        uint count;

    };

    struct EmissiveTriangle {

        vec4 vertices[3];

    };

    EmissiveTriangle readEmissiveTriangleInfo( sampler2D tex, uint index ) {

        uint i = index * 3u;

        vec4 a = texelFetch1D( tex, i + 0u );
        vec4 b = texelFetch1D( tex, i + 1u );
        vec4 c = texelFetch1D( tex, i + 2u );

        EmissiveTriangle ret;

        ret.vertices = vec4[]( a, b, c );

        return ret;

    }
`;