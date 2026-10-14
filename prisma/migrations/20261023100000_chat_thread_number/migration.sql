-- Короткий номер обсуждения для команды /t в мессенджере.
ALTER TABLE "ChatThread" ADD COLUMN "number" SERIAL NOT NULL;
CREATE UNIQUE INDEX "ChatThread_number_key" ON "ChatThread"("number");
