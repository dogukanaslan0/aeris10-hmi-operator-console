/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Zero-Dependency Node.js C2 Telemetry Mock Server
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

const http = require('http');
const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════════════════
// CONFIG & CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const PORT = 8765;
const FRAME_RATE_HZ = 60;
const PROTOCOL_VERSION = 1;
const VERSION = "0.1.0-node-mock";

const MOCK_ORIGIN_LAT = 41.0082;
const MOCK_ORIGIN_LON = 28.9784;

const CLASSIFICATIONS = ["bird", "drone", "aircraft", "vehicle"];
const THREATS = ["nominal", "caution", "warning", "critical"];

// ════════════════════════════════════════════════════════════════════════════
// SIMULATION ENGINE STATE
// ════════════════════════════════════════════════════════════════════════════

const startTimePerf = Date.now();
let frameCount = 0;
let droppedFrames = 0;

// Seed 4 radar targets with trajectories
const targets = [
  {
    id: "node-bird-1",
    classification: "bird",
    baseRange: 850,
    rangeAmp: 40,
    baseAzimuth: 45,
    azimuthRate: 3,
    baseElevation: 6,
    elevationAmp: 1.5,
    dopplerBase: 0.5,
    dopplerAmp: 1.8,
    rcsBase: -22,
    phase: 0
  },
  {
    id: "node-drone-1",
    classification: "drone",
    baseRange: 1400,
    rangeAmp: 180,
    baseAzimuth: 110,
    azimuthRate: 7,
    baseElevation: 12,
    elevationAmp: 3,
    dopplerBase: -2.5,
    dopplerAmp: 12,
    rcsBase: -12,
    phase: Math.PI / 3
  },
  {
    id: "node-aircraft-1",
    classification: "aircraft",
    baseRange: 2400,
    rangeAmp: 300,
    baseAzimuth: 280,
    azimuthRate: 11,
    baseElevation: 20,
    elevationAmp: 2,
    dopplerBase: -6,
    dopplerAmp: 20,
    rcsBase: 6,
    phase: Math.PI * 2 / 3
  },
  {
    id: "node-vehicle-1",
    classification: "vehicle",
    baseRange: 600,
    rangeAmp: 120,
    baseAzimuth: 175,
    azimuthRate: 5,
    baseElevation: 0.5,
    elevationAmp: 0.2,
    dopplerBase: 12,
    dopplerAmp: 18,
    rcsBase: 15,
    phase: Math.PI
  },
  {
    id: "node-crit-drone",
    classification: "drone",
    baseRange: 400,
    rangeAmp: 250,
    baseAzimuth: 140,
    azimuthRate: 6,
    baseElevation: 12,
    elevationAmp: 3,
    dopplerBase: -8,
    dopplerAmp: 6,
    rcsBase: -12,
    phase: Math.PI * 1.5 // Starts at min range (150m) and is critical at boot!
  }
];

// Active client connections
const clients = new Set();
const activeTargetThreatAlarms = new Set();

// ════════════════════════════════════════════════════════════════════════════
// SIMULATION HELPERS
// ════════════════════════════════════════════════════════════════════════════

