-- Роль SUPPLIER (внешний поставщик) и привязка пользователя к поставщику.
ALTER TYPE "UserRole" ADD VALUE 'SUPPLIER';

ALTER TABLE "User" ADD COLUMN "supplierId" TEXT;

CREATE INDEX "User_supplierId_idx" ON "User"("supplierId");

ALTER TABLE "User" ADD CONSTRAINT "User_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
