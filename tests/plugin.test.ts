import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BlockDragLinksPlugin from '../src/main';
import { DEFAULT_SETTINGS, effectiveOptions, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('BlockDragLinksPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new BlockDragLinksPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ multiBlock: 'yes' as never, readableIds: 1 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ readableIds: true }).readableIds).toBe(true);
	});

	it('keeps the Pro options off without Pro', () => {
		const saved = { multiBlock: true, readableIds: true };
		expect(effectiveOptions(saved, false)).toEqual({ multi: false, readable: false });
		expect(effectiveOptions(saved, true)).toEqual({ multi: true, readable: true });
	});

	it('is desktop only: HTML drag events do not start from a touch in the editor', () => {
		expect(manifest.isDesktopOnly).toBe(true);
	});
});
