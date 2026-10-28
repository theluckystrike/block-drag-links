import { PluginSettingTab, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems, redrawKeepFocus } from './license/github-obsidian';
import { PRO_MULTI, PRO_READABLE, PRO_UI, isPro, proNotice } from './pro';
import type { DragOptions } from './drag';
import type BlockDragLinksPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface BlockDragLinksSettings {
	/** Pro: drag every block of a selection, one link for each block. */
	multiBlock: boolean;
	/** Pro: make a new id from the first words of the block, for example ^call-bob. */
	readableIds: boolean;
}

export const DEFAULT_SETTINGS: BlockDragLinksSettings = {
	multiBlock: true,
	readableIds: false,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<BlockDragLinksSettings> | null | undefined): BlockDragLinksSettings {
	const s = saved ?? {};
	return {
		multiBlock: typeof s.multiBlock === 'boolean' ? s.multiBlock : DEFAULT_SETTINGS.multiBlock,
		readableIds: typeof s.readableIds === 'boolean' ? s.readableIds : DEFAULT_SETTINGS.readableIds,
	};
}

/** The options in effect. Without Pro: one block for each drag and random ids. */
export function effectiveOptions(settings: BlockDragLinksSettings, pro: boolean): DragOptions {
	return { multi: pro && settings.multiBlock, readable: pro && settings.readableIds };
}

export class BlockDragLinksSettingTab extends PluginSettingTab {
	/** The last Pro notice of this tab and its lead. The same notice does not show again while it is open. */
	private notice: Notice | null = null;
	private noticeLead = '';
	plugin: BlockDragLinksPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BlockDragLinksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Drag all blocks of a selection',
				desc: 'Pro. Select lines across several blocks, then drag the handle of one of them. The drop inserts one link for each block, one for each line.',
				control: { type: 'toggle', key: 'multiBlock', defaultValue: DEFAULT_SETTINGS.multiBlock },
			},
			{
				name: 'Readable block IDs',
				desc: 'Pro. Make a new block ID from the first three words of the block, for example ^call-bob. When this is off, a new ID has 6 random letters and digits, as Obsidian makes.',
				control: { type: 'toggle', key: 'readableIds', defaultValue: DEFAULT_SETTINGS.readableIds },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: the two settings above work.'
					: 'Free version: drag one heading or one block to insert a link, hold Ctrl or Cmd at the drop for an embed, and get a block ID in the source note. Pro adds the drag of all blocks of a selection and readable block IDs.',
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	getControlValue(key: string): unknown {
		// A free user sees the values in effect: both Pro toggles off. The stored choice stays for the time that Pro comes back.
		if ((key === 'multiBlock' || key === 'readableIds') && !isPro()) return false;
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		// Free users can select the Pro toggles: the notice shows what Pro adds and how to get it. Nothing is saved.
		const lead = key === 'multiBlock' ? PRO_MULTI : key === 'readableIds' ? PRO_READABLE : null;
		if (lead && !isPro()) {
			// One notice at a time for the same Pro setting: a repeated key on the focused control adds no new notice.
			const noticeLead = lead;
			if (!this.notice?.messageEl.isConnected || this.noticeLead !== noticeLead) {
				this.notice = proNotice(noticeLead);
				this.noticeLead = noticeLead;
			}
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the toggle shows the value in effect (off).
			redrawKeepFocus(this);
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
