-- Тематические группы чата: тип обсуждения GROUP, тема, участники; привязка группы платформы к Telegram-группе.
ALTER TYPE "ChatKind" ADD VALUE 'GROUP';
CREATE TYPE "ChatMemberRole" AS ENUM ('OWNER', 'MEMBER');
ALTER TABLE "ChatThread" ADD COLUMN "topic" TEXT;
ALTER TABLE "ChannelLink" ADD COLUMN "threadId" TEXT;
ALTER TABLE "ChannelBindCode" ADD COLUMN "threadId" TEXT;
CREATE TABLE "ChatMember" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatMemberRole" NOT NULL DEFAULT 'MEMBER',
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("threadId","userId")
);
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
