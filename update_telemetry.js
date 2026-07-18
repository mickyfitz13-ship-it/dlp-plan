const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'telemetry.json');
const PARKS = [4, 28, 6, 5, 7, 8, 16, 17, 274, 275, 31, 30];

async function updateData() {
    let history = {};
    if (fs.existsSync(FILE_PATH)) {
        try {
            history = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
        } catch (e) {
            console.error('Error reading existing telemetry, starting fresh.');
        }
    }

    let now = Date.now();

    // Fix cloud runner clock drift by forcing network time if running in GitHub Actions
    if (process.env.GITHUB_ACTIONS === 'true') {
        try {
            const timeRes = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC');
            if (timeRes.ok) {
                const timeData = await timeRes.json();
                now = new Date(timeData.utc_datetime).getTime();
                console.log(`[CLOUD] Overriding drift clock with network time: ${now}`);
            }
        } catch (e) {
            console.error('[CLOUD] Network time fetch failed, falling back to runner clock.', e);
        }
    }

    const cutoff = now - (14 * 86400000);

    for (const parkId of PARKS) {
        try {
            const res = await fetch(`https://queue-times.com/parks/${parkId}/queue.json`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            
            const rides = [...(data.rides || [])];
            if (data.lands) {
                data.lands.forEach(land => rides.push(...land.rides));
            }

            // Map and update telemetry data points
            rides.forEach(ride => {
                if (!history[ride.id]) history[ride.id] = [];
                history[ride.id].push({ t: now, w: ride.wait_time });
                // Filter out records older than 14 days
                history[ride.id] = history[ride.id].filter(item => item.t > cutoff);
            });

        } catch (err) {
            console.error(`Failed to fetch park ${parkId}:`, err);
        }
    }

    fs.writeFileSync(FILE_PATH, JSON.stringify(history));
    console.log('Global Telemetry updated and saved to telemetry.json');
}

updateData();
