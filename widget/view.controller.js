/* Copyright start
  Copyright (C) 2008 - 2026 Fortinet Inc.
  All rights reserved.
  FORTINET CONFIDENTIAL & FORTINET PROPRIETARY SOURCE CODE
  Copyright end */

'use strict';
(function () {
    angular
        .module('cybersponse')
        .controller('fortiGuardThreatMap102DevCtrl', fortiGuardThreatMap102DevCtrl);

    fortiGuardThreatMap102DevCtrl.$inject = ['$scope', '$interval', '$q', '$rootScope', 'threatMapService', 'widgetBasePath', 'config'];

    function fortiGuardThreatMap102DevCtrl($scope, $interval, $q, $rootScope, threatMapService, widgetBasePath, config) {
        var refreshTimer;
        var attackQueue = [];
        var currentQueueIndex = 0;

        // Initialize State
        $scope.mode = '2d';
        $scope.showHeat = true;
        $scope.attackHistory = [];
        $scope.latestAttack = null;
        $scope.heatmapData = {}; // Initialize as object for directive compatibility
        $scope.widgetBasePath = widgetBasePath;
        $scope.currentTheme = $rootScope.theme.id;
        $scope.filter = { selectedOutbreakID: null };
        // Message shown in the widget when loading fails (never left in the console only)
        $scope.loadError = null;
        // Widget configuration (set from the widget's edit dialog)
        $scope.config = config || {};
        $scope.demoMode = !!$scope.config.demoMode;

        // Bindings
        $scope.onOutbreakChange = onOutbreakChange;
        $scope.setMode = function(m) { $scope.mode = m; };
        $scope.toggleHeat = function() { $scope.showHeat = !$scope.showHeat; };

        function init() {
            // Load external dependencies first
            $q.all([
                loadSafeTopojson(widgetBasePath + 'widgetAssets/lib/topojson-client.min.js')
            ]).then(function() {
                // Step 1: Get Initial Outbreak List
                return threatMapService.executeAction('fortinet-fortiguard-outbreak', 'list_outbreak_alert_details', { limit: 1000 });
            }).then(function(response) {
                $scope.allOutbreakDetails = response.data.results;
                if ($scope.allOutbreakDetails.length > 0) {
                    $scope.filter.selectedOutbreakID = $scope.allOutbreakDetails[0].ID;
                    _fetchMapData(); // Step 2: Fetch Map content
                }
            }).catch(function(err) {
                console.error("Initialization Error:", err);
                _setLoadError(err);
            });
        }

        // Turn any failure into text the analyst sees in the widget: the service's own
        // message when it has one (missing connector, no default configuration), else a
        // generic line plus the platform's reason when there is one.
        function _setLoadError(err) {
            var reason = (err && (err.message || (err.data && (err.data.message || err.data.error)))) || '';
            $scope.loadError = reason || 'The threat map could not be loaded.';
            $scope.showProcessing = false;
            $scope.showError = false;
        }

        /**
         * Orchestrates the simultaneous loading of Heatmap and Live Map data.
         * In demo mode the live-map call is skipped entirely and the attack
         * queue is filled with simulated arcs (biased toward the countries the
         * real heat layer highlights) so the map always animates.
         */
        function _fetchMapData() {
            $scope.attackHistory = []; // Reset history for new context
            attackQueue = [];
            currentQueueIndex = 0;
            $scope.showProcessing = true;
            $scope.showError = false;
            $scope.loadError = null;

            var demoMode = !!$scope.config.demoMode;

            var heatParams = {
                limit: 50,
                num_groups: 10,
                hour: 24,
                num_interval: "Hours",
                outbreak_id: $scope.filter.selectedOutbreakID
            };

            var liveParams = {
                limit: 50,
                last_sec: 10800,
                segment_sec: 1800,
                replay: true,
                outbreak_id: $scope.filter.selectedOutbreakID
            };

            var calls = [threatMapService.executeAction('fortinet-fortiguard-outbreak', 'get_outbreak_threat_heat_map_details', heatParams)];
            if (!demoMode) {
                calls.push(threatMapService.executeAction('fortinet-fortiguard-outbreak', 'get_outbreak_threat_live_map_details', liveParams));
            }

            $q.all(calls).then(function(responses) {
                var heatResp = responses[0];
                var heatUsable = !!(heatResp && heatResp.data && heatResp.data.data &&
                    heatResp.data.data.message !== 'Information not found');
                if (heatUsable) {
                    $scope.showProcessing = false;
                    $scope.heatmapData = heatResp.data.data || {};
                } else {
                    $scope.heatmapData = {};
                }

                if (demoMode) {
                    _buildDemoAttackQueue($scope.heatmapData);
                    $scope.showProcessing = false;
                    $scope.showError = false;
                    startLiveFeed();
                    return;
                }

                // ATOMIC UPDATE: Assigning heatmap data first ensures the directive sees it before attacks start
                if (heatUsable) {
                    _buildLiveMapData(responses[1]);
                    startLiveFeed();
                } else {
                    $scope.showError = true;
                }
            }).catch(function(err) {
                console.error("Map data error:", err);
                _setLoadError(err);
            });
        }

        function _buildLiveMapData(response) {
            var data = response.data || {};
            var rawIps = data.ips || {};
            var rawVirus = data.virus || {};

            // Merge and sort timestamps
            var allTimestamps = _.union(Object.keys(rawIps), Object.keys(rawVirus)).sort();

            allTimestamps.forEach(function (ts) {
                if (rawIps[ts]) {
                    rawIps[ts].forEach(function(item) {
                        item.vuln_type = 'ips';
                        if (item.dest_lat) attackQueue.push(item);
                    });
                }
                if (rawVirus[ts]) {
                    rawVirus[ts].forEach(function(item) {
                        item.vuln_type = 'virus';
                        if (item.dest_lat) attackQueue.push(item);
                    });
                }
            });
        }

        // ---------------------------------------------------------------------
        // Demo mode: simulated attack arcs.
        // Endpoints come from an embedded country centroid table. When the real
        // heat layer has data, most arcs land in those (real) top target
        // countries so the glowing countries and the flying lines agree.
        // ---------------------------------------------------------------------
        var DEMO_GEO = {
            'US': { n: 'United States', c: [-98, 39], cities: ['New York', 'Los Angeles', 'Chicago', 'Ashburn', 'Seattle', 'Houston'] },
            'CA': { n: 'Canada', c: [-106, 56], cities: ['Toronto', 'Vancouver', 'Montreal'] },
            'MX': { n: 'Mexico', c: [-102, 24], cities: ['Mexico City', 'Guadalajara'] },
            'BR': { n: 'Brazil', c: [-51, -10], cities: ['Sao Paulo', 'Rio de Janeiro', 'Brasilia'] },
            'AR': { n: 'Argentina', c: [-64, -34], cities: ['Buenos Aires', 'Cordoba'] },
            'CL': { n: 'Chile', c: [-71, -30], cities: ['Santiago'] },
            'CO': { n: 'Colombia', c: [-74, 4], cities: ['Bogota', 'Medellin'] },
            'GB': { n: 'United Kingdom', c: [-2, 54], cities: ['London', 'Manchester', 'Edinburgh'] },
            'IE': { n: 'Ireland', c: [-8, 53], cities: ['Dublin'] },
            'FR': { n: 'France', c: [2, 46], cities: ['Paris', 'Marseille', 'Lyon'] },
            'DE': { n: 'Germany', c: [10, 51], cities: ['Berlin', 'Frankfurt', 'Munich'] },
            'NL': { n: 'Netherlands', c: [5, 52], cities: ['Amsterdam', 'Rotterdam'] },
            'BE': { n: 'Belgium', c: [4, 50], cities: ['Brussels', 'Antwerp'] },
            'CH': { n: 'Switzerland', c: [8, 47], cities: ['Zurich', 'Geneva'] },
            'AT': { n: 'Austria', c: [14, 47], cities: ['Vienna'] },
            'ES': { n: 'Spain', c: [-4, 40], cities: ['Madrid', 'Barcelona'] },
            'PT': { n: 'Portugal', c: [-8, 39], cities: ['Lisbon', 'Porto'] },
            'IT': { n: 'Italy', c: [12, 42], cities: ['Rome', 'Milan'] },
            'PL': { n: 'Poland', c: [19, 52], cities: ['Warsaw', 'Krakow'] },
            'SE': { n: 'Sweden', c: [15, 62], cities: ['Stockholm'] },
            'NO': { n: 'Norway', c: [9, 61], cities: ['Oslo'] },
            'FI': { n: 'Finland', c: [26, 64], cities: ['Helsinki'] },
            'DK': { n: 'Denmark', c: [9, 56], cities: ['Copenhagen'] },
            'CZ': { n: 'Czech Republic', c: [15, 50], cities: ['Prague'] },
            'RO': { n: 'Romania', c: [25, 46], cities: ['Bucharest'] },
            'RU': { n: 'Russia', c: [100, 60], cities: ['Moscow', 'Saint Petersburg', 'Novosibirsk'] },
            'UA': { n: 'Ukraine', c: [31, 49], cities: ['Kyiv', 'Kharkiv'] },
            'BY': { n: 'Belarus', c: [28, 53], cities: ['Minsk'] },
            'TR': { n: 'Turkey', c: [35, 39], cities: ['Istanbul', 'Ankara'] },
            'GR': { n: 'Greece', c: [22, 39], cities: ['Athens'] },
            'SA': { n: 'Saudi Arabia', c: [45, 24], cities: ['Riyadh', 'Jeddah'] },
            'AE': { n: 'United Arab Emirates', c: [54, 24], cities: ['Dubai', 'Abu Dhabi'] },
            'IL': { n: 'Israel', c: [35, 31], cities: ['Tel Aviv', 'Jerusalem'] },
            'IR': { n: 'Iran', c: [53, 32], cities: ['Tehran', 'Mashhad'] },
            'IQ': { n: 'Iraq', c: [44, 33], cities: ['Baghdad'] },
            'EG': { n: 'Egypt', c: [30, 27], cities: ['Cairo'] },
            'MA': { n: 'Morocco', c: [-7, 32], cities: ['Casablanca'] },
            'ZA': { n: 'South Africa', c: [25, -29], cities: ['Johannesburg', 'Cape Town'] },
            'NG': { n: 'Nigeria', c: [8, 10], cities: ['Lagos', 'Abuja'] },
            'KE': { n: 'Kenya', c: [38, 1], cities: ['Nairobi'] },
            'ET': { n: 'Ethiopia', c: [39, 8], cities: ['Addis Ababa'] },
            'KZ': { n: 'Kazakhstan', c: [67, 48], cities: ['Almaty', 'Astana'] },
            'UZ': { n: 'Uzbekistan', c: [64, 41], cities: ['Tashkent'] },
            'IN': { n: 'India', c: [79, 22], cities: ['Mumbai', 'New Delhi', 'Bengaluru', 'Chennai'] },
            'PK': { n: 'Pakistan', c: [69, 30], cities: ['Karachi', 'Islamabad'] },
            'AF': { n: 'Afghanistan', c: [66, 34], cities: ['Kabul'] },
            'BD': { n: 'Bangladesh', c: [90, 24], cities: ['Dhaka'] },
            'CN': { n: 'China', c: [104, 35], cities: ['Beijing', 'Shanghai', 'Shenzhen', 'Guangzhou', 'Chengdu'] },
            'JP': { n: 'Japan', c: [138, 36], cities: ['Tokyo', 'Osaka', 'Nagoya'] },
            'KR': { n: 'South Korea', c: [128, 36], cities: ['Seoul', 'Busan'] },
            'KP': { n: 'North Korea', c: [127, 40], cities: ['Pyongyang'] },
            'TW': { n: 'Taiwan', c: [121, 24], cities: ['Taipei', 'Kaohsiung'] },
            'HK': { n: 'Hong Kong', c: [114, 22], cities: ['Hong Kong'] },
            'SG': { n: 'Singapore', c: [104, 1], cities: ['Singapore'] },
            'MY': { n: 'Malaysia', c: [102, 4], cities: ['Kuala Lumpur'] },
            'TH': { n: 'Thailand', c: [101, 15], cities: ['Bangkok'] },
            'VN': { n: 'Vietnam', c: [106, 16], cities: ['Hanoi', 'Ho Chi Minh City'] },
            'PH': { n: 'Philippines', c: [122, 12], cities: ['Manila', 'Cebu'] },
            'ID': { n: 'Indonesia', c: [113, -2], cities: ['Jakarta', 'Surabaya'] },
            'MM': { n: 'Myanmar', c: [96, 21], cities: ['Yangon'] },
            'AU': { n: 'Australia', c: [134, -25], cities: ['Sydney', 'Melbourne', 'Perth'] },
            'NZ': { n: 'New Zealand', c: [172, -41], cities: ['Auckland', 'Wellington'] }
        };

        var DEMO_VULNS = [
            'SQL Injection Attempt', 'Ransomware C2 Beacon', 'SSH Brute Force',
            'Log4j RCE Exploit', 'Credential Stuffing', 'Malware Dropper Callback',
            'Phishing Payload Delivery', 'Botnet Activity', 'Web Shell Upload',
            'DDoS Reflection', 'Exploit Kit Redirect', 'Crypto Mining Pool Traffic',
            'DNS Tunneling', 'SMB Lateral Movement', 'Remote Code Execution Attempt',
            'Data Exfiltration', 'Zero-Day Probe', 'Command Injection Attempt'
        ];

        var DEMO_PROFILES = ['Exploit', 'Infection', 'Botnet', 'C2'];

        function _demoPick(arr) {
            return arr[Math.floor(Math.random() * arr.length)];
        }

        function _demoJitter(v) {
            return v + (Math.random() * 4 - 2);
        }

        function _demoCountryPool(heatData) {
            // Top target countries from the real heat layer (keyed by ISO code)
            var hot = [];
            Object.keys(heatData || {}).forEach(function(code) {
                if (code === 'summary') return;
                var count = (heatData[code] && Number(heatData[code].count)) || 0;
                if (count > 0 && DEMO_GEO[code]) hot.push({ code: code, count: count });
            });
            hot.sort(function(a, b) { return b.count - a.count; });
            return hot;
        }

        function _buildDemoAttackQueue(heatData) {
            var hot = _demoCountryPool(heatData);
            var world = Object.keys(DEMO_GEO);
            var targets = hot.length ? hot.map(function(c) { return c.code; }) : world;

            var intensity = parseInt($scope.config.demoIntensity, 10);
            if (!intensity || isNaN(intensity)) intensity = 50;
            intensity = Math.max(10, Math.min(200, intensity));

            for (var i = 0; i < intensity; i++) {
                var srcCode = _demoPick(world);
                // Bias ~2/3 of the arcs into the heat layer's real top targets
                var destCode = (hot.length && Math.random() < 0.65) ? _demoPick(targets) : _demoPick(world);
                if (destCode === srcCode) destCode = _demoPick(world);
                var src = DEMO_GEO[srcCode];
                var dest = DEMO_GEO[destCode];
                attackQueue.push({
                    vuln_name: _demoPick(DEMO_VULNS),
                    severity: Math.random() < 0.5 ? 'high' : (Math.random() < 0.7 ? 'medium' : 'low'),
                    vuln_type: Math.random() < 0.7 ? 'ips' : 'virus',
                    src_city: src.cities ? _demoPick(src.cities) : src.n,
                    src_country: srcCode,
                    dest_city: dest.cities ? _demoPick(dest.cities) : dest.n,
                    dest_country: destCode,
                    profile_type: _demoPick(DEMO_PROFILES),
                    src_lat: _demoJitter(src.c[1]),
                    src_long: _demoJitter(src.c[0]),
                    dest_lat: _demoJitter(dest.c[1]),
                    dest_long: _demoJitter(dest.c[0])
                });
            }
        }

        function onOutbreakChange() {
            _fetchMapData();
        }

        function startLiveFeed() {
            if (refreshTimer) $interval.cancel(refreshTimer);
            if (attackQueue.length === 0) return;

            refreshTimer = $interval(function() {
                var item = attackQueue[currentQueueIndex % attackQueue.length];
                if(item) {
                    // Construct entry for directive consumption
                    $scope.latestAttack = {
                        name: item.vuln_name || 'Network Intrusion',
                        severity: (item.severity || 'High').toLowerCase(),
                        vuln_type: item.vuln_type,
                        src_city: item.src_city,
                        src_flag: getFlagEmoji(item.src_country),
                        dest_city: item.dest_city || 'Target Node',
                        dest_flag: getFlagEmoji(item.dest_country),
                        dest_country: item.dest_country,
                        type: item.profile_type || 'Infection',
                        coords: {
                            src: [parseFloat(item.src_long || 0), parseFloat(item.src_lat || 0)],
                            dest: [parseFloat(item.dest_long), parseFloat(item.dest_lat)]
                        }
                    };

                    $scope.attackHistory.unshift($scope.latestAttack);
                    if ($scope.attackHistory.length > 15) $scope.attackHistory.pop();
                    currentQueueIndex++;
                }
            }, 400);
        }

        function getFlagEmoji(countryCode) {
            if (!countryCode || countryCode === 'Unknown' || countryCode.length !== 2) return '🌐';
            return countryCode.toUpperCase().replace(/./g, function(char) {
                return String.fromCodePoint(char.charCodeAt(0) + 127397);
            });
        }

        // External Resource Loaders
        function loadSafeTopojson(url) {
            return new Promise(function(resolve) {
                var tempDefine = window.define; window.define = undefined;
                var script = document.createElement('script'); script.src = url;
                script.onload = function() { window.define = tempDefine; resolve(); };
                document.head.appendChild(script);
            });
        }

        // Cleanup interval on controller destroy
        $scope.$on('$destroy', function() {
            if (refreshTimer) $interval.cancel(refreshTimer);
        });

        init();
    }
})();
