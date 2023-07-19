interface Env {
	CORS_ALLOW_ORIGIN: string;
	HELIUS_API_KEY: string;
	RateLimit: KVNamespace;
}

export default {
	async fetch(request: Request, env: Env, event: FetchEvent) {
		// If the request is an OPTIONS request, return a 200 response with permissive CORS headers
		// This is required for the Helius RPC Proxy to work from the browser and arbitrary origins
		// If you wish to restrict the origins that can access your Helius RPC Proxy, you can do so by
		// changing the `*` in the `Access-Control-Allow-Origin` header to a specific origin.
		// For example, if you wanted to allow requests from `https://example.com`, you would change the
		// header to `https://example.com`. Multiple domains are supported by verifying that the request
		// originated from one of the domains in the `CORS_ALLOW_ORIGIN` environment variable.
		const supportedDomains = env.CORS_ALLOW_ORIGIN ? env.CORS_ALLOW_ORIGIN.split(',') : undefined;
		const corsHeaders: Record<string, string> = {
			'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
			'Access-Control-Allow-Headers': '*',
		};
		if (supportedDomains) {
			const origin = request.headers.get('Origin');
			if (origin && supportedDomains.includes(origin)) {
				corsHeaders['Access-Control-Allow-Origin'] = origin;
			}
		} else {
			corsHeaders['Access-Control-Allow-Origin'] = '*';
		}

		const ip = request.headers.get('cf-connecting-ip');

		if (ip) {
			let requests: any = await env.RateLimit.get(ip);
			if (requests !== null && requests > 1000) {
				return new Response('Rate limit exceeded', { status: 429 });
			} else {
				let newRequests = (Number(requests) + 1).toString();
				event.waitUntil(env.RateLimit.put(ip, newRequests, { expirationTtl: 3600 }));
			}
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 200,
				headers: corsHeaders,
			});
		}

		const upgradeHeader = request.headers.get('Upgrade');
		if (upgradeHeader || upgradeHeader === 'websocket') {
			return await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, request);
		}

		const { pathname, search } = new URL(request.url);
		const payload = await request.text();

		const url = `https://${
			pathname === '/' ? 'mainnet.helius-rpc.com' : 'api.helius.xyz'
		}${pathname}?api-key=${env.HELIUS_API_KEY}${search ? `&${search.slice(1)}` : ''}`;

		const proxyRequest = new Request(url, {
			method: request.method,
			body: payload || null,
			headers: {
				'Content-Type': 'application/json',
				'X-Helius-Cloudflare-Proxy': 'true',
				...corsHeaders,
			},
		});

		return await fetch(proxyRequest);
	},
};
