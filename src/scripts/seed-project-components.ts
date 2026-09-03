/**
 * Seed Project-Component Relationships
 * Links projects to the components they require
 */

import "dotenv/config";
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🔗 Linking projects to components...');

  // Get all projects and components
  const projects = await prisma.project.findMany();
  const components = await prisma.component.findMany();

  if (projects.length === 0) {
    console.log('⚠️  No projects found. Please run seed-projects.ts first.');
    return;
  }

  if (components.length === 0) {
    console.log('⚠️  No components found. Please run seed-components.ts first.');
    return;
  }

  console.log(`Found ${projects.length} projects and ${components.length} components`);

  // Helper function to find component by name (partial match)
  const findComponent = (nameFragment: string) => {
    return components.find((c: any) => 
      c.name.toLowerCase().includes(nameFragment.toLowerCase())
    );
  };

  // Define component requirements for each project
  const projectComponentMap: Record<string, Array<{ name: string; quantity: number; notes?: string }>> = {
    // Arduino Line Following Robot
    'arduino-line-following-robot': [
      { name: 'Arduino', quantity: 1, notes: 'Main controller for the robot' },
      { name: 'Motor Driver', quantity: 1, notes: 'L298N for motor control' },
      { name: 'DC Motor', quantity: 2, notes: 'For robot movement' },
      { name: 'IR Sensor', quantity: 2, notes: 'For line detection' },
      { name: 'Battery', quantity: 1, notes: '9V or 12V battery pack' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],

    // IoT Smart Home Automation System
    'iot-smart-home-automation-system': [
      { name: 'ESP32', quantity: 1, notes: 'WiFi-enabled microcontroller' },
      { name: 'Relay', quantity: 4, notes: 'For controlling appliances' },
      { name: 'DHT22', quantity: 1, notes: 'Temperature & humidity sensor' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],

    // Self-Balancing Robot
    'self-balancing-robot': [
      { name: 'Arduino', quantity: 1, notes: 'Main controller' },
      { name: 'MPU6050', quantity: 1, notes: 'Gyroscope & accelerometer' },
      { name: 'Motor Driver', quantity: 1, notes: 'L298N for motor control' },
      { name: 'DC Motor', quantity: 2, notes: 'For balancing movement' },
      { name: 'Battery', quantity: 1, notes: '12V battery pack' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],

    // Weather Monitoring Station
    'weather-monitoring-station': [
      { name: 'Arduino', quantity: 1, notes: 'Main controller' },
      { name: 'DHT22', quantity: 1, notes: 'Temperature & humidity sensor' },
      { name: 'LCD', quantity: 1, notes: 'For displaying readings' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],

    // Obstacle Avoiding Robot Car
    'obstacle-avoiding-robot-car': [
      { name: 'Arduino', quantity: 1, notes: 'Main controller' },
      { name: 'Ultrasonic', quantity: 1, notes: 'HC-SR04 for obstacle detection' },
      { name: 'Motor Driver', quantity: 1, notes: 'L298N for motor control' },
      { name: 'DC Motor', quantity: 2, notes: 'For robot movement' },
      { name: 'Servo', quantity: 1, notes: 'For ultrasonic sensor rotation' },
      { name: 'Battery', quantity: 1, notes: '9V or 12V battery pack' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],

    // Bluetooth Controlled LED Matrix Display
    'bluetooth-controlled-led-matrix-display': [
      { name: 'Arduino', quantity: 1, notes: 'Main controller' },
      { name: 'LED Matrix', quantity: 1, notes: '8x8 or 16x16 matrix' },
      { name: 'Bluetooth', quantity: 1, notes: 'HC-05 for wireless control' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],

    // Smart Plant Watering System
    'smart-plant-watering-system': [
      { name: 'Arduino', quantity: 1, notes: 'Main controller' },
      { name: 'Soil Moisture', quantity: 1, notes: 'For detecting soil moisture' },
      { name: 'Relay', quantity: 1, notes: 'For controlling water pump' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],

    // RFID Door Lock System
    'rfid-door-lock-system': [
      { name: 'Arduino', quantity: 1, notes: 'Main controller' },
      { name: 'RFID', quantity: 1, notes: 'RC522 module for card reading' },
      { name: 'Servo', quantity: 1, notes: 'For lock mechanism' },
      { name: 'Relay', quantity: 1, notes: 'For electronic lock' },
      { name: 'Jumper', quantity: 1, notes: 'For connections' },
    ],
  };

  // Link components to projects
  let totalLinks = 0;
  for (const project of projects) {
    const componentRequirements = projectComponentMap[project.slug];
    
    if (!componentRequirements) {
      console.log(`⚠️  No component mapping found for project: ${project.title}`);
      continue;
    }

    console.log(`\nLinking components for: ${project.title}`);
    
    for (const req of componentRequirements) {
      const component = findComponent(req.name);
      
      if (!component) {
        console.log(`  ⚠️  Component not found: ${req.name}`);
        continue;
      }

      try {
        await prisma.projectComponent.upsert({
          where: {
            projectId_componentId: {
              projectId: project.id,
              componentId: component.id,
            },
          },
          create: {
            projectId: project.id,
            componentId: component.id,
            quantity: req.quantity,
            notes: req.notes || null,
          },
          update: {
            quantity: req.quantity,
            notes: req.notes || null,
          },
        });

        console.log(`  ✅ Linked: ${component.name} (qty: ${req.quantity})`);
        totalLinks++;
      } catch (error) {
        console.error(`  ❌ Failed to link ${component.name}:`, error);
      }
    }
  }

  console.log(`\n✨ Successfully linked ${totalLinks} component relationships!`);
}

main()
  .catch((error) => {
    console.error('Error seeding project components:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
