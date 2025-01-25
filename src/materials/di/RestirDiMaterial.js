import { ClampToEdgeWrapping, HalfFloatType, Matrix4, Vector2, GLSL3, ShaderMaterial } from 'three';
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
	"SpatialReuse": 2,
	"TemporalReuse": 3,
	"SaveSample": 4,
	"Dummy": -1,
}

export class AverageSamplesMaterial extends ShaderMaterial {

	constructor() {

		super( {

			uniforms: {

				curr: { value: null },
				newSample: { value: null },
				nSamples: { value: 0 },

			},
			
			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,

			fragmentShader: /* glsl */`

				uniform sampler2D curr;
				uniform sampler2D newSample;
				uniform uint nSamples; // no. of samples in [curr]

				varying vec2 vUv;

				void main() {

					vec4 incoming = texelFetch( newSample, ivec2( gl_FragCoord.xy ), 0 );

					if ( nSamples == 0u ) {

						gl_FragColor = incoming;

					} else {

						vec4 existing = texelFetch( curr, ivec2( gl_FragCoord.xy ), 0 );

						gl_FragColor = ( existing * float( nSamples ) + incoming ) / float( nSamples + 1u );

					}

				}

			`,

		} );

	}

}

/* For testing */
export class SimpleMaterial extends ShaderMaterial {

	constructor() {

		super( {

			vertexShader: /* glsl */`

				varying vec2 vUv;
				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					vUv = uv;

				}

			`,

			fragmentShader: /* glsl */`

				layout(location = 0) out vec4 fragColor;
				// layout(location = 1) out vec4 fragColor2;

				void main() {

					fragColor = vec4( 0.0, 1.0, 0.0, 1.0 );
					// fragColor2 = vec4( 0.0, 1.0, 0.0, 1.0 );

				}

			`,

		} );

		this.glslVersion = GLSL3;

	}

}

export class RestirDiMaterial extends PhysicalPathTracingMaterial {

