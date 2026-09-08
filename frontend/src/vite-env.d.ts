/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Base URL of the backend (e.g. https://api.example.com). Unset in dev. */
	readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
