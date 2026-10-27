import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import BlockDragLinksPlugin from '../src/main';
import { BlockDragLinksSettingTab, DEFAULT_SETTINGS } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

function setup(): { plugin: BlockDragLinksPlugin; tab: BlockDragLinksSettingTab; saved: unknown[] } {
	const app = App.createConfigured__({ files: {} });
	const plugin = new BlockDragLinksPlugin(app as never, manifest as never);
	plugin.settings = { ...DEFAULT_SETTINGS };
	const saved: unknown[] = [];
	plugin.saveData = vi.fn(async (data: unknown) => { saved.push(structuredClone(data)); });
	const tab = new BlockDragLinksSettingTab(app as never, plugin);
	tab.update = vi.fn();
	return { plugin, tab, saved };
}

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'block-drag-links' },
	} as unknown as SponsorsManager;
}

/** The Obsidian base method that stores a value. The test mock does not store, so the test watches the call. */
function baseSave() {
	return vi.spyOn(Object.getPrototypeOf(BlockDragLinksSettingTab.prototype) as { setControlValue(key: string, value: unknown): unknown }, 'setControlValue');
}

describe('Pro toggles in the settings tab', () => {
	afterEach(() => {
		resetPro();
		vi.restoreAllMocks();
	});

	it('a free user who selects a Pro toggle does not change the setting, and the tab draws again', async () => {
		const shown: { text: string; buttons: number }[] = [];
		vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
			shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
		});
		const { plugin, tab, saved } = setup();
		bindPro(fakePro(false));
		const base = baseSave();
		await tab.setControlValue('readableIds', true);
		await tab.setControlValue('multiBlock', false);
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(saved).toEqual([]);
		expect(base).not.toHaveBeenCalled();
		expect(tab.update).toHaveBeenCalledTimes(2);
		expect(shown).toEqual([
			{ text: 'Readable block IDs are a Pro feature. Sponsor on GitHub, then sign in from the plugin settings.Sponsor on GitHub', buttons: 1 },
			{ text: 'Drag all blocks of a selection is a Pro feature. Sponsor on GitHub, then sign in from the plugin settings.Sponsor on GitHub', buttons: 1 },
		]);
	});

	it('a free user sees the values in effect, and a refused select moves the focus out of the tab', async () => {
		const { plugin, tab } = setup();
		bindPro(fakePro(false));
		plugin.settings = { multiBlock: true, readableIds: true };
		// The toggles show what is in effect for a free user: off. The stored choice stays for the time that Pro comes back.
		expect(tab.getControlValue('multiBlock')).toBe(false);
		expect(tab.getControlValue('readableIds')).toBe(false);
		// Obsidian does not draw a control again while it has the focus, so the refusal moves the focus out first.
		activeDocument.body.appendChild(tab.containerEl);
		const box = tab.containerEl.createEl('input');
		box.focus();
		expect(activeDocument.activeElement).toBe(box);
		await tab.setControlValue('readableIds', true);
		expect(activeDocument.activeElement).not.toBe(box);
		expect(tab.update).toHaveBeenCalledTimes(1);
		expect(plugin.settings).toEqual({ multiBlock: true, readableIds: true });
		tab.containerEl.remove();
	});

	it('a Pro user sees the stored values', () => {
		const { tab } = setup();
		bindPro(fakePro(true));
		const base = vi.spyOn(Object.getPrototypeOf(BlockDragLinksSettingTab.prototype) as { getControlValue(key: string): unknown }, 'getControlValue').mockReturnValue(true);
		expect(tab.getControlValue('readableIds')).toBe(true);
		expect(base).toHaveBeenCalledWith('readableIds');
	});

	it('a Pro user who selects a Pro toggle changes the setting', async () => {
		const { plugin, tab } = setup();
		bindPro(fakePro(true));
		const base = baseSave();
		await tab.setControlValue('readableIds', true);
		expect(base).toHaveBeenCalledWith('readableIds', true);
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(tab.update).not.toHaveBeenCalled();
	});
});
