-- Чат с поставщиком (обсуждения, запросы, вложения, непрочитанное) и мост в Telegram/WhatsApp.
CREATE TYPE "ChatKind" AS ENUM ('GENERAL', 'REQUEST');
CREATE TYPE "ChatStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');
CREATE TYPE "ChatSide" AS ENUM ('INTERNAL', 'SUPPLIER', 'EXTERNAL');
CREATE TYPE "ChatSource" AS ENUM ('PLATFORM', 'TELEGRAM', 'WHATSAPP');
CREATE TYPE "ChannelType" AS ENUM ('TELEGRAM', 'WHATSAPP');
CREATE TYPE "ChannelLinkKind" AS ENUM ('PRIVATE', 'GROUP');

CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT,
    "kind" "ChatKind" NOT NULL DEFAULT 'GENERAL',
    "subject" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "entityHref" TEXT,
    "requestType" TEXT,
    "status" "ChatStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdBySide" "ChatSide" NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageSide" "ChatSide" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorSide" "ChatSide" NOT NULL,
    "body" TEXT NOT NULL,
    "source" "ChatSource" NOT NULL DEFAULT 'PLATFORM',
    "externalId" TEXT,
    "replyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatRead" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("threadId","userId")
);

CREATE TABLE "ChannelLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "userId" TEXT,
    "supplierId" TEXT,
    "externalChatId" TEXT NOT NULL,
    "externalUsername" TEXT,
    "kind" "ChannelLinkKind" NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelBindCode" (
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "supplierId" TEXT,
    "kind" "ChannelLinkKind" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelBindCode_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "ChannelDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "externalChatId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatThread_organizationId_supplierId_lastMessageAt_idx" ON "ChatThread"("organizationId", "supplierId", "lastMessageAt");
CREATE INDEX "ChatThread_entityType_entityId_idx" ON "ChatThread"("entityType", "entityId");
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");
CREATE UNIQUE INDEX "ChatMessage_source_externalId_key" ON "ChatMessage"("source", "externalId");
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");
CREATE INDEX "ChannelLink_organizationId_idx" ON "ChannelLink"("organizationId");
CREATE UNIQUE INDEX "ChannelLink_channel_externalChatId_key" ON "ChannelLink"("channel", "externalChatId");
CREATE UNIQUE INDEX "ChannelDelivery_messageId_channel_externalChatId_key" ON "ChannelDelivery"("messageId", "channel", "externalChatId");
CREATE UNIQUE INDEX "ChannelDelivery_channel_externalChatId_externalMessageId_key" ON "ChannelDelivery"("channel", "externalChatId", "externalMessageId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelDelivery" ADD CONSTRAINT "ChannelDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
