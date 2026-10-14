-- Мои форматы расчёта аукциона (кабинет Веллмеха): набор столбцов, формул и параметров под своим именем.
CREATE TABLE "SupplierCalcTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCalcTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierCalcTemplate_organizationId_supplierId_idx" ON "SupplierCalcTemplate"("organizationId", "supplierId");