function gaussianNoise(stddev) {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function deriveThreatLevel(range, doppler) {
  const speed = Math.abs(doppler);
  if (range < 250 && doppler < 0) return 'critical';
  if (range < 600 && speed > 22) return 'warning';
  if (range < 1200) return 'caution';
  return 'nominal';
}

function generateTelemetry(t, frameId) {
  const fanActive = t > 60;
  const thermistors = [];
  for (let i = 0; i < 8; i++) {
    const phase = i * 0.5;
    const targetTemp = fanActive ? 51 : 66;
    const base = 25 + (targetTemp - 25) * (1 - Math.exp(-t / 90));
    const ripple = Math.sin(t * 0.15 + phase) * 2;
    thermistors.push(base + ripple + gaussianNoise(0.3));
  }

  const paCurrents = [];
  for (let i = 0; i < 16; i++) {
    const phase = i * 0.3;
    const ripple = Math.sin(t * 0.2 + phase) * 12;
    paCurrents.push(280 + ripple + gaussianNoise(2));
  }

  const stepperPos = 50;
  const scanMech = (Math.floor((t / (50 / 60)) * stepperPos) % stepperPos) + 1;
  const scanElec = (Math.floor((t / (32 / 240)) * 32) % 32) + 1;

  const beamAz = ((scanMech - 1) / stepperPos) * 360;
  const beamEl = ((scanElec - 1) / 31) * 30 - 15;

  return {
    thermistors_c: thermistors,
    pa_currents_ma: paCurrents,
    cooling_fan_active: fanActive,
    cooling_threshold_c: 65,
    agc_gain: Math.round(Math.sin(t * 0.35) * 3),
    agc_enabled: true,
    agc_saturation_ratio: Math.max(0, Math.sin(t * 0.4) * 0.004 + gaussianNoise(0.001)),
    beam_azimuth_deg: beamAz,
    beam_elevation_deg: beamEl,
    scan_index_mechanical: scanMech,
    scan_index_electronic: scanElec,
    frame_count: frameId,
    dropped_frames: droppedFrames,
    data_rate_bps: Math.round(6200000 + gaussianNoise(80000))
  };
}

function generateSystem(t, timestamp) {
  const warmTime = 10;
  const elapsed = Math.min(t, warmTime);
  const warm = t >= warmTime;

  return {
    connection: warm ? "MOCK" : "OCXO_WARMUP",
    ocxo_warm: warm,
    ocxo_warmup_elapsed_s: elapsed,
    ocxo_warmup_total_s: warmTime,
    gps_lat: MOCK_ORIGIN_LAT + Math.sin(t * 0.04) * 0.00001,
    gps_lon: MOCK_ORIGIN_LON + Math.cos(t * 0.04) * 0.00001,
    gps_alt_m: 42 + Math.sin(t * 0.08) * 0.4,
    gps_fix_quality: 1,
    gps_satellites: 12,
    imu_pitch_deg: Math.sin(t * 0.18) * 0.4,
    imu_roll_deg: Math.cos(t * 0.12) * 0.6,
    imu_heading_deg: 180.0,
    baro_alt_m: 42 + Math.sin(t * 0.04) * 0.25,
    baro_pressure_hpa: 1013.25 + Math.sin(t * 0.015) * 1.2,
    server_timestamp_ms: timestamp,
    uptime_s: t
  };
}

function simulateTargets(t, timestamp) {
  return targets.map(seed => {
    const range = seed.baseRange + Math.sin(t * 0.25 + seed.phase) * seed.rangeAmp;
    const azimuth = (seed.baseAzimuth + t * seed.azimuthRate) % 360;
    const elevation = seed.baseElevation + Math.sin(t * 0.4 + seed.phase) * seed.elevationAmp;
    const doppler = seed.dopplerBase + Math.sin(t * 0.6 + seed.phase) * seed.dopplerAmp;

    const azRad = (azimuth * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    const horiz = range * Math.cos(elRad);
    const x = horiz * Math.sin(azRad);
    const y = horiz * Math.cos(azRad);
    const z = range * Math.sin(elRad);

    return {
      id: seed.id,
      timestamp_ms: timestamp,
      range_m: range,
      azimuth_deg: azimuth,
      elevation_deg: elevation,
      x_m: x,
      y_m: y,
      z_m: z,
      doppler_mps: doppler,
      snr_db: seed.snr_base_db ? seed.snr_base_db : 15 + gaussianNoise(1.5),
      rcs_dbsm: seed.rcsBase + gaussianNoise(0.4),
      threat_level: deriveThreatLevel(range, doppler),
      classification: seed.classification
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER IMPLEMENTATION
// ════════════════════════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    service: "AERIS-10 Node Mock Bridge",
    version: VERSION,
    mock: true,
    ws_endpoint: "/ws/radar",
    frame_rate_hz: FRAME_RATE_HZ,
    protocol_version: PROTOCOL_VERSION
  }));
});

server.on('upgrade', (req, socket, head) => {
  if (req.headers.upgrade !== 'websocket') {
    socket.destroy();
    return;
  }

  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) {
    socket.destroy();
    return;
  }

  // standard SHA1 handshake hash
  const shasum = crypto.createHash('sha1');
  shasum.update(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  const acceptKey = shasum.digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n'
  );

  const client = {
    socket,
    id: `client-${Math.random().toString(36).substr(2, 9)}`
  };

  clients.add(client);
  console.log(`[WS-Mock] Client connected: ${client.id}`);

  // Send handshake message immediately
  sendWsJson(client, {
    type: "HANDSHAKE",
    payload: {
      server_version: VERSION,
      mock: true,
      protocol_version: PROTOCOL_VERSION
    }
  });

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parseFrames();
  });

  socket.on('close', () => {
    clients.delete(client);
    console.log(`[WS-Mock] Client disconnected: ${client.id}`);
  });

  socket.on('error', (err) => {
    console.warn(`[WS-Mock] Socket error (${client.id}):`, err.message);
  });

  function parseFrames() {
    while (buffer.length >= 2) {
      const byte1 = buffer[0];
      const byte2 = buffer[1];
      const op = byte1 & 0x0f;
      const isMasked = (byte2 & 0x80) !== 0;
      let payloadLen = byte2 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        // high 32 bits not parsed for simplicity in this mock
        payloadLen = buffer.readUInt32BE(6);
        offset = 10;
      }

      const maskKeyOffset = offset;
      if (isMasked) {
        offset += 4;
      }

      if (buffer.length < offset + payloadLen) return;

      const mask = isMasked ? buffer.slice(maskKeyOffset, maskKeyOffset + 4) : null;
      const rawPayload = buffer.slice(offset, offset + payloadLen);

      // Unmask
      if (isMasked && mask) {
        for (let i = 0; i < rawPayload.length; i++) {
          rawPayload[i] ^= mask[i % 4];
        }
      }

      buffer = buffer.slice(offset + payloadLen);

      if (op === 8) { // CLOSE
        socket.end();
        return;
      }

      if (op === 1) { // TEXT
        const text = rawPayload.toString('utf8');
        try {
          const command = JSON.parse(text);
          handleClientCommand(client, command);
        } catch (err) {
          console.warn(`[WS-Mock] Failed to parse JSON command:`, text);
        }
      }
    }
  }
});

