import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
import { DRAG_HELPER } from './helper';

// Real-app checks E1 to E8 of the spec, on minAppVersion and on the latest app (wdio.conf.mts).
const SOURCE = ['Intro text.', '', 'The key fact is here.', '', '## Plan: next #2', '', 'Body.', '', '- [ ] Call Bob', '', '```js', 'code line', '```', ''].join('\n');
const TARGET = ['Links:', '', ''].join('\n');

interface Bdl {
	setup(src: string, tgt?: string): Promise<string>;
	hover(p: string | number, line: number): Promise<HTMLElement | null>;
	start(p: string | number, line: number): Promise<string>;
	drop(p: string | number, line: number, ch: number, ctrl?: boolean): Promise<string>;
	cancel(): Promise<string>;
	text(p: string | number): string | null;
	cm(p: string): { dispatch(spec: unknown): void; state: { doc: { length: number; lines: number }; replaceSelection(t: string): unknown } };
}
type W = Window & { __bdl: Bdl };

async function install(): Promise<void> {
	await browser.execute((code: string) => {
		(0, eval)(code);
	}, DRAG_HELPER);
}

/** Writes a note and waits until the vault has the text. */
async function writeNote(path: string, text: string): Promise<void> {
	await obsidianPage.write(path, text);
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(async ({ app }, p, t) => {
				const file = app.vault.getFileByPath(p);
				return !!file && (await app.vault.read(file)) === t && !!app.metadataCache.getFileCache(file);
			}, path, text),
		{ timeout: 10000, interval: 50, timeoutMsg: `${path} was not written` },
	);
}

async function editorText(path: string | number): Promise<string | null> {
	return browser.execute((p: string | number) => (window as unknown as W).__bdl.text(p), path);
}

async function fileText(path: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, p) => {
		const file = app.vault.getFileByPath(p);
		return file ? app.vault.read(file) : '';
	}, path);
}

async function setup(src: string, tgt?: string): Promise<void> {
	await install();
	await browser.execute((s: string, t: string | null) => (window as unknown as W).__bdl.setup(s, t ?? undefined), src, tgt ?? null);
}

async function dragTo(src: string | number, line: number, tgt: string | number, tline: number, ch: number, ctrl = false): Promise<void> {
	await browser.execute((p: string | number, l: number) => (window as unknown as W).__bdl.start(p, l), src, line);
	await browser.execute((p: string | number, l: number, c: number, k: boolean) => (window as unknown as W).__bdl.drop(p, l, c, k), tgt, tline, ch, ctrl);
}

/** Waits until the metadata cache of a note lists a block id. */
async function waitCachedId(path: string, id: string): Promise<void> {
	await browser.waitUntil(
		async () => browser.executeObsidian(({ app }, p, want) => Object.keys(app.metadataCache.getFileCache(app.vault.getFileByPath(p)!)?.blocks ?? {}).includes(want), path, id),
		{ timeout: 5000, interval: 50, timeoutMsg: `the metadata cache of ${path} has no ${id}` },
	);
}

/** Waits until the editor of a note shows a text that passes the check. */
async function waitEditor(path: string | number, ok: (t: string) => boolean, what: string): Promise<string> {
	let last: string | null = null;
	await browser
		.waitUntil(
			async () => {
				last = await editorText(path);
				return last !== null && ok(last);
			},
			{ timeout: 5000, interval: 50 },
		)
		.catch(() => {
			throw new Error(`${what}: ${JSON.stringify(last)}`);
		});
	return last ?? '';
}

async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

