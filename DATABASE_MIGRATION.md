# Database Migration for Extended Material List

## Overview
This migration guide describes the necessary database changes to support the extended material list in the argo-weld-calc application.

## Changes Required

### Table: `calculations`

The `material` column should be of type `TEXT` or `VARCHAR` to accept all new material values.

#### New Material Values:
- `steel` (Черный металл)
- `stainless` (Нержавейка)
- `aluminium` (Алюминий)
- `cast_iron` (Чугун)
- `copper` (new - Медь)
- `brass` (new - Латунь)
- `titanium` (new - Титан)

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
```

**Option 3: Change column type to TEXT (recommended)**
```sql
-- Change column type from ENUM to TEXT if it's currently an ENUM
ALTER TABLE calculations 
ALTER COLUMN material TYPE TEXT;
```

#### Update Existing Data (if needed):
```sql
-- Update existing records that use 'other' to null or 'steel'
UPDATE calculations 
SET material = 'steel' 
WHERE material = 'other';

-- Or set to NULL if preferred
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
-- Remove new materials (set to NULL or 'steel')
UPDATE calculations 
SET material = 'steel' 
WHERE material IN ('copper', 'brass', 'titanium');
```
