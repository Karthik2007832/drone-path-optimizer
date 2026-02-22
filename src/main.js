import './style.css'
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Pathfinder } from './pathfinder.js';
import { WeatherSystem } from './weatherSystem.js';

// Global Error Handler
window.onerror = function (message, source, lineno, colno, error) {
  alert(`System Error: ${message}\nLine: ${lineno}`);
  console.error(error);
};

document.addEventListener('DOMContentLoaded', () => {
  console.log("Defense Tech System Initializing...");
  initApp();
});

// --- Configuration ---
const MAP_START = [20.5937, 78.9629]; // India Center
const ZOOM_LEVEL = 5;

// --- State ---
const state = {
  startPoint: null,
  endPoint: null,
  startMarker: null,
  endMarker: null,
  noFlyZones: [],
  isDrawing: false,
  routeLayer: null,
  calculatedPath: null, // Store path for simulation
  weatherLayer: null // Canvas layer for weather
};

const missionState = {
  active: false,
  paused: false,
  path: [],
  currentIndex: 0,
  progress: 0, // 0.0 to 1.0 between nodes
  speed: 0,
  battery: 100,
  droneMarker: null,
  trailLayer: null,
  trailPoints: [],
  intervalId: null
};

// Wrap everything in initApp function
function initApp() {
  // --- Initialization ---
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(MAP_START, ZOOM_LEVEL);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const pathfinder = new Pathfinder(60);
  const weatherSystem = new WeatherSystem(60);

  // Link weather to pathfinder
  pathfinder.setWeatherSystem(weatherSystem);

  // Initialize Weather
  weatherSystem.init(map.getBounds());

  // Create an ImageOverlay to show weather
  const weatherOverlay = L.imageOverlay('', map.getBounds(), { opacity: 0.5, interactive: false }).addTo(map);

  function updateWeatherVisuals() {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');

    const grid = weatherSystem.weatherGrid;
    if (!grid || !grid[0]) return;

    const imgData = ctx.createImageData(60, 60);
    const data = imgData.data;

    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        // Flip Y: Grid Y=0 is South, Canvas Y=59 is Bottom
        const gridY = 59 - y;
        const cell = grid[gridY][x];
        if (!cell) continue;

        const index = (y * 60 + x) * 4;

        let r = 0, g = 0, b = 0, a = 0;

        if (cell.risk > 60) {
          r = 255; g = 42; b = 42; a = 120; // RED
        } else if (cell.risk > 30) {
          r = 255; g = 230; b = 0; a = 80; // YELLOW
        } else {
          r = 0; g = 255; b = 65; a = 0; // GREEN (Transparent)
          // Add rain effect?
          if (cell.rain > 10) {
            b = 255; a = Math.min(100, cell.rain);
          }
        }

        data[index] = r;
        data[index + 1] = g;
        data[index + 2] = b;
        data[index + 3] = a;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    weatherOverlay.setUrl(canvas.toDataURL());
  }

  // Start Weather Simulation Loop
  setInterval(() => {
    weatherSystem.update(0.1);
    updateWeatherVisuals();
    updateLiveWeatherValues();
    updateAI();
  }, 2000);

  // --- UI Elements ---
  const inputStartLat = document.getElementById('start-lat');
  const inputStartLng = document.getElementById('start-lng');
  const inputTargetLat = document.getElementById('target-lat');
  const inputTargetLng = document.getElementById('target-lng');
  const inputBattery = document.getElementById('battery-limit');
  const inputRisk = document.getElementById('risk-slider');
  const riskValueDisplay = document.getElementById('risk-value');

  // Telemetry UI
  const telLat = document.getElementById('telemet-lat');
  const telLng = document.getElementById('telemet-lng');
  const telSpeed = document.getElementById('telemet-speed');
  const telBattery = document.getElementById('telemet-battery');
  const missionStatus = document.getElementById('mission-status');

  const btnStart = document.getElementById('start-mission-btn');
  const btnPause = document.getElementById('pause-mission-btn');
  const btnAbort = document.getElementById('abort-mission-btn');

  // --- Event Listeners ---

  // 1. Map Interaction (Click to set points)
  map.on('click', (e) => {
    if (state.isDrawing) return; // Ignore if drawing polygon

    if (!state.startPoint) {
      setStartPoint(e.latlng);
    } else if (!state.endPoint) {
      setEndPoint(e.latlng);
    }
  });

  // Update Risk Slider Display
  inputRisk.addEventListener('input', (e) => {
    riskValueDisplay.textContent = `${e.target.value}%`;
  });

  // 2. Manual Input Handling
  function updateFromInputs() {
    const sLat = parseFloat(inputStartLat.value);
    const sLng = parseFloat(inputStartLng.value);
    const tLat = parseFloat(inputTargetLat.value);
    const tLng = parseFloat(inputTargetLng.value);

    if (!isNaN(sLat) && !isNaN(sLng)) {
      const latlng = L.latLng(sLat, sLng);
      state.startPoint = latlng;
      if (state.startMarker) map.removeLayer(state.startMarker);
      state.startMarker = addMarker(latlng, 'START', 'green');
      map.panTo(latlng);
    }

    if (!isNaN(tLat) && !isNaN(tLng)) {
      const latlng = L.latLng(tLat, tLng);
      state.endPoint = latlng;
      if (state.endMarker) map.removeLayer(state.endMarker);
      state.endMarker = addMarker(latlng, 'TARGET', 'blue');
    }
  }

  [inputStartLat, inputStartLng, inputTargetLat, inputTargetLng].forEach(input => {
    input.addEventListener('change', updateFromInputs);
  });

  // Helper: Set Start Point
  function setStartPoint(latlng) {
    state.startPoint = latlng;
    inputStartLat.value = latlng.lat.toFixed(4);
    inputStartLng.value = latlng.lng.toFixed(4);

    if (state.startMarker) map.removeLayer(state.startMarker);
    state.startMarker = addMarker(latlng, 'START', 'green');
  }

  // Helper: Set End Point
  function setEndPoint(latlng) {
    state.endPoint = latlng;
    inputTargetLat.value = latlng.lat.toFixed(4);
    inputTargetLng.value = latlng.lng.toFixed(4);

    if (state.endMarker) map.removeLayer(state.endMarker);
    state.endMarker = addMarker(latlng, 'TARGET', 'blue');
  }

  function addMarker(latlng, type, color) {
    const icon = L.divIcon({
      className: `custom-marker ${type.toLowerCase()}`,
      html: `<div style="background-color: ${color === 'green' ? '#00ff41' : '#00d4ff'}; width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 10px ${color === 'green' ? '#00ff41' : '#00d4ff'}; border: 2px solid white;"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    return L.marker(latlng, { icon }).addTo(map)
      .bindPopup(`<b>${type} POINT</b><br>Lat: ${latlng.lat.toFixed(4)}<br>Lng: ${latlng.lng.toFixed(4)}`)
      .openPopup();
  }

  // 3. Clear System
  document.getElementById('clear-btn').addEventListener('click', () => {
    state.startPoint = null;
    state.endPoint = null;
    state.startMarker = null;
    state.endMarker = null;
    state.noFlyZones = [];
    state.routeLayer = null;

    // Clear inputs
    inputStartLat.value = '';
    inputStartLng.value = '';
    inputTargetLat.value = '';
    inputTargetLng.value = '';

    // Clear map layers (keep tiles)
    map.eachLayer((layer) => {
      if (!layer._url) {
        map.removeLayer(layer);
      }
    });

    drawingPoly = null;
    drawingPoints = [];

    resetDashboard();
  });

  function resetDashboard() {
    document.getElementById('total-distance').innerHTML = '0.00 <small>km</small>';
    document.getElementById('battery-usage').textContent = '0%';
    document.getElementById('battery-usage').style.color = 'inherit';
    document.getElementById('risk-score').textContent = 'LOW';
    document.getElementById('risk-score').className = 'value risk-low';
  }

  // 4. Optimization & Constraints Logic
  const optimizeBtn = document.getElementById('optimize-btn');
  if (!optimizeBtn) {
    alert("CRITICAL ERROR: Optimize Button NOT FOUND in DOM");
    console.error("Optimize btn missing");
  } else {
    console.log("Optimize Button found, attaching listener");
    optimizeBtn.addEventListener('click', (e) => {
      console.log("Optimize Button CLICKED");
      alert("DEBUG: Button Clicked! Starting Optimization...");

      if (!state.startPoint || !state.endPoint) {
        alert("Please set a Start Point and Target Point.");
        return;
      }

      if (state.routeLayer) map.removeLayer(state.routeLayer);

      // RESET SAFETY: Disable Start until new valid path is confirmed
      disableMissionControls();
      state.calculatedPath = null;

      try {
        // 0. Initialize Pathfinder with current map bounds
        pathfinder.initGrid(map.getBounds());
        pathfinder.markObstacles(state.noFlyZones);

        // Calculate Path
        const riskTolerance = parseInt(inputRisk.value);
        const path = pathfinder.findPath(state.startPoint, state.endPoint, riskTolerance);

        if (!path || path.length === 0) {
          alert("No path found! Try adjusting risk tolerance or moving points.");
          return;
        }

        // 1. Battery / Distance
        let totalDist = 0;
        for (let i = 0; i < path.length - 1; i++) {
          totalDist += L.latLng(path[i]).distanceTo(path[i + 1]);
        }
        totalDist = totalDist / 1000; // km

        const batteryLimit = parseFloat(inputBattery.value) || 15;

        // Battery Usage Logic: Assumes 1km = 5% battery for this drone model (just a simplified metric)
        const estBatteryUsage = (totalDist / batteryLimit) * 100;

        if (totalDist > batteryLimit) {
          alert(`MISSION ABORTED: Insufficient Power.\nRoute Distance: ${totalDist.toFixed(2)} km\nMax Range: ${batteryLimit} km`);

          // Show failed path in red
          state.routeLayer = L.polyline(path, { color: '#ff2a2a', weight: 3, dashArray: '5, 10' }).addTo(map);
          document.getElementById('battery-usage').textContent = 'CRITICAL';
          document.getElementById('battery-usage').style.color = '#ff2a2a';
          return;
        }

        // 2. Risk Analysis (Real Data from Grid)
        let totalPathRisk = 0;
        path.forEach(pt => {
          totalPathRisk += pathfinder.getRisk(pt);
        });

        let averageRisk = path.length > 0 ? (totalPathRisk / path.length) : 0;
        let displayRisk = Math.max(0, (averageRisk - 10) * (100 / 90));
        if (displayRisk > 100) displayRisk = 100;

        // 3. Time Saved Calculation
        const speedKmph = 60;
        const distKm = totalDist;
        const timeHours = distKm / speedKmph;
        const timeMinutes = timeHours * 60;

        const riskFactor = (displayRisk / 100) * 0.5;
        const hypotheticalTime = timeMinutes * (1 + riskFactor);
        const timeSavedMin = hypotheticalTime - timeMinutes;

        // Update UI
        const riskEl = document.getElementById('risk-score');
        const timeEl = document.getElementById('time-saved');

        riskEl.innerText = `${Math.round(displayRisk)}%`;

        const savedSec = Math.round(timeSavedMin * 60);
        const m = Math.floor(savedSec / 60);
        const s = savedSec % 60;
        timeEl.innerText = `${m}m ${s}s`;

        const userTolerance = parseInt(inputRisk.value);

        if (displayRisk > userTolerance) {
          alert(`WARNING: Risk (${Math.round(displayRisk)}%) exceeds Limit (${userTolerance}%).`);
          riskEl.className = 'value risk-high';
        } else if (displayRisk > 25) {
          riskEl.className = 'value risk-med';
        } else {
          riskEl.className = 'value risk-low';
        }

        // Update Dashboard
        document.getElementById('total-distance').innerHTML = `${totalDist.toFixed(2)} <small>km</small>`;
        document.getElementById('battery-usage').textContent = `${estBatteryUsage.toFixed(1)}%`;
        document.getElementById('battery-usage').style.color = estBatteryUsage > 80 ? '#ffe600' : 'inherit';

        // Draw Success Path
        state.calculatedPath = path; // Store for mission
        enableMissionControls();

        state.routeLayer = L.polyline(path, {
          color: '#00ff41',
          weight: 3,
          opacity: 0.8,
          dashArray: '10, 10',
          lineCap: 'square'
        }).addTo(map);

        let offset = 0;
        // Animate the route dash
        const dashAnim = setInterval(() => {
          if (!state.routeLayer) {
            clearInterval(dashAnim);
            return;
          }
          offset -= 1;
          state.routeLayer.setStyle({ dashOffset: offset });
        }, 50);

      } catch (err) {
        console.error("Optimization Error:", err);
        alert(`Error during optimization: ${err.message}`);
      }
    });
  } // End else

  // --- Telemetry & Mission Logic ---

  function enableMissionControls() {
    if (btnStart) btnStart.disabled = false;
    if (btnPause) btnPause.disabled = true;
    if (btnAbort) btnAbort.disabled = true;
  }

  function disableMissionControls() {
    if (btnStart) btnStart.disabled = true;
    if (btnPause) btnPause.disabled = true;
    if (btnAbort) btnAbort.disabled = true;
  }

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      if (missionState.active && missionState.paused) {
        resumeMission();
      } else {
        startMission();
      }
    });

    btnPause.addEventListener('click', pauseMission);
    btnAbort.addEventListener('click', abortMission);
  }

  function startMission() {
    if (!state.calculatedPath || state.calculatedPath.length < 2) return;

    missionState.active = true;
    missionState.paused = false;
    missionState.path = state.calculatedPath;
    missionState.currentIndex = 0;
    missionState.progress = 0;
    missionState.battery = 100;
    missionState.trailPoints = [missionState.path[0]];

    // UI Updates
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnAbort.disabled = false;
    updateStatus("MISSION ACTIVE", "var(--text-primary)");

    // Drone Marker
    if (missionState.droneMarker) map.removeLayer(missionState.droneMarker);
    const startPos = missionState.path[0];

    // Create Drone Icon
    const droneIcon = L.divIcon({
      className: 'drone-icon',
      html: `<div style="
            width: 0; height: 0; 
            border-left: 10px solid transparent;
            border-right: 10px solid transparent;
            border-bottom: 20px solid #00ff41;
            filter: drop-shadow(0 0 5px #00ff41);
            transform: translate(-50%, -50%);
        "></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    missionState.droneMarker = L.marker(startPos, { icon: droneIcon }).addTo(map);

    // Trail Layer
    if (missionState.trailLayer) map.removeLayer(missionState.trailLayer);
    missionState.trailLayer = L.polyline(missionState.trailPoints, { color: '#00d4ff', weight: 2 }).addTo(map);

    // Start Loop (1s updates)
    if (missionState.intervalId) clearInterval(missionState.intervalId);
    missionState.intervalId = setInterval(simulationLoop, 1000);
  }

  function pauseMission() {
    if (!missionState.active) return;
    missionState.paused = true;
    clearInterval(missionState.intervalId);
    btnStart.disabled = false;
    btnStart.innerHTML = "▶ RESUME";
    btnPause.disabled = true;
    updateStatus("PAUSED", "#ffe600");
  }

  function resumeMission() {
    if (!missionState.active) return;
    missionState.paused = false;
    btnStart.disabled = true;
    btnStart.innerHTML = "▶ START";
    btnPause.disabled = false;
    updateStatus("MISSION ACTIVE", "var(--text-primary)");
    missionState.intervalId = setInterval(simulationLoop, 1000);
  }

  function abortMission() {
    clearInterval(missionState.intervalId);
    missionState.active = false;
    missionState.paused = false;

    disableMissionControls();
    btnStart.textContent = "▶ START"; // Reset text
    updateStatus("ABORTED", "var(--accent-red)");

    // Optional: Keep markers on map or clear? keeping for analysis
  }

  function updateStatus(text, color) {
    if (missionStatus) missionStatus.innerHTML = `STATUS: <span class="val" style="color: ${color}">${text}</span>`;
  }

  function simulationLoop() {
    if (missionState.battery <= 0) {
      abortMission();
      alert("CRITICAL: Battery Depleted. Drone forced to land.");
      return;
    }

    // Move Drone
    // Speed: 60km/h = 16.6 m/s
    // Update every 1s, so move ~16 meters/step
    // For visualization, we'll jump way faster to finish in reasonable time
    // Let's say we cover 5% of a segment per tick, or fixed distance?
    // Let's do simple index traversal for prototype

    // Move to next point?
    // Current segments are grid nodes (approx 1-5km apart depending on 60x60 grid over India)
    // India height ~3000km. 60 cells => 50km per cell.
    // 50km at 60km/h = nearly 1 hour per cell.
    // We need to SPEED UP simulation drastically.
    // Let's say 1 tick = 5 minutes simulated time? 
    // Or just animate smoothly between nodes over 2-3 seconds.

    // Implementation: Move 10% between current and next node per tick
    missionState.progress += 0.2; // 20% per second = 5 seconds per grid cell

    if (missionState.progress >= 1) {
      missionState.progress = 0;
      missionState.currentIndex++;
    }

    if (missionState.currentIndex >= missionState.path.length - 1) {
      // Reached Target
      finishMission();
      return;
    }

    const currNode = missionState.path[missionState.currentIndex];
    const nextNode = missionState.path[missionState.currentIndex + 1];

    // Interpolate
    const lat = currNode.lat + (nextNode.lat - currNode.lat) * missionState.progress;
    const lng = currNode.lng + (nextNode.lng - currNode.lng) * missionState.progress;
    const currentPos = { lat, lng };

    // Update Marker
    if (missionState.droneMarker) missionState.droneMarker.setLatLng(currentPos);

    // Update Trail
    missionState.trailPoints.push(currentPos);
    if (missionState.trailLayer) missionState.trailLayer.setLatLngs(missionState.trailPoints);

    // Telemetry Data
    // Speed fluctuation (Simulated)
    const baseSpeed = 60;
    const currentSpeed = baseSpeed + (Math.random() * 5 - 2.5); // +/- 2.5 km/h

    // Battery Drain
    // Total battery for mission was calc'd. 
    // Simple drain: 0.5% per tick
    missionState.battery -= 0.5;

    // Safety Checks
    // For now we assume safety based on grid, but could re-check
    const risk = pathfinder.getRisk(currentPos); // Use Pathfinder instance (includes Weather)

    // UI Updates
    if (telLat) telLat.textContent = lat.toFixed(4);
    if (telLng) telLng.textContent = lng.toFixed(4);
    if (telSpeed) telSpeed.innerHTML = `${currentSpeed.toFixed(1)} <small>km/h</small>`;
    if (telBattery) telBattery.textContent = `${Math.max(0, missionState.battery.toFixed(1))}%`;

    if (risk > 60) { // High Risk / Danger
      updateStatus("DANGER: REROUTING", "var(--accent-red)");

      if (missionState.active && !missionState.paused) {
        logAI("CRITICAL ALERT: Dangerous weather detected ahead!", "danger");
        logAI("Initiating emergency re-optimization...", "warning");

        pauseMission(); // Pause to calculate

        // Attempt Re-route
        setTimeout(() => {
          const newPath = pathfinder.findPath(currentPos, state.endPoint, 10); // Low tolerance for safety

          if (newPath && newPath.length > 0) {
            logAI("New safe route calculated. Resuming mission.", "normal");

            // Update Path
            missionState.path = newPath;
            missionState.currentIndex = 0;
            missionState.progress = 0;
            state.calculatedPath = newPath;

            // Update visual route
            if (state.routeLayer) {
              state.routeLayer.setLatLngs(newPath);
              state.routeLayer.setStyle({ color: '#ffe600' }); // Color change for reroute
            }

            startMission(); // Resume (startMission handles state reset but keeps old markers if we are careful)
            // actually startMission resets params. 
            // We need a resumePath() or just update state and resume
            resumeMission();
          } else {
            logAI("MISSION ABORT: No safe route found.", "danger");
            abortMission();
          }
        }, 1000); // Fake calc time
        return;
      }

    } else if (risk > 30) {
      updateStatus("WARNING: HIGH RISK ZONE", "#ffe600");
    } else {
      updateStatus("MISSION ACTIVE", "var(--text-primary)");
    }

    // Check Battery Safety
    if (missionState.battery < 20) {
      if (telBattery) telBattery.style.color = 'var(--accent-red)';
      updateStatus("LOW BATTERY", "var(--accent-red)");
      logAI("Battery low. Return to base recommended.", "warning");
    }
  }

  function finishMission() {
    clearInterval(missionState.intervalId);
    missionState.active = false;
    updateStatus("MISSION COMPLETE", "var(--accent-green)");
    disableMissionControls();
    alert("Target Reached Successfully.");
  }

  // --- No-Fly Zone Drawing (Shift + Click) ---
  let drawingPoly = null;
  let drawingPoints = [];

  map.on('click', (e) => {
    if (e.originalEvent.shiftKey) {
      state.isDrawing = true;
      drawingPoints.push(e.latlng);

      if (drawingPoly) {
        drawingPoly.setLatLngs(drawingPoints);
      } else {
        drawingPoly = L.polygon(drawingPoints, {
          color: '#ff2a2a',
          fillColor: '#ff2a2a',
          fillOpacity: 0.2,
          weight: 2
        }).addTo(map);
      }
    }
  });

  map.on('dblclick', (e) => {
    if (state.isDrawing) {
      state.isDrawing = false;
      state.noFlyZones.push([...drawingPoints]); // Save coordinates
      drawingPoints = [];
      drawingPoly = null;
      // Don't disable zoom, just let it be or handle it
    }
  });
  map.doubleClickZoom.disable();

  // --- Weather & AI Chatbot ---

  function updateLiveWeatherValues() {
    let targetPos = map.getCenter();
    if (missionState.active && missionState.droneMarker) {
      targetPos = missionState.droneMarker.getLatLng();
    } else if (state.startPoint) {
      targetPos = state.startPoint;
    }

    const weather = weatherSystem.getWeatherAt(targetPos);
    if (!weather) return;

    const elWind = document.getElementById('weather-wind');
    const elVis = document.getElementById('weather-vis');
    const elStatus = document.getElementById('weather-status');

    if (elWind) elWind.innerHTML = `${Math.round(weather.wind)} <small>km/h</small>`;
    if (elVis) elVis.innerText = `${Math.round(weather.visibility)}%`;

    if (elStatus) {
      if (weather.risk > 60) {
        elStatus.innerText = "UNSAFE";
        elStatus.className = "value risk-high";
      } else if (weather.risk > 30) {
        elStatus.innerText = "CAUTION";
        elStatus.className = "value risk-med";
      } else {
        elStatus.innerText = "SAFE";
        elStatus.className = "value risk-low";
      }
    }
  }

  // --- AEGIS CHATBOT SYSTEM ---
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatbotEl = document.getElementById('chatbot');
  const chatbotMinBtn = document.getElementById('chatbot-min-btn');

  function getTimeStr() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function addChatBubble(text, type = 'ai', sender = 'AEGIS') {
    if (!chatMessages) return;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${type}`;

    if (type === 'system' || type === 'alert') {
      bubble.innerHTML = `<div class="bubble-text">${text}</div>`;
    } else {
      bubble.innerHTML = `
        <div class="bubble-sender">${sender}</div>
        <div class="bubble-text">${text}</div>
        <div class="bubble-time">${getTimeStr()}</div>
      `;
    }

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Keep max 50 messages
    while (chatMessages.children.length > 50) {
      chatMessages.removeChild(chatMessages.firstChild);
    }
  }

  // Alias for backward compatibility with logAI calls in simulationLoop
  function logAI(message, type = 'normal') {
    if (type === 'danger') {
      addChatBubble(message, 'alert');
    } else if (type === 'warning') {
      addChatBubble(`⚠️ ${message}`, 'system');
    } else {
      addChatBubble(message, 'ai');
    }
  }

  // Process user input
  function processUserQuery(query) {
    const q = query.trim().toLowerCase();
    addChatBubble(query, 'user', 'YOU');

    setTimeout(() => {
      let response = '';

      if (q === 'help' || q === '?') {
        response = `Available commands:<br>
          <b>status</b> — Mission status<br>
          <b>weather</b> — Current weather report<br>
          <b>battery</b> — Battery level<br>
          <b>risk</b> — Risk analysis<br>
          <b>position</b> — Drone coordinates<br>
          <b>eta</b> — Estimated time to target<br>
          <b>brief</b> — Full mission briefing`;
      }
      else if (q === 'status') {
        if (missionState.active && !missionState.paused) {
          response = `Mission is <b>ACTIVE</b>. Drone is en-route. Progress: waypoint ${missionState.currentIndex + 1}/${missionState.path.length}.`;
        } else if (missionState.active && missionState.paused) {
          response = `Mission is <b>PAUSED</b>. Awaiting resume command.`;
        } else {
          response = `No active mission. Set coordinates and optimize a route to begin.`;
        }
      }
      else if (q === 'weather') {
        let targetPos = map.getCenter();
        if (missionState.active && missionState.droneMarker) {
          targetPos = missionState.droneMarker.getLatLng();
        }
        const w = weatherSystem.getWeatherAt(targetPos);
        if (w) {
          const safety = w.risk > 60 ? '🔴 UNSAFE' : w.risk > 30 ? '🟡 CAUTION' : '🟢 SAFE';
          response = `<b>Weather Report:</b><br>
            Wind: ${Math.round(w.wind)} km/h<br>
            Visibility: ${Math.round(w.visibility)}%<br>
            Rain: ${Math.round(w.rain * 100)}%<br>
            Risk Score: ${Math.round(w.risk)}/100<br>
            Status: ${safety}`;
        } else {
          response = `Weather data unavailable for current position.`;
        }
      }
      else if (q === 'battery') {
        if (missionState.active) {
          const bat = Math.max(0, missionState.battery).toFixed(1);
          const color = missionState.battery < 20 ? '🔴' : missionState.battery < 50 ? '🟡' : '🟢';
          response = `${color} Battery: <b>${bat}%</b> remaining.`;
          if (missionState.battery < 20) {
            response += `<br>⚠️ Critical! Return to base recommended.`;
          }
        } else {
          response = `🟢 Battery: <b>100%</b> (pre-flight).`;
        }
      }
      else if (q === 'risk') {
        if (missionState.active && missionState.droneMarker) {
          const pos = missionState.droneMarker.getLatLng();
          const risk = pathfinder.getRisk(pos);
          const level = risk > 60 ? '🔴 HIGH' : risk > 30 ? '🟡 MODERATE' : '🟢 LOW';
          response = `Current zone risk: <b>${Math.round(risk)}/100</b> — ${level}`;
        } else {
          response = `No active mission. Risk will be assessed during flight.`;
        }
      }
      else if (q === 'position' || q === 'pos' || q === 'location') {
        if (missionState.active && missionState.droneMarker) {
          const pos = missionState.droneMarker.getLatLng();
          response = `📍 Drone Position:<br>Lat: <b>${pos.lat.toFixed(4)}</b><br>Lng: <b>${pos.lng.toFixed(4)}</b>`;
        } else {
          response = `Drone is grounded. No position data.`;
        }
      }
      else if (q === 'eta') {
        if (missionState.active && missionState.path) {
          const remaining = missionState.path.length - missionState.currentIndex;
          const etaSeconds = remaining * 5; // ~5s per waypoint
          const m = Math.floor(etaSeconds / 60);
          const s = etaSeconds % 60;
          response = `⏱️ ETA: <b>${m}m ${s}s</b> (${remaining} waypoints remaining)`;
        } else {
          response = `No active mission to estimate.`;
        }
      }
      else if (q === 'brief' || q === 'briefing') {
        let targetPos = map.getCenter();
        if (missionState.active && missionState.droneMarker) {
          targetPos = missionState.droneMarker.getLatLng();
        }
        const w = weatherSystem.getWeatherAt(targetPos);
        const bat = missionState.active ? `${Math.max(0, missionState.battery).toFixed(1)}%` : '100%';
        const missionSt = missionState.active ? (missionState.paused ? 'PAUSED' : 'ACTIVE') : 'STANDBY';
        const weatherSt = w ? (w.risk > 60 ? 'UNSAFE' : w.risk > 30 ? 'CAUTION' : 'CLEAR') : 'N/A';

        response = `<b>━━ MISSION BRIEFING ━━</b><br>
          Status: ${missionSt}<br>
          Battery: ${bat}<br>
          Weather: ${weatherSt}<br>
          Wind: ${w ? Math.round(w.wind) + ' km/h' : 'N/A'}<br>
          Visibility: ${w ? Math.round(w.visibility) + '%' : 'N/A'}`;

        if (missionState.active && missionState.path) {
          response += `<br>Waypoints: ${missionState.currentIndex + 1}/${missionState.path.length}`;
        }
      }
      else {
        const fallback = [
          `I'm not sure I understand "<b>${query}</b>". Type <b>help</b> to see my command list.`,
          `Command not recognized. Try <b>status</b>, <b>weather</b>, <b>battery</b>, or <b>help</b>.`,
          `Hmm, I don't have data on that. Use <b>help</b> to see what I can report on.`
        ];
        response = fallback[Math.floor(Math.random() * fallback.length)];
      }

      addChatBubble(response, 'ai');
    }, 400 + Math.random() * 300); // Slight delay for realism
  }

  // Chat input handlers
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) {
        processUserQuery(chatInput.value);
        chatInput.value = '';
      }
    });
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', () => {
      if (chatInput && chatInput.value.trim()) {
        processUserQuery(chatInput.value);
        chatInput.value = '';
      }
    });
  }

  // Minimize / Expand
  if (chatbotMinBtn) {
    chatbotMinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chatbotEl.classList.toggle('minimized');
      chatbotMinBtn.textContent = chatbotEl.classList.contains('minimized') ? '+' : '—';
    });
  }

  // Auto-updates (ambient chatter + activity reporting)
  let lastActivityHash = '';

  function updateAI() {
    // Auto-post mission updates when state changes
    const currentHash = `${missionState.active}_${missionState.paused}_${missionState.currentIndex}_${Math.round(missionState.battery / 10)}`;

    if (currentHash !== lastActivityHash) {
      lastActivityHash = currentHash;

      if (missionState.active && !missionState.paused && missionState.currentIndex > 0 && missionState.currentIndex % 5 === 0) {
        addChatBubble(`📍 Checkpoint ${missionState.currentIndex}/${missionState.path.length} reached. Battery: ${Math.max(0, missionState.battery).toFixed(0)}%`, 'system');
      }
    }

    // 3% ambient chatter
    if (Math.random() > 0.03) return;

    const phrases = [
      "Scanning satellite feeds...",
      "Weather radar sweep complete.",
      "Terrain analysis nominal.",
      "Communication links stable.",
      "Perimeter sensors clear."
    ];

    if (missionState.active && !missionState.paused) {
      phrases.push("Telemetry stream active. All systems green.");
      phrases.push("Navigation lock confirmed.");
      phrases.push("Airspace corridor clear ahead.");
    }

    const msg = phrases[Math.floor(Math.random() * phrases.length)];
    addChatBubble(msg, 'ai');
  }

  console.log("Defense Tech Console: Ready");
} // End initApp
