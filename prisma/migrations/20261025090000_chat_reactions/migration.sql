-- Реакции на сообщения чата.
CREATE TABLE "ChatMessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessageReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatMessageReaction_messageId_userId_emoji_key" ON "ChatMessageReaction"("messageId", "userId", "emoji");
CREATE INDEX "ChatMessageReaction_messageId_idx" ON "ChatMessageReaction"("messageId");
ALTER TABLE "ChatMessageReaction" ADD CONSTRAINT "ChatMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
