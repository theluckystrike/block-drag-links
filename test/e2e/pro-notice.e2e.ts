import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import type Plugin from '../../src/main';

type Notices = { text: string; buttons: number }[];

const NEXT = 'Sponsor on GitHub, then sign in from the plugin settings.';
const MULTI = 'Drag all blocks of a selection is a Pro feature.';
const READABLE = 'Readable block IDs are a Pro feature.';

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(id);
	}, pluginId);
	try {
		await browser.waitUntil(async () => (await toggleState('Readable block IDs')) !== null, { timeout: 10000 });
	} catch {
		throw new Error(`The settings tab did not show the Pro toggles: ${(await probe('Readable block IDs', false)).html}`);
	}
}

async function closeTab(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		(app as unknown as { setting: { close(): void } }).setting.close();
		(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove());
	});
}

interface Probe { found: boolean; on: boolean; disabled: boolean; html: string }

/**
 * Finds the row of a toggle by its name in the open settings tab, and selects the toggle when click is true.
 * The row is the nearest parent of the name that holds a toggle (.checkbox-container or a checkbox input).
 */
async function probe(name: string, click: boolean): Promise<Probe> {
	return browser.executeObsidian(({ app }, label, select) => {
		const tab = (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab;
		const root: HTMLElement = tab?.containerEl ?? document.body;
		const names = [...root.querySelectorAll<HTMLElement>('*')].filter((el) => el.childElementCount === 0 && el.textContent?.trim() === label);
		for (const nameEl of names) {
			let row: HTMLElement | null = nameEl;
			while (row && row !== root && !row.querySelector('.checkbox-container, input[type="checkbox"]')) row = row.parentElement;
			if (!row || row === root) continue;
			const box = row.querySelector<HTMLElement>('.checkbox-container') ?? row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
			const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
			const on = box.classList.contains('is-enabled') || !!input?.checked;
			const disabled = box.classList.contains('is-disabled') || row.classList.contains('is-disabled') || !!input?.disabled;
			// A real click moves the focus into the row. Obsidian does not draw a focused control again, so the test focuses it too.
			if (select) { box.focus(); box.click(); }
			return { found: true, on, disabled, html: '' };
		}
		return { found: false, on: false, disabled: false, html: root.innerHTML.slice(0, 1500) };
	}, name, click);
}

/** On and off state, or null when the row is not drawn. */
async function toggleState(name: string): Promise<{ on: boolean; disabled: boolean } | null> {
	const p = await probe(name, false);
	return p.found ? { on: p.on, disabled: p.disabled } : null;
}

async function clickToggle(name: string): Promise<void> {
	const p = await probe(name, true);
	if (!p.found) throw new Error(`no toggle ${name}: ${p.html}`);
}

const notices = (): Promise<Notices> => browser.executeObsidian(() => [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));

/** State for a failure message: Pro on or off, the notices, the settings and the toggle. */
async function diagnose(name: string): Promise<string> {
	const state = await browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
		const pro = p.pro as unknown as { isPro(): boolean; hasToken(): boolean; getState(): unknown } | null;
		return { pro: pro?.isPro(), token: pro?.hasToken(), state: pro?.getState(), settings: p.settings, notices: [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => n.textContent) };
	}, pluginId);
	// Call the tab method directly, to see a thrown error, then look for the lead anywhere in the page.
	const direct = await browser.executeObsidian(async ({ app }, lead) => {
		const tab = (app as unknown as { setting: { activeTab?: { setControlValue(k: string, v: unknown): unknown } } }).setting.activeTab;
		let error = '';
		try { await tab?.setControlValue('readableIds', true); } catch (e) { error = String((e as Error)?.stack ?? e); }
		await new Promise((r) => setTimeout(r, 300));
		const hits = [...document.querySelectorAll<HTMLElement>('*')].filter((el) => el.childElementCount === 0 && (el.textContent ?? '').includes(lead)).map((el) => el.outerHTML.slice(0, 200));
		return { error, containers: (window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice-container').length, notices: (window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice').length, body: (window as unknown as { activeWindow: Window }).activeWindow.document.body.innerText.includes(lead), same: (window as unknown as { activeWindow: Window }).activeWindow === window, hits, tab: !!tab };
	}, READABLE);
	return JSON.stringify({ ...state, toggle: await toggleState(name), direct });
}