// Helper to send frame
function sendWsJson(client, obj) {
  if (client.socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = payload.length;

  let header;
  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2); // high 32 bits
    header.writeUInt32BE(len, 6); // low 32 bits
  }

  client.socket.write(Buffer.concat([header, payload]));
}

// ════════════════════════════════════════════════════════════════════════════
// COMMAND DISPATCHER
// ════════════════════════════════════════════════════════════════════════════

function handleClientCommand(client, command) {
  console.log(`[WS-Mock] Inbound Command (${command.type}) from ${client.id}`);

  switch (command.type) {
    case 'APPLY_CONFIG': {
      console.log(`  Config ID: ${command.config_id}`);
      console.log('  Payload:', command.payload);
      // ACK config immediately
      sendWsJson(client, {
        type: "CONFIG_ACK",
        payload: {
          config_id: command.config_id,
          success: true
        }
      });
      break;
    }

    case 'ACK_ALARM': {
      console.log(`  Alarm ID: ${command.alarm_id} ACKed by operator "${command.operator}"`);
      for (const targetId of activeTargetThreatAlarms) {
        if (command.alarm_id.includes(targetId)) {
          activeTargetThreatAlarms.delete(targetId);
          console.log(`  Cleared target threat alarm from server memory: ${targetId}`);
        }
      }
      break;
    }

    case 'START_SCAN': {
      console.log('  SCANNING started');
      break;
    }

    case 'STOP_SCAN': {
      console.log('  SCANNING stopped');
      break;
    }

    case 'ANNOTATE_TARGET': {
      console.log('  Annotated target:', command.payload);
      break;
    }

    default:
      console.warn('  Unknown command:', command);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN SIMULATION LOOP (60 Hz)
// ════════════════════════════════════════════════════════════════════════════

setInterval(() => {
  if (clients.size === 0) return;

  const t = (Date.now() - startTimePerf) / 1000;
  const timestamp = Date.now();

  frameCount += 1;

  const frame = {
    frame_id: frameCount,
    timestamp_ms: timestamp,
    targets: simulateTargets(t, timestamp),
    telemetry: generateTelemetry(t, frameCount),
    system: generateSystem(t, timestamp),
    source: "mock"
  };

  const message = {
    type: "FRAME",
    payload: frame
  };

  for (const client of clients) {
    sendWsJson(client, message);
  }

  // Scan targets for critical threats and trigger target threat alarms
  const frameTargets = frame.targets;
  for (const target of frameTargets) {
    if (target.threat_level === 'critical') {
      if (!activeTargetThreatAlarms.has(target.id)) {
        activeTargetThreatAlarms.add(target.id);
        
        const parts = target.id.split('-');
        const num = parts[parts.length - 1];
        const type = parts[parts.length - 2] ?? '';
        const prefix =
          type.includes('bird') ? 'BRD' :
          type.includes('drone') ? 'DRN' :
          type.includes('aircraft') ? 'AIR' :
          type.includes('vehicle') ? 'VEH' :
          type.toUpperCase().slice(0, 3);
        const displayId = /^\d+$/.test(num)
          ? `${prefix}-${num}`
          : target.id.replace('mock-', '').replace('node-', '').toUpperCase();
          
        const alarmId = `alarm-${target.id}-${Date.now()}`;
        const alarm = {
          id: alarmId,
          timestamp_ms: timestamp,
          category: "TARGET_THREAT",
          severity: "critical",
          source: target.id,
          message: `CRITICAL THREAT DETECTED: Target ${displayId} is inbound at ${target.range_m.toFixed(0)}m, speed ${target.doppler_mps.toFixed(1)}m/s!`,
          value: target.range_m,
          threshold: 200,
          acknowledged: false,
          acknowledged_at_ms: null,
          acknowledged_by: null
        };
        
        console.log(`[WS-Mock] Triggered Target Threat Alarm: ${target.id}`);
        for (const client of clients) {
          sendWsJson(client, {
            type: "ALARM",
            payload: alarm
          });
        }
      }
    }
  }

  // Periodic random alarms (approx every 30s)
  if (Math.random() < 0.0005) {
    const isTemp = Math.random() < 0.5;
    const alarmId = `alarm-${Math.random().toString(36).substr(2, 9)}`;

    const alarm = isTemp ? {
      id: alarmId,
      timestamp_ms: timestamp,
      category: "THERMISTOR",
      severity: "warning",
      source: "THERMISTOR_4",
      message: "Zone temperature 68.4°C above warning threshold 65°C",
      value: 68.4,
      threshold: 65,
      acknowledged: false,
      acknowledged_at_ms: null,
      acknowledged_by: null
    } : {
      id: alarmId,
      timestamp_ms: timestamp,
      category: "PA_CURRENT",
      severity: "critical",
      source: "PA_12",
      message: "Quiescent current 525 mA exceeds critical threshold 500 mA",
      value: 525,
      threshold: 500,
      acknowledged: false,
      acknowledged_at_ms: null,
      acknowledged_by: null
    };

    console.log(`[WS-Mock] Triggered Alarm Event: ${alarm.source} (${alarm.severity})`);

    for (const client of clients) {
      sendWsJson(client, {
        type: "ALARM",
        payload: alarm
      });
    }
  }
}, 1000 / FRAME_RATE_HZ);

// Start Server
server.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(` AERIS-10 WebSocket Mock Server is running!           `);
  console.log(`=======================================================`);
  console.log(` Listening on: ws://127.0.0.1:${PORT}/ws/radar`);
  console.log(` Web health:   http://127.0.0.1:${PORT}/`);
  console.log(` Ready to stream simulated 60 Hz radar frames!        `);
  console.log(`=======================================================`);
});