    constructor( pass, parameters ) {

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

			const vec3 luma = vec3( 0.2126, 0.7152, 0.0722 );

			${ StructsGLSL.emissive_triangles_struct }

			uniform EmissiveTrianglesInfo emissiveTriangles;

			struct Sample {

				vec4 path[3];
				float unbiasedContribWeight;

			};

			struct RisSample {

				vec4 path[3];
				float resamplingWeight;

			};

			// An abstraction used to facililtate RIS.
			struct Reservoir {

				RisSample sampleOut;
				float phatOut; // evaluation of target function for sampleOut
				float wSum;    // sum of resampling weights; required for unbiased contribution weight Wx
				bool valid;    // we might not successfully pick a sample...
			
			};

			Reservoir initReservoir() {

				Reservoir reservoir;
				reservoir.wSum = 0.0;
				reservoir.valid = false;
				return reservoir;

			}

			void addSample( inout Reservoir reservoir, RisSample samp, float phat, float r ) {

				reservoir.wSum += samp.resamplingWeight;

				if ( r <= samp.resamplingWeight / reservoir.wSum ) {

					reservoir.sampleOut = samp;
					reservoir.phatOut = phat;
					reservoir.valid = true;
				
				}

			}

			#if RESTIR_PASS == PASS_GEN_SAMPLE

			/*
			pathInfo.x: ok
			pathInfo.y: unbiased contrib weight
			pathInfo.z: target function evaluated for selected sample
			pathInfo.w: depth of primary ray
			
			ok < 0.0: primary ray missed
			ok < 1.0: secondary ray missed
			otherwise: ok
			*/

			layout(location = 0) out vec4 surfaceHit_faceIndices;
			layout(location = 1) out vec4 surfaceHit_barycoord_side;
			layout(location = 2) out vec4 surfaceHit_faceNormal_dist;
			layout(location = 3) out vec4 pathX1;
			layout(location = 4) out vec4 pathX2;
			layout(location = 5) out vec4 pathInfo;

			uniform int M_area; // number of uniform random area light samples
			uniform int M_bsdf; // number of bsdf samples

			#endif

			#if RESTIR_PASS == PASS_SPATIAL_REUSE || RESTIR_PASS == PASS_TEMPORAL_REUSE

			uniform sampler2D surfaceHit_faceIndices;
			uniform sampler2D surfaceHit_barycoord_side;
			uniform sampler2D surfaceHit_faceNormal_dist;
			uniform sampler2D pathX1_in;
			uniform sampler2D pathX2_in;
			uniform sampler2D pathInfo_in;

			layout(location = 0) out vec4 pathX2_out;
			layout(location = 1) out vec4 pathInfo_out;

			#endif

			#if RESTIR_PASS == PASS_TEMPORAL_REUSE
			// Previous frame data

			uniform sampler2D pathX2_in_prev;
			uniform sampler2D pathInfo_in_prev;

			#endif

			#if RESTIR_PASS == PASS_SAVE_SAMPLE

			uniform sampler2D pathX2_in;
			uniform sampler2D pathInfo_in;

			layout(location = 0) out vec4 pathX2_out;
			layout(location = 1) out vec4 pathInfo_out;

			#endif

			#if RESTIR_PASS == PASS_SHADE_PIXEL

			layout(location = 0) out vec4 fragColor;

			uniform sampler2D surfaceHit_faceIndices;
			uniform sampler2D surfaceHit_barycoord_side;
			uniform sampler2D surfaceHit_faceNormal_dist;
			uniform sampler2D pathX1;
			uniform sampler2D pathX2;
			uniform sampler2D pathInfo;

			#endif

			void main() {

				// init
				rng_initialize( gl_FragCoord.xy, seed );
				sobolPixelIndex = ( uint( gl_FragCoord.x ) << 16 ) | uint( gl_FragCoord.y );
				sobolPathIndex = uint( seed );

				#if RESTIR_PASS == PASS_GEN_SAMPLE

				/////////////////////
				// GENERATE SAMPLE //
				/////////////////////

				// Initialize outputs
				surfaceHit_faceIndices = vec4( 0.0, 0.0, 0.0, 0.0 );
				surfaceHit_barycoord_side = vec4( 0.0, 0.0, 0.0, 0.0 );
				surfaceHit_faceNormal_dist = vec4( 0.0, 0.0, 0.0, 0.0 );
				pathX1 = vec4( 0.0, 0.0, 0.0, 0.0 );
				pathX2 = vec4( 0.0, 0.0, 0.0, 0.0 );
				pathInfo = vec4( 0.0, 0.0, 0.0, 0.0 );

				pathInfo.x = 1.0;

				Ray ray = getCameraRay2();
				SurfaceHit surfaceHit;
				int hitType = traceScene( ray, surfaceHit );

				pathInfo.w = surfaceHit.dist;

				if ( hitType != SURFACE_HIT ) {

					pathInfo.x = -1.0;
					return;
					
				}

				SurfaceRecord surf;
				{

					uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
					Material material = readMaterialInfo( materials, materialIndex );

					int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );
					if ( surfRecord == SKIP_SURFACE ) {

						// TODO: what's the semantics of skipping a surface even
						pathInfo.x = 0.0;
						return;

					}

					pathX1.w = float( materialIndex );

				}

				vec3 hitPoint = stepRayOrigin( ray.origin, ray.direction, surfaceHit.faceNormal, surfaceHit.dist );
				pathX1.xyz = hitPoint;

				surfaceHit_faceIndices = vec4( surfaceHit.faceIndices );
				surfaceHit_barycoord_side = vec4( surfaceHit.barycoord, surfaceHit.side );
				surfaceHit_faceNormal_dist = vec4( surfaceHit.faceNormal, surfaceHit.dist );
				
				Reservoir reservoir = initReservoir();

				for ( int i = 0; i < M_area; ++i ) {

					EmissiveTriangleSample emTri = randomEmissiveTriangleSample( emissiveTriangles, rand( 16 + i ) );
					vec3 lightDir = normalize( emTri.barycoord - hitPoint );
					float lightDist = length( emTri.barycoord - hitPoint );

					if ( dot( lightDir, emTri.normal ) >= 0.0 ) {
					
						// Wrong side of the light
						// @resume: is this correct?
						continue;
					
					}

					float invLightDistSquared = 1.0 / ( lightDist * lightDist );

					float invLightPdf = invLightDistSquared * emTri.tri.area * dot( -lightDir, emTri.normal ) * float( emissiveTriangles.count );
					float lightPdf = 1.0 / invLightPdf;

					uint emTriMaterialIndex = uTexelFetch1D( materialIndexAttribute, emTri.tri.indices.x ).r;
					Material lightMaterial = readMaterialInfo( materials, emTriMaterialIndex );
					vec3 emission = lightMaterial.emissiveIntensity * lightMaterial.emissive;

					vec3 sampleColor;
					float materialPdf = bsdfResult( -ray.direction, lightDir, surf, sampleColor );

					// @todo: verify target function?
					float phat = dot( sampleColor * emission, luma );

					/*
					// Full calculation: balance heuristic for MIS weight, and
					// then the resampling weight. A truncation is used since
					// terms might cancel out in practice.
					float misWeight = lightPdf / ( float( M_area ) * lightPdf + float( M_bsdf ) * materialPdf );
					float resamplingWeight = misWeight * phat * invLightPdf;
					*/

					float resamplingWeight = phat / ( float( M_area ) * lightPdf + float( M_bsdf ) * materialPdf ); // balance heuristic

					RisSample samp;
					samp.path[0] = vec4( ray.origin, 0.0 );
					samp.path[1] = vec4( hitPoint, 0.0 );
					samp.path[2] = vec4( emTri.barycoord, float( emTriMaterialIndex ) );
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, phat, rand( 17 + i ) );
				
				}

