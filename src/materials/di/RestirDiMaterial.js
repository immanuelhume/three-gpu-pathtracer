import { ClampToEdgeWrapping, HalfFloatType, Matrix4, Vector2 } from 'three';
import { MaterialBase } from '../MaterialBase.js';
import {
	MeshBVHUniformStruct, UIntVertexAttributeTexture,
	BVHShaderGLSL,
} from 'three-mesh-bvh';

// uniforms
import { PhysicalCameraUniform } from '../../uniforms/PhysicalCameraUniform.js';
import { EquirectHdrInfoUniform } from '../../uniforms/EquirectHdrInfoUniform.js';
import { LightsInfoUniformStruct } from '../../uniforms/LightsInfoUniformStruct.js';
import { AttributesTextureArray } from '../../uniforms/AttributesTextureArray.js';
import { MaterialsTexture, MATERIAL_PIXELS } from '../../uniforms/MaterialsTexture.js';
import { RenderTarget2DArray } from '../../uniforms/RenderTarget2DArray.js';
import { StratifiedSamplesTexture } from '../../uniforms/StratifiedSamplesTexture.js';
import { BlueNoiseTexture } from '../../textures/BlueNoiseTexture.js';

// general glsl
import * as StructsGLSL from '../../shader/structs/index.js';
import * as SamplingGLSL from '../../shader/sampling/index.js';
import * as CommonGLSL from '../../shader/common/index.js';
import * as RandomGLSL from '../../shader/rand/index.js';
import * as BSDFGLSL from '../../shader/bsdf/index.js';
import * as PTBVHGLSL from '../../shader/bvh/index.js';

// path tracer glsl
import * as RenderGLSL from '../pathtracing/glsl/index.js';
import { PhysicalPathTracingMaterial } from '../pathtracing/PhysicalPathTracingMaterial.js';

export const Pass = {
	"GenSample": 0,
	"ShadePixel": 1,
}

export class RestirDiMaterial extends PhysicalPathTracingMaterial {

