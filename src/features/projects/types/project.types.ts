/**
 * Project Types
 * Types and interfaces for the Projects feature module
 */

import { ProjectCategory, DifficultyLevel, ProjectType } from "../../../generated/prisma/enums.js";

// ============================================================================
// COMPONENT TYPES
// ============================================================================

/**
 * Component information for project creation/update
 */
export interface ProjectComponentInput {
  componentId: string;
  quantity: number;
  notes?: string; // Optional notes about component usage
}

/**
 * Component details in project response
 */
export interface ProjectComponentDetail {
  id: string;
  componentId: string;
  quantity: number;
  notes?: string;
  component: {
    id: string;
    name: string;
    sku?: string;
    description?: string;
    typicalUseCase?: string;
    vendorLink?: string;
    imageUrl?: string;
    unitPriceCents: number;
    unitPrice: number; // In rupees
    stockQuantity: number;
    isActive: boolean;
  };
  totalCost: number; // quantity * unitPrice (in rupees)
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

export interface CreateProjectRequest {
  // Basic Info
  title: string;
  slug?: string; // Auto-generated from title if not provided
  summary?: string;
  description: string;
  
  // Categorization
  category: ProjectCategory;
  tags?: string[];
  
  // Project Details
  difficulty: DifficultyLevel;
  projectType?: ProjectType;
  
  // Pricing & Time
  estimatedCostCents?: number;
  estimatedBuildTimeMinutes?: number;
  
  // Pre-Built Option
  preBuiltAvailable?: boolean;
  preBuiltStock?: number;
  preBuiltPriceCents?: number;
  preBuiltImages?: string[];
  
  // Media
  thumbnailUrl?: string;
  youtubeUrl?: string;
  
  // Learning Info
  learningOutcomes?: string[];
  prerequisites?: string[];
  
  // Visibility
  isFeatured?: boolean;
  isPublic?: boolean;
  
  // Relations
  defaultMentorId?: string;
  components?: ProjectComponentInput[]; // Components used in project with quantities
  componentIds?: string[]; // Backward compatibility - simple ID array (defaults to quantity 1)
}

export interface UpdateProjectRequest {
  title?: string;
  slug?: string;
  summary?: string;
  description?: string;
  
  category?: ProjectCategory;
  tags?: string[];
  
  difficulty?: DifficultyLevel;
  projectType?: ProjectType;
  
  estimatedCostCents?: number;
  estimatedBuildTimeMinutes?: number;
  
  preBuiltAvailable?: boolean;
  preBuiltStock?: number;
  preBuiltPriceCents?: number;
  preBuiltImages?: string[];
  
  thumbnailUrl?: string;
  youtubeUrl?: string;
  
  learningOutcomes?: string[];
  prerequisites?: string[];
  
  isFeatured?: boolean;
  isPublic?: boolean;
  
  defaultMentorId?: string;
  components?: ProjectComponentInput[]; // Update component list (replaces existing)
}

export interface ProjectFilters {
  // Category & Type
  category?: ProjectCategory | ProjectCategory[];
  difficulty?: DifficultyLevel | DifficultyLevel[];
  projectType?: ProjectType;
  
  // Tags
  tags?: string | string[];
  
  // Flags
  isFeatured?: boolean;
  isPublic?: boolean;
  isAIGenerated?: boolean;
  
  // Pre-Built
  preBuiltAvailable?: boolean;
  
  // Price Range
  minCost?: number;
  maxCost?: number;
  
  // Build Time Range
  minBuildTime?: number;
  maxBuildTime?: number;
  
  // Search
  search?: string; // Search in title, summary, description
  
  // Pagination
  page?: number;
  limit?: number;
  