				for ( int i = 0; i < M_bsdf; ++i ) {

					ScatterRecord scatterRec = bsdfSample( -ray.direction, surf, rand2( 15 + i ) );

					SurfaceHit surfaceHit;
					Ray bounceRay = Ray( hitPoint, scatterRec.direction );
					int hitType = traceScene( bounceRay, surfaceHit );

					if ( hitType != SURFACE_HIT ) {
					
						// @resume: is this correct?
						continue;

					}

					uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
					Material material = readMaterialInfo( materials, materialIndex );
					vec3 emission = material.emissiveIntensity * material.emissive;

					if ( emission == vec3( 0.0 ) ) {
					
						// @resume: is this correct?
						continue;

					}

					vec3 lightHitPoint = stepRayOrigin( bounceRay.origin, bounceRay.direction, surfaceHit.faceNormal, surfaceHit.dist );

					vec3 a = texelFetch1D( bvh.position, surfaceHit.faceIndices.x ).xyz;
					vec3 b = texelFetch1D( bvh.position, surfaceHit.faceIndices.y ).xyz;
					vec3 c = texelFetch1D( bvh.position, surfaceHit.faceIndices.z ).xyz;

					vec3 triNormal = normalize( textureSampleBarycoord(
						attributesArray,
						ATTR_NORMAL,
						surfaceHit.barycoord,
						surfaceHit.faceIndices.xyz
					).xyz );
					float triArea = 0.5 * length( cross( b - a, c - a ) );

					if ( dot( bounceRay.direction, triNormal ) >= 0.0 ) {
					
						// @resume: is this correct?
						continue;

					}

					float invLightDistSquared = 1.0 / ( surfaceHit.dist * surfaceHit.dist );
					float invLightPdf = invLightDistSquared * triArea * dot( -bounceRay.direction, triNormal ) * float( emissiveTriangles.count );
					float lightPdf = 1.0 / invLightPdf;

					// @todo: verify target function?
					float phat = dot( scatterRec.color * emission, luma );

					/*
					float misWeight = scatterRec.pdf / ( float( M_area ) * lightPdf + float( M_bsdf ) * scatterRec.pdf );
					float resamplingWeight = misWeight * phat / scatterRec.pdf;
					*/

					float resamplingWeight = phat / ( float( M_area ) * lightPdf + float( M_bsdf ) * scatterRec.pdf );

					RisSample samp;
					samp.path[0] = vec4( ray.origin, 0.0 );
					samp.path[1] = vec4( hitPoint, 0.0 );
					samp.path[2] = vec4( lightHitPoint, float( materialIndex ) );
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, phat, rand( 18 + i ) );

				}

				if ( !reservoir.valid ) {

					pathInfo.x = 0.0;
					return;

				}

				pathX2 = reservoir.sampleOut.path[ 2 ];
				pathInfo.y = reservoir.wSum / reservoir.phatOut;
				pathInfo.z = reservoir.phatOut;

				// @todo: insert visibility pass

				#endif
				
				#if RESTIR_PASS == PASS_SPATIAL_REUSE

				///////////////////
				// SPATIAL REUSE //
				///////////////////

				// @todo: different spatial reuse strategies might be worth exploring
				// @todo: different order of passes

				pathX2_out = texelFetch( pathX2_in, ivec2( gl_FragCoord.xy ), 0 );
				pathInfo_out = texelFetch( pathInfo_in, ivec2( gl_FragCoord.xy ), 0 );

				return; // @temp

				if ( pathInfo_out.x < 0.0 ) {

					// Primary ray missed.
					return;

				}

				////////////////////////////START/////////////////////////////////////////
				/*
				vec4 pathX0 = cameraWorldMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
				vec4 pathX1 = texelFetch( pathX1_in, ivec2( gl_FragCoord.xy ), 0 );

				Reservoir reservoir = initReservoir();

				for ( int i = 0; i < 9; ++i ) {

					int dx = i % 3 - 1;
					int dy = i / 3 - 1;

					float x = gl_FragCoord.x + float( dx );
					float y = gl_FragCoord.y + float( dy );

					// Pixel is out of viewport
					if ( x < 0.0 || x >= resolution.x || y < 0.0 || y >= resolution.y ) {

						continue;
					
					}

					vec4 pathInfo = texelFetch( pathInfo_in, ivec2( x, y ), 0 );
					if ( pathInfo.x < 1.0 ) {

						// No x2 was picked...
						continue;

					}
					
					vec4 pathX2 = texelFetch( pathX2_in, ivec2( x, y ), 0 );
					float phat = texelFetch( pathInfo_in, ivec2( x, y ), 0 ).z;

					Material lightMaterial;
					{
						uint materialIndex = uint( pathX2.w );
						lightMaterial = readMaterialInfo( materials, materialIndex );
					}
					vec3 emission = lightMaterial.emissiveIntensity * lightMaterial.emissive;

					float phatSum = 0.0;

					for ( int j = 0; j < 9; ++j ) {

						int dx2 = j % 3 - 1;
						int dy2 = j / 3 - 1;
						ivec2 offset = ivec2( dx2, dy2 );

						float x2 = gl_FragCoord.x + float( dx2 );
						float y2 = gl_FragCoord.y + float( dy2 );

						// Pixel is out of viewport
						if ( x2 < 0.0 || x2 >= resolution.x || y2 < 0.0 || y2 >= resolution.y ) {

							continue;
						
						}

						uvec4 faceIndices = uvec4( texelFetch( surfaceHit_faceIndices, ivec2( gl_FragCoord.xy ) + offset, 0 ) );
						vec4 barycoord_side = texelFetch( surfaceHit_barycoord_side, ivec2( gl_FragCoord.xy ) + offset, 0 );
						vec4 faceNormal_dist = texelFetch( surfaceHit_faceNormal_dist, ivec2( gl_FragCoord.xy ) + offset, 0 );

						SurfaceHit surfaceHit = SurfaceHit( faceIndices, barycoord_side.xyz, faceNormal_dist.xyz, barycoord_side.w, faceNormal_dist.w );
						SurfaceRecord surf;
						{

							uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
							Material material = readMaterialInfo( materials, materialIndex );

							int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );

						}


						vec4 pathX1 = texelFetch( pathX1_in, ivec2( x2, y2 ), 0 );
						vec3 rayDir = normalize( pathX1.xyz - pathX0.xyz );
						vec3 lightDir = normalize( pathX2.xyz - pathX1.xyz );

						vec3 sampleColor;
						float materialPdf = bsdfResult( -rayDir, lightDir, surf, sampleColor );

						float phat = dot( sampleColor * emission, luma );
						phatSum += phat;

					}

					float misWeight = phat / phatSum; // generalized balance heuristic
					float resamplingWeight = misWeight * phat * pathInfo.y;

					RisSample samp;
					samp.path[0] = pathX0;
					samp.path[1] = pathX1;
					samp.path[2] = pathX2;
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, phat, rand( 19 + i ) );

				}

				if ( !reservoir.valid ) {

					return;

				}

				pathX2_out = reservoir.sampleOut.path[ 2 ];
				pathInfo_out.y = reservoir.wSum / reservoir.phatOut;
				pathInfo_out.z = reservoir.phatOut;
				*/
				////////////////////////////END/////////////////////////////////////////

				vec4 pathX0 = cameraWorldMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
				vec4 pathX1 = texelFetch( pathX1_in, ivec2( gl_FragCoord.xy ), 0 );
				vec3 rayDir = normalize( pathX1.xyz - pathX0.xyz );

				uvec4 faceIndices = uvec4( texelFetch( surfaceHit_faceIndices, ivec2( gl_FragCoord.xy ), 0 ) );
				vec4 barycoord_side = texelFetch( surfaceHit_barycoord_side, ivec2( gl_FragCoord.xy ), 0 );
				vec4 faceNormal_dist = texelFetch( surfaceHit_faceNormal_dist, ivec2( gl_FragCoord.xy ), 0 );

				SurfaceHit surfaceHit = SurfaceHit( faceIndices, barycoord_side.xyz, faceNormal_dist.xyz, barycoord_side.w, faceNormal_dist.w );
				SurfaceRecord surf;
				{

					uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
					Material material = readMaterialInfo( materials, materialIndex );

					int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );

				}

				vec4 pathInfo = texelFetch( pathInfo_in, ivec2( gl_FragCoord.xy ), 0 );

				vec3 normal = surf.normal;
				float depth = pathInfo.w;

				Reservoir reservoir = initReservoir();

				if ( pathInfo.x > 0.0 ) {

					float misWeight = 1.0 / 9.0;
					float resamplingWeight = misWeight * pathInfo.z * pathInfo.y;

					RisSample samp;
					samp.path[0] = pathX0;
					samp.path[1] = pathX1;
					samp.path[2] = texelFetch( pathX2_in, ivec2( gl_FragCoord.xy ), 0 );
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, pathInfo.z, rand( 20 ) );

				}

				for ( int i = 0; i < 9; ++i ) {

					int dx = i % 3 - 1;
					int dy = i / 3 - 1;

					if ( dx == 0 && dy == 0 ) { continue; }

					float x = gl_FragCoord.x + float( dx );
					float y = gl_FragCoord.y + float( dy );

					// Pixel is out of viewport
					if ( x < 0.0 || x >= resolution.x || y < 0.0 || y >= resolution.y ) {

						continue;
					
					}

					ivec2 xy = ivec2( x, y );
					vec4 pathInfo = texelFetch( pathInfo_in, xy, 0 ); // @todo: don't shadow

					if ( pathInfo.x < 1.0 ) {

						// No x2 was picked...
						continue;

					}

					{

						uvec4 faceIndices = uvec4( texelFetch( surfaceHit_faceIndices, xy, 0 ) );
						vec4 barycoord_side = texelFetch( surfaceHit_barycoord_side, xy, 0 );
						vec4 faceNormal_dist = texelFetch( surfaceHit_faceNormal_dist, xy, 0 );

						SurfaceHit surfaceHit = SurfaceHit( faceIndices, barycoord_side.xyz, faceNormal_dist.xyz, barycoord_side.w, faceNormal_dist.w );
						SurfaceRecord surf;
						{

							uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
							Material material = readMaterialInfo( materials, materialIndex );

							int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );

						}

						vec3 _normal = surf.normal;
						float _depth = pathInfo.w;

						bool normalOk = dot( normal, _normal ) > 0.96;
						bool depthOk = _depth < 1.1 * depth && _depth > 0.9 * depth;

						if ( !normalOk || !depthOk ) {

							// Reject this neighbour.
							continue;

						}

					}

					vec4 pathX2 = texelFetch( pathX2_in, xy, 0 );
					vec3 lightDir = normalize( pathX2.xyz - pathX1.xyz );

					Material lightMaterial;
					{
						uint materialIndex = uint( pathX2.w );
						lightMaterial = readMaterialInfo( materials, materialIndex );
					}
					vec3 emission = lightMaterial.emissiveIntensity * lightMaterial.emissive;

					vec3 sampleColor;
					float materialPdf = bsdfResult( -rayDir, lightDir, surf, sampleColor );

					float phat = dot( sampleColor * emission, luma );

					float misWeight = 1.0 / 9.0;
					float unbiasedContribWeight = pathInfo.y;
					float resamplingWeight = misWeight * phat * unbiasedContribWeight;

					RisSample samp;
					samp.path[0] = pathX0;
					samp.path[1] = pathX1;
					samp.path[2] = pathX2;
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, phat, rand( 21 + i ) );

				}

				if ( !reservoir.valid ) {

					return;

				}

				pathX2_out = reservoir.sampleOut.path[ 2 ];
				pathInfo_out.y = reservoir.wSum / reservoir.phatOut;

				#endif

				#if RESTIR_PASS == PASS_TEMPORAL_REUSE

				////////////////////
				// TEMPORAL REUSE //
				////////////////////

				vec4 pathX0 = cameraWorldMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
				vec4 pathX1 = texelFetch( pathX1_in, ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathX2 = texelFetch( pathX2_in, ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathInfo = texelFetch( pathInfo_in, ivec2( gl_FragCoord.xy ), 0 );

				pathX2_out = pathX2; pathInfo_out = pathInfo; // "default values"

				vec4 pathX2_prev = texelFetch( pathX2_in_prev, ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathInfo_prev = texelFetch( pathInfo_in_prev, ivec2( gl_FragCoord.xy ), 0 );

				if ( pathInfo_prev.x < 1.0 ) {

					// No sample from previous frame.
					return;

				}

				Reservoir reservoir = initReservoir();

				float misWeight = 0.5; // @todo: check

				if ( pathInfo.x > 0.0 ) {

					float resamplingWeight = misWeight * pathInfo.z * pathInfo.y;

					RisSample samp;
					samp.path[0] = pathX0;
					samp.path[1] = pathX1;
					samp.path[2] = pathX2;
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, pathInfo.z, rand( 22 ) );

				}

				if ( pathInfo_prev.x > 0.0 ) {

					// compute target function for previous frame's sample
					uvec4 faceIndices = uvec4( texelFetch( surfaceHit_faceIndices, ivec2( gl_FragCoord.xy ), 0 ) );
					vec4 barycoord_side = texelFetch( surfaceHit_barycoord_side, ivec2( gl_FragCoord.xy ), 0 );
					vec4 faceNormal_dist = texelFetch( surfaceHit_faceNormal_dist, ivec2( gl_FragCoord.xy ), 0 );

					SurfaceHit surfaceHit = SurfaceHit( faceIndices, barycoord_side.xyz, faceNormal_dist.xyz, barycoord_side.w, faceNormal_dist.w );
					SurfaceRecord surf;
					{

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
						Material material = readMaterialInfo( materials, materialIndex );

						int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );

					}

					vec3 lightDir = normalize( pathX2_prev.xyz - pathX1.xyz );
					vec3 rayDir = normalize( pathX1.xyz - pathX0.xyz );

					Material lightMaterial;
					{
						uint materialIndex = uint( pathX2_prev.w );
						lightMaterial = readMaterialInfo( materials, materialIndex );
					}
					vec3 emission = lightMaterial.emissiveIntensity * lightMaterial.emissive;

					vec3 sampleColor;
					float materialPdf = bsdfResult( -rayDir, lightDir, surf, sampleColor );

					float phat = dot( sampleColor * emission, luma );

					float resamplingWeight = misWeight * phat * pathInfo_prev.y;

					RisSample samp;
					samp.path[0] = pathX0;
					samp.path[1] = pathX1;
					samp.path[2] = pathX2_prev;
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, phat, rand( 23 ) );

				}

				if ( !reservoir.valid ) {

					return;

				}

				pathX2_out = reservoir.sampleOut.path[ 2 ];
				pathInfo_out.y = reservoir.wSum / reservoir.phatOut;

				#endif

				#if RESTIR_PASS == PASS_SAVE_SAMPLE

				//////////////////
				// SAVE SAMPLES //
				//////////////////

				pathX2_out = texelFetch( pathX2_in, ivec2( gl_FragCoord.xy ), 0 );
				pathInfo_out = texelFetch( pathInfo_in, ivec2( gl_FragCoord.xy ), 0 );

				#endif

				#if RESTIR_PASS == PASS_SHADE_PIXEL

				/////////////////
				// SHADE POINT //
				/////////////////

				fragColor = vec4( 0.0, 0.0, 0.0, 1.0 );

				vec4 pathInfo = texelFetch( pathInfo, ivec2( gl_FragCoord.xy ), 0 );

				if ( pathInfo.x < 0.0 ) {

					// Primary ray missed.
					return;

				}

				uvec4 faceIndices = uvec4( texelFetch( surfaceHit_faceIndices, ivec2( gl_FragCoord.xy ), 0 ) );
				vec4 barycoord_side = texelFetch( surfaceHit_barycoord_side, ivec2( gl_FragCoord.xy ), 0 );
				vec4 faceNormal_dist = texelFetch( surfaceHit_faceNormal_dist, ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathX1 = texelFetch( pathX1, ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathX2 = texelFetch( pathX2, ivec2( gl_FragCoord.xy ), 0 );

				SurfaceHit surfaceHit = SurfaceHit( faceIndices, barycoord_side.xyz, faceNormal_dist.xyz, barycoord_side.w, faceNormal_dist.w );

				Sample samp;
				samp.path[0] = cameraWorldMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
				samp.path[1] = pathX1;
				samp.path[2] = pathX2;
				samp.unbiasedContribWeight = pathInfo.y;

				SurfaceRecord surf;
				{

					uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
					Material material = readMaterialInfo( materials, materialIndex );

					int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );
					if ( surfRecord == SKIP_SURFACE ) {

						// TODO: what's the semantics of skipping a surface even
						fragColor = vec4( surf.emission, 1.0 );
						return;

					}

				}

				float lightDist = length( samp.path[ 2 ].xyz - samp.path[ 1 ].xyz );
				vec3 lightDir = normalize( samp.path[ 2 ].xyz - samp.path[ 1 ].xyz );

				vec3 rayDir = normalize( samp.path[ 1 ].xyz - samp.path[ 0 ].xyz );

				if ( pathInfo.x < 1.0 || dot( lightDir, surf.normal ) <= 0.0 ) {

					// Light is behind the surface
					//
					// @todo: support transmission...

					fragColor = vec4( surf.emission, 1.0 );
					return;

				}

				Ray shadowRay = Ray( samp.path[ 1 ].xyz, lightDir );
				SurfaceHit lightHit;
				int hitType = traceScene( shadowRay, lightHit );

				if ( hitType == SURFACE_HIT ) {

					if ( lightHit.dist < lightDist - 0.001 ) {

						// Light is blocked
						fragColor = vec4( surf.emission, 1.0 );

					} else {

						Material lightMaterial;
						{
							uint materialIndex = uint( pathX2.w );
							lightMaterial = readMaterialInfo( materials, materialIndex );
						}
						vec3 emission = lightMaterial.emissiveIntensity * lightMaterial.emissive;

						vec3 sampleColor;
						float materialPdf = bsdfResult( -rayDir, lightDir, surf, sampleColor );

						if ( materialPdf > 0.0 ) {

							// @todo: do we need this? existing code doesn't seem to care...
							float g = dot( lightDir, surf.normal );

							fragColor = vec4( (surf.emission + sampleColor * emission) * samp.unbiasedContribWeight, 1.0 );

						} else {

							// This branch should not occur - it probably means
							// the light is beneath the surface, which we have
							// already checked for.

							fragColor = vec4( surf.emission, 1.0 );

						}

					}

				} else {

					// Sampled light is obstructed from hit point.

					fragColor = vec4( surf.emission, 1.0 );

				}

				#endif

			}
		`;

		super( parameters );

		this.glslVersion = GLSL3;
		this.fragmentShader = fragmentShader;

		this.defines["PASS_GEN_SAMPLE"] = Pass.GenSample;
		this.defines["PASS_SHADE_PIXEL"] = Pass.ShadePixel;
		this.defines["PASS_SPATIAL_REUSE"] = Pass.SpatialReuse;
		this.defines["PASS_TEMPORAL_REUSE"] = Pass.TemporalReuse;
		this.defines["PASS_SAVE_SAMPLE"] = Pass.SaveSample;

		this.defines["RESTIR_PASS"] = pass;

    }

}