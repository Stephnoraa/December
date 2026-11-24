-- AlterTable
ALTER TABLE "StaffSession" ADD COLUMN     "refreshTokenHash" TEXT;

-- AlterTable
ALTER TABLE "CustomerSession" ADD COLUMN     "expiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "refreshTokenHash" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "PlatformAdminSession" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAdminSession_adminId_idx" ON "PlatformAdminSession"("adminId");

-- AddForeignKey
ALTER TABLE "PlatformAdminSession" ADD CONSTRAINT "PlatformAdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

