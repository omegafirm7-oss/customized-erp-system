-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('CHANNEL', 'DIRECT');

-- CreateTable
CREATE TABLE "chat_channels" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ChatChannelKind" NOT NULL DEFAULT 'CHANNEL',
    "name" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "dmKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_members" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_channels_companyId_lastMessageAt_idx" ON "chat_channels"("companyId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_channels_companyId_dmKey_key" ON "chat_channels"("companyId", "dmKey");

-- CreateIndex
CREATE UNIQUE INDEX "chat_channels_companyId_name_key" ON "chat_channels"("companyId", "name");

-- CreateIndex
CREATE INDEX "chat_members_userId_idx" ON "chat_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_members_channelId_userId_key" ON "chat_members"("channelId", "userId");

-- CreateIndex
CREATE INDEX "chat_messages_channelId_createdAt_idx" ON "chat_messages"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_channelId_updatedAt_idx" ON "chat_messages"("channelId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_attachments_messageId_key" ON "chat_attachments"("messageId");

-- AddForeignKey
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
