import { invoke } from '@tauri-apps/api/core';

export async function getMediaFile(
	filePath: string,
): Promise<{ data: string; mimeType: string }> {
	try {
		const result = await invoke<{ data: string; mimeType: string }>('get_media_file', {
			filePath: filePath,
		});

		return result;
	} catch (error) {
		// Tauri rejects `invoke` with the raw Err(String) payload, not an Error
		// instance — so an `instanceof Error` check used to discard the real
		// reason and surface "unknown error" to the user. Hugo's "Failed to load
		// media: failed to read media file: unknown error" feedback was actually
		// "File does not exist: <path>" upstream.
		const message =
			error instanceof Error
				? error.message
				: typeof error === "string"
					? error
					: JSON.stringify(error);
		console.error("failed to read media file:", message);
		throw new Error(`failed to read media file: ${message}`);
	}
}

