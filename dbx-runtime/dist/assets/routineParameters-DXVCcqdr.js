import{Fi as e,ci as t}from"./api-B4E9_QFp.js";async function n(n){if(n.databaseType===`xugu`)return a((await e(n.connectionId,n.database,n.schema||n.database,n.routineName,`PROCEDURE`)).source).parameters;let r=i(n);return r?_(await t(n.connectionId,n.database,r,n.schema,void 0,{maxRows:200,pageSize:200}),n.databaseType):[]}function r(e){return e===`postgres`||e===`mysql`||e===`doris`||e===`starrocks`||e===`sqlserver`||e===`oracle`||e===`dameng`||e===`oceanbase-oracle`||e===`databend`||e===`xugu`}function i(e){if(!r(e.databaseType))return null;let t=E(e.schema||(e.databaseType===`postgres`?`public`:``)||(e.databaseType===`mysql`||e.databaseType===`doris`||e.databaseType===`starrocks`?e.database:``)),n=E(e.routineName);return e.databaseType===`postgres`?`
SELECT
  NULLIF(arg.name, '') AS name,
  arg.data_type,
  CASE arg.mode
    WHEN 'i' THEN 'IN'
    WHEN 'o' THEN 'OUT'
    WHEN 'b' THEN 'INOUT'
    WHEN 'v' THEN 'IN'
    WHEN 't' THEN 'OUT'
    ELSE 'IN'
  END AS mode,
  arg.ordinal,
  CASE
    WHEN COALESCE(arg.mode, 'i') IN ('i', 'b', 'v') AND p.pronargdefaults > 0 AND arg.input_ordinal > p.pronargs - p.pronargdefaults THEN TRUE
    ELSE FALSE
  END AS has_default
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL (
  SELECT
    gs.ordinal AS ordinal,
    p.proargnames[gs.ordinal] AS name,
    CASE
      WHEN p.proallargtypes IS NULL THEN p.proargtypes[gs.ordinal - 1]
      ELSE p.proallargtypes[gs.ordinal]
    END::regtype::text AS data_type,
    COALESCE(p.proargmodes[gs.ordinal], 'i') AS mode,
    COUNT(*) FILTER (WHERE COALESCE(p.proargmodes[gs.ordinal], 'i') IN ('i', 'b', 'v')) OVER (ORDER BY gs.ordinal) AS input_ordinal
  FROM generate_series(1, COALESCE(array_length(p.proallargtypes, 1), p.pronargs)) AS gs(ordinal)
) arg
WHERE p.prokind = 'p'
  AND n.nspname = ${t}
  AND p.proname = ${n}
ORDER BY arg.ordinal;`.trim():e.databaseType===`mysql`||e.databaseType===`doris`||e.databaseType===`starrocks`?`
SELECT
  PARAMETER_NAME AS name,
  DTD_IDENTIFIER AS data_type,
  COALESCE(PARAMETER_MODE, 'IN') AS mode,
  ORDINAL_POSITION AS ordinal,
  FALSE AS has_default
FROM information_schema.PARAMETERS
WHERE SPECIFIC_SCHEMA = ${t}
  AND SPECIFIC_NAME = ${n}
  AND ORDINAL_POSITION > 0
ORDER BY ORDINAL_POSITION;`.trim():e.databaseType===`databend`?`
SELECT arguments
FROM system.procedures
WHERE name = ${n}
ORDER BY procedure_id
LIMIT 1;`.trim():e.databaseType===`sqlserver`?`
SELECT
  p.name AS name,
  t.name AS data_type,
  CASE WHEN p.is_output = 1 THEN 'OUT' ELSE 'IN' END AS mode,
  p.parameter_id AS ordinal,
  p.has_default_value AS has_default,
  p.max_length AS max_length,
  p.precision AS precision,
  p.scale AS scale,
  SCHEMA_NAME(t.schema_id) AS type_schema,
  t.is_user_defined AS is_user_defined
FROM sys.parameters p
JOIN sys.objects o ON o.object_id = p.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types t ON t.user_type_id = p.user_type_id
WHERE o.type IN ('P', 'PC')
  AND s.name = ${t}
  AND o.name = ${n}
ORDER BY p.parameter_id;`.trim():e.databaseType===`oracle`||e.databaseType===`dameng`||e.databaseType===`oceanbase-oracle`?`
SELECT
  ARGUMENT_NAME AS name,
  DATA_TYPE AS data_type,
  IN_OUT AS mode,
  POSITION AS ordinal,
  DEFAULTED AS has_default
FROM ALL_ARGUMENTS
WHERE OWNER = UPPER(${t})
  AND OBJECT_NAME = UPPER(${n})
  AND POSITION > 0
ORDER BY SEQUENCE;`.trim():null}function a(e){let t=o(e);if(!t)return{parameters:[]};let n=t.findIndex(e=>l(e,`PROCEDURE`)||l(e,`FUNCTION`));if(n<0)return{parameters:[]};let r=t[n].text.toUpperCase(),i=s(t,n+1);if(i<0)return{kind:r,parameters:[]};let a=i,c=-1,f=[];if(t[a]?.text===`(`){if(c=u(t,a),c<0)return{kind:r,parameters:[]};f=d(e,t,a+1,c),a=c+1}let m=r===`FUNCTION`?p(e,t,a):void 0;return{kind:r,parameters:f,returnType:m}}function o(e){let t=[],n=0;for(;n<e.length;){let r=e[n];if(/\s/.test(r)){n+=1;continue}if(r===`-`&&e[n+1]===`-`){for(n+=2;n<e.length&&e[n]!==`
`&&e[n]!==`\r`;)n+=1;continue}if(r===`/`&&e[n+1]===`*`){let t=e.indexOf(`*/`,n+2);if(t<0)return null;n=t+2;continue}if(r===`'`||r===`"`){let i=n,a=r,o=!1;for(n+=1;n<e.length;){if(e[n]!==a){n+=1;continue}if(e[n+1]===a){n+=2;continue}n+=1,o=!0;break}if(!o)return null;t.push({kind:a===`'`?`string`:`quoted-identifier`,text:e.slice(i,n),start:i,end:n});continue}if(/[A-Za-z_#$]/.test(r)){let r=n;for(n+=1;n<e.length&&/[A-Za-z0-9_#$%]/.test(e[n]);)n+=1;t.push({kind:`word`,text:e.slice(r,n),start:r,end:n});continue}let i=n;r===`:`&&e[n+1]===`=`?n+=2:n+=1,t.push({kind:`symbol`,text:e.slice(i,n),start:i,end:n})}return t}function s(e,t){let n=e[t];if(!c(n))return-1;let r=t+1;for(;e[r]?.text===`.`&&c(e[r+1]);)r+=2;return r}function c(e){return e?.kind===`word`||e?.kind===`quoted-identifier`}function l(e,t){return e?.kind===`word`&&e.text.toUpperCase()===t}function u(e,t){let n=0;for(let r=t;r<e.length;r+=1)if(e[r].text===`(`&&(n+=1),e[r].text===`)`&&(--n,n===0))return r;return-1}function d(e,t,n,r){let i=[],a=0,o=n;for(let e=n;e<r;e+=1)t[e].text===`(`&&(a+=1),t[e].text===`)`&&(a=Math.max(0,a-1)),t[e].text===`,`&&a===0&&(i.push([o,e]),o=e+1);return i.push([o,r]),i.flatMap(([n,r],i)=>{let a=f(e,t,n,r,i+1);return a?[a]:[]})}function f(e,t,n,r,i){if(n>=r||!c(t[n]))return null;let a=g(t[n].text),o=n+1,s=`IN`;l(t[o],`INOUT`)?(s=`INOUT`,o+=1):l(t[o],`IN`)?l(t[o+1],`OUT`)?(s=`INOUT`,o+=2):(s=`IN`,o+=1):l(t[o],`OUT`)&&(s=`OUT`,o+=1);let u=0,d=-1;for(let e=o;e<r;e+=1)if(t[e].text===`(`&&(u+=1),t[e].text===`)`&&(u=Math.max(0,u-1)),u===0&&(l(t[e],`DEFAULT`)||t[e].text===`:=`||t[e].text===`=`)){d=e;break}let f=d>=0?d:r;if(o>=f)return null;let p=m(e,t,o,f).replace(/\s+/g,` `);if(!p)return null;let h=d>=0?m(e,t,d+1,r):void 0;return d>=0&&!h?null:{name:a,dataType:p,mode:s,ordinal:i,hasDefault:d>=0,defaultValue:h}}function p(e,t,n){let r=-1;for(let e=n;e<t.length&&!(l(t[e],`AS`)||l(t[e],`IS`));e+=1)if(l(t[e],`RETURN`)){r=e;break}if(r<0)return;let i=r+1,a=0;for(;i<t.length;){let e=t[i];if(e.text===`(`&&(a+=1),e.text===`)`&&(a=Math.max(0,a-1)),a===0&&(l(e,`AS`)||l(e,`IS`)||l(e,`AUTHID`)||l(e,`PIPELINED`)||l(e,`DETERMINISTIC`)))break;i+=1}if(!(r+1>=i))return m(e,t,r+1,i).replace(/\s+/g,` `)||void 0}function m(e,t,n,r){return n>=r?``:h(e.slice(t[n].start,t[r-1].end)).trim()}function h(e){let t=``,n=0,r=``;for(;n<e.length;){let i=e[n];if(r){if(t+=i,i===r){if(e[n+1]===r){t+=e[n+1],n+=2;continue}r=``}n+=1;continue}if(i===`'`||i===`"`){r=i,t+=i,n+=1;continue}if(i===`-`&&e[n+1]===`-`){for(t+=` `,n+=2;n<e.length&&e[n]!==`
`&&e[n]!==`\r`;)n+=1;continue}if(i===`/`&&e[n+1]===`*`){t+=` `;let r=e.indexOf(`*/`,n+2);if(r<0)break;n=r+2;continue}t+=i,n+=1}return t}function g(e){return!e.startsWith(`"`)||!e.endsWith(`"`)?e:e.slice(1,-1).replace(/""/g,`"`)}function _(e,t){if(t===`databend`)return x(e);let n=t===`sqlserver`?{maxLength:e.columns.findIndex(e=>e.toLowerCase()===`max_length`),precision:e.columns.findIndex(e=>e.toLowerCase()===`precision`),scale:e.columns.findIndex(e=>e.toLowerCase()===`scale`),typeSchema:e.columns.findIndex(e=>e.toLowerCase()===`type_schema`),isUserDefined:e.columns.findIndex(e=>e.toLowerCase()===`is_user_defined`)}:null;return e.rows.map((e,t)=>{let r=String(e[1]||``);return{name:String(e[0]||`arg${t+1}`),dataType:n?v(r,e,n):r,mode:w(e[2]),ordinal:Number(e[3]||t+1),hasDefault:T(e[4])}}).filter(e=>e.mode!==`RETURN`)}function v(e,t,n){let r=e.trim();if(!r)return``;if(T(y(t,n.isUserDefined))){let e=String(y(t,n.typeSchema)||``).trim(),i=b(r);return e?`${b(e)}.${i}`:i}let i=r.toLowerCase(),a=Number(y(t,n.maxLength));if([`varchar`,`char`,`varbinary`,`binary`].includes(i)&&Number.isFinite(a))return`${r}(${a===-1?`max`:Math.max(1,a)})`;if([`nvarchar`,`nchar`].includes(i)&&Number.isFinite(a))return`${r}(${a===-1?`max`:Math.max(1,Math.floor(a/2))})`;let o=Number(y(t,n.precision)),s=Number(y(t,n.scale));return[`decimal`,`numeric`].includes(i)&&Number.isFinite(o)&&Number.isFinite(s)?`${r}(${o},${s})`:[`datetime2`,`datetimeoffset`,`time`].includes(i)&&Number.isFinite(s)?`${r}(${s})`:i===`float`&&Number.isFinite(o)?`${r}(${o})`:r}function y(e,t){return t>=0?e[t]:void 0}function b(e){return`[${e.replace(/]/g,`]]`)}]`}function x(e){let t=e.columns.findIndex(e=>e.toLowerCase()===`arguments`);return S(String(e.rows[0]?.[t>=0?t:0]||``)).map((e,t)=>({name:`arg${t+1}`,dataType:e,mode:`IN`,ordinal:t+1,hasDefault:!1}))}function S(e){let t=e.indexOf(`(`);if(t<0)return[];let n=0;for(let r=t;r<e.length;r+=1){let i=e[r];if(i===`(`&&(n+=1),i===`)`&&(--n,n===0))return C(e.slice(t+1,r)).filter(Boolean)}return[]}function C(e){let t=[],n=``,r=0;for(let i of e){if(i===`(`&&(r+=1),i===`)`&&(r=Math.max(0,r-1)),i===`,`&&r===0){t.push(n.trim()),n=``;continue}n+=i}return n.trim()&&t.push(n.trim()),t}function w(e){let t=String(e||`IN`).toUpperCase().replace(/\s+/g,``);return t===`IN`?`IN`:t===`OUT`?`OUT`:t===`INOUT`||t===`IN/OUT`?`INOUT`:t===`RETURN`?`RETURN`:`UNKNOWN`}function T(e){if(typeof e==`boolean`)return e;if(typeof e==`number`)return e!==0;let t=String(e||``).toLowerCase();return t===`true`||t===`yes`||t===`y`||t===`1`}function E(e){return`'${e.replace(/'/g,`''`)}'`}export{a as n,n as t};