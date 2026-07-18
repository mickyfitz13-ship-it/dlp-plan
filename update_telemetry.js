const fs = require('fs');

// We will track Disneyland Park (4) and Disney Adventure World (28)
const PARKS = [4, 28]; 
const FILE_PATH = 'telemetry.json';

async function updateData() {
    let history = {};
    
    // Load existing history if the file exists
    if (fs.existsSync(FILE_PATH)) {
        try {
            history = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
        } catch (e) {
            console.error('Error reading existing telemetry, starting fresh.');
        }
    }

    const now = Date.now();
    // 86400000 milliseconds = 24 hours
    const cutoff = now - 86400000; 

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
    console.log('Telemetry updated and saved to telemetry.json');
}

updateData();
