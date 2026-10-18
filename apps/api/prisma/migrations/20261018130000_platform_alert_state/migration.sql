-- CreateTable
CREATE TABLE "platform_alert_states" (
    "key" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "alertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_alert_states_pkey" PRIMARY KEY ("key")
);
