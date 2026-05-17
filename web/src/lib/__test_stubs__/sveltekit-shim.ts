/**
 * Vitest stub for `@sveltejs/kit` — Phase 34 Plan 34-07.
 *
 * The root vitest config aliases `@sveltejs/kit` to this file so test
 * runs (which execute outside the SvelteKit build pipeline + outside
 * web/node_modules) can still import `error` + `redirect` helpers.
 *
 * Shape mirrors `@sveltejs/kit`'s public error/redirect surface closely
 * enough for our load-function specs to assert against the thrown object.
 */
export class HttpError extends Error {
	status: number;
	body: { message: string };
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		this.body = { message };
	}
}

export class Redirect {
	status: number;
	location: string;
	constructor(status: number, location: string) {
		this.status = status;
		this.location = location;
	}
}

export function error(status: number, body: string | { message: string }): never {
	const message = typeof body === 'string' ? body : body.message;
	throw new HttpError(status, message);
}

export function redirect(status: number, location: string): never {
	throw new Redirect(status, location);
}
