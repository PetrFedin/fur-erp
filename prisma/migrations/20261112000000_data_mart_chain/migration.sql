-- CreateTable
CREATE TABLE "DmPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "isContractor" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "orderDate" DATE NOT NULL,
    "receivedDate" DATE,
    "invoiceNumber" TEXT,
    "invoiceDate" DATE,
    "transferDoc" TEXT,
    "auction" TEXT,
    "itemsSum" DECIMAL(18,2) NOT NULL,
    "expensesSum" DECIMAL(18,2) NOT NULL,
    "lotsCostSum" DECIMAL(18,2) NOT NULL,
    "paidSum" DECIMAL(18,2) NOT NULL,
    "lotsCount" INTEGER NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "lotNumber" TEXT,
    "purchaseId" TEXT,
    "material" TEXT NOT NULL,
    "category" TEXT,
    "colorCanon" TEXT,
    "grade" TEXT,
    "sizeGrade" TEXT,
    "warehouse" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "qtyReceived" DECIMAL(18,3) NOT NULL,
    "qtyRemaining" DECIMAL(18,3) NOT NULL,
    "qtyUsed" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(8,4) NOT NULL,
    "materialExcl" DECIMAL(18,2) NOT NULL,
    "expenseExcl" DECIMAL(18,2) NOT NULL,
    "usedCost" DECIMAL(18,2) NOT NULL,
    "ordersCount" INTEGER NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmLotUse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "usageId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "model" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "commission4" BOOLEAN NOT NULL,

    CONSTRAINT "DmLotUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "flow" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "purchaseId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" TEXT,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paidAt" DATE NOT NULL,
    "docRef" TEXT,
    "invoiceNo" TEXT,
    "ppNo" TEXT,
    "confirmed" BOOLEAN NOT NULL,
    "allocated" DECIMAL(18,2) NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmPaymentAlloc" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "DmPaymentAlloc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmOrderExpense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,

    CONSTRAINT "DmOrderExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DmPurchase_organizationId_supplierId_idx" ON "DmPurchase"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "DmPurchase_organizationId_purchaseId_key" ON "DmPurchase"("organizationId", "purchaseId");

-- CreateIndex
CREATE INDEX "DmLot_organizationId_purchaseId_idx" ON "DmLot"("organizationId", "purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "DmLot_organizationId_lotId_key" ON "DmLot"("organizationId", "lotId");

-- CreateIndex
CREATE INDEX "DmLotUse_organizationId_lotId_idx" ON "DmLotUse"("organizationId", "lotId");

-- CreateIndex
CREATE INDEX "DmLotUse_organizationId_orderId_idx" ON "DmLotUse"("organizationId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DmLotUse_organizationId_usageId_key" ON "DmLotUse"("organizationId", "usageId");

-- CreateIndex
CREATE INDEX "DmPayment_organizationId_purchaseId_idx" ON "DmPayment"("organizationId", "purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "DmPayment_organizationId_flow_paymentId_key" ON "DmPayment"("organizationId", "flow", "paymentId");

-- CreateIndex
CREATE INDEX "DmPaymentAlloc_organizationId_paymentId_idx" ON "DmPaymentAlloc"("organizationId", "paymentId");

-- CreateIndex
CREATE INDEX "DmPaymentAlloc_organizationId_orderId_idx" ON "DmPaymentAlloc"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "DmOrderExpense_organizationId_orderId_idx" ON "DmOrderExpense"("organizationId", "orderId");

