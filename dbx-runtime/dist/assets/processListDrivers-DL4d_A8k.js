import{p as e}from"./jdbcDialect-CpckLfxx.js";import{n as t,t as n}from"./kingbaseCatalogCompatibility-F_jXacGT.js";var r=new Set([`mysql`]),i=`SHOW FULL PROCESSLIST`,a=3600;function o(){let e=!1;return{tryStart(){return!e&&(e=!0,!0)},finish(){e=!1}}}function s(e){let t=e.find(e=>e.execution_error===!0);if(!t)return null;let n=t.rows?.[0]?.[0];return n==null||String(n).length===0?`Query execution failed`:String(n)}function c(e,t){return t?`${e}+`:e}function l(e,t){let n=t.toLowerCase();return e.findIndex(e=>e.toLowerCase()===n)}function u(e){return e==null?``:String(e)}function d(e){if(e==null)return null;let t=String(e);return t.length===0?null:t}function f(e){if(typeof e==`number`)return e;let t=Number(e);return Number.isFinite(t)?t:0}function p(e){if(!e||!Array.isArray(e.columns)||!Array.isArray(e.rows))return[];let t=e.columns,n=l(t,`Id`),r=l(t,`User`),i=l(t,`Host`),a=l(t,`db`),o=l(t,`Command`),s=l(t,`Time`),c=l(t,`State`),p=l(t,`Info`),m=(e,t)=>t>=0?e[t]:null;return e.rows.map(e=>({id:f(m(e,n)),user:u(m(e,r)),host:u(m(e,i)),db:d(m(e,a)),command:u(m(e,o)),time:f(m(e,s)),state:d(m(e,c)),info:d(m(e,p))}))}function m(e){if(!Number.isInteger(e)||e<=0)throw Error(`Invalid session id: ${e}`);return`KILL QUERY ${e}`}function h(e){if(!Number.isFinite(e))return 5;let t=Math.floor(e);return t<1?1:t>3600?a:t}function g(e){return!!e&&r.has(e)}var _=`SELECT pid,
       usename AS "user",
       datname AS db,
       coalesce(host(client_addr), client_hostname, 'local') AS client,
       application_name AS app,
       state,
       coalesce(nullif(wait_event_type, '') || ':' || wait_event, wait_event_type, '') AS wait,
       floor(extract(epoch FROM (now() - coalesce(query_start, xact_start, backend_start))))::bigint AS time,
       query
FROM pg_stat_activity
ORDER BY time DESC NULLS LAST`,v=`SELECT pid,
       usename AS "user",
       datname AS db,
       coalesce(host(client_addr), client_hostname, 'local') AS client,
       application_name AS app,
       state,
       CASE WHEN waiting THEN 'Lock' ELSE '' END AS wait,
       floor(extract(epoch FROM (now() - coalesce(query_start, xact_start, backend_start))))::bigint AS time,
       query
FROM pg_stat_activity
ORDER BY time DESC NULLS LAST`,y=`SELECT pid,
       usename AS "user",
       datname AS db,
       coalesce(host(client_addr), client_hostname, 'local') AS client,
       application_name AS app,
       state,
       CASE WHEN waiting THEN 'Lock' ELSE '' END AS wait,
       CAST(floor(extract(epoch FROM (CURRENT_TIMESTAMP - coalesce(query_start, xact_start, backend_start)))) AS BIGINT) AS time,
       query
FROM pg_catalog.pg_stat_activity
ORDER BY time DESC NULLS LAST`,b=`SELECT pid,
       usename AS "user",
       datname AS db,
       coalesce(CAST(client_addr AS VARCHAR), client_hostname, 'local') AS client,
       application_name AS app,
       state,
       coalesce(nullif(concat_ws(':', wait_event_type, wait_event), ''), '') AS wait,
       CAST(floor(
         extract(epoch FROM CAST(CURRENT_TIMESTAMP AS TIMESTAMP))
         - extract(epoch FROM CAST(coalesce(query_start, xact_start, backend_start) AS TIMESTAMP))
       ) AS BIGINT) AS time,
       query
FROM sys_catalog.sys_stat_activity
ORDER BY time DESC NULLS LAST`,x=b.replace(`sys_catalog.sys_stat_activity`,`pg_catalog.pg_stat_activity`),S=`SELECT pg_backend_pid()`,C=`SELECT pg_backend_pid()`,w=`SELECT sys_backend_pid()`,T=`SELECT pg_backend_pid()`;function E(e,t){let n=t.toLowerCase();return e.findIndex(e=>e.toLowerCase()===n)}function D(e){return e==null?``:String(e)}function O(e){if(e==null)return null;let t=String(e);return t.length===0?null:t}function k(e){if(typeof e==`number`)return e;let t=Number(e);return Number.isFinite(t)?t:0}function A(e){if(!e||!Array.isArray(e.columns)||!Array.isArray(e.rows))return[];let t=e.columns,n=E(t,`pid`),r=E(t,`user`),i=E(t,`db`),a=E(t,`client`),o=E(t,`app`),s=E(t,`state`),c=E(t,`wait`),l=E(t,`time`),u=E(t,`query`),d=(e,t)=>t>=0?e[t]:null;return e.rows.map(e=>({id:k(d(e,n)),user:D(d(e,r)),db:O(d(e,i)),client:D(d(e,a)),app:O(d(e,o)),state:O(d(e,s)),wait:O(d(e,c)),time:k(d(e,l)),query:O(d(e,u))}))}function j(e){if(!Number.isInteger(e)||e<=0)throw Error(`Invalid backend pid: ${e}`)}function M(e){return j(e),`SELECT pg_cancel_backend(${e})`}function N(e){return j(e),`SELECT sys_cancel_backend(${e})`}function P(e){return j(e),`SELECT pg_cancel_backend(${e})`}function F(e){return R(e,`pg_cancel_backend`)}function I(e){return R(e,`sys_cancel_backend`)}function L(e){return R(e,`pg_cancel_backend`)}function R(e,t){let n=e.find(e=>e.execution_error!==!0)?.rows?.[0]?.[0];return n===!0||n===1||String(n).toLowerCase()===`t`||String(n).toLowerCase()===`true`?null:`${t} did not cancel a running query`}function z(e){if((typeof e==`object`&&e&&`code`in e?String(e.code??``):``)===`42703`)return!0;let t=e instanceof Error?e.message:String(e);return/(?:wait_event_type|wait_event).*(?:does not exist|42703)|(?:does not exist|42703).*(?:wait_event_type|wait_event)/i.test(t)}function B(e){return t(e,[`sys_catalog.sys_stat_activity`])}function V(e){return n(e,[`sys_backend_pid`])}function H(e){return n(e,[`sys_cancel_backend`])}var U=[{key:`id`,labelKey:`processList.colId`,mono:!0,numeric:!0},{key:`user`,labelKey:`processList.colUser`},{key:`host`,labelKey:`processList.colHost`},{key:`db`,labelKey:`processList.colDb`},{key:`command`,labelKey:`processList.colCommand`},{key:`time`,labelKey:`processList.colTime`,mono:!0,numeric:!0},{key:`state`,labelKey:`processList.colState`},{key:`info`,labelKey:`processList.colInfo`,mono:!0,wide:!0}],W=[{key:`id`,labelKey:`processList.colPid`,mono:!0,numeric:!0},{key:`user`,labelKey:`processList.colUser`},{key:`db`,labelKey:`processList.colDb`},{key:`client`,labelKey:`processList.colClient`},{key:`app`,labelKey:`processList.colApp`},{key:`state`,labelKey:`processList.colState`},{key:`wait`,labelKey:`processList.colWait`},{key:`time`,labelKey:`processList.colTime`,mono:!0,numeric:!0},{key:`query`,labelKey:`processList.colQuery`,mono:!0,wide:!0}],G={listSql:i,ownSessionSql:`SELECT CONNECTION_ID()`,columns:U,defaultSortKey:`time`,maxRows:5e3,mapRows:e=>p(e),buildCancelQuerySql:m},K={listSql:_,fallbackListSql:v,shouldUseFallbackListSql:z,ownSessionSql:S,columns:W,defaultSortKey:`time`,maxRows:5e3,mapRows:e=>A(e),buildCancelQuerySql:M,cancelQueryResultError:F},q={listSql:y,ownSessionSql:C,columns:W,defaultSortKey:`time`,maxRows:5e3,mapRows:e=>A(e),buildCancelQuerySql:M,cancelQueryResultError:F},J={listSql:b,fallbackListSql:x,shouldUseFallbackListSql:B,ownSessionSql:w,fallbackOwnSessionSql:T,shouldUseFallbackOwnSessionSql:V,columns:W,defaultSortKey:`time`,maxRows:5e3,mapRows:e=>A(e),buildCancelQuerySql:N,buildFallbackCancelQuerySql:P,shouldUseFallbackCancelQuerySql:H,cancelQueryResultError:I,fallbackCancelQueryResultError:L};function Y(e){return g(e)?G:e===`postgres`?K:e===`opengauss`?q:e===`kingbase`?J:null}var X=/(?:kyuubi|hive2|org\.apache\.hive\.jdbc\.HiveDriver|hive-jdbc)/i;function Z(t){if(!t)return null;if(t.db_type===`jdbc`){let e=[t.driver_profile,t.connection_string,t.jdbc_driver_class,...t.jdbc_driver_paths??[]].filter(Boolean).join(`
`);if(X.test(e))return null}let n=e(t);return n===`gaussdb`&&t.driver_profile?.toLowerCase()===`opengauss`?q:Y(n)}function Q(e){return Z(e)!==null}export{s as a,o as i,Z as n,c as o,h as r,Q as t};