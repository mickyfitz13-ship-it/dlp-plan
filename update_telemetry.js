const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'telemetry.json');
const TARGET_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB Limit Ceiling

// --- 1. REPLACE THIS WITH YOUR REAL SCRAPING / API LOGIC ---
async function fetchLiveQueueData() {
  // Example structure expected: { "queue_1": 12, "queue_2": 45 }
  // Replace this placeholder object with your actual fetch/axios call:
  return {
    "queue_1": 12,
    "queue_2": 45
  };
}

// --- 2. HELPER TO CHECK JSON BYTE SIZE ---
function getByteSize(data) {
  return Buffer.byteLength(JSON.stringify(data), 'utf8');
}

// --- 3. TIME MACHINE RETENTION LOGIC ---
function pruneTelemetry(telemetryData) {
  const NOW = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
  const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

  const prunedData = {};

  for (const [queueId, entries] of Object.entries(telemetryData)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      prunedData[queueId] = [];
      continue;
    }

    // Sort entries chronologically
    const sorted = [...entries].sort((a, b) => a.t - b.t);

    const recentRaw = [];
    const midTermDailyBucket = {};   // Key: 'YYYY-MM-DD'
    const longTermWeeklyBucket = {}; // Key: 'YYYY-Www'

    for (const entry of sorted) {
      const age = NOW - entry.t;

      if (age <= SEVEN_DAYS_MS) {
        // Keep full hourly resolution for the last 7 days
        recentRaw.push(entry);
      } else if (age <= THIRTY_DAYS_MS) {
        // Group into daily buckets for days 8–30
        const dateKey = new Date(entry.t).toISOString().split('T')[0];
        if (!midTermDailyBucket[dateKey]) midTermDailyBucket[dateKey] = [];
        midTermDailyBucket[dateKey].push(entry);
      } else {
        // Group into weekly buckets for everything older than 30 days
        const d = new Date(entry.t);
        const year = d.getUTCFullYear();
        const firstJan = new Date(Date.UTC(year, 0, 1));
        const weekNum = Math.ceil((((d - firstJan) / 86400000) + firstJan.getUTCDay() + 1) / 7);
        const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;

        if (!longTermWeeklyBucket[weekKey]) longTermWeeklyBucket[weekKey] = [];
        longTermWeeklyBucket[weekKey].push(entry);
      }
    }

    // Reduce a bucket of data points into a single median point
    const reduceBucket = (bucket) => {
      return Object.values(bucket).map(group => {
        if (group.length === 1) return group[0];
        
        const sortedGroup = [...group].sort((a, b) => a.w - b.w);
        const mid = Math.floor(sortedGroup.length / 2);
        const medianWait = sortedGroup.length % 2 !== 0 
          ? sortedGroup[mid].w 
          : Math.round((sortedGroup[mid - 1].w + sortedGroup[mid].w) / 2);

        return {
          t: group[0].t,
          w: medianWait
        };
      });
    };

    const aggregatedDaily = reduceBucket(midTermDailyBucket);
    const aggregatedWeekly = reduceBucket(longTermWeeklyBucket);

    // Combine and sort final output
    prunedData[queueId] = [...aggregatedWeekly, ...aggregatedDaily, ...recentRaw]
      .sort((a, b) => a.t - b.t);
  }

  return prunedData;
}

// --- 4. ENFORCE 20 MB CEILING ---
function enforceSizeCap(telemetryData) {
  const currentSize = getByteSize(telemetryData);

  // If under 20 MB, keep 100% raw data
  if (currentSize < TARGET_SIZE_BYTES) {
    return telemetryData;
  }

  console.log(`Telemetry size (${(currentSize / (1024 * 1024)).toFixed(2)} MB) reached 20 MB ceiling. Running Time Machine pruning...`);
  return pruneTelemetry(telemetryData);
}

// --- 5. MAIN SWEEP EXECUTION ---
async function runSweep() {
  console.log('Starting telemetry sweep...');

  // Load existing telemetry file if available
  let telemetry = {};
  if (fs.existsSync(FILE_PATH)) {
    try {
      telemetry = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    } catch (err) {
      console.error('Error reading telemetry.json, starting fresh:', err);
      telemetry = {};
    }
  }

  // Fetch new data
  const newQueueData = await fetchLiveQueueData();

  // Append new timestamped entries
  const timestamp = Date.now();
  Object.keys(newQueueData).forEach(qId => {
    if (!telemetry[qId]) telemetry[qId] = [];
    telemetry[qId].push({ t: timestamp, w: newQueueData[qId] });
  });

  // Apply size enforcement / pruning
  const finalTelemetry = enforceSizeCap(telemetry);

  // Save to file
  const finalSizeMB = (getByteSize(finalTelemetry) / (1024 * 1024)).toFixed(2);
  fs.writeFileSync(FILE_PATH, JSON.stringify(finalTelemetry), 'utf8');
  console.log(`Telemetry updated successfully. Current file size: ${finalSizeMB} MB`);
}

runSweep().catch(console.error);
