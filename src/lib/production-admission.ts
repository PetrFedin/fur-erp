import "server-only";

import { prisma } from "@/lib/prisma";
import reconciliation from "@/data/reconciliation.json";

const REQUIRED_TABLES = [
  "Organization",
  "User",
  "Purchase",
  "PurchaseItem",
  "Payment",
  "RawMaterialLot",
  "StockMovement",
  "ProductionOrder",
  "ProductionMaterialUsage",
  "ProductionPayment",
  "ProductionBatch",
  "DriveDocument",
] as const;

type ReconGroup = {
  id: string;
  title: string;
  status: "ok" | "docs" | "unpaid" | "review" | "conflict" | "empty";
  manualReview?: string[];
};

type ReconData = {
  checkedAt: string;
  groups: ReconGroup[];
};

const REC = reconciliation as unknown as ReconData;

function ageDays(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export async function getProductionAdmission() {
  const queue = {
    ok: 0,
    docs: 0,
    unpaid: 0,
    review: 0,
    conflict: 0,
    empty: 0,
  } satisfies Record<ReconGroup["status"], number>;

  const manualItems: { id: string; title: string; questions: string[] }[] = [];
  for (const g of REC.groups) {
    queue[g.status] += 1;
    if (g.manualReview?.length) manualItems.push({ id: g.id, title: g.title, questions: g.manualReview });
  }

  const reconciliationAgeDays = ageDays(REC.checkedAt);
  const reconciliationFresh = reconciliationAgeDays != null && reconciliationAgeDays <= 30;

  let dbError: string | null = null;
  let tables: string[] = [];
  let failedMigrations: string[] = [];
  let migrationCount = 0;
  let counts = {
    organizations: 0,
    users: 0,
    purchases: 0,
    purchasePayments: 0,
    lots: 0,
    stockMovements: 0,
    productionOrders: 0,
    productionPayments: 0,
    driveDocuments: 0,
    driveDocumentsWithFile: 0,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    tables = rows.map((r) => r.table_name);

    const [
      organizations,
      users,
      purchases,
      purchasePayments,
      lots,
      stockMovements,
      productionOrders,
      productionPayments,
      driveDocuments,
      driveDocumentsWithFile,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.purchase.count(),
      prisma.payment.count(),
      prisma.rawMaterialLot.count(),
      prisma.stockMovement.count(),
      prisma.productionOrder.count(),
      prisma.productionPayment.count(),
      prisma.driveDocument.count(),
      prisma.driveDocument.count({ where: { storagePath: { not: null } } }),
    ]);

    counts = {
      organizations,
      users,
      purchases,
      purchasePayments,
      lots,
      stockMovements,
      productionOrders,
      productionPayments,
      driveDocuments,
      driveDocumentsWithFile,
    };

    try {
      const migrations = await prisma.$queryRaw<
        Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
      >`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at
      `;
      migrationCount = migrations.length;
      failedMigrations = migrations
        .filter((m) => m.finished_at == null && m.rolled_back_at == null)
        .map((m) => m.migration_name);
    } catch {
      failedMigrations = ["_prisma_migrations недоступна"];
    }
  } catch (error) {
    dbError = error instanceof Error ? error.message : String(error);
  }

  const missingTables = REQUIRED_TABLES.filter((name) => !tables.includes(name));
  const databaseReady = !dbError && missingTables.length === 0 && failedMigrations.length === 0;
  const coreDataReady =
    counts.organizations > 0 &&
    counts.users > 0 &&
    counts.purchases > 0 &&
    counts.lots > 0 &&
    counts.productionOrders > 0;

  // Документы без прикреплённого файла — не блокер выпуска: это список «что прикрепить позже».
  const attachedShare =
    counts.driveDocuments > 0 ? counts.driveDocumentsWithFile / counts.driveDocuments : 0;

  const reconciliationReady = REC.groups.length > 0 && reconciliationFresh;
  const productionReady = databaseReady && coreDataReady && reconciliationReady;

  const blockers: string[] = [];
  if (dbError) blockers.push("DATABASE_UNREACHABLE");
  if (missingTables.length) blockers.push("DATABASE_SCHEMA_INCOMPLETE");
  if (failedMigrations.length) blockers.push("DATABASE_MIGRATION_FAILED");
  if (!coreDataReady) blockers.push("PRODUCTION_DATA_NOT_LOADED");
  if (!reconciliationReady) blockers.push("RECONCILIATION_DATASET_STALE_OR_EMPTY");

  return {
    production_ready: productionReady,
    checked_at: new Date().toISOString(),
    blockers,
    database: {
      ready: databaseReady,
      error: dbError,
      required_tables: REQUIRED_TABLES,
      missing_tables: missingTables,
      applied_migrations: migrationCount,
      failed_migrations: failedMigrations,
      counts,
    },
    documents: {
      total: counts.driveDocuments,
      attached: counts.driveDocumentsWithFile,
      attached_pct: Math.round(attachedShare * 10_000) / 100,
    },
    reconciliation: {
      ready: reconciliationReady,
      checked_at: REC.checkedAt,
      age_days: reconciliationAgeDays,
      tolerance_rub: 3.96,
      groups: REC.groups.length,
      queue,
      manual_review_items: manualItems,
      unresolved_groups: queue.unpaid + queue.review + queue.conflict,
    },
  };
}
