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
			uniform mat4 invCameraWorldMatrix; // view matrix
			uniform mat4 invCameraWorldMatrixPrev;
			uniform mat4 cameraWorldMatrix; // view matrix inverse
			uniform mat4 cameraProjectionMatrix;
			uniform mat4 cameraProjectionMatrixPrev;
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

			uniform int hasPrevFrame;

			const vec3 luma = vec3( 0.2126, 0.7152, 0.0722 );

			${ StructsGLSL.emissive_triangles_struct }

			uniform EmissiveTrianglesInfo emissiveTriangles;

			struct RisSample {

				vec4  pathX2; // w component stores material index
				vec4  pathX3; // zero if not sampled
				float resamplingWeight;

			};

			// An abstraction used to facililtate RIS.
			struct Reservoir {

				RisSample sampleOut;
				float     phatOut;  // evaluation of target function for sampleOut
				float     wSum;     // sum of resampling weights; required for unbiased contribution weight Wx
				bool      valid;    // we might not successfully pick a sample...
			
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

			vec2 getPrevFrameUV( vec4 worldCurr ) {

				vec4 clipPrev = cameraProjectionMatrixPrev * invCameraWorldMatrixPrev * worldCurr;
				clipPrev /= clipPrev.w;
				vec2 uv = 0.5 * clipPrev.xy + 0.5;
				return uv;

			}

			vec2 getPrevFrameFragCoord( vec4 worldCurr ) {

				vec2 uv = getPrevFrameUV( worldCurr );
				return uv * resolution;

			}

			vec3 normalOfSurfaceHit( SurfaceHit surfaceHit ) {
			
				vec3 triNormal = normalize( textureSampleBarycoord(
					attributesArray,
					ATTR_NORMAL,
					surfaceHit.barycoord,
					surfaceHit.faceIndices.xyz
				).xyz );

				return triNormal;

			}

			void areaSampleLight(
				inout Reservoir     reservoir,
				      int           M_area,
				      int           M_bsdf,
				      vec4          pathX1, // not literal pathX1, but relative
				      vec3          wo,
				      SurfaceRecord surf,
				inout int           randBase
			) {

				for ( int i = 0; i < M_area; ++i ) {

					EmissiveTriangleSample emTri = randomEmissiveTriangleSample( emissiveTriangles, rand( ++randBase ) );

					vec3  wi        = normalize( emTri.barycoord - pathX1.xyz );
					float lightDist = length( emTri.barycoord - pathX1.xyz );

					if ( dot( wi, emTri.normal ) >= 0.0 ) {
					
						// Wrong side of the light - don't bother
						continue;
					
					}

					float invLightDistSquared = 1.0 / ( lightDist * lightDist );

					float invLightPdf = invLightDistSquared * emTri.tri.area * dot( -wi, emTri.normal ) * float( emissiveTriangles.count );
					float lightPdf    = 1.0 / invLightPdf;

					uint     emTriMaterialIndex = uTexelFetch1D( materialIndexAttribute, emTri.tri.indices.x ).r;
					Material lightMaterial      = readMaterialInfo( materials, emTriMaterialIndex );
					vec3     emission           = lightMaterial.emissiveIntensity * lightMaterial.emissive;

					vec3 sampleColor;

					float materialPdf = bsdfResult( wo, wi, surf, sampleColor );

					float phat             = dot( sampleColor * emission, luma );
					float misWeight        = lightPdf / ( float( M_area ) * lightPdf + float( M_bsdf ) * materialPdf );
					float resamplingWeight = misWeight * phat * invLightPdf;

					RisSample samp;

					samp.pathX2           = vec4( emTri.barycoord, float( emTriMaterialIndex ) );
					samp.pathX3           = vec4( 0.0, 0.0, 0.0, -1.0 ); // path terminates
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, phat, rand( ++randBase ) );
				
				}
			}

			const int bsdfSample_miss         = 0;
			const int bsdfSample_lightHit     = 1;
			const int bsdfSample_continuation = 2;

			vec4 getPathX1( SurfaceHit surfaceHit, Ray primaryRay ) {

				uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
				vec3 pathX1        = stepRayOrigin( primaryRay.origin, primaryRay.direction, surfaceHit.faceNormal, surfaceHit.dist );

				return vec4( pathX1, float( materialIndex ) );

			}
			
			#if RESTIR_PASS == PASS_GEN_SAMPLE

			/*
			pathInfo.x: ok
			pathInfo.y: unbiased contrib weight
			pathInfo.z: target function evaluated for selected sample
			pathInfo.w: depth of primary ray // needed for spatial resampling, but unused for now
			
			ok < 0.0: primary ray missed
			ok < 1.0: secondary ray missed
			otherwise: ok
			*/

			layout(location = 0) out vec4 surfaceHit_faceIndices;
			layout(location = 1) out vec4 surfaceHit_barycoord_side;
			layout(location = 2) out vec4 surfaceHit_faceNormal_dist;
			layout(location = 3) out vec4 pathX2;
			layout(location = 4) out vec4 pathInfo;
			layout(location = 5) out vec4 pathX3;

			uniform int M_area; // number of uniform random area light samples
			uniform int M_bsdf; // number of bsdf samples

			#endif

			#if RESTIR_PASS == PASS_TEMPORAL_REUSE
			// @cont: fix texture units too many error, maybe due to using the materials??

			// We can't keep the g buffer data around, because it overflows the
			// max texture units...
			//
			// uniform sampler2D surfaceHit_faceIndices;
			// uniform sampler2D surfaceHit_barycoord_side;
			// uniform sampler2D surfaceHit_faceNormal_dist;

			uniform sampler2D pathX2_in;
			uniform sampler2D pathInfo_in;
			uniform sampler2D pathX3_in;

			// Previous frame data
			uniform sampler2D pathX2_in_prev;
			uniform sampler2D pathInfo_in_prev;
			uniform sampler2D pathX3_in_prev;

			layout(location = 0) out vec4 pathX2_out;
			layout(location = 1) out vec4 pathInfo_out;
			layout(location = 2) out vec4 pathX3_out;

			#endif

			#if RESTIR_PASS == PASS_SAVE_SAMPLE

			uniform sampler2D pathX2_in;
			uniform sampler2D pathInfo_in;
			uniform sampler2D pathX3_in;

			layout(location = 0) out vec4 pathX2_out;
			layout(location = 1) out vec4 pathInfo_out;
			layout(location = 2) out vec4 pathX3_out;

			#endif

			#if RESTIR_PASS == PASS_SHADE_PIXEL

			layout(location = 0) out vec4 fragColor;

			uniform sampler2D surfaceHit_faceIndices;
			uniform sampler2D surfaceHit_barycoord_side;
			uniform sampler2D surfaceHit_faceNormal_dist;
			uniform sampler2D pathX2;
			uniform sampler2D pathInfo;
			uniform sampler2D pathX3;

			#endif

			#if RESTIR_PASS == PASS_SHADE_PIXEL

			SurfaceHit readSurfaceHit( ivec2 xy ) {

				uvec4 faceIndices    = uvec4( texelFetch( surfaceHit_faceIndices    , xy, 0 ) );
				vec4 barycoord_side  =        texelFetch( surfaceHit_barycoord_side , xy, 0 );
				vec4 faceNormal_dist =        texelFetch( surfaceHit_faceNormal_dist, xy, 0 );

				SurfaceHit surfaceHit = SurfaceHit( faceIndices, barycoord_side.xyz, faceNormal_dist.xyz, barycoord_side.w, faceNormal_dist.w );

				return surfaceHit;
			}

			SurfaceRecord readSurfaceRecord( ivec2 xy, out int res ) {

				SurfaceHit surfaceHit = readSurfaceHit( xy );

				uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
				Material material  = readMaterialInfo( materials, materialIndex );

				SurfaceRecord surf;
				
				res = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );

				return surf;

			}

			SurfaceRecord readSurfaceRecord( ivec2 xy ) {

				int res;
				return readSurfaceRecord( xy, res );

			}

			#endif

			float targetFunc( SurfaceRecord surf, vec4 pathX0, vec4 pathX1, vec4 pathX2 ) {
			
				vec3 wi = normalize( pathX2.xyz - pathX1.xyz );
				vec3 wo = normalize( pathX0.xyz - pathX1.xyz );

				Material lightMaterial;
				{
					uint materialIndex = uint( pathX2.w );
					lightMaterial      = readMaterialInfo( materials, materialIndex );
				}
				vec3 emission = lightMaterial.emissiveIntensity * lightMaterial.emissive;

				vec3 sampleColor;
				float materialPdf = bsdfResult( wo, wi, surf, sampleColor );

				float phat = dot( sampleColor * emission, luma );

				return phat;

			}

			void main() {

				////////////////////////////////////////////////////////////////
				// Common init code
				////////////////////////////////////////////////////////////////

				rng_initialize( gl_FragCoord.xy, seed );

				sobolPixelIndex = ( uint( gl_FragCoord.x ) << 16 ) | uint( gl_FragCoord.y );
				sobolPathIndex  = uint( seed );

				#if RESTIR_PASS == PASS_GEN_SAMPLE

				////////////////////////////////////////////////////////////////
				// GENERATE SAMPLE
				//
				// We perform MIS+RIS on simple sampling procedures. We generate
				// M_area samples of random points on area lights, and M_bsdf
				// samples of directions from the hit point's BSDF.
				//
				// The target function is L dot N * f dot E, where L dot N is the
				// geometry term, f is the BSDF spectral response, and E is the
				// emissive intensity.
				////////////////////////////////////////////////////////////////

				int randBase = 0;

				// Initialize outputs
				surfaceHit_faceIndices     = vec4( 0.0 );
				surfaceHit_barycoord_side  = vec4( 0.0 );
				surfaceHit_faceNormal_dist = vec4( 0.0 );

				pathX2   = vec4( 0.0 );
				pathInfo = vec4( 0.0 );
				pathX3   = vec4( 0.0, 0.0, 0.0, -1.0 );

				pathInfo.x = 1.0;

				SurfaceHit surfaceHit;

				Ray ray     = getCameraRay2();
				int hitType = traceScene( ray, surfaceHit );

				pathInfo.w = surfaceHit.dist;

				if ( hitType != SURFACE_HIT ) {

					pathInfo.x = -1.0;
					return;
					
				}

				vec4 pathX1 = getPathX1( surfaceHit, ray );

				SurfaceRecord surf;
				{

					uint     materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
					Material material      = readMaterialInfo( materials, materialIndex );

					int surfRecord = getSurfaceRecord( material, surfaceHit, attributesArray, 0.0, surf );

					if ( surfRecord == SKIP_SURFACE ) {

						// TODO: what's the semantics of skipping a surface even
						pathInfo.x = 0.0;
						return;

					}

				}

				// Record G buffer

				surfaceHit_faceIndices     = vec4( surfaceHit.faceIndices );
				surfaceHit_barycoord_side  = vec4( surfaceHit.barycoord, surfaceHit.side );
				surfaceHit_faceNormal_dist = vec4( surfaceHit.faceNormal, surfaceHit.dist );
				
				Reservoir reservoir = initReservoir();

				int M_bsdf = 1; // override the uniform, @todo: remove the uniform...

				// NEE
				areaSampleLight( reservoir, M_area, M_bsdf, pathX1, -ray.direction, surf, randBase );	

				ScatterRecord scatterRec = bsdfSample( -ray.direction, surf, rand2( ++randBase ) );

				if ( scatterRec.pdf <= 0.0 ) {

					if ( !reservoir.valid ) {

						pathInfo.x = 0.0;
						return;

					}

					pathX2     = reservoir.sampleOut.pathX2;
					pathInfo.y = reservoir.wSum / reservoir.phatOut;
					pathInfo.z = reservoir.phatOut;

					return;

				}

				SurfaceHit cont_surfaceHit;

				Ray cont_ray     = Ray( pathX1.xyz, scatterRec.direction );
				int cont_hitType = traceScene( cont_ray, cont_surfaceHit );

				if ( cont_hitType != SURFACE_HIT ) {

					// Continuation ray missed. Nothing else to do for initial
					// resampling, we'll save our reservoir and continue.

					if ( !reservoir.valid ) {

						pathInfo.x = 0.0;
						return;

					}

					pathX2     = reservoir.sampleOut.pathX2;
					pathInfo.y = reservoir.wSum / reservoir.phatOut;
					pathInfo.z = reservoir.phatOut;

					return;

				}

				uint     cont_materialIndex = uTexelFetch1D( materialIndexAttribute, cont_surfaceHit.faceIndices.x ).r;
				Material cont_material      = readMaterialInfo( materials, cont_materialIndex );
				vec3     cont_emission      = cont_material.emissiveIntensity * cont_material.emissive;

				vec4 cont_pathX2 = vec4( 0.0 );

				cont_pathX2.xyz = stepRayOrigin( cont_ray.origin, cont_ray.direction, cont_surfaceHit.faceNormal, cont_surfaceHit.dist );
				cont_pathX2.w   = float( cont_materialIndex );

				if ( cont_emission != vec3( 0.0 ) ) {

					// Our continutation ray hit a light source. Add it to the reservoir.

					vec3 triNormal = normalOfSurfaceHit( cont_surfaceHit );

					vec3 a = texelFetch1D( bvh.position, cont_surfaceHit.faceIndices.x ).xyz;
					vec3 b = texelFetch1D( bvh.position, cont_surfaceHit.faceIndices.y ).xyz;
					vec3 c = texelFetch1D( bvh.position, cont_surfaceHit.faceIndices.z ).xyz;

					float triArea = 0.5 * length( cross( b - a, c - a ) );

					if ( dot( cont_ray.direction, triNormal ) < 0.0 ) {
					
						float invLightDistSquared = 1.0 / ( cont_surfaceHit.dist * cont_surfaceHit.dist );
						float invLightPdf         = invLightDistSquared * triArea * dot( -cont_ray.direction, triNormal ) * float( emissiveTriangles.count );
						float lightPdf            = 1.0 / invLightPdf;

						float phat             = dot( scatterRec.color * cont_emission, luma );
						float misWeight        = scatterRec.pdf / ( float( M_area ) * lightPdf + float( M_bsdf ) * scatterRec.pdf );
						float resamplingWeight = misWeight * phat / scatterRec.pdf;

						RisSample samp;

						samp.pathX2           = cont_pathX2;
						samp.resamplingWeight = resamplingWeight;
						samp.pathX3           = vec4( 0.0, 0.0, 0.0, -1.0 ); // path terminates

						addSample( reservoir, samp, phat, rand( ++randBase ) );

					}

				}
				
				{
					// Let's sample one area light from [cont_pathX2] (NEE) and
					// then trace a shadow ray to account for visiblitiy. This
					// allows us to avoid tracing this ray for later stages.
					//
					// It's essentially getting the incoming radiance at X2.

					EmissiveTriangleSample emTri = randomEmissiveTriangleSample( emissiveTriangles, rand( ++randBase ) );

					vec3  wo        = -cont_ray.direction;
					vec3  wi        = normalize( emTri.barycoord - cont_pathX2.xyz );
					float lightDist = length( emTri.barycoord - cont_pathX2.xyz );

					if ( dot( wi, emTri.normal ) < 0.0 ) {

						// Light is facing the right way. Now we should trace a
						// shadow ray and see if the light is occluded.

						SurfaceHit surfaceHit;

						Ray shadowRay = Ray( cont_pathX2.xyz, wi );
						int hitType   = traceScene( shadowRay, surfaceHit );

						if ( hitType == SURFACE_HIT && surfaceHit.dist >= lightDist - 1e-5 ) {

							// Light is not occluded. We have a length 4 path!

							float invLightDistSquared = 1.0 / ( lightDist * lightDist );
							float invLightPdf         = invLightDistSquared * emTri.tri.area * dot( -wi, emTri.normal ) * float( emissiveTriangles.count );

							uint     emTriMaterialIndex = uTexelFetch1D( materialIndexAttribute, emTri.tri.indices.x ).r;
							Material lightMaterial      = readMaterialInfo( materials, emTriMaterialIndex );
							vec3     emission           = lightMaterial.emissiveIntensity * lightMaterial.emissive;

							SurfaceRecord cont_surf;
							getSurfaceRecord( cont_material, cont_surfaceHit, attributesArray, 0.0, cont_surf );

							vec3 cont_sampleColor;

							float materialPdf = bsdfResult( wo, wi, cont_surf, cont_sampleColor );
							vec3  Lo          = cont_sampleColor * emission;

							float phat             = dot( scatterRec.color * Lo, luma );
							float misWeight        = 1.0;
							float resamplingWeight = misWeight * phat * invLightPdf / ( scatterRec.pdf + 1e-5 );

							RisSample samp;

							samp.pathX2           = vec4( cont_pathX2 );
							samp.resamplingWeight = resamplingWeight;
							samp.pathX3           = vec4( emTri.barycoord, emTriMaterialIndex );

							addSample( reservoir, samp, phat, rand( ++randBase ) );

						}
					
					}

				}

				if ( !reservoir.valid ) {

					pathInfo.x = 0.0;
					return;

				}

				pathX2     = reservoir.sampleOut.pathX2;
				pathInfo.y = reservoir.wSum / ( reservoir.phatOut + 1e-5 );
				pathInfo.z = reservoir.phatOut;
				pathX3     = reservoir.sampleOut.pathX3;

				// @todo: insert visibility pass?

				#endif
				
				#if RESTIR_PASS == PASS_TEMPORAL_REUSE

				////////////////////////////////////////////////////////////////
				// TEMPORAL REUSE
				//
				// For now, no motion vectors. Also using biased MIS weights
				// (not generalized balance heuristic) because I'm not saving
				// the previous frame's G buffers.
				////////////////////////////////////////////////////////////////

				int randBase = 2000;

				vec4 pathX0   = cameraWorldMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
				vec4 pathX2   = texelFetch( pathX2_in  , ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathInfo = texelFetch( pathInfo_in, ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathX3   = texelFetch( pathX3_in  , ivec2( gl_FragCoord.xy ), 0 );

				// "default values"
				pathX2_out   = pathX2;
				pathInfo_out = pathInfo;
				pathX3_out   = pathX3;

				bool primaryRayMissed = pathInfo.x < 0.0;

				if ( primaryRayMissed || hasPrevFrame == 0 ) return;

				SurfaceHit surfaceHit;

				Ray primaryRay = getCameraRay2();
				int hitType    = traceScene( primaryRay, surfaceHit );

				vec4 pathX1 = getPathX1( surfaceHit, primaryRay );

				vec4 clip_prev  = cameraProjectionMatrixPrev * invCameraWorldMatrixPrev * vec4( pathX1.xyz, 1.0 );
				     clip_prev /= clip_prev.w;

				vec2 uv_prev = 0.5 * clip_prev.xy + 0.5;

				if ( uv_prev.x < 0.0 || uv_prev.y < 0.0 || uv_prev.x > 1.0 || uv_prev.y > 1.0 ) return;

				ivec2 fragCoord_prev = ivec2( uv_prev * resolution );

				vec4 pathX2_prev   = texelFetch( pathX2_in_prev  , fragCoord_prev, 0 );
				vec4 pathInfo_prev = texelFetch( pathInfo_in_prev, fragCoord_prev, 0 );
				vec4 pathX3_prev   = texelFetch( pathX3_in_prev  , fragCoord_prev, 0 );

				bool hasPrev = pathInfo_prev.x > 0.0;
				bool hasCurr = pathInfo.x      > 0.0;

				if ( !hasPrev ) return; // Can't do temporal reuse. Go to next pass.

				// Check if the previous sample is legit.
				bool depthOk =
					pathInfo_prev.w > 0.9 * pathInfo.w &&
					pathInfo_prev.w < 1.1 * pathInfo.w;

				if ( !depthOk ) return;

				Reservoir reservoir = initReservoir();

				// float misWeightCurr = 0.5;
				// float misWeightPrev = 1.0 - misWeightCurr;

				float misWeightCurr = pathInfo.z      / ( pathInfo.z + pathInfo_prev.z + 1e-5 );
				float misWeightPrev = pathInfo_prev.z / ( pathInfo.z + pathInfo_prev.z + 1e-5 );

				if ( hasPrev ) {

					float resamplingWeight = misWeightPrev * pathInfo_prev.z * pathInfo_prev.y;

					RisSample samp;

					samp.pathX2           = pathX2_prev;
					samp.resamplingWeight = resamplingWeight;
					samp.pathX3           = pathX3_prev;

					addSample( reservoir, samp, pathInfo_prev.z, rand( ++randBase ) );

				}

				if ( hasCurr ) {

					float resamplingWeight = misWeightCurr * pathInfo.z * pathInfo.y;

					RisSample samp;

					samp.pathX2           = pathX2;
					samp.resamplingWeight = resamplingWeight;
					samp.pathX3           = pathX3;

					addSample( reservoir, samp, pathInfo.z, rand( ++randBase ) );

				}

				if ( !reservoir.valid ) {

					// If sampling failed somehow, then we'll just use the
					// original sample for this frame before temporarl reuse
					// happens. I.e. it's as if we skipped temporarl reuse for
					// this pixel.
					return;

				}

				pathX2_out     = reservoir.sampleOut.pathX2;
				pathInfo_out.y = reservoir.wSum / ( reservoir.phatOut + 1e-5 );
				pathInfo_out.z = reservoir.phatOut;
				pathX3_out     = reservoir.sampleOut.pathX3;

				#endif

				#if RESTIR_PASS == PASS_SAVE_SAMPLE

				////////////////////////////////////////////////////////////////
				// SAVE SAMPLES
				//
				// By now, we must have decided on a sample for this frame. Save
				// this sample, so that we can reuse for the next frame.
				////////////////////////////////////////////////////////////////

				pathX2_out   = texelFetch( pathX2_in, ivec2( gl_FragCoord.xy ), 0 );
				pathInfo_out = texelFetch( pathInfo_in, ivec2( gl_FragCoord.xy ), 0 );
				pathX3_out   = texelFetch( pathX3_in, ivec2( gl_FragCoord.xy ), 0 );

				#endif

				#if RESTIR_PASS == PASS_SHADE_PIXEL

				////////////////////////////////////////////////////////////////
				// SHADE POINT
				//
				// Basic stuff. Given the selected sample and G buffer info,
				// trace ray and shade the point.
				////////////////////////////////////////////////////////////////

				fragColor = vec4( 0.0, 0.0, 0.0, 1.0 );

				vec4 pathInfo = texelFetch( pathInfo, ivec2( gl_FragCoord.xy ), 0 );

				if ( pathInfo.x < 0.0 ) {

					// Primary ray missed.
					return;

				}

				vec4 pathX0 = cameraWorldMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
				vec4 pathX2 = texelFetch( pathX2, ivec2( gl_FragCoord.xy ), 0 );
				vec4 pathX3 = texelFetch( pathX3, ivec2( gl_FragCoord.xy ), 0 );

				SurfaceHit surfaceHit = readSurfaceHit( ivec2( gl_FragCoord.xy ) );
				Ray        primaryRay = getCameraRay2();
				vec4       pathX1     = getPathX1( surfaceHit, primaryRay );

				// @todo: this is negative somehow??
				// float unbiasedContribWeight = pathInfo.y;
				// float unbiasedContribWeight = 1.0;
				float unbiasedContribWeight = max( 0.0, pathInfo.y );

				int x1_surfRecord;
				SurfaceRecord surf = readSurfaceRecord( ivec2( gl_FragCoord.xy ), x1_surfRecord );

				fragColor.xyz += surf.emission;

				if ( pathInfo.x < 1.0 ) {

					// Primary ray hit but no sample was selected.
					return;

				}

				float x1x2dist = length( pathX2.xyz - pathX1.xyz );
				vec3  wi       = normalize( pathX2.xyz - pathX1.xyz );
				vec3  wo       = normalize( pathX0.xyz - pathX1.xyz );

				SurfaceHit pathX2Hit;

				Ray x1x2ray = Ray( pathX1.xyz, wi );
				int hitType = traceScene( x1x2ray, pathX2Hit );

				if ( hitType == SURFACE_HIT ) {

					if ( pathX2Hit.dist < x1x2dist - 1e-5 ) {

						// x2 is blocked

					} else {

						Material x2_material;
						{
							uint materialIndex = uint( pathX2.w );
							x2_material        = readMaterialInfo( materials, materialIndex );
						}
						vec3 x2_emission = x2_material.emissiveIntensity * x2_material.emissive;

						// Radiance exiting x2 is at least x2's emission.
						vec3 x2_Lo = x2_emission;

						if ( pathX3.w != -1.0 ) {

							// Path has length 4. The light source is x4.

							Material x3_material = readMaterialInfo( materials, uint( pathX3.w ) );
							vec3     x3_emission = x3_material.emissiveIntensity * x3_material.emissive;

							SurfaceRecord x2_surf;
							getSurfaceRecord( x2_material, pathX2Hit, attributesArray, 0.0, x2_surf );

							vec3 x2_wo = -wi;
							vec3 x2_wi = normalize( pathX3.xyz - pathX2.xyz );

							vec3 x2_sampleColor;
							float x2_materialPdf = bsdfResult( x2_wo, x2_wi, x2_surf, x2_sampleColor );

							if ( x2_materialPdf > 0.0 ) {

								x2_Lo += x2_sampleColor * x3_emission;

							}

						}

						vec3 sampleColor;
						float materialPdf = bsdfResult( wo, wi, surf, sampleColor );

						if ( materialPdf > 0.0 ) {

							// @note: No geometry term (L dot N) needed. I guess
							// it's included in [sampleColor]? Double checked
							// that image converges without it.

							fragColor.xyz += sampleColor * x2_Lo * unbiasedContribWeight;

						} else {

							// This branch should not occur - it probably means
							// the light is beneath the surface, which we have
							// already checked for.

						}

					}

				} else {

					// Ray from x1 to x2 missed. Impossible.

				}

				// fragColor.xyz = min( fragColor.xyz, vec3( 10.0 ) );
				// fragColor.xyz = fragColor.xyz / ( 1.0 + fragColor.xyz );
				// fragColor.xyz = log( 1.0 + fragColor.xyz );

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