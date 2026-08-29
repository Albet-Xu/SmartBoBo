import{p as e}from"./jdbcDialect-DtyGvh0F.js";import{n as t,t as n}from"./kingbaseCatalogCompatibility-F_jXacGT.js";import{c as r,t as i}from"./serverMetrics-BZb2R5jM.js";var a=`WITH db_stats AS (
  SELECT
    coalesce(sum(xact_commit),0) AS xact_commit,
    coalesce(sum(xact_rollback),0) AS xact_rollback,
    coalesce(sum(blks_hit),0) AS blks_hit,
    coalesce(sum(blks_read),0) AS blks_read,
    coalesce(sum(tup_returned),0) AS tup_returned,
    coalesce(sum(tup_fetched),0) AS tup_fetched,
    coalesce(sum(tup_inserted),0) AS tup_inserted,
    coalesce(sum(tup_updated),0) AS tup_updated,
    coalesce(sum(tup_deleted),0) AS tup_deleted,
    coalesce(sum(deadlocks),0) AS deadlocks,
    coalesce(sum(temp_files),0) AS temp_files
  FROM pg_stat_database
), activity_stats AS (
  SELECT
    coalesce(sum(CASE WHEN state IS NOT NULL THEN 1 ELSE 0 END),0) AS connections,
    coalesce(sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END),0) AS active_connections,
    coalesce(sum(CASE WHEN state = 'idle' THEN 1 ELSE 0 END),0) AS idle_connections
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
)
SELECT
  db_stats.*,
  activity_stats.*,
  coalesce(CASE WHEN pg_is_in_recovery()
    THEN pg_wal_lsn_diff(pg_last_wal_replay_lsn(), '0/0')
    ELSE pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')
  END, 0) AS wal_bytes,
  floor(extract(epoch FROM (now() - pg_postmaster_start_time())))::bigint AS uptime_seconds
FROM db_stats, activity_stats`,o=a.replace(/\bpg_current_wal_lsn\b/g,`pg_current_xlog_location`).replace(/\bpg_last_wal_replay_lsn\b/g,`pg_last_xlog_replay_location`).replace(/\bpg_wal_lsn_diff\b/g,`pg_xlog_location_diff`),s=`SELECT current_setting('max_connections') AS max_connections, current_setting('server_version') AS version`,c=`WITH db_stats AS (
  SELECT
    coalesce(sum(xact_commit),0) AS xact_commit,
    coalesce(sum(xact_rollback),0) AS xact_rollback,
    coalesce(sum(blks_hit),0) AS blks_hit,
    coalesce(sum(blks_read),0) AS blks_read,
    coalesce(sum(tup_returned),0) AS tup_returned,
    coalesce(sum(tup_fetched),0) AS tup_fetched,
    coalesce(sum(tup_inserted),0) AS tup_inserted,
    coalesce(sum(tup_updated),0) AS tup_updated,
    coalesce(sum(tup_deleted),0) AS tup_deleted,
    coalesce(sum(deadlocks),0) AS deadlocks,
    coalesce(sum(temp_files),0) AS temp_files
  FROM pg_catalog.pg_stat_database
), activity_stats AS (
  SELECT
    coalesce(sum(CASE WHEN state IS NOT NULL THEN 1 ELSE 0 END),0) AS connections,
    coalesce(sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END),0) AS active_connections,
    coalesce(sum(CASE WHEN state = 'idle' THEN 1 ELSE 0 END),0) AS idle_connections
  FROM pg_catalog.pg_stat_activity
  WHERE pid <> pg_backend_pid()
)
SELECT
  db_stats.*,
  activity_stats.*,
  coalesce(CASE WHEN pg_is_in_recovery()
    THEN pg_xlog_location_diff(CAST((pg_last_xlog_replay_location()).lsn AS text), CAST('0/0' AS text))
    ELSE pg_xlog_location_diff(CAST(pg_current_xlog_location() AS text), CAST('0/0' AS text))
  END, 0) AS wal_bytes,
  CAST(floor(extract(epoch FROM (CURRENT_TIMESTAMP - pg_postmaster_start_time()))) AS BIGINT) AS uptime_seconds
FROM db_stats
CROSS JOIN activity_stats`,l=c.replace(`(pg_last_xlog_replay_location()).lsn`,`pg_last_xlog_replay_location()`),u=`SELECT current_setting('max_connections') AS max_connections, version() AS version`;function d(e,t){return`WITH db_stats AS (
  SELECT
    coalesce(sum(xact_commit),0) AS xact_commit,
    coalesce(sum(xact_rollback),0) AS xact_rollback,
    coalesce(sum(blks_hit),0) AS blks_hit,
    coalesce(sum(blks_read),0) AS blks_read,
    coalesce(sum(tup_returned),0) AS tup_returned,
    coalesce(sum(tup_fetched),0) AS tup_fetched,
    coalesce(sum(tup_inserted),0) AS tup_inserted,
    coalesce(sum(tup_updated),0) AS tup_updated,
    coalesce(sum(tup_deleted),0) AS tup_deleted,
    coalesce(sum(deadlocks),0) AS deadlocks,
    coalesce(sum(temp_files),0) AS temp_files
  FROM ${e}.${t}_stat_database
), activity_stats AS (
  SELECT
    coalesce(sum(CASE WHEN state IS NOT NULL THEN 1 ELSE 0 END),0) AS connections,
    coalesce(sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END),0) AS active_connections,
    coalesce(sum(CASE WHEN state = 'idle' THEN 1 ELSE 0 END),0) AS idle_connections
  FROM ${e}.${t}_stat_activity
  WHERE pid <> ${t}_backend_pid()
)
SELECT
  db_stats.*,
  activity_stats.*,
  coalesce(CASE WHEN ${t}_is_in_recovery()
    THEN ${t}_wal_lsn_diff(${t}_last_wal_replay_lsn(), '0/0')
    ELSE ${t}_wal_lsn_diff(${t}_current_wal_lsn(), '0/0')
  END, 0) AS wal_bytes,
  CAST(floor(
    extract(epoch FROM CAST(CURRENT_TIMESTAMP AS TIMESTAMP))
    - extract(epoch FROM CAST(${t}_postmaster_start_time() AS TIMESTAMP))
  ) AS BIGINT) AS uptime_seconds
FROM db_stats
CROSS JOIN activity_stats`}var f=d(`sys_catalog`,`sys`),p=d(`pg_catalog`,`pg`),m=`SELECT current_setting('max_connections') AS max_connections, version() AS version`;function h(e){let t=typeof e==`object`&&e&&`code`in e?String(e.code??``):``;if(t!==``&&t!==`42883`)return!1;let n=e instanceof Error?e.message:String(e);return/(?:pg_current_wal_lsn|pg_last_wal_replay_lsn|pg_wal_lsn_diff)/i.test(n)&&/does not exist/i.test(n)}function g(e){if((typeof e==`object`&&e&&`code`in e?String(e.code??``):``)===`42809`)return!0;let t=e instanceof Error?e.message:String(e);return/\blsn\b/i.test(t)&&/(?:composite|record data type|column notation|identify column)/i.test(t)}function _(e){return t(e,[`sys_catalog.sys_stat_database`,`sys_catalog.sys_stat_activity`])||n(e,[`sys_backend_pid`,`sys_is_in_recovery`,`sys_wal_lsn_diff`,`sys_last_wal_replay_lsn`,`sys_current_wal_lsn`,`sys_postmaster_start_time`])}var v={statusSql:a,variablesSql:s,fallbackStatusSql:o,shouldUseFallbackStatusSql:h},y={statusSql:c,variablesSql:u,fallbackStatusSql:l,shouldUseFallbackStatusSql:g},b={statusSql:f,variablesSql:m,fallbackStatusSql:p,shouldUseFallbackStatusSql:_};function x(e){return e===`postgres`?v:e===`opengauss`?y:e===`kingbase`?b:null}function S(t){if(!t)return null;let n=e(t);return n===`gaussdb`&&t.driver_profile?.toLowerCase()===`opengauss`?y:x(n)}function C(e){let t={};if(!e||!Array.isArray(e.columns)||!Array.isArray(e.rows)||e.rows.length===0)return t;let n=e.rows[0];return e.columns.forEach((e,r)=>{let i=n[r];t[e]=i==null?``:String(i)}),t}function w(e,t){return i(e,t,`xact_commit`)+i(e,t,`xact_rollback`)}function T(e){let t=r(e,`blks_hit`),n=t+r(e,`blks_read`);if(n<=0)return null;let i=t/n*100;return Number.isFinite(i)?Math.max(0,Math.min(100,i)):null}function E(e){return S(e)!==null}export{S as a,T as i,E as n,C as r,w as t};