  // Sorting
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'viewCount' | 'buildCount' | 'averageRating' | 'estimatedCostCents';
  sortOrder?: 'asc' | 'desc';
}

export interface UpdatePreBuiltStockRequest {
  projectId: string;
  stockChange: number; // Positive to add, negative to remove
  reason?: string;
}

export interface ProjectReviewRequest {
  projectId: string;
  rating: number; // 1-5
  review?: string;
  orderId?: string; // Link to purchase
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface ProjectResponse {
  id: string;
  title: string;
  slug: string;
  summary?: string;
  description?: string;
  
  category: ProjectCategory;
  categoryDisplay: string; // Human-readable category name
  tags: string[];
  
  difficulty: DifficultyLevel;
  difficultyDisplay: string;
  projectType: ProjectType;
  
  estimatedCostCents?: number;
  estimatedCost?: number; // In rupees
  estimatedBuildTimeMinutes?: number;
  estimatedBuildTimeDisplay?: string; // "2 hours" or "3 days"
  
  // Pre-Built Info
  preBuiltAvailable: boolean;
  preBuiltStock: number;
  preBuiltPriceCents?: number;
  preBuiltPrice?: number; // In rupees
  preBuiltImages: string[];
  preBuiltSavings?: number; // If pre-built is cheaper than building
  
  thumbnailUrl?: string;
  imageUrls: string[]; // Project gallery images (max 5)
  youtubeUrl?: string;
  youtubeEmbedUrl?: string; // Formatted for iframe
  pdfUrls: string[]; // PDF documentation URLs (max 5)
  externalLinks: Array<{title: string; url: string}>; // Notion, GitHub, etc.
  
  learningOutcomes: string[];
  prerequisites: string[];
  
  isFeatured: boolean;
  isPublic: boolean;
  isAIGenerated: boolean;
  publishedAt?: Date;
  
  // Stats
  viewCount: number;
  buildCount: number;
  averageRating: number;
  
  // Relations
  createdBy?: {
    id: string;
    name?: string;
    email: string;
  };
  defaultMentor?: {
    id: string;
    name: string;
    expertise: string[];
  };
  components?: ProjectComponentDetail[]; // List of required components
  
  // Computed
  componentsCount?: number;
  totalComponentsCost?: number; // Sum of all component costs (in rupees)
  
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectListResponse {
  projects: ProjectResponse[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters?: {
    categories: Array<{ category: ProjectCategory; count: number }>;
    difficulties: Array<{ difficulty: DifficultyLevel; count: number }>;
    priceRange: { min: number; max: number };
  };
}

export interface ProjectDetailResponse extends Omit<ProjectResponse, 'components'> {
  // Full components list with complete details
  components: ProjectComponentDetail[];
  
  // Assets (PDFs, diagrams, code)
  assets: Array<{
    id: string;
    assetType: string;
    url: string;
    description?: string;
    isLocked: boolean; // Locked until purchase
  }>;
  
  // Steps/Instructions
  steps: Array<{
    id: string;
    stepNumber: number;
    title: string;
    bodyMarkdown: string;
    pdfUrl?: string;
  }>;
  
  // Mentor assigned
  mentors: Array<{
    id: string;
    name: string;
    role: string; // PRIMARY or SECONDARY
    expertise: string[];
  }>;
  
  // Related projects
  relatedProjects: Array<{
    id: string;
    title: string;
    slug: string;
    thumbnailUrl?: string;
    category: ProjectCategory;
    difficulty: DifficultyLevel;
    estimatedCost?: number;
  }>;
}

export interface CategoryStatsResponse {
  category: ProjectCategory;
  displayName: string;
  description: string;
  icon: string; // Icon name or emoji
  projectCount: number;
  averageCost: number;
  popularTags: string[];
  featuredProjects: Array<{
    id: string;
    title: string;
    slug: string;
    thumbnailUrl?: string;
  }>;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface ProjectAccessCheck {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canViewAssets: boolean; // Has purchased or is admin
  reason?: string;
}

export interface CategoryInfo {
  value: ProjectCategory;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const CATEGORY_INFO: Record<ProjectCategory, Omit<CategoryInfo, 'value'>> = {
  IOT: {
    label: 'Internet of Things (IoT)',
    description: 'Connected devices and smart systems',
    icon: '🌐',
    keywords: ['wifi', 'bluetooth', 'sensors', 'mqtt', 'cloud', 'iot']
  },
  ROBOTICS: {
    label: 'Robotics',
    description: 'Robots, robotic arms, and automated systems',
    icon: '🤖',
    keywords: ['robot', 'servo', 'motor', 'arm', 'wheels', 'autonomous']
  },
  DRONE: {
    label: 'Drones & UAVs',
    description: 'Flying robots and aerial vehicles',
    icon: '🚁',
    keywords: ['drone', 'quadcopter', 'uav', 'flight', 'aerial', 'fpv']
  },
  AUTOMATION: {
    label: 'Automation',
    description: 'Home and industrial automation systems',
    icon: '⚙️',
    keywords: ['automation', 'control', 'relay', 'switch', 'timer']
  },
  ENVIRONMENT: {
    label: 'Environment & Green Tech',
    description: 'Environmental monitoring and sustainability',
    icon: '🌱',
    keywords: ['environment', 'air quality', 'pollution', 'weather', 'climate']
  },
  HEALTH: {
    label: 'Healthcare & Medical',
    description: 'Medical devices and health monitoring',
    icon: '🏥',
    keywords: ['health', 'medical', 'heartbeat', 'temperature', 'pulse']
  },
  AGRICULTURE: {
    label: 'Agriculture & Farming',
    description: 'Smart farming and agricultural technology',
    icon: '🌾',
    keywords: ['farming', 'irrigation', 'soil', 'agriculture', 'crop']
  },
  SECURITY: {
    label: 'Security & Surveillance',
    description: 'Security systems and monitoring',
    icon: '🔒',
    keywords: ['security', 'camera', 'alarm', 'surveillance', 'access']
  },
  EDUCATION: {
    label: 'Educational Tools',
    description: 'Learning kits and educational projects',
    icon: '📚',
    keywords: ['learning', 'education', 'teaching', 'beginner', 'kit']
  },
  AUTOMOTIVE: {
    label: 'Automotive',
    description: 'Car technology and vehicle automation',
    icon: '🚗',
    keywords: ['car', 'vehicle', 'automotive', 'transport', 'gps']
  },
  SMART_HOME: {
    label: 'Smart Home',
    description: 'Home automation and smart devices',
    icon: '🏠',
    keywords: ['home', 'smart', 'alexa', 'google', 'voice', 'lights']
  },
  ENERGY: {
    label: 'Energy & Power',
    description: 'Renewable energy and power management',
    icon: '⚡',
    keywords: ['solar', 'energy', 'power', 'battery', 'renewable', 'wind']
  },
  WEARABLES: {
    label: 'Wearable Tech',
    description: 'Wearable devices and smart accessories',
    icon: '⌚',
    keywords: ['wearable', 'watch', 'fitness', 'tracker', 'band']
  },
  GAMING: {
    label: 'Gaming & Entertainment',
    description: 'Gaming controllers and entertainment systems',
    icon: '🎮',
    keywords: ['game', 'gaming', 'controller', 'joystick', 'vr', 'ar']
  },
  MUSIC: {
    label: 'Music & Audio',
    description: 'Musical instruments and audio technology',
    icon: '🎵',
    keywords: ['music', 'audio', 'sound', 'instrument', 'speaker', 'midi']
  },
  COMMUNICATION: {
    label: 'Communication',
    description: 'RF, wireless, and communication systems',
    icon: '📡',
    keywords: ['rf', 'wireless', 'communication', 'radio', 'lora', 'zigbee']
  },
  AI_ML: {
    label: 'AI & Machine Learning',
    description: 'Artificial intelligence and ML projects',
    icon: '🧠',
    keywords: ['ai', 'ml', 'machine learning', 'neural', 'tensorflow']
  },
  COMPUTER_VISION: {
    label: 'Computer Vision',
    description: 'Image processing and object detection',
    icon: '👁️',
    keywords: ['vision', 'camera', 'image', 'detection', 'opencv', 'recognition']
  },
  OTHER: {
    label: 'Other Projects',
    description: 'Miscellaneous projects',
    icon: '📦',
    keywords: ['other', 'misc', 'various']
  }
};

export const DIFFICULTY_DISPLAY: Record<DifficultyLevel, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced'
};
