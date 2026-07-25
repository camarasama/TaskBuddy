-- Avatar cosmetics (growth roadmap §4.4).
--
-- A points SINK. Rewards depend on a parent delivering something in the real world; when they are
-- slow, points stop meaning anything and the loop stalls. Cosmetics give points value the child
-- controls entirely.
--
-- Bought with in-app points earned from tasks. There is NO purchase path in the child experience.
CREATE TABLE "cosmetic_items" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    -- Renderer key the frontend maps to CSS/SVG; keeps art out of the database.
    "asset_key" TEXT NOT NULL,
    "points_cost" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cosmetic_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cosmetic_items_category_asset_key_key" ON "cosmetic_items"("category", "asset_key");
CREATE INDEX "cosmetic_items_category_idx" ON "cosmetic_items"("category");

-- Ownership is permanent; a child never loses something they paid for. is_equipped is separate.
CREATE TABLE "child_cosmetics" (
    "id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "is_equipped" BOOLEAN NOT NULL DEFAULT false,
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_cosmetics_pkey" PRIMARY KEY ("id")
);

-- Double-purchase is refused at the database level, not only in the service.
CREATE UNIQUE INDEX "child_cosmetics_child_id_item_id_key" ON "child_cosmetics"("child_id", "item_id");
CREATE INDEX "child_cosmetics_child_id_is_equipped_idx" ON "child_cosmetics"("child_id", "is_equipped");

ALTER TABLE "child_cosmetics" ADD CONSTRAINT "child_cosmetics_child_id_fkey"
    FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_cosmetics" ADD CONSTRAINT "child_cosmetics_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "cosmetic_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