describe(`${pluginId} drag in the real app`, function () {
	beforeEach(async function () {
		await setPro(false);
		// Close every editor first, so no editor saves an old text over the new notes.
		await browser.executeObsidian(async ({ app }) => {
			app.workspace.detachLeavesOfType('markdown');
			await new Promise((r) => setTimeout(r, 500));
		});
		await writeNote('Source.md', SOURCE);
		await writeNote('Target.md', TARGET);
		await writeNote('Other.md', 'Other note.\n');
		await setup('Source.md', 'Target.md');
	});

	it('E1 drag a paragraph into another note makes a block link and adds the id to the source', async function () {
		await dragTo('Source.md', 2, 'Target.md', 2, 0);
		const target = await waitEditor('Target.md', (t) => /\[\[Source#\^[a-z0-9]{6}\]\]/.test(t), 'no block link in Target');
		const id = /\^([a-z0-9]{6})/.exec(target)![1]!;
		expect(target).toBe(`Links:\n\n[[Source#^${id}]]`);
		const source = await editorText('Source.md');
		expect(source).toBe(SOURCE.replace('The key fact is here.', `The key fact is here. ^${id}`));
		// The source editor saves at once, so the metadata cache has the id before the 2 s autosave.
		await browser.waitUntil(
			async () => browser.executeObsidian(({ app }, want) => Object.keys(app.metadataCache.getFileCache(app.vault.getFileByPath('Source.md')!)?.blocks ?? {}).includes(want), id),
			{ timeout: 1500, interval: 50, timeoutMsg: 'the metadata cache has no new id after 1.5 s' },
		);
	});

	it('E2 a drop with Ctrl makes an embed, and a second drag reuses the id', async function () {
		await dragTo('Source.md', 2, 'Target.md', 2, 0);
		const first = await waitEditor('Target.md', (t) => /\^[a-z0-9]{6}/.test(t), 'no first link');
		const id = /\^([a-z0-9]{6})/.exec(first)![1]!;
		const sourceAfterFirst = await editorText('Source.md');
		await browser.execute(() => {
			const w = window as unknown as W;
			const v = w.__bdl.cm('Target.md');
			v.dispatch({ changes: { from: v.state.doc.length, insert: '\n' }, selection: { anchor: v.state.doc.length + 1 } });
		});
		await dragTo('Source.md', 2, 'Target.md', 3, 0, true);
		const target = await waitEditor('Target.md', (t) => t.includes('![['), 'no embed');
		expect(target).toBe(`Links:\n\n[[Source#^${id}]]\n![[Source#^${id}]]`);
		expect(await editorText('Source.md')).toBe(sourceAfterFirst);
	});

	it('E3 drag a heading with special characters makes a heading link', async function () {
		await dragTo('Source.md', 4, 'Target.md', 2, 0);
		const target = await waitEditor('Target.md', (t) => t.includes('[['), 'no heading link');
		expect(target).toBe('Links:\n\n[[Source#Plan next 2]]');
		expect(await editorText('Source.md')).toBe(SOURCE);
	});

	it('E4 a drop in the same note makes a link without the note name', async function () {
		await dragTo('Source.md', 4, 'Source.md', 13, 0);
		const source = await waitEditor('Source.md', (t) => t.includes('[[#'), 'no same-note link');
		expect(source).toBe(SOURCE + '[[#Plan next 2]]');
	});

	it('E5 Undo in the source editor removes the new id', async function () {
		await dragTo('Source.md', 8, 'Target.md', 2, 0);
		await waitEditor('Source.md', (t) => /- \[ \] Call Bob \^[a-z0-9]{6}/.test(t), 'no id on the task');
		// Editor.undo of the source editor: the id came through that editor, so its history holds it.
		await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('markdown').find((l) => (l.view as unknown as { file?: { path: string } }).file?.path === 'Source.md')!;
			(leaf.view as unknown as { editor: { undo(): void } }).editor.undo();
		});
		await waitEditor('Source.md', (t) => t === SOURCE, 'Undo did not remove the id');
		expect(await editorText('Target.md')).toMatch(/\[\[Source#\^[a-z0-9]{6}\]\]/);
	});

	it('E6 a closed source note gets the id by vault.process, and every other byte stays', async function () {
		await browser.execute((p: string, l: number) => (window as unknown as W).__bdl.start(p, l), 'Source.md', 0);
		// Close the source: its pane opens another note. No editor shows Source.md now.
		await browser.executeObsidian(async ({ app }) => {
			const leaf = app.workspace.getLeavesOfType('markdown').find((l) => (l.view as unknown as { file?: { path: string } }).file?.path === 'Source.md')!;
			await leaf.openFile(app.vault.getFileByPath('Other.md')!);
		});
		await browser.execute((p: string, l: number, c: number) => (window as unknown as W).__bdl.drop(p, l, c, false), 'Target.md', 2, 0);
		let disk = '';
		await browser.waitUntil(async () => (disk = await fileText('Source.md')).includes('^'), { timeout: 5000, interval: 50, timeoutMsg: 'no id on disk' });
		const id = /\^([a-z0-9]{6})/.exec(disk)![1]!;
		expect(disk).toBe(SOURCE.replace('Intro text.', `Intro text. ^${id}`));
		await waitEditor('Target.md', (t) => t === `Links:\n\n[[Source#^${id}]]`, 'no link after the vault write');
	});

	it('E7 a source note that changed after the drag start is not written', async function () {
		await browser.execute((p: string, l: number) => (window as unknown as W).__bdl.start(p, l), 'Source.md', 6);
		const changed = SOURCE.replace('Body.', 'Body changed.');
		await browser.executeObsidian(async ({ app }, text) => {
			const leaf = app.workspace.getLeavesOfType('markdown').find((l) => (l.view as unknown as { file?: { path: string } }).file?.path === 'Source.md')!;
			await leaf.openFile(app.vault.getFileByPath('Other.md')!);
			await app.vault.modify(app.vault.getFileByPath('Source.md')!, text);
		}, changed);
		await browser.execute((p: string, l: number, c: number) => (window as unknown as W).__bdl.drop(p, l, c, false), 'Target.md', 2, 0);
		await browser.pause(500);
		expect(await fileText('Source.md')).toBe(changed);
		expect(await editorText('Target.md')).toBe(TARGET);
		const notice = await browser.execute(() => Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? '').join('|'));
		expect(notice).toContain('No link was made: the source note changed');
	});

	it('E8 code block lines and empty lines show no handle', async function () {
		await install();
		const code = await browser.execute(async () => !!(await (window as unknown as W).__bdl.hover('Source.md', 11)));
		const empty = await browser.execute(async () => !!(await (window as unknown as W).__bdl.hover('Source.md', 1)));
		const para = await browser.execute(async () => !!(await (window as unknown as W).__bdl.hover('Source.md', 2)));
		expect({ code, empty, para }).toEqual({ code: false, empty: false, para: true });
	});

	it('E9 typing in a 5,000 line note stays fast with the plugin on', async function () {
		const big = Array.from({ length: 5000 }, (_, i) => (i % 5 === 0 ? `## Part ${i}` : i % 5 === 4 ? '' : `- item ${i} with some words`)).join('\n');
		await writeNote('Big.md', big);
		await setup('Big.md');
		const ms = await browser.execute(async () => {
			const w = window as unknown as W;
			const v = w.__bdl.cm('Big.md');
			// One hover first, so the line scan of the note is part of the cost.
			await w.__bdl.hover('Big.md', 2);
			const t0 = performance.now();
			for (let i = 0; i < 300; i++) v.dispatch(v.state.replaceSelection('x'));
			return performance.now() - t0;
		});
		// ESTIMATE: 300 key presses under 1.5 s on a CI runner is under 5 ms each. Core alone takes about 1 ms each.
		expect(ms).toBeLessThan(1500);
	});

	it('E11 a cancelled drag writes nothing and carries the block text as plain text', async function () {
		await browser.execute((p: string, l: number) => (window as unknown as W).__bdl.start(p, l), 'Source.md', 2);
		const plain = await browser.execute(() => (window as unknown as W).__bdl.cancel());
		expect(plain).toBe('The key fact is here.');
		await browser.pause(300);
		expect(await editorText('Source.md')).toBe(SOURCE);
		expect(await editorText('Target.md')).toBe(TARGET);
	});

	it('E12 one note in two panes: the id and the link stay, on disk and in the cache (R3 A, A2)', async function () {
		await setup('Source.md', 'Source.md');
		await dragTo(0, 2, 1, 6, 5);
		const want = (id: string) => SOURCE.replace('The key fact is here.', `The key fact is here. ^${id}`).replace('Body.', `Body.[[#^${id}]]`);
		const one = await waitEditor(1, (t) => /Body\.\[\[#\^[a-z0-9]{6}\]\]/.test(t), 'no link in pane 2');
		const id = /\[\[#\^([a-z0-9]{6})\]\]/.exec(one)![1]!;
		expect(one).toBe(want(id));
		await waitEditor(0, (t) => t === want(id), 'pane 1 lost the id or the link');
		await browser.pause(2500);
		expect(await editorText(0)).toBe(want(id));
		expect(await editorText(1)).toBe(want(id));
		await waitCachedId('Source.md', id);
		await browser.waitUntil(async () => (await fileText('Source.md')) === want(id), { timeout: 5000, interval: 100, timeoutMsg: 'the disk text lost the id' });
	});

	it('E13 one note in two panes: a drop before the block keeps the id (R3 A3)', async function () {
		await setup('Source.md', 'Source.md');
		await dragTo(0, 6, 1, 0, 11);
		const want = (id: string) => SOURCE.replace('Intro text.', `Intro text.[[#^${id}]]`).replace('Body.', `Body. ^${id}`);
		const one = await waitEditor(1, (t) => /\[\[#\^[a-z0-9]{6}\]\]/.test(t), 'no link in pane 2');
		const id = /\[\[#\^([a-z0-9]{6})\]\]/.exec(one)![1]!;
		await browser.pause(2500);
		expect(await editorText(0)).toBe(want(id));
		expect(await editorText(1)).toBe(want(id));
		await waitCachedId('Source.md', id);
	});

	it('E14 a quote and a callout with an inline id keep it, and get no second id (R3 B, B2)', async function () {
		const q = ['Para.', '', '> quoted text ^old123', '', '> [!note] T', '> body ^call12', '', 'End.', ''].join('\n');
		await writeNote('Q.md', q);
		await setup('Q.md', 'Target.md');
		await dragTo('Q.md', 2, 'Target.md', 2, 0);
		await waitEditor('Target.md', (t) => t === 'Links:\n\n[[Q#^old123]]', 'no link to the quote id');
		await dragTo('Q.md', 5, 'Target.md', 2, 0);
		await waitEditor('Target.md', (t) => t === 'Links:\n\n[[Q#^call12]][[Q#^old123]]', 'no link to the callout id');
		await browser.pause(500);
		expect(await editorText('Q.md')).toBe(q);
	});

	it('E15 a thematic break, a setext underline, a footnote and indented code show no handle (R3 C)', async function () {
		const h = ['Para one.', '', '---', '', 'Title', '=====', '', '[^1]: Note.', '', 'Text.', '', '    code line', ''].join('\n');
		await writeNote('H.md', h);
		await setup('H.md', 'Target.md');
		const shown = await browser.execute(async () => {
			const w = window as unknown as W;
			const out: Record<string, boolean> = {};
			for (const [k, l] of [['rule', 2], ['footnote', 7], ['code', 11], ['para', 0]] as const) out[k] = !!(await w.__bdl.hover('H.md', l));
			return out;
		});
		expect(shown).toEqual({ rule: false, footnote: false, code: false, para: true });
		// The setext heading gives a heading link and no id.
		await dragTo('H.md', 4, 'Target.md', 2, 0);
		await waitEditor('Target.md', (t) => t === 'Links:\n\n[[H#Title]]', 'no setext heading link');
		expect(await editorText('H.md')).toBe(h);
	});

	it('E16 a paragraph with an inline tag line gets the id at its end, and Obsidian finds it (R3 round 2 G)', async function () {
		const g = ['Some text here', '<span>more</span> text', '', '<mark>Key</mark> point.', ''].join('\n');
		await writeNote('G.md', g);
		await setup('G.md', 'Target.md');
		await dragTo('G.md', 0, 'Target.md', 2, 0);
		const target = await waitEditor('Target.md', (t) => /\[\[G#\^[a-z0-9]{6}\]\]/.test(t), 'no link to the paragraph');
		const id = /\^([a-z0-9]{6})/.exec(target)![1]!;
		expect(await editorText('G.md')).toBe(g.replace('<span>more</span> text', `<span>more</span> text ^${id}`));
		await waitCachedId('G.md', id);
		const mark = await browser.execute(async () => !!(await (window as unknown as W).__bdl.hover('G.md', 3)));
		expect(mark).toBe(true);
	});

	it('E17 a quote and a callout with a lazy line keep their section range after the id write (R3 round 3 Z1, Z2)', async function () {
		const z = ['> q1', '>', 'plain after empty quote line', '', '> [!note] T', '> body', '>', 'plain after', '', 'End.', ''].join('\n');
		await writeNote('Z.md', z);
		const sections = async (): Promise<string> =>
			browser.executeObsidian(({ app }) =>
				(app.metadataCache.getFileCache(app.vault.getFileByPath('Z.md')!)?.sections ?? [])
					.filter((x) => x.type === 'blockquote' || x.type === 'callout')
					.map((x) => `${x.type}:${x.position.start.line}-${x.position.end.line}`)
					.join(','),
			);
		const before = await sections();
		expect(before).toBe('blockquote:0-2,callout:4-7');
		await setup('Z.md', 'Target.md');
		await dragTo('Z.md', 0, 'Target.md', 2, 0);
		const t1 = await waitEditor('Target.md', (t) => /\[\[Z#\^[a-z0-9]{6}\]\]/.test(t), 'no quote link');
		const q = /\^([a-z0-9]{6})/.exec(t1)![1]!;
		await waitCachedId('Z.md', q);
		await dragTo('Z.md', 7, 'Target.md', 2, 0);
		const t2 = await waitEditor('Target.md', (t) => (t.match(/\[\[Z#\^/g) ?? []).length === 2, 'no callout link');
		const c = /^Links:\n\n\[\[Z#\^([a-z0-9]{6})\]\]/.exec(t2)![1]!;
		await waitCachedId('Z.md', c);
		// The ids sit after the lazy lines, so each section keeps its lines (ids on their own lines come after).
		const after = await sections();
		expect(after).toBe('blockquote:0-2,callout:6-9');
		expect(await editorText('Z.md')).toBe(z.replace('plain after empty quote line', `plain after empty quote line\n\n^${q}`).replace('plain after\n', `plain after\n\n^${c}\n`));
	});

	it('E10 Pro drags every block of a selection, one link for each line', async function () {
		await setPro(true);
		await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('markdown').find((l) => (l.view as unknown as { file?: { path: string } }).file?.path === 'Source.md')!;
			const ed = (leaf.view as unknown as { editor: { setSelection(a: { line: number; ch: number }, b: { line: number; ch: number }): void } }).editor;
			ed.setSelection({ line: 0, ch: 0 }, { line: 8, ch: 3 });
		});
		await dragTo('Source.md', 0, 'Target.md', 2, 0);
		const target = await waitEditor('Target.md', (t) => t.split('\n').length >= 7, 'no multi-block links');
		const lines = target.split('\n').slice(2);
		expect(lines.length).toBe(5);
		expect(lines[2]).toBe('[[Source#Plan next 2]]');
		for (const l of [lines[0], lines[1], lines[3], lines[4]]) expect(l).toMatch(/^\[\[Source#\^[a-z0-9-]+\]\]$/);
		await setPro(false);
	});
});
