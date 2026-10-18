import { proxyRequest } from "../proxy.mjs";
import { prepareRuleTarget } from "../_utils.mjs";
const proxy = {
	order: 2,
	handler: (m) => {
		const options = m.options;
		const resolveTarget = prepareRuleTarget(options);
		if (!resolveTarget) return function proxyRouteRule() {};
		return function proxyRouteRule(event) {
			return proxyRequest(event, resolveTarget(event), { ...options });
		};
	}
};
export { proxy };