async function waitNotice(lead: string, name: string): Promise<void> {
	try {
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(lead)), { timeout: 5000 });
	} catch {
		throw new Error(`No Pro notice after ${name}: ${await diagnose(name)}`);
	}
}

async function stored(): Promise<{ memory: { multiBlock: boolean; readableIds: boolean }; disk: unknown }> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
		return { memory: { ...p.settings }, disk: (await p.loadData()) as unknown };
	}, pluginId);
}

describe(`${pluginId} Pro notice`, function () {
	afterEach(async function () {
		await closeTab();
	});

	it('a free user who selects a Pro toggle gets a Pro notice with a Sponsor button, the toggle goes back to off, and the setting stays', async function () {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			p.pro?.signOut();
			(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, pluginId);
		const before = await stored();
		await openTab();
		// A free user sees the values in effect: both Pro toggles are off and enabled. multiBlock is stored as true (default).
		expect(before.memory.multiBlock).toBe(true);
		expect(await toggleState('Readable block IDs')).toEqual({ on: false, disabled: false });
		expect(await toggleState('Drag all blocks of a selection')).toEqual({ on: false, disabled: false });

		await clickToggle('Readable block IDs');
		await waitNotice(READABLE, 'Readable block IDs');
		const one = (await notices()).find((n) => n.text.includes(READABLE))!;
		expect(one.text).toContain(`${READABLE} ${NEXT}`);
		expect(one.buttons).toBe(1);
		// The tab draws again with the stored value.
		await browser.waitUntil(async () => (await toggleState('Readable block IDs'))?.on === false, { timeout: 5000, timeoutMsg: 'The Readable block IDs toggle did not go back to off.' });

		await clickToggle('Drag all blocks of a selection');
		await waitNotice(MULTI, 'Drag all blocks of a selection');
		const two = (await notices()).find((n) => n.text.includes(MULTI))!;
		expect(two.text).toContain(`${MULTI} ${NEXT}`);
		expect(two.buttons).toBe(1);
		await browser.waitUntil(async () => (await toggleState('Drag all blocks of a selection'))?.on === false, { timeout: 5000, timeoutMsg: 'The Drag all blocks toggle did not go back to off.' });

		// The Pro action did not run: no value changed in memory or on disk.
		expect(await stored()).toEqual(before);
	});

	it('a Pro user who selects a Pro toggle changes the setting', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			if (!p.pro) throw new Error('Sponsors manager missing');
			const manager = p.pro as unknown as { opts: { http: unknown }; refreshNow(): Promise<unknown>; isPro(): boolean };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			if (!manager.isPro()) throw new Error('The simulated Sponsors check did not turn Pro on.');
			p.settings.readableIds = false;
			await p.saveSettings();
			(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, pluginId);
		try {
			await openTab();
			expect(await toggleState('Readable block IDs')).toEqual({ on: false, disabled: false });
			await clickToggle('Readable block IDs');
			await browser.waitUntil(async () => (await stored()).memory.readableIds, { timeout: 5000, timeoutMsg: 'A Pro user could not turn on Readable block IDs.' });
			const after = await stored();
			expect((after.disk as { readableIds?: boolean } | null)?.readableIds).toBe(true);
			expect(await toggleState('Readable block IDs')).toEqual({ on: true, disabled: false });
			expect((await notices()).some((n) => n.text.includes('Pro feature'))).toBe(false);
		} finally {
			await browser.executeObsidian(async ({ app }, id) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
				p.settings.readableIds = false;
				await p.saveSettings();
				p.pro?.signOut();
			}, pluginId);
		}
	});
});
