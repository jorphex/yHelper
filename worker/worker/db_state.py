from __future__ import annotations

import logging
import math
from datetime import UTC, datetime

import psycopg

from .config import DDL, JOB_KONG_SNAPSHOT, RUNNING_STALE_SECONDS, SNAPSHOT_MIN_ACTIVE_RATIO, SNAPSHOT_MIN_DROP_COUNT
def _ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(DDL)
        cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_raw NUMERIC(78, 0)")
        cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_decimals INTEGER")
        cur.execute("ALTER TABLE product_interactions ADD COLUMN IF NOT EXISTS amount_symbol TEXT")
        cur.execute("ALTER TABLE styfi_snapshots ADD COLUMN IF NOT EXISTS liquid_lockers_staked_raw NUMERIC(78, 0)")
        cur.execute("ALTER TABLE styfi_snapshots ADD COLUMN IF NOT EXISTS migrated_yfi_raw NUMERIC(78, 0)")
        cur.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'vault_dim'
                      AND column_name = 'feature_score'
                ) THEN
                    ALTER TABLE vault_dim DROP COLUMN feature_score;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'vault_dim_pkey'
                      AND conrelid = 'vault_dim'::regclass
                      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (chain_id, vault_address)'
                ) THEN
                    ALTER TABLE vault_dim DROP CONSTRAINT vault_dim_pkey;
                    ALTER TABLE vault_dim ADD CONSTRAINT vault_dim_pkey PRIMARY KEY (chain_id, vault_address);
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'vault_dim'
                      AND column_name = 'apr_net'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'vault_dim'
                      AND column_name = 'est_apy'
                ) THEN
                    ALTER TABLE vault_dim RENAME COLUMN apr_net TO est_apy;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'pps_timeseries_pkey'
                      AND conrelid = 'pps_timeseries'::regclass
                      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (chain_id, vault_address, ts)'
                ) THEN
                    ALTER TABLE pps_timeseries DROP CONSTRAINT pps_timeseries_pkey;
                    ALTER TABLE pps_timeseries ADD CONSTRAINT pps_timeseries_pkey PRIMARY KEY (chain_id, vault_address, ts);
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'vault_metrics_latest_pkey'
                      AND conrelid = 'vault_metrics_latest'::regclass
                      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (chain_id, vault_address)'
                ) THEN
                    ALTER TABLE vault_metrics_latest DROP CONSTRAINT vault_metrics_latest_pkey;
                    ALTER TABLE vault_metrics_latest ADD CONSTRAINT vault_metrics_latest_pkey PRIMARY KEY (chain_id, vault_address);
                END IF;
            END
            $$;
            """
        )
        cur.execute(
            """
            DO $$
            DECLARE
                idx_def TEXT;
            BEGIN
                EXECUTE 'DROP INDEX IF EXISTS idx_vault_dim_active_rank';

                SELECT indexdef
                INTO idx_def
                FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'idx_vault_dim_active_tvl';
                IF idx_def IS NOT NULL
                   AND idx_def <> 'CREATE INDEX idx_vault_dim_active_tvl ON public.vault_dim USING btree (tvl_usd DESC NULLS LAST, chain_id, vault_address) WHERE (active = true)'
                THEN
                    EXECUTE 'DROP INDEX IF EXISTS idx_vault_dim_active_tvl';
                END IF;

                SELECT indexdef
                INTO idx_def
                FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'idx_vault_metrics_points';
                IF idx_def IS NOT NULL
                   AND idx_def <> 'CREATE INDEX idx_vault_metrics_points ON public.vault_metrics_latest USING btree (points_count DESC, chain_id, vault_address)'
                THEN
                    EXECUTE 'DROP INDEX IF EXISTS idx_vault_metrics_points';
                END IF;
            END
            $$;
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_vault_dim_active_tvl
                ON vault_dim(tvl_usd DESC NULLS LAST, chain_id, vault_address)
                WHERE active = TRUE;
            CREATE INDEX IF NOT EXISTS idx_vault_metrics_points
                ON vault_metrics_latest(points_count DESC, chain_id, vault_address);
            """
        )
    conn.commit()


def _active_vault_count(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM vault_dim WHERE active = TRUE")
        row = cur.fetchone()
    return int(row[0] if row else 0)


def _has_successful_run(conn: psycopg.Connection, job_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM ingestion_runs
            WHERE job_name = %s AND status = 'success'
            LIMIT 1
            """,
            (job_name,),
        )
        return cur.fetchone() is not None


def _assert_snapshot_size_guard(
    conn: psycopg.Connection,
    *,
    normalized_count: int,
    payload_count: int,
    skipped_missing_identity: int,
) -> None:
    previous_active = _active_vault_count(conn)
    if previous_active <= 0 or normalized_count >= previous_active:
        return
    if not _has_successful_run(conn, JOB_KONG_SNAPSHOT):
        logging.warning(
            "Skipping snapshot size guard for initial Kong snapshot migration "
            "(previous_active=%s normalized=%s payload=%s skipped_missing_identity=%s)",
            previous_active,
            normalized_count,
            payload_count,
            skipped_missing_identity,
        )
        return
    drop_count = previous_active - normalized_count
    min_allowed_rows = max(1, math.ceil(previous_active * SNAPSHOT_MIN_ACTIVE_RATIO))
    if normalized_count < min_allowed_rows and drop_count >= SNAPSHOT_MIN_DROP_COUNT:
        raise ValueError(
            "Snapshot guard triggered: normalized rows dropped below safety threshold "
            f"(previous_active={previous_active}, normalized={normalized_count}, min_allowed={min_allowed_rows}, "
            f"drop_count={drop_count}, payload={payload_count}, skipped_missing_identity={skipped_missing_identity})"
        )


def _insert_run(conn: psycopg.Connection, job_name: str, started_at: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ingestion_runs (job_name, started_at, status)
            VALUES (%s, %s, 'running')
            RETURNING id
            """,
            (job_name, started_at),
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def _mark_stale_running_runs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET
                status = 'abandoned',
                ended_at = NOW(),
                error_summary = COALESCE(
                    error_summary,
                    json_build_object(
                        'error',
                        'marked abandoned by worker due to stale running status',
                        'stale_threshold_seconds',
                        %s
                    )::text
                )
            WHERE status = 'running'
              AND started_at < NOW() - (%s * INTERVAL '1 second')
            """,
            (RUNNING_STALE_SECONDS, RUNNING_STALE_SECONDS),
        )
        updated = cur.rowcount
    conn.commit()
    return updated


def _mark_boot_orphaned_runs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET
                status = 'abandoned',
                ended_at = NOW(),
                error_summary = COALESCE(
                    error_summary,
                    json_build_object(
                        'error',
                        'marked abandoned on worker boot due to orphan running status'
                    )::text
                )
            WHERE status = 'running'
            """
        )
        updated = cur.rowcount
    conn.commit()
    return updated


def _complete_run(conn: psycopg.Connection, run_id: int, status: str, records: int, error_summary: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE ingestion_runs
            SET ended_at = %s, status = %s, records = %s, error_summary = %s
            WHERE id = %s
            """,
            (datetime.now(UTC), status, records, error_summary, run_id),
        )
    conn.commit()

