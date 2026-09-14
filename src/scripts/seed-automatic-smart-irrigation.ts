import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { DifficultyLevel, ProjectCategory, ProjectType } from "../generated/prisma/enums.js";

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const projectSlug = "automatic-smart-irrigation-system";
const imageUrl = "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=1400&q=80";

const componentSeeds = [
  {
    sku: "SENS-SOIL-MOISTURE-V1",
    name: "Capacitive Soil Moisture Sensor",
    slug: "capacitive-soil-moisture-sensor",
    category: "Sensors",
    subcategory: "Agriculture Sensors",
    unitPriceCents: 24900,
    stockQuantity: 100,
    description: "Corrosion-resistant capacitive sensor for measuring soil moisture.",
  },
  {
    sku: "PUMP-12V-MINI",
    name: "12V Mini Water Pump",
    slug: "12v-mini-water-pump",
    category: "Motors & Actuators",
    subcategory: "Pumps",
    unitPriceCents: 29900,
    stockQuantity: 60,
    description: "Compact 12V DC pump for small indoor and balcony irrigation systems.",
  },
  {
    sku: "RELAY-1CH-5V",
    name: "5V Single Channel Relay Module",
    slug: "5v-single-channel-relay-module",
    category: "Automation",
    subcategory: "Relay Modules",
    unitPriceCents: 7900,
    stockQuantity: 150,
    description: "Opto-isolated relay module for switching a small DC water pump.",
  },
];

const bom = [
  { sku: "ESP32-DEVKIT", quantity: 1, isOptional: false, note: "Main controller and WiFi connection" },
  { sku: "SENS-SOIL-MOISTURE-V1", quantity: 2, isOptional: false, note: "One sensor per irrigation zone" },
  { sku: "PUMP-12V-MINI", quantity: 1, isOptional: false, note: "Water delivery pump" },
  { sku: "RELAY-1CH-5V", quantity: 1, isOptional: false, note: "Switches the pump" },
  { sku: "WIRE-JUMP-65", quantity: 1, isOptional: false, note: "Breadboard connections" },
  { sku: "BREAD-830", quantity: 1, isOptional: true, note: "Use a terminal block instead for a permanent build" },
];

const sections = [
  {
    sectionKey: "components",
    heading: "Choose the right irrigation parts",
    body: "The ESP32 reads capacitive soil sensors and uses a relay to switch the pump. Capacitive sensors last longer in damp soil than exposed-resistive probes. Add a second sensor when you want independent control for two pots.",
    sortOrder: 1,
    steps: [],
    faqs: [],
  },
  {
    sectionKey: "wiring",
    heading: "Wire the controller and pump",
    body: "Keep the pump supply separate from the ESP32 USB supply, and connect all low-voltage grounds together. Never route pump current through the ESP32 board.",
    sortOrder: 2,
    diagramUrl: imageUrl,
    steps: [
      { title: "Connect the moisture sensor", body: "Connect VCC to 3.3V, GND to GND, and analog output to GPIO 34." },
      { title: "Connect the relay input", body: "Connect relay IN to GPIO 26, VCC to 5V, and GND to the common ground." },
      { title: "Connect the pump", body: "Route the pump positive lead through the relay's normally-open contact and use a separate 12V supply." },
    ],
    faqs: [],
  },
  {
    sectionKey: "code",
    heading: "Upload the irrigation logic",
    body: "Calibrate the dry and wet readings for your soil, then upload the controller code. Start with a conservative moisture threshold to avoid overwatering.",
    sortOrder: 3,
    code: "const int moisturePin = 34;\nconst int relayPin = 26;\nconst int dryThreshold = 2600;\n\nvoid setup() {\n  pinMode(relayPin, OUTPUT);\n  digitalWrite(relayPin, HIGH);\n  Serial.begin(115200);\n}\n\nvoid loop() {\n  const int moisture = analogRead(moisturePin);\n  const bool needsWater = moisture > dryThreshold;\n  digitalWrite(relayPin, needsWater ? LOW : HIGH);\n  Serial.println(moisture);\n  delay(5000);\n}",
    repoUrl: "https://github.com/roboroot-in/automatic-smart-irrigation-system",
    steps: [],
    faqs: [],
  },
  {
    sectionKey: "troubleshooting",
    heading: "Troubleshooting",
    body: "Check the sensor reading in the serial monitor before changing the threshold. Most issues come from a missing common ground or a pump supply that cannot provide enough current.",
    sortOrder: 4,
    steps: [],
    faqs: [
      { question: "The pump never turns on", answer: "Confirm the relay input changes state and that the pump has its own 12V supply. Test the pump directly for a moment, away from the controller." },
      { question: "The moisture value is stuck", answer: "Check the sensor's analog output wire and common ground. Keep the sensor cable away from pump power wires." },
      { question: "The plants are overwatered", answer: "Raise the dry threshold only after recording wet and dry readings, and add a minimum delay between watering cycles." },
    ],
  },
];

