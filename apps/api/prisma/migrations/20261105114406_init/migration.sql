-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('CUSTOMER', 'STAFF', 'PLATFORM');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED', 'DELETED');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('MALL', 'AIRPORT', 'RAILWAY', 'HOSPITAL', 'OFFICE', 'RESIDENTIAL', 'HOTEL', 'RESTAURANT', 'PUBLIC', 'EVENT', 'CORPORATE', 'GARAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "OccupancyMode" AS ENUM ('SLOT_BASED', 'CAPACITY_BASED');

-- CreateEnum
CREATE TYPE "SlotState" AS ENUM ('AVAILABLE', 'HELD', 'RESERVED', 'OCCUPIED', 'BLOCKED', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "VehicleClass" AS ENUM ('TWO_WHEELER', 'CAR', 'SUV', 'LCV', 'BUS', 'TRUCK', 'EV_CAR', 'EV_TWO_WHEELER');

-- CreateEnum
CREATE TYPE "GateDirection" AS ENUM ('ENTRY', 'EXIT', 'BOTH');

-- CreateEnum
CREATE TYPE "GateStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('CREATED', 'ENTRY_PENDING', 'ACTIVE', 'PAYMENT_PENDING', 'EXIT_READY', 'EXIT_IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "SessionSource" AS ENUM ('WALK_IN', 'RESERVATION', 'PASS', 'CORPORATE', 'VALET');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('QR', 'PLATE_MANUAL', 'PLATE_ANPR', 'TICKET', 'RFID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'NETBANKING', 'WALLET', 'FASTAG', 'CORPORATE_BILLING', 'PASS');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('PARKING_SESSION', 'RESERVATION', 'PASS', 'SAAS_SUBSCRIPTION', 'CORPORATE_INVOICE');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "RateRuleKind" AS ENUM ('FIXED_ENTRY', 'HOURLY', 'PER_MINUTE', 'DAILY_CAP', 'DAILY', 'OVERNIGHT', 'LOST_TICKET', 'VALET', 'EV_SURCHARGE');

-- CreateEnum
CREATE TYPE "RateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FLAT', 'FREE_MINUTES');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "OverrideType" AS ENUM ('LOST_TICKET', 'FEE_WAIVER', 'FEE_ADJUSTMENT', 'PLATE_CORRECTION', 'MANUAL_BARRIER_OPEN', 'FORCE_EXIT', 'CAPACITY_OVERRIDE', 'ANPR_REVIEW');

-- CreateEnum
CREATE TYPE "OverrideStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('ANPR_CAMERA', 'QR_SCANNER', 'RFID_READER', 'BARRIER', 'SLOT_SENSOR', 'LED_DISPLAY', 'PRINTER', 'PAYMENT_TERMINAL', 'EV_CHARGER', 'KIOSK');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PROVISIONED', 'ONLINE', 'OFFLINE', 'FAULT', 'RETIRED');

-- CreateEnum
CREATE TYPE "BarrierCommandStatus" AS ENUM ('PENDING', 'SENT', 'ACKED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "AnprReviewStatus" AS ENUM ('AUTO_MATCHED', 'PENDING_REVIEW', 'CONFIRMED', 'CORRECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PassKind" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'EMPLOYEE', 'RESIDENT', 'FLEET', 'RESERVED_SLOT');

-- CreateEnum
CREATE TYPE "ValetStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'RECEIVED', 'PARKED', 'RETRIEVAL_REQUESTED', 'RETRIEVING', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "kind" "UserKind" NOT NULL DEFAULT 'CUSTOMER',
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "profileComplete" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT,
    "gstin" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMember" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "facilityIds" UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthlyMinor" INTEGER NOT NULL,
    "priceYearlyMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEntitlement" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "SubscriptionEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "currentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingFacility" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cityId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL DEFAULT 'PUBLIC',
    "occupancyMode" "OccupancyMode" NOT NULL DEFAULT 'CAPACITY_BASED',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "addressLine" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "open24h" BOOLEAN NOT NULL DEFAULT true,
    "openingHours" JSONB,
    "covered" BOOLEAN NOT NULL DEFAULT false,
    "hasEv" BOOLEAN NOT NULL DEFAULT false,
    "hasValet" BOOLEAN NOT NULL DEFAULT false,
    "heightLimitCm" INTEGER,
    "reservable" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "photos" TEXT[],
    "rules" TEXT,
    "cancellationPolicy" JSONB,
    "offlineMaxProvisionalEntries" INTEGER NOT NULL DEFAULT 50,
    "anprConfidenceThreshold" DECIMAL(4,3) NOT NULL DEFAULT 0.90,
    "failSafeBarrierPolicy" TEXT NOT NULL DEFAULT 'FAIL_CLOSED',
    "plateCountry" TEXT NOT NULL DEFAULT 'IN',
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "reservationHoldMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingBuilding" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ParkingBuilding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingFloor" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "buildingId" UUID,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,

    CONSTRAINT "ParkingFloor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingZone" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "floorId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleClasses" "VehicleClass"[],
    "isEv" BOOLEAN NOT NULL DEFAULT false,
    "isAccessible" BOOLEAN NOT NULL DEFAULT false,
    "isReservedOnly" BOOLEAN NOT NULL DEFAULT false,
    "isStaffOnly" BOOLEAN NOT NULL DEFAULT false,
    "isCorporate" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB,

    CONSTRAINT "ParkingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingSlot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "row" TEXT,
    "position" INTEGER,
    "vehicleClass" "VehicleClass" NOT NULL,
    "state" "SlotState" NOT NULL DEFAULT 'AVAILABLE',
    "isEv" BOOLEAN NOT NULL DEFAULT false,
    "isAccessible" BOOLEAN NOT NULL DEFAULT false,
    "sensorDeviceId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingGate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "GateDirection" NOT NULL,
    "status" "GateStatus" NOT NULL DEFAULT 'ONLINE',
    "lastHeartbeatAt" TIMESTAMPTZ(3),

    CONSTRAINT "ParkingGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingCapacityPool" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "totalCapacity" INTEGER NOT NULL,
    "occupied" INTEGER NOT NULL DEFAULT 0,
    "reservedHeld" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "reservableCapacity" INTEGER NOT NULL DEFAULT 0,
    "sensorCount" INTEGER,
    "sensorReportedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingCapacityPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingRestriction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "ParkingRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingAmenity" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "ParkingAmenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityReview" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleType" (
    "id" UUID NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT,

    CONSTRAINT "VehicleType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "plateDisplay" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "vehicleClass" "VehicleClass" NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "color" TEXT,
    "isEv" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleOwner" (
    "userId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "nickname" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleOwner_pkey" PRIMARY KEY ("userId","vehicleId")
);

-- CreateTable
CREATE TABLE "VehicleWhitelist" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID,
    "corporateId" UUID,
    "plateNormalized" TEXT NOT NULL,
    "reason" TEXT,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleBlacklist" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleBlacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingRatePlan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingRatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingRateVersion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "definition" JSONB NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingRateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingRateRule" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "kind" "RateRuleKind" NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ParkingRateRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingCoupon" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "code" TEXT NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "maxDiscountMinor" INTEGER,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "maxRedemptions" INTEGER,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "facilityIds" UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingDiscount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionId" UUID,
    "reservationId" UUID,
    "couponId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingReservation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "slotId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "prepaid" BOOLEAN NOT NULL DEFAULT true,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationPriceSnapshot" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "rateVersionId" UUID NOT NULL,
    "breakdown" JSONB NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationStatusHistory" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "from" "ReservationStatus",
    "to" "ReservationStatus" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "vehicleId" UUID,
    "plateNormalized" TEXT NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'CREATED',
    "source" "SessionSource" NOT NULL,
    "reservationId" UUID,
    "passId" UUID,
    "corporateId" UUID,
    "rateVersionId" UUID,
    "entryAt" TIMESTAMPTZ(3) NOT NULL,
    "exitAt" TIMESTAMPTZ(3),
    "amountDueMinor" INTEGER NOT NULL DEFAULT 0,
    "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "isLostTicket" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingSessionEvent" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from" "SessionStatus",
    "to" "SessionStatus",
    "actorId" UUID,
    "deviceId" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingEntry" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "gateId" UUID,
    "credentialType" "CredentialType" NOT NULL,
    "staffUserId" UUID,
    "deviceId" UUID,
    "photoKey" TEXT,
    "anprEventId" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingExit" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "gateId" UUID,
    "credentialType" "CredentialType" NOT NULL,
    "staffUserId" UUID,
    "deviceId" UUID,
    "photoKey" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingExit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingTicket" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lost" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ParkingTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingAssignment" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ParkingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingFeeCalculation" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "rateVersionId" UUID,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billedUntil" TIMESTAMPTZ(3) NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "ParkingFeeCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingSessionAdjustment" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "overrideId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingSessionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "purpose" "PaymentPurpose" NOT NULL,
    "sessionId" UUID,
    "reservationId" UUID,
    "passId" UUID,
    "subscriptionInvoiceId" UUID,
    "userId" UUID,
    "method" "PaymentMethod",
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "collectedByUserId" UUID,
    "shiftId" UUID,
    "succeededAt" TIMESTAMPTZ(3),
    "receiptNumber" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "providerPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "method" "PaymentMethod",
    "errorCode" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "tenantId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "requestedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paymentId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "pdfKey" TEXT,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialLedgerAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,

    CONSTRAINT "FinancialLedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialLedgerEntry" (
    "id" UUID NOT NULL,
    "txnId" UUID NOT NULL,
    "tenantId" UUID,
    "accountId" UUID NOT NULL,
    "debitMinor" INTEGER NOT NULL DEFAULT 0,
    "creditMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "refType" TEXT NOT NULL,
    "refId" UUID NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "refundsMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(3),
    "utr" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "kind" TEXT NOT NULL,
    "refId" UUID,
    "expected" INTEGER NOT NULL,
    "actual" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "purpose" "PaymentPurpose" NOT NULL,
    "percentBp" INTEGER NOT NULL,
    "flatMinor" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "employeeCode" TEXT,
    "pinHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffShift" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gateId" UUID,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "openingFloatMinor" INTEGER NOT NULL DEFAULT 0,
    "expectedCashMinor" INTEGER,
    "declaredCashMinor" INTEGER,
    "varianceMinor" INTEGER,
    "notes" TEXT,
    "reconciledById" UUID,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCashRecord" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "paymentId" UUID,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftCashRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "gateId" UUID,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffActivity" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "facilityId" UUID,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorOverride" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "type" "OverrideType" NOT NULL,
    "status" "OverrideStatus" NOT NULL DEFAULT 'REQUESTED',
    "sessionId" UUID,
    "gateId" UUID,
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SupervisorOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HardwareDevice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "gateId" UUID,
    "kind" "DeviceKind" NOT NULL,
    "vendor" TEXT NOT NULL,
    "model" TEXT,
    "serial" TEXT,
    "adapter" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "DeviceStatus" NOT NULL DEFAULT 'PROVISIONED',
    "lastSeenAt" TIMESTAMPTZ(3),
    "firmware" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HardwareDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCredential" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraRecognitionEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "gateId" UUID,
    "deviceId" UUID NOT NULL,
    "deviceEventId" UUID NOT NULL,
    "direction" "GateDirection" NOT NULL,
    "plateRaw" TEXT NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "imageKey" TEXT,
    "reviewStatus" "AnprReviewStatus" NOT NULL,
    "reviewedById" UUID,
    "correctedPlate" TEXT,
    "sessionId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraRecognitionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarrierCommand" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "gateId" UUID NOT NULL,
    "deviceId" UUID,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sessionId" UUID,
    "overrideId" UUID,
    "requestedById" UUID,
    "status" "BarrierCommandStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "ackedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BarrierCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensorReading" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "slotId" UUID,
    "occupied" BOOLEAN,
    "count" INTEGER,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SensorReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HardwareAlert" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HardwareAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineSyncBatch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "deviceId" UUID,
    "userId" UUID,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventCount" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "conflicts" INTEGER NOT NULL,
    "results" JSONB NOT NULL,

    CONSTRAINT "OfflineSyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingPassPlan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PassKind" NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "facilityIds" UUID[],
    "maxEntriesPerDay" INTEGER,
    "allowedWindows" JSONB,
    "maxVehicles" INTEGER NOT NULL DEFAULT 1,
    "reservedSlot" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingPassPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingPass" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "userId" UUID,
    "corporateId" UUID,
    "number" TEXT NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "slotId" UUID,
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingPassVehicle" (
    "passId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingPassVehicle_pkey" PRIMARY KEY ("passId","vehicleId")
);

-- CreateTable
CREATE TABLE "ParkingPassUsage" (
    "id" UUID NOT NULL,
    "passId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL,
    "exitedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ParkingPassUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValetRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "status" "ValetStatus" NOT NULL DEFAULT 'REQUESTED',
    "keyTag" TEXT,
    "parkedLocation" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievalRequestedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "customerConfirmedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ValetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValetAssignment" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ValetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleHandover" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "staffId" UUID NOT NULL,
    "odometer" INTEGER,
    "fuelLevel" TEXT,
    "notes" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyCustodyRecord" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "holderId" UUID NOT NULL,
    "location" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyCustodyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleConditionPhoto" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "takenById" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleConditionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "billingEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateMember" (
    "id" UUID NOT NULL,
    "corporateId" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "employeeCode" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vehiclePlates" TEXT[],

    CONSTRAINT "CorporateMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateContract" (
    "id" UUID NOT NULL,
    "corporateId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "billing" TEXT NOT NULL DEFAULT 'MONTHLY_POSTPAID',
    "ratePerSessionMinor" INTEGER,
    "monthlyFeeMinor" INTEGER,
    "maxConcurrent" INTEGER NOT NULL,

    CONSTRAINT "CorporateContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateAllocation" (
    "id" UUID NOT NULL,
    "corporateId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "units" INTEGER NOT NULL,
    "inUse" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CorporateAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateInvoice" (
    "id" UUID NOT NULL,
    "corporateId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "refType" TEXT,
    "refId" UUID,
    "assigneeId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "reportedById" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'LOW',
    "description" TEXT NOT NULL,
    "sessionId" UUID,
    "photoKeys" TEXT[],
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorId" UUID,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_familyId_idx" ON "UserSession"("familyId");

-- CreateIndex
CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON "OtpChallenge"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "TenantMember_userId_idx" ON "TenantMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMember_tenantId_userId_key" ON "TenantMember"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEntitlement_planId_key_key" ON "SubscriptionEntitlement"("planId", "key");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_idx" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_number_key" ON "SubscriptionInvoice"("number");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_tenantId_idx" ON "SubscriptionInvoice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "City_name_state_country_key" ON "City"("name", "state", "country");

-- CreateIndex
CREATE INDEX "ParkingFacility_tenantId_idx" ON "ParkingFacility"("tenantId");

-- CreateIndex
CREATE INDEX "ParkingFacility_cityId_idx" ON "ParkingFacility"("cityId");

-- CreateIndex
CREATE INDEX "ParkingFacility_latitude_longitude_idx" ON "ParkingFacility"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingFacility_tenantId_code_key" ON "ParkingFacility"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ParkingBuilding_tenantId_idx" ON "ParkingBuilding"("tenantId");

-- CreateIndex
CREATE INDEX "ParkingFloor_tenantId_idx" ON "ParkingFloor"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingFloor_facilityId_level_buildingId_key" ON "ParkingFloor"("facilityId", "level", "buildingId");

-- CreateIndex
CREATE INDEX "ParkingZone_tenantId_idx" ON "ParkingZone"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingZone_facilityId_code_key" ON "ParkingZone"("facilityId", "code");

-- CreateIndex
CREATE INDEX "ParkingSlot_tenantId_idx" ON "ParkingSlot"("tenantId");

-- CreateIndex
CREATE INDEX "ParkingSlot_facilityId_state_vehicleClass_idx" ON "ParkingSlot"("facilityId", "state", "vehicleClass");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingSlot_facilityId_code_key" ON "ParkingSlot"("facilityId", "code");

-- CreateIndex
CREATE INDEX "ParkingGate_tenantId_idx" ON "ParkingGate"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingGate_facilityId_code_key" ON "ParkingGate"("facilityId", "code");

-- CreateIndex
CREATE INDEX "ParkingCapacityPool_tenantId_idx" ON "ParkingCapacityPool"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingCapacityPool_facilityId_vehicleClass_key" ON "ParkingCapacityPool"("facilityId", "vehicleClass");

-- CreateIndex
CREATE INDEX "ParkingRestriction_tenantId_idx" ON "ParkingRestriction"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingAmenity_facilityId_key_key" ON "ParkingAmenity"("facilityId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityReview_facilityId_userId_key" ON "FacilityReview"("facilityId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleType_vehicleClass_key" ON "VehicleType"("vehicleClass");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNormalized_key" ON "Vehicle"("plateNormalized");

-- CreateIndex
CREATE INDEX "VehicleWhitelist_tenantId_plateNormalized_idx" ON "VehicleWhitelist"("tenantId", "plateNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleBlacklist_tenantId_plateNormalized_key" ON "VehicleBlacklist"("tenantId", "plateNormalized");

-- CreateIndex
CREATE INDEX "ParkingRatePlan_tenantId_idx" ON "ParkingRatePlan"("tenantId");

-- CreateIndex
CREATE INDEX "ParkingRatePlan_facilityId_vehicleClass_active_idx" ON "ParkingRatePlan"("facilityId", "vehicleClass", "active");

-- CreateIndex
CREATE INDEX "ParkingRateVersion_tenantId_idx" ON "ParkingRateVersion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingRateVersion_ratePlanId_version_key" ON "ParkingRateVersion"("ratePlanId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingCoupon_tenantId_code_key" ON "ParkingCoupon"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ParkingDiscount_tenantId_idx" ON "ParkingDiscount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingReservation_code_key" ON "ParkingReservation"("code");

-- CreateIndex
CREATE INDEX "ParkingReservation_tenantId_idx" ON "ParkingReservation"("tenantId");

-- CreateIndex
CREATE INDEX "ParkingReservation_facilityId_status_startsAt_idx" ON "ParkingReservation"("facilityId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "ParkingReservation_userId_idx" ON "ParkingReservation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationPriceSnapshot_reservationId_key" ON "ReservationPriceSnapshot"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationStatusHistory_reservationId_idx" ON "ReservationStatusHistory"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingSession_reservationId_key" ON "ParkingSession"("reservationId");

-- CreateIndex
CREATE INDEX "ParkingSession_tenantId_idx" ON "ParkingSession"("tenantId");

-- CreateIndex
CREATE INDEX "ParkingSession_facilityId_status_idx" ON "ParkingSession"("facilityId", "status");

-- CreateIndex
CREATE INDEX "ParkingSession_facilityId_plateNormalized_idx" ON "ParkingSession"("facilityId", "plateNormalized");

-- CreateIndex
CREATE INDEX "ParkingSession_entryAt_idx" ON "ParkingSession"("entryAt");

-- CreateIndex
CREATE INDEX "ParkingSessionEvent_sessionId_at_idx" ON "ParkingSessionEvent"("sessionId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingEntry_sessionId_key" ON "ParkingEntry"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingExit_sessionId_key" ON "ParkingExit"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingTicket_sessionId_key" ON "ParkingTicket"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingTicket_number_key" ON "ParkingTicket"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingTicket_qrToken_key" ON "ParkingTicket"("qrToken");

-- CreateIndex
CREATE INDEX "ParkingAssignment_slotId_releasedAt_idx" ON "ParkingAssignment"("slotId", "releasedAt");

-- CreateIndex
CREATE INDEX "ParkingFeeCalculation_sessionId_idx" ON "ParkingFeeCalculation"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_tenantId_createdAt_idx" ON "Payment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_sessionId_idx" ON "Payment"("sessionId");

-- CreateIndex
CREATE INDEX "Payment_reservationId_idx" ON "Payment"("reservationId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_paymentId_idx" ON "PaymentAttempt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_providerEventId_key" ON "PaymentWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialLedgerAccount_tenantId_code_key" ON "FinancialLedgerAccount"("tenantId", "code");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_tenantId_createdAt_idx" ON "FinancialLedgerEntry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_txnId_idx" ON "FinancialLedgerEntry"("txnId");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_refType_refId_idx" ON "FinancialLedgerEntry"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_tenantId_periodStart_periodEnd_key" ON "Settlement"("tenantId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_tenantId_kind_idx" ON "ReconciliationRecord"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_tenantId_userId_key" ON "StaffProfile"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "StaffShift_tenantId_idx" ON "StaffShift"("tenantId");

-- CreateIndex
CREATE INDEX "StaffShift_userId_status_idx" ON "StaffShift"("userId", "status");

-- CreateIndex
CREATE INDEX "ShiftCashRecord_shiftId_idx" ON "ShiftCashRecord"("shiftId");

-- CreateIndex
CREATE INDEX "StaffAssignment_tenantId_facilityId_idx" ON "StaffAssignment"("tenantId", "facilityId");

-- CreateIndex
CREATE INDEX "StaffActivity_tenantId_userId_at_idx" ON "StaffActivity"("tenantId", "userId", "at");

-- CreateIndex
CREATE INDEX "SupervisorOverride_tenantId_status_idx" ON "SupervisorOverride"("tenantId", "status");

-- CreateIndex
CREATE INDEX "HardwareDevice_tenantId_idx" ON "HardwareDevice"("tenantId");

-- CreateIndex
CREATE INDEX "HardwareDevice_facilityId_kind_idx" ON "HardwareDevice"("facilityId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCredential_keyId_key" ON "DeviceCredential"("keyId");

-- CreateIndex
CREATE INDEX "DeviceEvent_tenantId_receivedAt_idx" ON "DeviceEvent"("tenantId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEvent_deviceId_eventId_key" ON "DeviceEvent"("deviceId", "eventId");

-- CreateIndex
CREATE INDEX "CameraRecognitionEvent_tenantId_reviewStatus_idx" ON "CameraRecognitionEvent"("tenantId", "reviewStatus");

-- CreateIndex
CREATE INDEX "CameraRecognitionEvent_facilityId_plateNormalized_occurredA_idx" ON "CameraRecognitionEvent"("facilityId", "plateNormalized", "occurredAt");

-- CreateIndex
CREATE INDEX "BarrierCommand_tenantId_createdAt_idx" ON "BarrierCommand"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "BarrierCommand_gateId_status_idx" ON "BarrierCommand"("gateId", "status");

-- CreateIndex
CREATE INDEX "SensorReading_deviceId_at_idx" ON "SensorReading"("deviceId", "at");

-- CreateIndex
CREATE INDEX "HardwareAlert_tenantId_resolvedAt_idx" ON "HardwareAlert"("tenantId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ParkingPassPlan_tenantId_idx" ON "ParkingPassPlan"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingPass_number_key" ON "ParkingPass"("number");

-- CreateIndex
CREATE INDEX "ParkingPass_tenantId_status_idx" ON "ParkingPass"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ParkingPassUsage_passId_enteredAt_idx" ON "ParkingPassUsage"("passId", "enteredAt");

-- CreateIndex
CREATE INDEX "ValetRequest_tenantId_facilityId_status_idx" ON "ValetRequest"("tenantId", "facilityId", "status");

-- CreateIndex
CREATE INDEX "CorporateAccount_tenantId_idx" ON "CorporateAccount"("tenantId");

-- CreateIndex
CREATE INDEX "CorporateMember_corporateId_idx" ON "CorporateMember"("corporateId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateAllocation_corporateId_facilityId_vehicleClass_key" ON "CorporateAllocation"("corporateId", "facilityId", "vehicleClass");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateInvoice_number_key" ON "CorporateInvoice"("number");

-- CreateIndex
CREATE INDEX "SupportTicket_tenantId_status_idx" ON "SupportTicket"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IncidentReport_tenantId_facilityId_createdAt_idx" ON "IncidentReport"("tenantId", "facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_at_idx" ON "AuditLog"("tenantId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEntitlement" ADD CONSTRAINT "SubscriptionEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingFacility" ADD CONSTRAINT "ParkingFacility_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingFacility" ADD CONSTRAINT "ParkingFacility_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingBuilding" ADD CONSTRAINT "ParkingBuilding_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingFloor" ADD CONSTRAINT "ParkingFloor_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingFloor" ADD CONSTRAINT "ParkingFloor_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "ParkingBuilding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingZone" ADD CONSTRAINT "ParkingZone_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingZone" ADD CONSTRAINT "ParkingZone_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "ParkingFloor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSlot" ADD CONSTRAINT "ParkingSlot_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSlot" ADD CONSTRAINT "ParkingSlot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ParkingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingGate" ADD CONSTRAINT "ParkingGate_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingCapacityPool" ADD CONSTRAINT "ParkingCapacityPool_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingRestriction" ADD CONSTRAINT "ParkingRestriction_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingAmenity" ADD CONSTRAINT "ParkingAmenity_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityReview" ADD CONSTRAINT "FacilityReview_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOwner" ADD CONSTRAINT "VehicleOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOwner" ADD CONSTRAINT "VehicleOwner_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingRatePlan" ADD CONSTRAINT "ParkingRatePlan_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingRateVersion" ADD CONSTRAINT "ParkingRateVersion_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "ParkingRatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingRateRule" ADD CONSTRAINT "ParkingRateRule_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ParkingRateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingReservation" ADD CONSTRAINT "ParkingReservation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingReservation" ADD CONSTRAINT "ParkingReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingReservation" ADD CONSTRAINT "ParkingReservation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationPriceSnapshot" ADD CONSTRAINT "ReservationPriceSnapshot_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ParkingReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationStatusHistory" ADD CONSTRAINT "ReservationStatusHistory_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ParkingReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ParkingReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_passId_fkey" FOREIGN KEY ("passId") REFERENCES "ParkingPass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSessionEvent" ADD CONSTRAINT "ParkingSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingEntry" ADD CONSTRAINT "ParkingEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingExit" ADD CONSTRAINT "ParkingExit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingTicket" ADD CONSTRAINT "ParkingTicket_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingAssignment" ADD CONSTRAINT "ParkingAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingAssignment" ADD CONSTRAINT "ParkingAssignment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ParkingSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingFeeCalculation" ADD CONSTRAINT "ParkingFeeCalculation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSessionAdjustment" ADD CONSTRAINT "ParkingSessionAdjustment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialLedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCashRecord" ADD CONSTRAINT "ShiftCashRecord_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "StaffShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HardwareDevice" ADD CONSTRAINT "HardwareDevice_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ParkingFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HardwareDevice" ADD CONSTRAINT "HardwareDevice_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "ParkingGate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "HardwareDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "HardwareDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarrierCommand" ADD CONSTRAINT "BarrierCommand_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "ParkingGate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HardwareAlert" ADD CONSTRAINT "HardwareAlert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "HardwareDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingPass" ADD CONSTRAINT "ParkingPass_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ParkingPassPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingPass" ADD CONSTRAINT "ParkingPass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingPassVehicle" ADD CONSTRAINT "ParkingPassVehicle_passId_fkey" FOREIGN KEY ("passId") REFERENCES "ParkingPass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingPassVehicle" ADD CONSTRAINT "ParkingPassVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingPassUsage" ADD CONSTRAINT "ParkingPassUsage_passId_fkey" FOREIGN KEY ("passId") REFERENCES "ParkingPass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValetRequest" ADD CONSTRAINT "ValetRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ParkingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValetAssignment" ADD CONSTRAINT "ValetAssignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ValetRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleHandover" ADD CONSTRAINT "VehicleHandover_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ValetRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyCustodyRecord" ADD CONSTRAINT "KeyCustodyRecord_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ValetRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleConditionPhoto" ADD CONSTRAINT "VehicleConditionPhoto_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ValetRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateAccount" ADD CONSTRAINT "CorporateAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateMember" ADD CONSTRAINT "CorporateMember_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "CorporateAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateContract" ADD CONSTRAINT "CorporateContract_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "CorporateAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateAllocation" ADD CONSTRAINT "CorporateAllocation_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "CorporateAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateInvoice" ADD CONSTRAINT "CorporateInvoice_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "CorporateAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Park2All hand-written safeguards ─────

-- One active (non-terminal) session per plate per facility.
CREATE UNIQUE INDEX "ParkingSession_one_active_per_plate"
  ON "ParkingSession" ("facilityId", "plateNormalized")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED');

-- Capacity counters can never go negative or exceed capacity.
ALTER TABLE "ParkingCapacityPool"
  ADD CONSTRAINT "pool_nonnegative" CHECK ("occupied" >= 0 AND "reservedHeld" >= 0 AND "blocked" >= 0 AND "totalCapacity" >= 0),
  ADD CONSTRAINT "pool_within_capacity" CHECK ("occupied" + "reservedHeld" + "blocked" <= "totalCapacity");

ALTER TABLE "FinancialLedgerEntry"
  ADD CONSTRAINT "ledger_one_sided" CHECK (("debitMinor" > 0 AND "creditMinor" = 0) OR ("creditMinor" > 0 AND "debitMinor" = 0));

ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amountMinor" > 0 AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor");

-- Append-only tables.
CREATE OR REPLACE FUNCTION park2all_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON "FinancialLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION park2all_block_mutation();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION park2all_block_mutation();
