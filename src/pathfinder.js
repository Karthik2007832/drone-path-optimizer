/**
 * A* Pathfinding Module for Drone Route Optimization
 * Features:
 * - Weighted Grid (Risk Costs)
 * - Dynamic Risk Tolerance
 * - Diagonal Movement with Cost
 */

export class Pathfinder {
    constructor(gridSize = 60) {
        this.gridSize = gridSize;
        this.grid = []; // Stores obstacle risk (0-100)
        this.bounds = null;
        this.weatherSystem = null; // Reference to WeatherSystem
    }

    setWeatherSystem(ws) {
        this.weatherSystem = ws;
    }

    /**
     * Initialize grid and reset risk values
     */
    initGrid(bounds) {
        this.bounds = {
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast()
        };

        // Initialize grid with Base Risk = 10 (Normal Terrain)
        this.grid = new Array(this.gridSize).fill(0).map(() => new Array(this.gridSize).fill(10));
    }

    /**
     * Mark obstacles and create a Risk Gradient (Heatmap)
     * @param {Array} polygons - Arrays of LatLngs
     */
    markObstacles(polygons) {
        // Reset grid to base risk (10)
        this.grid = new Array(this.gridSize).fill(0).map(() => new Array(this.gridSize).fill(10));

        const latStep = (this.bounds.maxLat - this.bounds.minLat) / this.gridSize;
        const lngStep = (this.bounds.maxLng - this.bounds.minLng) / this.gridSize;

        // 1. Mark Solid Obstacles (Risk 100)
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const centerLat = this.bounds.minLat + (y + 0.5) * latStep;
                const centerLng = this.bounds.minLng + (x + 0.5) * lngStep;
                const point = { lat: centerLat, lng: centerLng };

                for (let poly of polygons) {
                    if (this.isPointInPolygon(point, poly)) {
                        this.grid[y][x] = 100; // Blocked
                        break;
                    }
                }
            }
        }

        // 2. Apply Proximity Risk (Gradient) to nearby cells
        // Simple 3-pass diffusion or distance check
        // For performance on 60x60, a simple distance check to '100' cells is okay
        // But a multi-pass box blur is faster and gives good result
        this.applyRiskDiffusion();
        this.applyRiskDiffusion(); // Run twice for wider gradient
    }

    applyRiskDiffusion() {
        const newGrid = this.grid.map(row => [...row]); // Clone

        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                if (this.grid[y][x] >= 100) continue; // Don't change walls

                // Check neighbors
                let maxNeighborRisk = 0;
                const neighbors = this.getNeighbors(x, y);
                for (let n of neighbors) {
                    if (this.grid[n.y][n.x] > maxNeighborRisk) {
                        maxNeighborRisk = this.grid[n.y][n.x];
                    }
                }

                // Decay risk: strict decay to create buffer
                // If neighbor is 100, I become 60. If neighbor is 60, I become 36.
                if (maxNeighborRisk > 15) { // Threshold above base risk
                    // Allow risk to bleed out
                    const decay = 0.6;
                    const diffusedRisk = Math.floor(maxNeighborRisk * decay);
                    if (diffusedRisk > newGrid[y][x]) {
                        newGrid[y][x] = diffusedRisk;
                    }
                }
            }
        }
        this.grid = newGrid;
    }

    /**
     * Get Risk value at specific LatLng
     */
    getRisk(latlng) {
        const node = this.latLngToGrid(latlng);
        let risk = 0;

        if (this.isValid(node.x, node.y)) {
            risk = this.grid[node.y][node.x];
        }

        // Add Weather Risk
        if (this.weatherSystem) {
            const weatherRisk = this.weatherSystem.getRisk(latlng);
            risk = Math.max(risk, weatherRisk); // Take the higher of terrain or weather risk
            // Or combine: risk += weatherRisk;
        }

        return Math.min(100, risk);
    }

    isPointInPolygon(point, vs) {
        let x = point.lat, y = point.lng;
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            let xi = vs[i].lat, yi = vs[i].lng;
            let xj = vs[j].lat, yj = vs[j].lng;
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /**
     * Execute A* Algorithm with Risk Handling
     * @param {Object} startLatLng 
     * @param {Object} endLatLng 
     * @param {Number} userRiskTolerance (0-100)
     */
    findPath(startLatLng, endLatLng, userRiskTolerance = 50) {
        const startNode = this.latLngToGrid(startLatLng);
        const endNode = this.latLngToGrid(endLatLng);

        if (!this.isValid(startNode.x, startNode.y) || !this.isValid(endNode.x, endNode.y)) {
            console.error("Start/End outside bounds");
            return [];
        }

        // Calculate Risk Weight based on Tolerance
        // Low Tolerance (0) -> High Weight (Avoid Risk)
        // High Tolerance (100) -> Low Weight (Ignore Risk)
        // Weight Multiplier: 0 to 50
        const riskWeight = Math.max(0, (100 - userRiskTolerance) / 2);

        const openSet = [];
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();
        const closedSet = new Set(); // Optimization

        const startKey = `${startNode.x},${startNode.y}`;
        gScore.set(startKey, 0);
        fScore.set(startKey, this.heuristic(startNode, endNode));

        openSet.push({
            x: startNode.x,
            y: startNode.y,
            f: fScore.get(startKey)
        });

        while (openSet.length > 0) {
            openSet.sort((a, b) => a.f - b.f);
            const current = openSet.shift();
            const currentKey = `${current.x},${current.y}`;

            if (current.x === endNode.x && current.y === endNode.y) {
                return this.reconstructPath(cameFrom, current);
            }

            closedSet.add(currentKey);

            const neighbors = this.getNeighbors(current.x, current.y);

            for (let neighbor of neighbors) {
                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (closedSet.has(neighborKey)) continue;

                const riskValue = this.grid[neighbor.y][neighbor.x];

                // ABSOLUTE RED LINE: If Risk is 100 (No-Fly), it's a wall.
                if (riskValue >= 100) continue;

                // Distance Cost (1.0 for straight, 1.414 for diagonal)
                const distCost = Math.sqrt(Math.pow(neighbor.x - current.x, 2) + Math.pow(neighbor.y - current.y, 2));

                // Risk Cost
                // Additional cost added to the movement based on cell risk and user tolerance
                // If tolerance is low, riskWeight is high, making risky cells very expensive.
                const riskCost = (riskValue * riskWeight) / 10;

                const tentative_gScore = gScore.get(currentKey) + distCost + riskCost;

                if (!gScore.has(neighborKey) || tentative_gScore < gScore.get(neighborKey)) {
                    cameFrom.set(neighborKey, current);
                    gScore.set(neighborKey, tentative_gScore);
                    fScore.set(neighborKey, tentative_gScore + this.heuristic(neighbor, endNode));

                    if (!openSet.find(n => n.x === neighbor.x && n.y === neighbor.y)) {
                        openSet.push({
                            x: neighbor.x,
                            y: neighbor.y,
                            f: fScore.get(neighborKey)
                        });
                    }
                }
            }
        }
        return [];
    }

    getNeighbors(x, y) {
        const neighbors = [];
        const directions = [
            { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
            { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
            { dx: -1, dy: 1 }, { dx: 1, dy: 1 }
        ];

        for (let dir of directions) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            if (this.isValid(nx, ny)) {
                neighbors.push({ x: nx, y: ny });
            }
        }
        return neighbors;
    }

    isValid(x, y) {
        return x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize;
    }

    heuristic(a, b) {
        return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    }

    reconstructPath(cameFrom, current) {
        const totalPath = [current];
        let key = `${current.x},${current.y}`;

        while (cameFrom.has(key)) {
            current = cameFrom.get(key);
            key = `${current.x},${current.y}`;
            totalPath.unshift(current);
        }
        return totalPath.map(node => this.gridToLatLng(node));
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

    gridToLatLng(node) {
        const latStep = (this.bounds.maxLat - this.bounds.minLat) / this.gridSize;
        const lngStep = (this.bounds.maxLng - this.bounds.minLng) / this.gridSize;
        return {
            lat: this.bounds.minLat + (node.y + 0.5) * latStep,
            lng: this.bounds.minLng + (node.x + 0.5) * lngStep
        };
    }
}
