import { readFile } from "node:fs/promises";

type SynonymMap = Record<string, string[]>;

const FALLBACK_SYNONYMS: SynonymMap = {
  servo: ["servo motor actuator", "SG90", "MG996R"],
  board: ["microcontroller development board", "Arduino", "ESP32", "Raspberry Pi"],
  lidar: ["LiDAR laser distance sensor", "RPLidar"],
  "motor driver": ["H-bridge driver", "L298N", "TB6612FNG"],
  ble: ["bluetooth low energy communication module", "HC-05", "wireless transceiving link"],
  wifi: ["wireless network internet access", "ESP8266", "ESP32 microchip"],
  imu: ["inertial measurement unit sensor", "gyroscope accelerometer", "MPU6050"],
  oled: ["digital display screen monitor panel", "I2C OLED screen"],
  gps: ["satellite positioning navigation receiver", "NEO-6M module"],
  battery: ["rechargeable lithium cell pack", "18650 Li-ion battery", "Lipo power source"],
};

let cachedSynonyms: SynonymMap | null = null;

export async function expandQuery(query: string): Promise<string> {
  const synonyms = await loadSynonyms();
  const normalizedQuery = query.toLowerCase();
  const expansions = new Set<string>();

  for (const [term, values] of Object.entries(synonyms)) {
    if (normalizedQuery.includes(term.toLowerCase())) {
      values.forEach((value) => expansions.add(value));
    }
  }

  if (expansions.size === 0) return query.trim();
  return `${query.trim()} ${Array.from(expansions).join(" ")}`.replace(/\s+/g, " ");
}

async function loadSynonyms(): Promise<SynonymMap> {
  if (cachedSynonyms) return cachedSynonyms;

  try {
    const url = new URL("../data/synonyms.json", import.meta.url);
    const raw = await readFile(url, "utf8");
    cachedSynonyms = JSON.parse(raw) as SynonymMap;
  } catch {
    cachedSynonyms = FALLBACK_SYNONYMS;
  }

  return cachedSynonyms;
}
