-- Operational admission metadata for deterministic database rebuilds.
CREATE TABLE "SystemState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemState_organizationId_key_key" ON "SystemState"("organizationId", "key");
CREATE INDEX "SystemState_organizationId_idx" ON "SystemState"("organizationId");

ALTER TABLE "SystemState"
ADD CONSTRAINT "SystemState_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
