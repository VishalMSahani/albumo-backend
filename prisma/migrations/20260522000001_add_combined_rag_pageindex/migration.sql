-- Enable extensions required by combined catalog RAG and PageIndex-style retrieval.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE "RagChunkSourceType" AS ENUM ('COMPONENT', 'PROJECT', 'FAQ', 'SHORT_POLICY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RagDocumentSourceType" AS ENUM ('MANUAL', 'DATASHEET', 'POLICY', 'TUTORIAL', 'PROJECT_REPORT', 'COURSE_MATERIAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ComponentRelationType" AS ENUM ('COMPATIBLE_WITH', 'INCLUDES', 'UPGRADE_OF', 'FREQUENTLY_BOUGHT_WITH', 'REQUIRES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "RagChunk" (
  "id" TEXT NOT NULL,
  "sourceType" "RagChunkSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "chunkText" TEXT NOT NULL,
  "metadata" JSONB,
  "embedding" vector(1024),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RagChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sourceType" "RagDocumentSourceType" NOT NULL,
  "sourceId" TEXT,
  "fileUrl" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DocumentNode" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "parentId" TEXT,
  "nodeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "fullText" TEXT,
  "startPage" INTEGER,
  "endPage" INTEGER,
  "startIndex" INTEGER,
  "endIndex" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComponentRelation" (
  "id" TEXT NOT NULL,
  "sourceComponentId" TEXT NOT NULL,
  "targetComponentId" TEXT NOT NULL,
  "type" "ComponentRelationType" NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ComponentRelation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RagChunk_sourceType_sourceId_idx" ON "RagChunk"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "RagChunk_createdAt_idx" ON "RagChunk"("createdAt");
CREATE INDEX IF NOT EXISTS "RagChunk_embedding_idx" ON "RagChunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS "RagChunk_chunkText_trgm_idx" ON "RagChunk" USING GIN ("chunkText" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Document_sourceType_idx" ON "Document"("sourceType");
CREATE INDEX IF NOT EXISTS "Document_sourceId_idx" ON "Document"("sourceId");
CREATE INDEX IF NOT EXISTS "Document_createdAt_idx" ON "Document"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentNode_documentId_nodeId_key" ON "DocumentNode"("documentId", "nodeId");
CREATE INDEX IF NOT EXISTS "DocumentNode_documentId_idx" ON "DocumentNode"("documentId");
CREATE INDEX IF NOT EXISTS "DocumentNode_parentId_idx" ON "DocumentNode"("parentId");
CREATE INDEX IF NOT EXISTS "DocumentNode_documentId_parentId_sortOrder_idx" ON "DocumentNode"("documentId", "parentId", "sortOrder");
CREATE INDEX IF NOT EXISTS "DocumentNode_title_trgm_idx" ON "DocumentNode" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DocumentNode_summary_trgm_idx" ON "DocumentNode" USING GIN ("summary" gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS "ComponentRelation_sourceComponentId_targetComponentId_type_key" ON "ComponentRelation"("sourceComponentId", "targetComponentId", "type");
CREATE INDEX IF NOT EXISTS "ComponentRelation_sourceComponentId_type_idx" ON "ComponentRelation"("sourceComponentId", "type");
CREATE INDEX IF NOT EXISTS "ComponentRelation_targetComponentId_type_idx" ON "ComponentRelation"("targetComponentId", "type");
CREATE INDEX IF NOT EXISTS "ComponentRelation_type_idx" ON "ComponentRelation"("type");

DO $$ BEGIN
  ALTER TABLE "DocumentNode" ADD CONSTRAINT "DocumentNode_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentNode" ADD CONSTRAINT "DocumentNode_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "DocumentNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ComponentRelation" ADD CONSTRAINT "ComponentRelation_sourceComponentId_fkey"
    FOREIGN KEY ("sourceComponentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ComponentRelation" ADD CONSTRAINT "ComponentRelation_targetComponentId_fkey"
    FOREIGN KEY ("targetComponentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
