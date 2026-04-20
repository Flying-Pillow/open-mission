import adapter from '@sveltejs/adapter-node';
import type { Config } from '@sveltejs/kit';

const config: Config = {
	compilerOptions: {
		experimental: {
			async: true
		}
	},
	kit: {
		adapter: adapter(),
		experimental: {
			remoteFunctions: true
		}
	}
};

export default config;