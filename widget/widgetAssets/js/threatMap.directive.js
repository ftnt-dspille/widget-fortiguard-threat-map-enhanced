/* Copyright start
  Copyright (C) 2008 - 2026 Fortinet Inc.
  All rights reserved.
  FORTINET CONFIDENTIAL & FORTINET PROPRIETARY SOURCE CODE
  Copyright end */

'use strict';

angular.module('cybersponse').directive('threatMap', ['$timeout', '$http', '$rootScope', function($timeout, $http, $rootScope) {
    return {
        restrict: 'E',
        scope: { 
            attack: '=', 
            mode: '=', 
            heatmap: '=',
            allData: '=',
            widgetBasePath: '=?'
        },
        link: function(scope, element) {
            var g, path, timer;
            var worldData, width, height, countryMap;
            var rotationAngle = 0;
            var countryIntensity = {};
            var activeAttacks = [];
            var verticalPadding = 20; 

            // Helper to get theme-specific colors from CSS variables
            function getThemeColors() {
                var style = window.getComputedStyle(element[0].closest('.threat-dashboard-container') || element[0]);
                return {
                    land: style.getPropertyValue('--land-fill').trim() || '#1e242b',
                    stroke: style.getPropertyValue('--land-stroke').trim() || '#0a0d12',
                    text: style.getPropertyValue('--city-text-color').trim() || '#00e5ff',
                    attackSrc: style.getPropertyValue('--attack-src').trim() || '#BFB5FF',
                    attackDest: style.getPropertyValue('--attack-dest').trim() || '#ff3b3b',
                };
            }

            // Generate heat scale based on the active theme
            function getHeatScale() {
                var currentTheme = $rootScope.theme.id;
                var range;
                
                if (currentTheme === 'light') {
                    // High-visibility blue/teal gradient for white landmasses
                    range = ["#86A6E2", "#7695CE", "#6684BB", "#5673A7", "#456294", "#35517F", "#253D6A"];
                } else if (currentTheme === 'deepSea') {
                    // Cold-to-hot blue gradient for midnight backgrounds
                    range = ["#AABBDA", "#B6C8E9", "#9EB3D9",  "#869DC8", "#6E87B8", "#5672A7", "#3E5C97"];
                } else {
                    // Classic neon green/yellow for Dark and Steel themes
                    range = ["#5FC7D5", "#54B2BE", "#499DA8", "#3E8891", "#33737B", "#285E64", "#1C484D"];
                }

                return d3.scaleThreshold()
                    .domain([10, 100, 500, 1000, 5000, 10000])
                    .range(range);
            }

            function init() {
                if (!window.d3 || !window.topojson) { $timeout(init, 200); return; }

                $http.get(scope.widgetBasePath + 'widgetAssets/lib/countries_data.json')
                    .then(function(response) {
                        countryMap = response.data;
                        width = element[0].parentElement.offsetWidth;
                        height = width * 0.5;
                        
                        d3.select(element[0]).select('svg').remove();
                        var svg = d3.select(element[0]).append('svg')
                            .attr('width', '100%').attr('height', height)
                            .attr('viewBox', '0 0 ' + width + ' ' + height)
                            .attr('preserveAspectRatio', 'xMidYMid meet'); 
                        
                        g = svg.append('g');
                        return d3.json(scope.widgetBasePath + 'widgetAssets/lib/countries-110m.json');
                    })
                    .then(function(data) {
                        worldData = data;
                        if(scope.allData) processFullHeatmap(scope.allData);
                        draw(); 
                        renderLoop();
                    })
                    .catch(function(err) { console.error("D3 Init Error:", err); });
            }

            // (processFullHeatmap and getNormalizedName logic remains unchanged)
            function getNormalizedName(raw) {
                if (!raw) return null;
                var code = raw.toString().toUpperCase().trim();
                return (countryMap && countryMap[code]) ? countryMap[code] : raw;
            }

            function processFullHeatmap(data) {
                var tempIntensity = {}; // Use a local object to build the data all at once
                if(!data || !countryMap) return;
                
                if (!Array.isArray(data)) {
                    Object.keys(data).forEach(function(code) {
                        var fullName = countryMap[code.toUpperCase()];
                        if (fullName) {
                            tempIntensity[fullName.toLowerCase().trim()] = data[code].count || 0;
                        }
                    });
                } else {
                    data.forEach(function(item) {
                        var name = getNormalizedName(item.dest_country);
                        if (name) {
                            var key = name.toLowerCase().trim();
                            tempIntensity[key] = (tempIntensity[key] || 0) + 1;
                        }
                    });
                }
                // 2. Assign the complete object at once
                countryIntensity = tempIntensity;
            }

            function draw() {
                if (!worldData || !window.topojson) return;
                var countriesGeoJSON = window.topojson.feature(worldData, worldData.objects.countries);
                var colors = getThemeColors();
                var heatScale = getHeatScale();
                var projection;
                
                if (scope.mode === '3d') {
                    var globeRadius = (Math.min(width, height) / 2) - verticalPadding;
                    projection = d3.geoOrthographic()
                        .scale(globeRadius).translate([width / 2, height / 2])
                        .clipAngle(90).rotate([rotationAngle, -15]);
                } else {
                    projection = d3.geoEquirectangular()
                        .fitExtent([[0, verticalPadding], [width , height - verticalPadding]], countriesGeoJSON);
                }
                
                path = d3.geoPath().projection(projection);

                var countries = g.selectAll('.country').data(countriesGeoJSON.features.filter(d => d.id !== "010"));
                
                countries.enter().append('path').attr('class', 'country')
                    .merge(countries)
                    .attr('d', path)
                    .attr('fill', function(d) {
                        if (!scope.heatmap) return colors.land;
                        
                        var mapName = (d.properties.name || "").toLowerCase().trim();
                        var count = countryIntensity[mapName] || 0;

                        if (count === 0) {
                            Object.keys(countryIntensity).some(function(key) {
                                if (mapName.includes(key) || key.includes(mapName)) {
                                    count = countryIntensity[key];
                                    return true;
                                }
                                return false;
                            });
                        }
                        return count > 0 ? heatScale(count) : colors.land;
                    })
                    .attr('stroke', colors.stroke).attr('stroke-width', 0.5);

                countries.exit().remove();
                updateAttackVisuals(projection);
            }

            function updateAttackVisuals(projection) {
                var colors = getThemeColors();
                g.selectAll('.attack-element').remove();
                var now = Date.now();
                activeAttacks = activeAttacks.filter(a => now - a.ts < 3000);
                var center = projection.invert([width / 2, height / 2]);

                activeAttacks.forEach(function(d) {
                    var lineColor = (d.vuln_type === 'virus') ? "#ff9800" : "#ff3b3b";
                    var elapsed = now - d.ts;
                    var duration = 800; // Travel speed
                    var progress = Math.min(elapsed / duration, 1);
                    
                    // Slow down the overall fade-out
                    var overallOpacity = Math.max(0, (3000 - elapsed) / 1500);

                    var isSrcVisible = true;
                    var isDestVisible = true;
                    if (scope.mode === '3d') {
                        isSrcVisible = d3.geoDistance(d.coords.src, center) < Math.PI / 2;
                        isDestVisible = d3.geoDistance(d.coords.dest, center) < Math.PI / 2;
                    }

                    var src = (isSrcVisible && d.coords.src[0] !== 0) ? projection(d.coords.src) : null;
                    var dest = isDestVisible ? projection(d.coords.dest) : null;

                    // --- PATH DRAWING ---
                    if (src && dest) {
                        var dx = dest[0] - src[0], dy = dest[1] - src[1];
                        var dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
                        var dPath = "M" + src[0] + "," + src[1] + "A" + dr + "," + dr + " 0 0,1 " + dest[0] + "," + dest[1];

                        // Background line fades out faster than the pulse
                        g.append("path").attr("class", "attack-element").attr("d", dPath)
                            .attr("fill", "none").attr("stroke", lineColor).attr("stroke-width", 6)
                            .attr("opacity", overallOpacity * 0.15);

                        var blockOpacity = progress < 1 ? overallOpacity : overallOpacity * 0.5;
                        var pathEl = g.append("path").attr("class", "attack-element").attr("d", dPath)
                            .attr("fill", "none").attr("stroke", lineColor).attr("stroke-width", 6)
                            .attr("stroke-linecap", "round").attr("opacity", blockOpacity);

                        var totalLength = pathEl.node().getTotalLength();
                        pathEl.attr("stroke-dasharray", "25 " + totalLength)
                            .attr("stroke-dashoffset", totalLength - (progress * totalLength))
                            .style("filter", "drop-shadow(0 0 6px " + lineColor + ")");
                    }

                    // --- SOURCE ELEMENTS ---
                    if (src) {
                        var srcFade = Math.max(0, overallOpacity * (1 - progress));
                        if (d.src_city) {
                            g.append("text").attr("class", "attack-element")
                                .attr("x", src[0]).attr("y", src[1] - 25).attr("text-anchor", "middle")
                                .attr("fill", colors.text).style("font-size", "20px").text(d.src_city).attr("opacity", srcFade);
                        }
                        g.append("circle").attr("class", "attack-element").attr("cx", src[0]).attr("cy", src[1]).attr("r", 8)
                            .attr("fill", colors.attackSrc).attr("opacity", srcFade);
                    }

                    // --- DESTINATION ELEMENTS (FIXED RING) ---
                    if (dest) {
                        // Impact starts when the red block arrives
                        var impactOpacity = progress >= 1 ? overallOpacity : 0;
                        
                        if (d.dest_city) {
                            g.append("text").attr("class", "attack-element")
                                .attr("x", dest[0]).attr("y", dest[1] - 25).attr("text-anchor", "middle")
                                .attr("fill", colors.text).style("font-size", "20px").text(d.dest_city).attr("opacity", impactOpacity);
                        }

                        // 2. THE RING: Decoupled timing to prevent early removal
                        if (elapsed > duration) {
                            // How long the pulse ring lasts after impact (ms)
                            var pulseDuration = 1000; 
                            var pulseElapsed = elapsed - duration;
                            var pulseProgress = Math.min(pulseElapsed / pulseDuration, 1);
                            
                            g.append("circle").attr("class", "attack-element pulse-ring")
                                .attr("cx", dest[0]).attr("cy", dest[1])
                                .attr("r", 6 + (pulseProgress * 35)) // Grows much larger (35px)
                                .attr("stroke", colors.attackDest)
                                .attr("fill", "none")
                                .attr("stroke-width", 3)
                                .attr("opacity", (1 - pulseProgress) * overallOpacity); // Fade as it grows
                        }

                        g.append("circle").attr("class", "attack-element").attr("cx", dest[0]).attr("cy", dest[1]).attr("r", 6)
                            .attr("fill", colors.attackDest).attr("opacity", impactOpacity);
                    }
                });
            }
            

            var destroyAllData = scope.$watch('allData', function(v) { 
                if (v && countryMap) { 
                    processFullHeatmap(v); 
                    if (worldData) {
                        draw(); // This paints the map the moment data arrives
                    }
                } 
            }, true);
            
            var destroyAttack = scope.$watch('attack', function(v) { 
                if (v) { 
                    v.ts = Date.now(); 
                    activeAttacks.push(v);
                    var name = getNormalizedName(v.dest_country);
                    if (name) {
                        var key = name.toLowerCase().trim();
                        // Increment base value so it gets darker
                        countryIntensity[key] = (countryIntensity[key] || 0) + 10; 
                        
                        // Use a fast path for live attacks
                        if (worldData && scope.heatmap) {
                            // If in 2D mode, we draw immediately. 
                            // If in 3D mode, the renderLoop timer will handle the next frame.
                            if (scope.mode !== '3d') draw(); 
                        }
                    }
                } 
            });

            // Watch for theme changes specifically to re-draw map colors
            var destroyheatmapGroup = scope.$watchGroup(['heatmap', 'mode', function() { return $rootScope.theme.id; }], function() { 
                if (worldData) draw(); 
            });

            function renderLoop() {
                if (timer) timer.stop();
                timer = d3.timer(function() {
                    if (scope.mode === '3d') { 
                        rotationAngle += 0.5; 
                        draw(); 
                    } else if (activeAttacks.length > 0) {
                        draw();
                    }
                });
            }
            init();
            scope.$on('$destroy', function() {
                destroyAllData();
                destroyAttack();
                destroyheatmapGroup();
                if (timer) {
                    timer.stop();
                }
            });
        }
    };
}]);