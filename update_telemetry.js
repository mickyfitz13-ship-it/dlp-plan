const fs = require('fs');
const { execSync } = require('child_process');

// Expanded tracking array to include the entire global network
// Paris (4,28), Florida (6,5,7,8), California (16,17), Tokyo (274,275), HK/Shanghai (31,30)
const PARKS = [4, 28, 6, 5, 7, 8, 16, 17, 274, 275, 31, 30]; 
const FILE_PATH = 'telemetry.json';

async function runTelemetryPipeline() {
    try {
        // Step 1: Pull cloud telemetry points logged by GitHub Actions while local was resting
        console.log("[LOCAL] Running Git synchronization pull...");
        execSync('git pull --rebase origin main', { stdio: 'inherit' });

        // --- DATA COLLECTION VECTOR ENGINE ---
        let history = {};
        
        // Load existing history if the file exists after sync
        if (fs.existsSync(FILE_PATH)) {
            try {
                history = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
            } catch (e) {
                console.error('Error reading existing telemetry, starting fresh.');
            }
        }

        const now = Date.now();
        // 14 days * 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
        const cutoff = now - (14 * 86400000); 

        for (const parkId of PARKS) {
            try {
                const res = await fetch(`https://queue-times.com/parks/${parkId}/queue_times.json`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                
                const rides = [...(data.rides || [])];
                if (data.lands) {
                    data.lands.forEach(land => rides.push(...land.rides));
                }

                rides.forEach(ride => {
                    if (!history[ride.id]) history[ride.id] = [];
                    
                    // Only log if the ride is actually operating
                    if (ride.is_open && ride.wait_time !== undefined) {
                        history[ride.id].push({ t: now, w: ride.wait_time });
                    }
                    
                    // Prune old data to keep the file size minimal and relevant
                    history[ride.id] = history[ride.id].filter(point => point.t >= cutoff);
                });
                console.log(`Successfully processed Park ${parkId}`);
            } catch (err) {
                console.error(`Failed to fetch park ${parkId}:`, err);
            }
        }

        fs.writeFileSync(FILE_PATH, JSON.stringify(history));
        console.log('Global Telemetry updated and saved to telemetry.json');
        // -----------------------------------------------------------

        // Step 2: Push newly captured local points back up to the master repository
        console.log("[LOCAL] Commit and sync data back to cloud origin...");
        execSync('git add telemetry.json', { stdio: 'inherit' });
        execSync('git commit -m "SYS: Local daemon telemetry sweep [Skip CI]"', { stdio: 'inherit' });
        execSync('git push origin main', { stdio: 'inherit' });
        
        console.log("[LOCAL] Dual-route synchronization complete.");
    } catch (error) {
        console.error("[LOCAL LOG ERR] Pipeline concurrency collision or network drop:", error.message);
    }
}

runTelemetryPipeline();