    constructor( parameters ) {

        const fragmentShader = /* glsl */`
			#define RAY_OFFSET 1e-4
			#define INFINITY 1e20

			precision highp isampler2D;
			precision highp usampler2D;
			precision highp sampler2DArray;
			vec4 envMapTexelToLinear( vec4 a ) { return a; }
			#include <common>

			// bvh intersection
			${ BVHShaderGLSL.common_functions }
			${ BVHShaderGLSL.bvh_struct_definitions }
			${ BVHShaderGLSL.bvh_ray_functions }

			// random
			#if RANDOM_TYPE == 2 	// Stratified List

				${ RandomGLSL.stratified_functions }

			#elif RANDOM_TYPE == 1 	// Sobol

				${ RandomGLSL.pcg_functions }
				${ RandomGLSL.sobol_common }
				${ RandomGLSL.sobol_functions }

				#define rand(v) sobol(v)
				#define rand2(v) sobol2(v)
				#define rand3(v) sobol3(v)
				#define rand4(v) sobol4(v)

			#else 					// PCG

			${ RandomGLSL.pcg_functions }

				// Using the sobol functions seems to break the the compiler on MacOS
				// - specifically the "sobolReverseBits" function.
				uint sobolPixelIndex = 0u;
				uint sobolPathIndex = 0u;
				uint sobolBounceIndex = 0u;

				#define rand(v) pcgRand()
				#define rand2(v) pcgRand2()
				#define rand3(v) pcgRand3()
				#define rand4(v) pcgRand4()

			#endif

			// uniform structs
			${ StructsGLSL.camera_struct }
			${ StructsGLSL.lights_struct }
			${ StructsGLSL.equirect_struct }
			${ StructsGLSL.material_struct }
			${ StructsGLSL.surface_record_struct }
			${ StructsGLSL.emissive_triangles_struct }

			// common
			${ CommonGLSL.texture_sample_functions }
			${ CommonGLSL.fresnel_functions }
			${ CommonGLSL.util_functions }
			${ CommonGLSL.math_functions }
			${ CommonGLSL.shape_intersection_functions }

			// environment
			uniform EquirectHdrInfo envMapInfo;
			uniform mat4 environmentRotation;
			uniform float environmentIntensity;

			// lighting
			uniform sampler2DArray iesProfiles;
			uniform LightsInfo lights;
			uniform EmissiveTrianglesInfo emissiveTriangles;

			// background
			uniform float backgroundBlur;
			uniform float backgroundAlpha;
			#if FEATURE_BACKGROUND_MAP

			uniform sampler2D backgroundMap;
			uniform mat4 backgroundRotation;
			uniform float backgroundIntensity;

			#endif

			// camera
			uniform mat4 cameraWorldMatrix;
			uniform mat4 invProjectionMatrix;
			#if FEATURE_DOF

			uniform PhysicalCamera physicalCamera;

			#endif

			// geometry
			uniform sampler2DArray attributesArray;
			uniform usampler2D materialIndexAttribute;
			uniform sampler2D materials;
			uniform sampler2DArray textures;
			uniform BVH bvh;

			// path tracer
			uniform int bounces;
			uniform int transmissiveBounces;
			uniform float filterGlossyFactor;
			uniform int seed;

			// image
			uniform vec2 resolution;
			uniform float opacity;

			varying vec2 vUv;

			// globals
			mat3 envRotation3x3;
			mat3 invEnvRotation3x3;
			float lightsDenom;

			// sampling
			${ SamplingGLSL.shape_sampling_functions }
			${ SamplingGLSL.equirect_functions }
			${ SamplingGLSL.light_sampling_functions }

			${ PTBVHGLSL.inside_fog_volume_function }
			${ BSDFGLSL.ggx_functions }
			${ BSDFGLSL.sheen_functions }
			${ BSDFGLSL.iridescence_functions }
			${ BSDFGLSL.fog_functions }
			${ BSDFGLSL.bsdf_functions }

			float applyFilteredGlossy( float roughness, float accumulatedRoughness ) {

				return clamp(
					max(
						roughness,
						accumulatedRoughness * filterGlossyFactor * 5.0 ),
					0.0,
					1.0
				);

			}

			${ RenderGLSL.render_structs }
			${ RenderGLSL.camera_util_functions }
			${ RenderGLSL.trace_scene_function }
			${ RenderGLSL.attenuate_hit_function }
			${ RenderGLSL.direct_light_contribution_function }
			${ RenderGLSL.get_surface_record_function }

			// restir

			struct Sample {

				vec3 path[3];
				float weight;

			};

			uniform int pass;

			void main() {

				// init
				rng_initialize( gl_FragCoord.xy, seed );
				sobolPixelIndex = ( uint( gl_FragCoord.x ) << 16 ) | uint( gl_FragCoord.y );
				sobolPathIndex = uint( seed );

				lightsDenom =
					( environmentIntensity == 0.0 || envMapInfo.totalSum == 0.0 ) && lights.count != 0u ?
						float( lights.count ) :
						float( lights.count + 1u );

				Ray ray = getCameraRay();

				Sample samp;
				samp.path[0] = ray.origin;

				SurfaceHit surfaceHit;
				int hitType = traceScene( ray, surfaceHit );

				if ( hitType == SURFACE_HIT ) {

					uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
					Material material = readMaterialInfo( materials, materialIndex );

					// TODO: does not accomodate transmission
					vec3 hitPoint = stepRayOrigin( ray.origin, ray.direction, surfaceHit.faceNormal, surfaceHit.dist );
					samp.path[1] = hitPoint;

					LightRecord lightRec = randomLightSample( lights.tex, iesProfiles, lights.count, hitPoint, rand3( 6 ) );

					SurfaceRecord surf;
					int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );
					if ( surfRecord == SKIP_SURFACE ) {

						// TODO: what's the semantics of skipping a surface even
						return;

					}

					if ( lightRec.pdf > 0.0 && isDirectionValid( lightRec.direction, surf.normal, surf.faceNormal ) ) {
						Ray shadowRay = Ray( hitPoint, lightRec.direction );
						SurfaceHit surfaceHit;
						int hitType = traceScene( shadowRay, surfaceHit );

						if ( hitType == SURFACE_HIT && surfaceHit.dist < lightRec.dist ) {

							// Light is blocked

						} else {

							// Light is not blocked
							vec3 pointOnLight = hitPoint + lightRec.dist * lightRec.direction;
							float lightPdf = lightRec.pdf / lightsDenom;

							samp.path[2] = pointOnLight;
							samp.weight = 1.0 / lightPdf;

							vec3 sampleColor;
							float lightMaterialPdf = bsdfResult( -ray.direction, lightRec.direction, surf, sampleColor );

							if ( lightMaterialPdf > 0.0 ) {

								gl_FragColor = vec4( lightRec.emission * sampleColor * samp.weight, 1.0 );

							}

						}

					}


				}

			}
		`;

		super( parameters );
		this.fragmentShader = fragmentShader;

        this.setValues( parameters );

    }

}