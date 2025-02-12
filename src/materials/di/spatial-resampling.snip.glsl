
				#if RESTIR_PASS == PASS_SPATIAL_REUSE

				////////////////////////////////////////////////////////////////
				// SPATIAL REUSE
				//
				// Causes artifacts - unused for now.
				////////////////////////////////////////////////////////////////

				int randBase = 1000;

				// @todo: different spatial reuse strategies might be worth exploring
				// @todo: different order of passes

				pathX2_out = texelFetch( pathX2_in, ivec2( gl_FragCoord.xy ), 0 );
				pathInfo_out = texelFetch( pathInfo_in, ivec2( gl_FragCoord.xy ), 0 );

				return; // @temp

				if ( pathInfo_out.x < 0.0 ) {

					// Primary ray missed.
					return;

				}

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
					samp.pathX2                  = texelFetch( pathX2_in, ivec2( gl_FragCoord.xy ), 0 );
					samp.resamplingWeight        = resamplingWeight;

					addSample( reservoir, samp, pathInfo.z, rand( ++randBase ) );

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
					samp.pathX2 = pathX2;
					samp.resamplingWeight = resamplingWeight;

					addSample( reservoir, samp, phat, rand( ++randBase ) );

				}

				if ( !reservoir.valid ) {

					return;

				}

				pathX2_out = reservoir.sampleOut.pathX2;
				pathInfo_out.y = reservoir.wSum / reservoir.phatOut;

				#endif
