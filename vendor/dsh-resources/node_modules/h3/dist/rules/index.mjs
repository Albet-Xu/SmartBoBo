import { callMiddleware } from "../middleware.mjs";
import { isPreflightRequest } from "../cors.mjs";
import { HTTP_METHODS, buildRouteRuleMiddleware, cors, createMatcherFromFind, createRouteRulesMatcher, headers, memoizeRouteRulesMatcher, mergeMatchedRouteRules, normalizeRouteRules, redirect, ruleHandlers } from "../normalize.mjs";
import { createCacheRuleHandler } from "../cache2.mjs";
function routeRules(config, opts) {
	const memoize = opts?.memoize ?? true;
	const matcher = createRouteRulesMatcher(normalizeRouteRules(config), opts);
	const match = memoize ? memoizeRouteRulesMatcher(matcher, memoize === true ? void 0 : memoize) : matcher;
	return function routeRulesMiddleware(event, next) {
		const pathname = event.url.pathname;
		const method = event.req.method.toUpperCase();
		let matched = match(method, pathname);
		if (method === "OPTIONS" && isPreflightRequest(event)) matched = liftPreflightCors(matched, match, event, pathname);
		const { routeRules, routeRuleMiddleware } = matched;
		const prev = event.context.routeRules;
		event.context.routeRules = prev ? Object.assign(Object.create(null), prev, routeRules) : routeRules;
		return routeRuleMiddleware.length > 0 ? callMiddleware(event, routeRuleMiddleware, () => next()) : next();
	};
}
function liftPreflightCors(matched, match, event, pathname) {
	const requested = event.req.headers.get("access-control-request-method");
	if (!requested) return matched;
	const method = requested.toUpperCase();
	if (method === "OPTIONS" || !HTTP_METHODS.has(method)) return matched;
	const cors = match(method, pathname).matchedRules.cors;
	if (!cors || cors === matched.matchedRules.cors) return matched;
	const matchedRules = Object.assign(Object.create(null), matched.matchedRules, { cors });
	return {
		routeRules: Object.assign(Object.create(null), matched.routeRules, { cors: cors.options }),
		matchedRules,
		routeRuleMiddleware: buildRouteRuleMiddleware(matchedRules)
	};
}
export { cors, createCacheRuleHandler, createMatcherFromFind, createRouteRulesMatcher, headers, memoizeRouteRulesMatcher, mergeMatchedRouteRules, normalizeRouteRules, redirect, routeRules, ruleHandlers };
