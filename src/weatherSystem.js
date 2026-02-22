/**
 * Weather Simulation & Safety Analysis Module
 * Simulates dynamic local weather patterns for drone pathfinding.
 */

export class WeatherSystem {
    constructor(gridSize = 60) {
        this.gridSize = gridSize;
        this.weatherGrid = []; // Stores { wind, rain, visibility, risk }
        this.bounds = null;
        this.patterns = [];
        this.timeOffset = 0;
    }

    init(bounds) {
        this.bounds = {
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast()
        };

        // Initialize Grid
        this.weatherGrid = new Array(this.gridSize).fill(0).map(() => new Array(this.gridSize).fill(null));

        // Generate Initial Patterns
        this.generatePatterns();
        this.updateGrid();
    }

    generatePatterns() {
        this.patterns = [];
        // Create 3-5 random weather systems
        const numSystems = 3 + Math.floor(Math.random() * 3);

        for (let i = 0; i < numSystems; i++) {
            this.patterns.push({
                x: Math.random() * this.gridSize,
                y: Math.random() * this.gridSize,
                radius: 5 + Math.random() * 10, // Grid cells
                type: Math.random() > 0.5 ? 'STORM' : 'WIND', // STORM = rain + wind, WIND = high wind
                intensity: 0.5 + Math.random() * 0.5, // 0.5 to 1.0
                driftX: (Math.random() - 0.5) * 0.1,
                driftY: (Math.random() - 0.5) * 0.1
            });
        }
    }

    update(deltaTime = 1) {
        this.timeOffset += deltaTime;

        // Move patterns
        this.patterns.forEach(p => {
            p.x += p.driftX * deltaTime;
            p.y += p.driftY * deltaTime;

            // Wrap around (toroidal world for simulation simplicity)
            if (p.x < 0) p.x += this.gridSize;
            if (p.x >= this.gridSize) p.x -= this.gridSize;
            if (p.y < 0) p.y += this.gridSize;
            if (p.y >= this.gridSize) p.y -= this.gridSize;
        });

        this.updateGrid();
    }

    updateGrid() {
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                let wind = 0; // km/h (0-100)
                let rain = 0; // mm/h (0-50)
                let visibility = 100; // % (100 = clear, 0 = blind)

                // Accumulate influence from all patterns
                this.patterns.forEach(p => {
                    const dist = Math.sqrt(Math.pow(x - p.x, 2) + Math.pow(y - p.y, 2));
                    if (dist < p.radius) {
                        const falloff = 1 - (dist / p.radius); // 1 at center, 0 at edge
                        const power = falloff * p.intensity;

                        if (p.type === 'STORM') {
                            wind += power * 60;
                            rain += power * 40;
                            visibility -= power * 80;
                        } else if (p.type === 'WIND') {
                            wind += power * 80;
                            visibility -= power * 20; // Dust/Turbulence
                        }
                    }
                });

                // Clamp values
                wind = Math.min(100, Math.max(0, wind + (Math.random() * 5))); // Add noise
                rain = Math.min(50, Math.max(0, rain));
                visibility = Math.min(100, Math.max(0, visibility));

                // Calculate Risk Score (0-100)
                // Wind > 40 is risky, > 60 is dangerous
                // Rain > 20 is risky
                // Vis < 50 is risky

                let risk = 0;
                risk += Math.max(0, (wind - 20) * 1.5);
                risk += Math.max(0, (rain - 10) * 2);
                risk += Math.max(0, (80 - visibility) * 1.5);

                this.weatherGrid[y][x] = {
                    wind,
                    rain,
                    visibility,
                    risk: Math.min(100, risk)
                };
            }
        }
    }

    getWeatherAt(latlng) {
        if (!this.bounds) return null;
        const gridPos = this.latLngToGrid(latlng);
        if (this.isValid(gridPos.x, gridPos.y)) {
            return this.weatherGrid[gridPos.y][gridPos.x];
        }
        return { wind: 0, rain: 0, visibility: 100, risk: 0 };
    }

    getRisk(latlng) {
        const w = this.getWeatherAt(latlng);
        return w ? w.risk : 0;
    }

    latLngToGrid(latlng) {
        const latRange = this.bounds.maxLat - this.bounds.minLat;
        const lngRange = this.bounds.maxLng - this.bounds.minLng;
        const y = Math.floor(((latlng.lat - this.bounds.minLat) / latRange) * this.gridSize);
        const x = Math.floor(((latlng.lng - this.bounds.minLng) / lngRange) * this.gridSize);
        return {
            x: Math.max(0, Math.min(x, this.gridSize - 1)),
            y: Math.max(0, Math.min(y, this.gridSize - 1))
        };
    }

    isValid(x, y) {
        return x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize;
    }
}
