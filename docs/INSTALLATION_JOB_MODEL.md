# GasGuard Installation & Service Job Data Model

Phase 6D-1 introduces the database foundation for installation and maintenance service visits across GasGuard sites.

## 1. Domain Hierarchy

```
Customer
  └── Site
       └── Installation Job (installation / service)
            └── Job Assignment
                 └── Technician (auth.users)
```

- **Customer**: Owns one or more installation sites.
- **Site**: The physical deployment location containing zones, devices, and sensors.
- **Installation Job**: Represents a scheduled or active installation or service visit bound to a specific site.
- **Job Assignment**: Explicit mapping linking an `installation_job` to a assigned `technician` (`auth.users`).
- **Technician**: An authenticated user carrying the `technician` platform role claim (`auth.jwt() -> 'app_metadata' ->> 'role' = 'technician'`).

---

## 2. Table Definitions

### 2.1 `public.installation_jobs`

Tracks service and installation work orders for a site.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | Primary Key, `default gen_random_uuid()` | Unique job identifier |
| `site_id` | `uuid` | `NOT NULL`, `REFERENCES public.sites(id) ON DELETE CASCADE` | Associated site |
| `job_type` | `text` | `NOT NULL`, `CHECK (job_type IN ('installation', 'service'))` | Job classification |
| `status` | `text` | `NOT NULL DEFAULT 'scheduled'`, `CHECK (status IN ('scheduled', 'in_progress', 'blocked', 'completed', 'cancelled'))` | Job lifecycle state |
| `scheduled_for` | `timestamptz` | `NULL` | Target execution timestamp |
| `notes` | `text` | `NULL` | Operational instructions or site notes |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Record creation timestamp |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Record modification timestamp |

### 2.2 `public.job_assignments`

Explicitly assigns technicians to jobs.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `job_id` | `uuid` | `NOT NULL`, `REFERENCES public.installation_jobs(id) ON DELETE CASCADE` | Associated job |
| `technician_user_id` | `uuid` | `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` | Assigned technician user ID |
| `assignment_status` | `text` | `NOT NULL DEFAULT 'assigned'`, `CHECK (assignment_status IN ('assigned', 'accepted', 'completed', 'cancelled'))` | Assignment state |
| `assigned_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Assignment timestamp |
| `completed_at` | `timestamptz` | `NULL` | Completion timestamp |

- **Primary Key**: `(job_id, technician_user_id)`
- **Constraint**: `CHECK (assignment_status != 'completed' OR completed_at IS NOT NULL)`
- **Role Integrity**: A database trigger (`tr_validate_job_assignment_technician_role`) validates that `technician_user_id` has `raw_app_meta_data ->> 'role' = 'technician'` before assignment.

---

## 3. Authorization Model (RLS)

Authorization is strictly enforced at the PostgreSQL Row-Level Security layer.

| Role (`app_metadata.role`) | `installation_jobs` Access | `job_assignments` Access |
|---|---|---|
| **General** (`general`) | `SELECT` allowed ONLY if user holds active site membership (`site_memberships.status = 'active'`) for the job's site. | No direct access. |
| **Technician** (`technician`) | `SELECT` allowed ONLY if explicitly assigned to that job via `job_assignments`. | `SELECT` allowed for own assignments (`technician_user_id = auth.uid()`). |
| **Admin** (`admin`) | Global `SELECT` allowed for all jobs. | Global `SELECT` allowed for all job assignments. |
| **Developer** (`developer`) | No automatic business access. | No automatic business access. |
| **Anon** (`anon`) | Denied (`0` rows). | Denied (`0` rows). |

### Write Access
Browser-initiated `INSERT`, `UPDATE`, and `DELETE` queries on business tables remain **DENIED BY DEFAULT** in this phase.

---

## 4. Separation of Authorization Concepts

GasGuard enforces a clear boundary between platform roles, site membership, and job assignment:

1. **Platform Role**: Stored in JWT `app_metadata.role` (`general`, `technician`, `admin`, `developer`).
2. **Site Membership**: Grants general users access to site telemetry, devices, and overview. Technicians are **NOT** added to `site_memberships`.
3. **Job Assignment**: Grants technicians scoped access to a specific job and site for the duration of an installation or service visit.