async function main() {
  console.log(`Seeding ${projectSlug}...`);

  for (const seed of componentSeeds) {
    await prisma.component.upsert({
      where: { sku: seed.sku },
      create: {
        ...seed,
        typicalUseCase: "Smart irrigation and plant monitoring",
        tags: ["irrigation", "agriculture", "smart-garden"],
        isActive: true,
      },
      update: {
        name: seed.name,
        slug: seed.slug,
        category: seed.category,
        subcategory: seed.subcategory,
        unitPriceCents: seed.unitPriceCents,
        description: seed.description,
      },
    });
  }

  const project = await prisma.project.upsert({
    where: { slug: projectSlug },
    create: {
      title: "Automatic Smart Irrigation System",
      slug: projectSlug,
      summary: "Build a soil-aware irrigation controller that waters plants only when they need it.",
      description: "This beginner-friendly agriculture and IoT project uses an ESP32, capacitive soil moisture sensors, and a relay-controlled pump to automate watering. You will learn analog sensor calibration, safe low-voltage switching, and practical irrigation logic.",
      category: ProjectCategory.AGRICULTURE,
      tags: ["agriculture", "smart-garden", "esp32", "soil-moisture", "irrigation", "iot"],
      projectType: ProjectType.FEATURED,
      difficulty: DifficultyLevel.BEGINNER,
      estimatedCostCents: 110000,
      costEstimateMinCents: 90000,
      costEstimateMaxCents: 140000,
      estimatedBuildTimeMinutes: 150,
      thumbnailUrl: imageUrl,
      heroImageUrl: imageUrl,
      imageUrls: [imageUrl],
      isFeatured: true,
      isPublic: true,
      learningOutcomes: ["Calibrate capacitive moisture sensors", "Switch a DC pump safely", "Build threshold-based automation"],
      prerequisites: ["Basic Arduino IDE usage", "Low-voltage wiring basics"],
      publishedAt: new Date(),
    },
    update: {
      title: "Automatic Smart Irrigation System",
      category: ProjectCategory.AGRICULTURE,
      tags: ["agriculture", "smart-garden", "esp32", "soil-moisture", "irrigation", "iot"],
      isPublic: true,
      isFeatured: true,
    },
  });

  for (const item of bom) {
    const component = await prisma.component.findUnique({ where: { sku: item.sku } });
    if (!component) throw new Error(`Missing component ${item.sku}`);
    await prisma.projectComponent.upsert({
      where: { projectId_componentId: { projectId: project.id, componentId: component.id } },
      create: { projectId: project.id, componentId: component.id, quantity: item.quantity, isOptional: item.isOptional, note: item.note, notes: item.note },
      update: { quantity: item.quantity, isOptional: item.isOptional, note: item.note, notes: item.note },
    });
  }

  for (const section of sections) {
    await prisma.projectContentSection.upsert({
      where: { projectId_sectionKey: { projectId: project.id, sectionKey: section.sectionKey } },
      create: { projectId: project.id, ...section },
      update: {
        heading: section.heading,
        body: section.body,
        sortOrder: section.sortOrder,
        ...(section.diagramUrl ? { diagramUrl: section.diagramUrl } : {}),
        ...(section.code ? { code: section.code } : {}),
        ...(section.repoUrl ? { repoUrl: section.repoUrl } : {}),
        steps: section.steps,
        faqs: section.faqs,
      },
    });
  }

  console.log(`Created or updated project: ${project.title}`);
  console.log(`Hub: /projects/${project.slug}`);
  console.log(`Making guide: /projects/${project.slug}/making`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
