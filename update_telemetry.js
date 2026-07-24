const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'telemetry.json');
const PARKS = [4, 28, 6, 5, 7, 8, 16, 17, 274, 275, 31, 30];
const RETENTION_MS = 14 * 86400000; // keep 14 days of history per ride

// Small fetch helper with retry + backoff for transient network/rate-limit blips.
async function fetchJson(url, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'dlp-plan-telemetry' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            lastErr = e;
            if (i < tries - 1) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
        }
    }
    throw lastErr;
}

async function updateData() {
    let history = {};
    if (fs.existsSync(FILE_PATH)) {
        try {
            history = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8')) || {};
        } catch (e) {
            console.error('Existing telemetry unreadable — starting fresh.');
            history = {};
        }
    }

    // GitHub-hosted runners are NTP-synced, so the local clock is reliable. (The old build
    // called worldtimeapi.org, which is frequently down and only ever fell back to this anyway.)
    const now = Date.now();
    const cutoff = now - RETENTION_MS;
    let parksOk = 0, samples = 0;

    for (const parkId of PARKS) {
        try {
            const data = await fetchJson(`https://queue-times.com/parks/${parkId}/queue_times.json`);
            const rides = Array.isArray(data.rides) ? [...data.rides] : [];
            if (Array.isArray(data.lands)) {
                data.lands.forEach(land => {
                    if (land && Array.isArray(land.rides)) rides.push(...land.rides);
                });
            }
            rides.forEach(ride => {
                if (!ride || ride.id == null) return;
                const w = Number(ride.wait_time);
                if (!Number.isFinite(w)) return;
                if (!history[ride.id]) history[ride.id] = [];
                history[ride.id].push({ t: now, w });
                history[ride.id] = history[ride.id].filter(item => item && item.t > cutoff);
                samples++;
            });
            parksOk++;
        } catch (err) {
            console.error(`Failed to fetch park ${parkId}: ${err.message}`);
        }
    }

    // Safety net: if every park failed this run, leave the good file untouched rather than
    // risk clobbering weeks of history with a partial/empty write.
    if (parksOk === 0) {
        console.error('All parks failed this run — telemetry.json left untouched.');
        process.exit(0);
    }

    fs.writeFileSync(FILE_PATH, JSON.stringify(history));
    console.log(`Telemetry updated: ${parksOk}/${PARKS.length} parks, ${samples} samples, ${Object.keys(history).length} rides tracked.`);
}

updateData().catch(err => { console.error('Fatal:', err); process.exit(1); });
