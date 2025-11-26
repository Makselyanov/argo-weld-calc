# Database Migration for Extended Material List

## Overview
This migration guide describes the necessary database changes to support the extended material list in the argo-weld-calc application.

## Changes Required

### Table: `calculations`

The `material` column should be of type `TEXT` or `VARCHAR` to accept all new material values.

#### New Material Values:
- `black_metal` (was `steel`)
- `stainless`
- `aluminium`
- `cast_iron`
- `copper` (new)
- `brass` (new)
- `titanium` (new)

#### Migration Steps:

If the `material` column has an ENUM constraint, it needs to be removed or updated.

**Option 1: Remove ENUM constraint (if exists)**
```sql
-- Check current constraint
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'calculations' AND constraint_type = 'CHECK';

-- Drop constraint if exists (replace 'constraint_name' with actual name)
ALTER TABLE calculations DROP CONSTRAINT IF EXISTS calculations_material_check;
```

**Option 2: Update ENUM to include new values**
```sql
-- If using PostgreSQL ENUM type, you need to add new values
ALTER TYPE material_enum ADD VALUE IF NOT EXISTS 'copper';
ALTER TYPE material_enum ADD VALUE IF NOT EXISTS 'brass';
ALTER TYPE material_enum ADD VALUE IF NOT EXISTS 'titanium';

-- Rename old value (if ENUM is used and 'steel' needs to be renamed to 'black_metal')
-- Note: PostgreSQL doesn't support renaming enum values directly
-- You would need to:
-- 1. Create new enum with all values
-- 2. Alter column to use new enum
-- 3. Drop old enum
```

**Option 3: Change column type to TEXT (recommended)**
```sql
-- Change column type from ENUM to TEXT if it's currently an ENUM
ALTER TABLE calculations 
ALTER COLUMN material TYPE TEXT;
```

#### Update Existing Data (if renaming steel to black_metal):
```sql
-- Update existing records that use 'steel' to 'black_metal'
UPDATE calculations 
SET material = 'black_metal' 
WHERE material = 'steel';

-- Update existing records that use 'other' to null or a specific value
-- UPDATE calculations 
-- SET material = NULL 
-- WHERE material = 'other';
```

## Testing

After migration, verify:
1. New calculations can be created with all 7 material types
2. Existing calculations remain accessible
3. Material values display correctly in History and calculation details

## Rollback

If needed to rollback:
```sql
-- Rename back
UPDATE calculations 
SET material = 'steel' 
WHERE material = 'black_metal';

-- Remove new materials (set to NULL or 'other')
UPDATE calculations 
SET material = NULL 
WHERE material IN ('copper', 'brass', 'titanium');
```
