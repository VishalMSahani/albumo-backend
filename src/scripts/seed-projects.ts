/**
 * Seed Sample Projects
 * Adds featured robotics projects to the database
 */

import "dotenv/config";
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { ProjectCategory, DifficultyLevel, ProjectType } from '../generated/prisma/enums.js';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const sampleProjects = [
  {
    title: 'Arduino Line Following Robot',
    slug: 'arduino-line-following-robot',
    summary: 'Build a self-driving robot that follows black lines using IR sensors and Arduino Uno.',
    description: 'This project teaches you how to build an autonomous line-following robot using Arduino. Perfect for beginners! The robot uses infrared sensors to detect and follow a black line on a white surface. You will learn about motor control, sensor interfacing, and basic robotics algorithms.',
    category: ProjectCategory.ROBOTICS,
    tags: ['arduino', 'robot', 'ir-sensor', 'motor', 'beginner'],
    difficulty: DifficultyLevel.BEGINNER,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 149900, // ₹1,499
    estimatedBuildTimeMinutes: 180, // 3 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: true,
    isPublic: true,
    learningOutcomes: [
      'Understanding IR sensors',
      'Motor control with L298N driver',
      'Arduino programming basics',
      'Basic robotics concepts',
    ],
    prerequisites: ['Basic Arduino knowledge', 'Soldering skills (optional)'],
    publishedAt: new Date(),
  },
  {
    title: 'IoT Smart Home Automation System',
    slug: 'iot-smart-home-automation',
    summary: 'Control home appliances remotely using ESP32 and smartphone app via WiFi.',
    description: 'Build a complete smart home automation system that lets you control lights, fans, and other appliances from your smartphone. Uses ESP32 for WiFi connectivity and relay modules for switching AC appliances. Includes a mobile app interface and voice control integration.',
    category: ProjectCategory.IOT,
    tags: ['esp32', 'wifi', 'smart-home', 'relay', 'mobile-app'],
    difficulty: DifficultyLevel.INTERMEDIATE,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 249900, // ₹2,499
    estimatedBuildTimeMinutes: 300, // 5 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: true,
    isPublic: true,
    learningOutcomes: [
      'ESP32 WiFi programming',
      'Relay module interfacing',
      'Mobile app development basics',
      'IoT protocols (MQTT/HTTP)',
    ],
    prerequisites: ['Arduino IDE knowledge', 'Basic electronics', 'WiFi router access'],
    publishedAt: new Date(),
  },
  {
    title: 'Self-Balancing Robot',
    slug: 'self-balancing-robot',
    summary: 'Create a two-wheeled self-balancing robot using MPU6050 gyroscope and PID control.',
    description: 'Advanced project that demonstrates PID control algorithms. This self-balancing robot uses the MPU6050 sensor to detect tilt and maintains balance using PID calculations. Great for learning control systems and sensor fusion.',
    category: ProjectCategory.ROBOTICS,
    tags: ['arduino', 'mpu6050', 'pid', 'gyroscope', 'advanced'],
    difficulty: DifficultyLevel.ADVANCED,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 199900, // ₹1,999
    estimatedBuildTimeMinutes: 420, // 7 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: true,
    isPublic: true,
    learningOutcomes: [
      'PID control algorithm',
      'Gyroscope and accelerometer',
      'Sensor fusion techniques',
      'Advanced motor control',
    ],
    prerequisites: ['Advanced Arduino', 'Control systems basics', 'Math fundamentals'],
    publishedAt: new Date(),
  },
  {
    title: 'Weather Monitoring Station',
    slug: 'weather-monitoring-station',
    summary: 'Monitor temperature, humidity, and atmospheric pressure with cloud data logging.',
    description: 'Build an IoT weather station that measures temperature, humidity, and pressure using DHT11 and BMP180 sensors. Data is uploaded to cloud (ThingSpeak) for remote monitoring and historical analysis. Perfect introduction to IoT and data logging.',
    category: ProjectCategory.ENVIRONMENT,
    tags: ['sensors', 'cloud', 'dht11', 'bmp180', 'data-logging'],
    difficulty: DifficultyLevel.BEGINNER,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 119900, // ₹1,199
    estimatedBuildTimeMinutes: 120, // 2 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: false,
    isPublic: true,
    learningOutcomes: [
      'Sensor data reading',
      'Cloud API integration',
      'Data visualization',
      'IoT fundamentals',
    ],
    prerequisites: ['Basic Arduino', 'Internet connection'],
    publishedAt: new Date(),
  },
  {
    title: 'Obstacle Avoiding Robot Car',
    slug: 'obstacle-avoiding-robot-car',
    summary: 'Autonomous robot that navigates and avoids obstacles using ultrasonic sensors.',
    description: 'Build a smart robot car that can detect and avoid obstacles automatically. Uses HC-SR04 ultrasonic sensor for distance measurement and L298N motor driver for movement control. Great beginner robotics project!',
    category: ProjectCategory.ROBOTICS,
    tags: ['arduino', 'ultrasonic', 'robot-car', 'autonomous', 'beginner'],
    difficulty: DifficultyLevel.BEGINNER,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 139900, // ₹1,399
    estimatedBuildTimeMinutes: 150, // 2.5 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: true,
    isPublic: true,
    learningOutcomes: [
      'Ultrasonic sensor usage',
      'Obstacle detection algorithm',
      'Motor control basics',
      'Robot navigation logic',
    ],
    prerequisites: ['Basic Arduino programming'],
    publishedAt: new Date(),
  },
  {
    title: 'Bluetooth Controlled LED Matrix Display',
    slug: 'bluetooth-led-matrix-display',
    summary: 'Control a scrolling LED matrix display from your smartphone via Bluetooth.',
    description: 'Create an 8x8 LED matrix display that shows custom messages and animations controlled from your smartphone. Uses MAX7219 LED driver and HC-05 Bluetooth module. Learn about LED matrix control and Bluetooth communication.',
    category: ProjectCategory.EDUCATION,
    tags: ['led-matrix', 'bluetooth', 'max7219', 'smartphone', 'display'],
    difficulty: DifficultyLevel.INTERMEDIATE,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 89900, // ₹899
    estimatedBuildTimeMinutes: 180, // 3 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: false,
    isPublic: true,
    learningOutcomes: [
      'LED matrix control',
      'Bluetooth communication',
      'Mobile app interfacing',
      'Animation programming',
    ],
    prerequisites: ['Arduino basics', 'Bluetooth-enabled phone'],
    publishedAt: new Date(),
  },
  {
    title: 'Smart Plant Watering System',
    slug: 'smart-plant-watering-system',
    summary: 'Automated plant irrigation system based on soil moisture levels.',
    description: 'Build an IoT-based automatic plant watering system that monitors soil moisture and waters plants when needed. Uses soil moisture sensor, water pump, and relay module. Can be controlled remotely via WiFi.',
    category: ProjectCategory.AGRICULTURE,
    tags: ['soil-moisture', 'pump', 'automation', 'iot', 'plants'],
    difficulty: DifficultyLevel.BEGINNER,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 99900, // ₹999
    estimatedBuildTimeMinutes: 120, // 2 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: true,
    isPublic: true,
    learningOutcomes: [
      'Soil moisture sensing',
      'Relay control',
      'Automatic irrigation',
      'IoT integration',
    ],
    prerequisites: ['Basic Arduino', 'Plant to water!'],
    publishedAt: new Date(),
  },
  {
    title: 'RFID Door Lock System',
    slug: 'rfid-door-lock-system',
    summary: 'Secure access control system using RFID cards and electromagnetic lock.',
    description: 'Build a security system that uses RFID cards for access control. Includes RFID reader, solenoid lock, and buzzer for feedback. Learn about RFID technology and security systems. Can store multiple authorized cards.',
    category: ProjectCategory.SECURITY,
    tags: ['rfid', 'security', 'lock', 'access-control', 'authentication'],
    difficulty: DifficultyLevel.INTERMEDIATE,
    projectType: ProjectType.FEATURED,
    estimatedCostCents: 179900, // ₹1,799
    estimatedBuildTimeMinutes: 240, // 4 hours
    thumbnailUrl: 'https://cdn.pixabay.com/photo/2017/03/23/12/32/arduino-2168193_1280.png',
    isFeatured: false,
    isPublic: true,
    learningOutcomes: [
      'RFID technology',
      'Security systems',
      'Solenoid control',
      'User authentication',
    ],
    prerequisites: ['Arduino intermediate', 'Basic electronics'],
    publishedAt: new Date(),
  },
];

async function seedProjects() {
  console.log('🌱 Seeding projects...');

  try {
    for (const project of sampleProjects) {
      const existing = await prisma.project.findUnique({
        where: { slug: project.slug },
      });

      if (existing) {
        console.log(`⏭️  Skipping ${project.title} (already exists)`);
        continue;
      }

      await prisma.project.create({ data: project });
      console.log(`✅ Created ${project.title}`);
    }

    console.log('\n✨ Project seeding complete!');
  } catch (error) {
    console.error('❌ Error seeding projects:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedProjects();
